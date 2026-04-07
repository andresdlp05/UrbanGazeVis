const heatmapLog = window.debugLog || function(...args) { if (window.DEBUG_LOGS) { console.log(...args); } };
let attentionHeatmapRenderState = null;
const HEATMAP_BLUE_MAX_INTENSITY = 0.80;
const HEATMAP_LABEL_FONT_FAMILY = '"Avenir Next Custom", "Inter", sans-serif';

function isUnknownClassLabel(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'unknown';
}

function measureHeatmapTextWidth(text, fontSize = 12, fontWeight = 400) {
    const content = String(text ?? '');
    if (typeof document === 'undefined') {
        return content.length * (fontSize * 0.6);
    }

    if (!measureHeatmapTextWidth._canvas) {
        measureHeatmapTextWidth._canvas = document.createElement('canvas');
    }
    const ctx = measureHeatmapTextWidth._canvas.getContext('2d');
    if (!ctx) {
        return content.length * (fontSize * 0.6);
    }

    ctx.font = `${fontWeight} ${fontSize}px ${HEATMAP_LABEL_FONT_FAMILY}`;
    return ctx.measureText(content).width;
}

function truncateHeatmapLabel(text, maxWidthPx, fontSize = 12, fontWeight = 400) {
    const content = String(text ?? '');
    if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) {
        return content;
    }
    if (measureHeatmapTextWidth(content, fontSize, fontWeight) <= maxWidthPx) {
        return content;
    }

    const ellipsis = '...';
    let low = 0;
    let high = content.length;
    let best = '';

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = `${content.slice(0, mid).trimEnd()}${ellipsis}`;
        const width = measureHeatmapTextWidth(candidate, fontSize, fontWeight);
        if (width <= maxWidthPx) {
            best = candidate;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return best || ellipsis;
}

function compactUnderscoreLabel(text) {
    const content = String(text ?? '');
    if (!content.includes('_')) {
        return content;
    }

    const parts = content
        .split('_')
        .map(part => part.trim())
        .filter(Boolean);

    if (parts.length >= 3) {
        return `${parts[0]}_${parts[parts.length - 1]}`;
    }

    return content;
}

function computeHeatmapLeftMargin(labels, containerWidth) {
    const baseMin = 100;
    const dynamicMax = Math.max(140, Math.floor(containerWidth * 0.32));
    const labelReserve = 14; // espacio entre etiqueta y celdas
    const axisTitleReserve = 22; // espacio para "Classes"
    const maxLabelWidth = (labels || []).reduce((max, label) => {
        const compactLabel = compactUnderscoreLabel(label);
        const width = measureHeatmapTextWidth(compactLabel, 12, 400);
        return Math.max(max, width);
    }, 0);
    const desired = Math.ceil(maxLabelWidth + labelReserve + axisTitleReserve);
    return Math.max(baseMin, Math.min(dynamicMax, desired));
}

function interpolateSoftBlues(t) {
    const normalized = Number.isFinite(t) ? t : 0;
    const clamped = Math.max(0, Math.min(1, normalized));
    return d3.interpolateBlues(clamped * HEATMAP_BLUE_MAX_INTENSITY);
}

function buildAttentionColumnStats(cellData) {
    const stats = new Map();
    (cellData || []).forEach(item => {
        const key = String(item.imageName);
        const current = stats.get(key);
        if (!current) {
            stats.set(key, { min: item.rawValue, max: item.rawValue });
            return;
        }
        current.min = Math.min(current.min, item.rawValue);
        current.max = Math.max(current.max, item.rawValue);
    });
    return stats;
}

function setAttentionHeatmapCellValues(cellData, colNormalize, columnStatsByImage) {
    const useColNormalize = Boolean(colNormalize);
    (cellData || []).forEach(item => {
        if (!useColNormalize) {
            item.value = item.baseValue;
            return;
        }
        const stats = columnStatsByImage.get(String(item.imageName));
        const min = stats ? stats.min : item.rawValue;
        const max = stats ? stats.max : item.rawValue;
        const range = (max - min) || 1;
        item.value = (item.rawValue - min) / range;
    });
}

function applyAttentionHeatmapNormalization(colNormalize = false) {
    if (!attentionHeatmapRenderState || !attentionHeatmapRenderState.cellsSelection) {
        return false;
    }

    setAttentionHeatmapCellValues(
        attentionHeatmapRenderState.cellData,
        colNormalize,
        attentionHeatmapRenderState.columnStatsByImage
    );

    attentionHeatmapRenderState.cellsSelection
        .attr('fill', d => attentionHeatmapRenderState.colorScale(d.value));

    if (attentionHeatmapRenderState.legendMinLabel && attentionHeatmapRenderState.legendMaxLabel) {
        attentionHeatmapRenderState.legendMinLabel
            .text(colNormalize ? '0' : attentionHeatmapRenderState.rawMin.toFixed(2));
        attentionHeatmapRenderState.legendMaxLabel
            .text(colNormalize ? '1' : attentionHeatmapRenderState.rawMax.toFixed(2));
    }

    attentionHeatmapRenderState.isColumnNormalized = Boolean(colNormalize);
    return true;
}

window.applyAttentionHeatmapNormalization = applyAttentionHeatmapNormalization;

// heatmap-viz.js — heatmap visualization, highlights, legend

function visualizeHeatmap(data) {
    const container = document.getElementById('heatmap-plot');
    container.innerHTML = '';

    heatmapLog('=== visualizeHeatmap ===');
    heatmapLog('Data received - Classes count:', data.classes.length);
    heatmapLog('Classes:', data.classes);
    heatmapLog('Matrix raw rows:', data.matrix_raw.length);
    heatmapLog('Matrix raw first row:', data.matrix_raw[0]);

    if (!data.matrix_normalized || data.matrix_normalized.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No data available</p>';
        return;
    }

    const visibleClasses = (data.classes || []).filter(className => !isUnknownClassLabel(className));
    if (visibleClasses.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No data available</p>';
        return;
    }
    if (window.selectedClass && isUnknownClassLabel(window.selectedClass)) {
        window.selectedClass = null;
    }

    if (data.class_colors) {
        classColorMap = { ...data.class_colors };
        heatmapLog('Updated classColorMap:', classColorMap);
    }

    // 1. Setup dimensions
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const margin = {
        top: 20,
        right: 20,
        bottom: 50,
        left: computeHeatmapLeftMargin(visibleClasses, containerWidth)
    };
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    const svg = d3.select(container)
        .append('svg')
        .attr('width', containerWidth)
        .attr('height', containerHeight)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    var dataParticipant = globalData.find(d => Number(d.id) === data.image_id).participants;

    // ORDENAMIENTO: Reordenar clases por score (primario) y suma de columna (secundario)
    // Calcular suma por clase (fila)
    const classSums = {};
    visibleClasses.forEach((className) => {
        const classIndex = data.classes.indexOf(className);
        const rowValues = (data.matrix_raw[classIndex] || []);
        const sum = rowValues.reduce((a, b) => a + b, 0);
        classSums[className] = sum;
    });

    // Obtener scores de clases (si existen en los datos)
    const classScores = data.class_scores || {};

    // Ordenar clases: primero por score (menor a mayor), luego por suma (mayor a menor si scores iguales)
    const sortedClasses = [...visibleClasses].sort((a, b) => {
        const scoreA = classScores[a] !== undefined ? classScores[a] : Infinity;
        const scoreB = classScores[b] !== undefined ? classScores[b] : Infinity;

        if (scoreA !== scoreB) {
            return scoreA - scoreB;  // Menor score primero (izquierda)
        }

        // Si scores son iguales, ordenar por suma (mayor suma primero)
        return classSums[b] - classSums[a];
    });

    heatmapLog('Class scores:', classScores);
    heatmapLog('Class sums:', classSums);
    heatmapLog('Sorted classes:', sortedClasses);

    // 2. Create Scales
    const xScale = d3.scaleBand()
        .domain(dataParticipant.map(d => d.participant))
        .range([0, width])
        .padding(0.0);

    const yScale = d3.scaleBand()
        .domain(sortedClasses)
        .range([0, height])
        .padding(0.0);

    heatmapLog('yScale domain:', yScale.domain());
    heatmapLog('yScale domain length:', yScale.domain().length);

    // Color Scale - usar valores sin normalizar (rawValue)
    const minRawValue = data.min_value || 0;
    const maxRawValue = data.max_value || 1;

    heatmapLog('[HEATMAP DEBUG] visualizeHeatmap Color Scale:');
    heatmapLog('  - min_value from backend:', data.min_value);
    heatmapLog('  - max_value from backend:', data.max_value);

    const colorScale = d3.scaleSequential()
        .domain([minRawValue, maxRawValue])  // Rango de valores crudos
        .interpolator(interpolateSoftBlues);

    // 3. Flatten data (using sorted class order)
    const heatmapData = [];
    sortedClasses.forEach((className) => {
        const classIndex = data.classes.indexOf(className);
        data.participants.forEach((participant, j) => {
            const rawVal = (data.matrix_raw[classIndex] && data.matrix_raw[classIndex][j]) || 0;
            const normVal = (data.matrix_normalized[classIndex] && data.matrix_normalized[classIndex][j]) || 0;
            heatmapData.push({
                row: className,
                col: participant,
                value: normVal,
                rawValue: rawVal
            });
        });
    });

    heatmapLog('heatmapData length:', heatmapData.length);
    heatmapLog('Expected data points:', visibleClasses.length * data.participants.length);
    heatmapLog('Classes in heatmapData:', [...new Set(heatmapData.map(d => d.row))].length);

    // 4. Draw Cells - usar rawValue (sin normalizar)
    svg.selectAll('rect')
        .data(heatmapData)
        .enter()
        .append('rect')
        .attr('class', 'heatmap-cell')
        .attr('x', d => xScale(d.col))
        .attr('y', d => yScale(d.row))
        .attr('width', xScale.bandwidth())
        .attr('height', yScale.bandwidth())
        .attr('fill', d => colorScale(d.rawValue))
        .attr('stroke', '#fff')
        .attr('stroke-width', 0.5);
    // Note: Tooltips on these rects will be blocked by the overlay below.
    // If you need tooltips, apply them to the overlay rects in Step 8 instead.

    // 5. Add Cell Values
    svg.selectAll('.cell-text')
        .data(heatmapData)
        .enter()
        .append('text')
        .attr('class', 'cell-text')
        .attr('x', d => xScale(d.col) + xScale.bandwidth() / 2)
        .attr('y', d => yScale(d.row) + yScale.bandwidth() / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .style('fill', '#000')
        .style('font-size', '10px')
        .style('pointer-events', 'none')
        .text(d => (d.rawValue || 0).toFixed(2));

    function toggleHeatmapClassSelection(className) {
        if (window.selectedClass === className) {
            window.selectedClass = null;
        } else {
            window.selectedClass = className;
        }
        updateHighlights();
        heatmapLog('Selected Class:', window.selectedClass);
    }

    function updateParticipantAxisLabelStyles() {
        const selectedParticipantKey = (
            selectedPart !== null &&
            selectedPart !== undefined &&
            selectedPart !== '' &&
            selectedPart !== 'all'
        ) ? String(selectedPart) : null;

        svg.selectAll('.heatmap-participant-axis-label')
            .style('font-weight', d => {
                const participantValue = String(d?.participant ?? d);
                return selectedParticipantKey && participantValue === selectedParticipantKey ? '700' : '400';
            })
            .style('opacity', d => {
                if (!selectedParticipantKey) return 1;
                const participantValue = String(d?.participant ?? d);
                return participantValue === selectedParticipantKey ? 1 : 0.65;
            });
    }

    function handleHeatmapParticipantLabelClick(participantValue) {
        const participantKey = String(participantValue);
        const isSameSelection = String(selectedPart ?? 'all') === participantKey;
        selectedPart = isSameSelection ? 'all' : participantKey;

        const partSelect = document.getElementById('part-select');
        if (partSelect) {
            partSelect.value = selectedPart;
        }

        if (selectedPart !== 'all') {
            highlightParticipantColumnInHeatmap(selectedPart);
            if (typeof highlightParticipantInScarf === 'function') {
                highlightParticipantInScarf(selectedPart);
            }
        } else {
            removeParticipantColumnHighlight();
            if (typeof highlightParticipantInScarf === 'function') {
                highlightParticipantInScarf(null);
            }
        }

        if (currentOverlayTypes && currentOverlayTypes.length > 0 && !window._scarfSelecting) {
            updateOverlay();
        }

        updateParticipantAxisLabelStyles();
    }

    // 6. X Axis
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .selectAll('text')
        .data(dataParticipant)
        .enter()
        .append('text')
        .attr('class', 'heatmap-participant-axis-label')
        .attr('x', d => xScale(d.participant) + xScale.bandwidth() / 2)
        .attr('y', 15)
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .style('fill','var(--color-secondary)')
        .style('cursor', 'pointer')
        .text(d => d.participant)
        .on('click', function(_event, d) {
            const participantValue = d?.participant ?? d;
            handleHeatmapParticipantLabelClick(participantValue);
        });

    // 7. Y Axis (Added class 'y-axis-label')
    const yAxisLabelMaxWidth = Math.max(40, margin.left - 20);

    svg.append('g')
        .selectAll('text')
        .data(sortedClasses)
        .enter()
        .append('text')
        .attr('class', 'y-axis-label') // Class needed for selection later
        .attr('x', -10)
        .attr('y', d => yScale(d) + yScale.bandwidth() / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '12px')
        .style('font-family', HEATMAP_LABEL_FONT_FAMILY)
        .style('cursor', 'pointer') // Indicate clickable
        .style('fill','var(--color-secondary)')
        .text(d => {
            const compactLabel = compactUnderscoreLabel(d);
            return truncateHeatmapLabel(compactLabel, yAxisLabelMaxWidth, 12, 400);
        })
        .on('click', function(_event, d) {
            toggleHeatmapClassSelection(d);
        })
        .append('title')
        .text(d => d);

    // 8. Axis Labels
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + 40)
        .attr('text-anchor', 'middle')
        .attr('font-size', '16px')
        .style('fill','var(--color-secondary)')
        .text('Participants');

    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -(margin.left - 20))
        .attr('text-anchor', 'middle')
        .attr('font-size', '16px')
        .style('fill','var(--color-secondary)')
        .text('Classes');

    // ---------------------------------------------------------
    // 9. ROW SELECTORS (Interaction Layer)
    // ---------------------------------------------------------

    // Function to update visual state based on global variable
    function updateHighlights() {
        updateHighlightsGlobal();
    }

    svg.selectAll('.row-selector')
        .data(sortedClasses)
        .enter()
        .append('rect')
        .attr('class', 'row-selector')
        .attr('x', 0)
        .attr('y', d => yScale(d))
        .attr('width', width)
        .attr('height', yScale.bandwidth())
        .attr('fill', 'black') // Darken effect
        .attr('opacity', 0)    // Invisible by default
        .style('cursor', 'pointer')

        // --- EVENTS ---
        .on('mouseover', function(event, d) {
            // Only apply hover effect if this specific row is NOT selected
            if (window.selectedClass !== d) {
                d3.select(this).attr('opacity', 0.1);
                // Highlight text temporarily
                svg.selectAll('.y-axis-label')
                   .filter(label => label === d)
                   .style('font-weight', 'bold');
            }
        })
        .on('mouseout', function(event, d) {
            // Only remove hover effect if this specific row is NOT selected
            if (window.selectedClass !== d) {
                d3.select(this).attr('opacity', 0);
                // Un-highlight text
                svg.selectAll('.y-axis-label')
                   .filter(label => label === d)
                   .style('font-weight', 'normal');
            }
        })
        .on('click', function(event, d) {
            toggleHeatmapClassSelection(d);
        });

    // Initialize state in case of re-render
    updateHighlights();
    updateParticipantAxisLabelStyles();

    document.getElementById("heatmap-plot-legend").innerHTML = "";
    // Assume heatmapData is available and contains objects with rawValue
    const values = heatmapData.map(d => d.rawValue);
    const minVal = d3.min(values);
    const maxVal = d3.max(values);
    // Select container
    const container2 = d3.select("#heatmap-plot-legend");
    const width2 = container2.node().getBoundingClientRect().width;
    const height2 = container2.node().getBoundingClientRect().height;
    // SVG
    const svgLegend = container2.append("svg")
        .attr("width", width2)
        .attr("height", height2);

    // Legend rect size & position
    const barWidth = width2 / 3;
    const barHeight = height2*0.8;
    const barX = (width2 - barWidth) / 2;
    const barY = (height2 - barHeight) / 2;
    // Gradient
    const defs = svgLegend.append("defs");
    const gradient = defs.append("linearGradient")
        .attr("id", "attention-gradient")
        .attr("x1", "0%")
        .attr("y1", "100%")
        .attr("x2", "0%")
        .attr("y2", "0%");

    gradient.selectAll("stop")
        .data([
            { offset: "0%", color: colorScale(minRawValue) },
            { offset: "50%", color: colorScale((minRawValue+maxRawValue)/2) },
            { offset: "100%", color: colorScale(maxRawValue) }
        ])
        .enter()
        .append("stop")
        .attr("offset", d => d.offset)
        .attr("stop-color", d => d.color);

    // Bar
    svgLegend.append("rect")
        .attr("x", barX)
        .attr("y", barY)
        .attr("width", barWidth)
        .attr("height", barHeight)
        .attr("fill", "url(#attention-gradient)");

    // Min & max labels
    svgLegend.append("text")
        .attr("x", barX + barWidth / 2)
        .attr("y", barY + barHeight + 4)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "hanging")
        .attr('class', 'text-sm font-bold')
        .attr('fill', 'var(--color-secondary)')
        .text(minVal.toFixed(2));

    // Max label (top of bar)
    svgLegend.append("text")
        .attr("x", barX + barWidth / 2)
        .attr("y", barY - 4)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "auto")
        .attr('class', 'text-sm font-bold')
        .attr('fill', 'var(--color-secondary)')
        .text(maxVal.toFixed(2));

    // Legend label
    svgLegend.append("text")
        .attr("x", barX + barWidth + 8)
        .attr("y", barY + barHeight / 2)
        .attr("text-anchor", "middle")
        .attr('class', 'text-sm')
        .attr('fill', 'var(--color-secondary)')
        .attr("transform", "rotate(90," + (barX + barWidth + 8) + "," + (barY + barHeight / 2) + ")")
        .text("Attention");

    if (currentAreaData) {
        highlightHeatmapAreaEntities(currentAreaData);
    } else {
        clearHeatmapAreaFrames();
    }

}

function visualizeAttentionHeatmap(data, colNormalize=false) {
    const container = document.getElementById('attention-heatmap-plot');
    container.innerHTML = ''; // Clear container

    // 1. Data Validation
    if (!data.matrix_normalized || data.matrix_normalized.length === 0 || data.images.length === 0 || data.classes.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No data available</p>';
        attentionHeatmapRenderState = null;
        return;
    }

    const visibleClasses = (data.classes || []).filter(className => !isUnknownClassLabel(className));
    if (visibleClasses.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No data available</p>';
        attentionHeatmapRenderState = null;
        return;
    }
    if (window.selectedAttentionClass && isUnknownClassLabel(window.selectedAttentionClass)) {
        window.selectedAttentionClass = null;
    }

    // Guardar datos globalmente para acceso posterior
    window.currentAttentionHeatmapData = data;
    heatmapLog('ATTENTION HEATMAP DATA');
    heatmapLog(data);
    // 2. Setup Dimensions
    let containerWidth = container.clientWidth;
    let containerHeight = container.clientHeight;
    const margin = {
        top: 15,
        right: 20,
        bottom: 50,
        left: computeHeatmapLeftMargin(visibleClasses, containerWidth)
    };

    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    // 3. Setup SVG
    const svg = d3.select(container)
        .append('svg')
        .attr('width', containerWidth)
        .attr('height', containerHeight)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // 4. ORDENAMIENTO: Reordenar imágenes por score (primario) y suma de columna (secundario)
    // Crear mapeo de ImageIndex -> ImageName para acceder a los scores
    const imageNames = data.images || {};
    const imageScoresData = data.image_scores || {};
    // Calcular suma por imagen (columna) y crear un mapeo para los scores
    const imageSums = {};
    const imageScoresMap = {};  // Mapeo de ImageIndex -> score
    const sortedImages = (data.image_scores || []).slice().sort((a, b) => a[1] - b[1]);
    // 4. Scales and Bandwidth (Key Update)
    heatmapLog('SORTED IMAGES');
    heatmapLog(sortedImages);
    // Color Scale (YlOrRd - Yellow-Orange-Red)
    /*const colorScale = d3.scaleLinear()
        .domain([0, 0.5, 1])
        .range(['#ffffcc', '#ff7f00', '#d92000']);*/

    // 5. Draw Heatmap Cells (D3 Idiomatic Way)
    // Create a joint array of all (class, image) pairs using sorted images
    const cellData = d3.cross(visibleClasses, sortedImages, (className, imageIdx, i, j) => {
        // imageIdx es ImageIndex (0-based), convertir a ImageName (número real)
        //const imageNameValue = imageNames[imageIdx];

        const baseValue = data.matrix_normalized[data.classes.indexOf(className)][data.images.indexOf(imageIdx[0])];
        return {
            className: className,
            imageIdx: imageIdx[0],  // ImageIndex (0-based, para posicionamiento y lookup en matrices)
            imageName: imageIdx[0],  // ImageName (número real de imagen, ej: 114)
            baseValue: baseValue,
            value: baseValue,
            rawValue: data.matrix_raw[data.classes.indexOf(className)][data.images.indexOf(imageIdx[0])],
            imageScore: imageIdx[1] || 0
        };
    });

    const columnStatsByImage = buildAttentionColumnStats(cellData);
    setAttentionHeatmapCellValues(cellData, colNormalize, columnStatsByImage);

    const imageOrder = sortedImages.map(d => d[0]);

    const data_matrix = [];
    for (let i = 0; i < visibleClasses.length; i++) {
        const className = visibleClasses[i];
        // Siempre usar rawValue para el orden — independiente del Normalize toggle
        var mapForClass = new Map();
        cellData
            .filter(d => d.className === className)
            .forEach(d => mapForClass.set(d.imageName, d.rawValue));

        const row = imageOrder.map(imgName => mapForClass.get(imgName) || 0);
        data_matrix.push(row);
    }


    var perm = reorder.optimal_leaf_order()(data_matrix);
    var permIds = [];
    for (let i = 0; i < visibleClasses.length; i++) {
        permIds.push(visibleClasses[perm[i]]);
    }
    var newClasses = permIds.slice();


    // X-Scale (Images - Columns)
    const xScale = d3.scaleBand()
        .domain(sortedImages.map( d=>d[0]))
        .range([0, width])
        .padding(0); // Small padding between cells

    // Y-Scale (Classes - Rows)
    const yScale = d3.scaleBand()
        .domain(newClasses)//.domain(data.classes)
        .range([0, height])
        .padding(0);


    const colorScale = d3.scaleLinear()
        .domain([0, 1])         // your data range
        .interpolate(() => interpolateSoftBlues);

    // The size of each cell is determined by the bandwidth of the scales
    const cellWidth = xScale.bandwidth();
    const cellHeight = yScale.bandwidth();

    // Create a group for all cells
    const cells = svg.append('g')
        .attr('class', 'heatmap-cells');

    function handleAttentionSummaryColumnClick(imageNameRaw) {
        const imageName = imageNameRaw !== undefined && imageNameRaw !== null ? String(imageNameRaw) : null;

        heatmapLog(`=== COLUMN CLICKED ===`);
        heatmapLog(`imageName: ${imageName}`);

        // Selección cruzada por toggle simple:
        // click en no seleccionado => selecciona, click en seleccionado => deselecciona.
        if (
            imageName &&
            typeof window.getLinkedSelectedImageNames === 'function' &&
            typeof window.setLinkedSelectionByImageNames === 'function' &&
            typeof window.updateLinkedSelectionViews === 'function'
        ) {
            const selected = new Set(
                window.getLinkedSelectedImageNames().map(name => String(name))
            );

            if (selected.has(imageName)) {
                selected.delete(imageName);
            } else {
                selected.add(imageName);
            }

            if (selected.size > 0) {
                window.setLinkedSelectionByImageNames([...selected]);
            } else if (typeof window.clearLinkedSelectionState === 'function') {
                window.clearLinkedSelectionState();
            }
            window.updateLinkedSelectionViews();
        }

        if (imageNameRaw !== undefined && imageNameRaw !== null) {
            loadImageInControls2(imageNameRaw);
        }
    }

    // Bind data and draw rectangles
    cells.selectAll('rect')
        .data(cellData)
        .enter()
        .append('rect')
        // Use the scales for positioning and bandwidth for sizing
        .attr('x', d => xScale(d.imageName))
        .attr('y', d => yScale(d.className))
        .attr('width', cellWidth)
        .attr('height', cellHeight)
        .attr('class', d => 'rect-heatmap rect-heatmap-'+d.imageName)
        // Color and styling
        .attr('fill', d => colorScale(d.value))
        .attr('stroke', '#fff')
        .attr('stroke-width', 0.5)
        .style('cursor', 'pointer')
        // Evento click para cargar la imagen en controls2
        .on('click', function(event, d) {
            handleAttentionSummaryColumnClick(d.imageName);
        })
        // Tooltip (title element)
        .append('title')
        .text(d => `${d.className} - Image ${d.imageName} (Score: ${d.imageScore}): ${d.rawValue.toFixed(2)}`);

    cells.selectAll('.rect-h-img')
        .data(sortedImages)
        .enter()
        .append('rect')
        // Use the scales for positioning and bandwidth for sizing
        .attr('x', d => xScale(d[0]))
        .attr('y', d => 0)
        .attr('width', cellWidth)
        .attr('height', height)
        .attr('class', 'rect-h-img')
        .attr('id', d=>'rect-h-img-'+d[0])
        // Color and styling
        .attr('fill', d => 'transparent')
        .attr('stroke', 'red')
        .attr('stroke-width', 2)
        .attr('opacity', 0)
        .attr('pointer-events', 'all')
        .style('cursor', 'pointer')
        .on('click', function(event, d) {
            handleAttentionSummaryColumnClick(d[0]);
        });

    cells.selectAll('.heatmap-score')
        .data(sortedImages)
        .enter()
        .append('text')
        // Use the scales for positioning and bandwidth for sizing
        .attr('x', d => xScale(d[0]) + xScale.bandwidth()/2)
        .attr('y', d => -2)
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .text(d => d[1]);
    // 6. Draw Axes

    // 6. X Axis - Mostrar ImageName en lugar de ImageIndex (usando sorted images)
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .selectAll('text')
        .data(sortedImages)
        .enter()
        .append('text')
        .attr('class', 'attention-heatmap-image-axis-label')
        .attr('x', d => xScale(d[0]) + xScale.bandwidth() / 2)
        .attr('y', 12)
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .style('cursor', 'pointer')
        .text(d => d[0])
        .on('click', function(_event, d) {
            handleAttentionSummaryColumnClick(d[0]);
        });

    // 7. Y Axis (Added class 'y-axis-label')
    const yAxisLabelMaxWidth = Math.max(40, margin.left - 20);
    const updateAttentionClassSelectionStyles = () => {
        const selectedClassKey = window.selectedAttentionClass ? String(window.selectedAttentionClass) : null;

        cells.selectAll('.rect-heatmap')
            .attr('stroke', cell => {
                if (!selectedClassKey) return '#fff';
                return String(cell?.className) === selectedClassKey ? '#1d5f9f' : '#fff';
            })
            .attr('stroke-width', cell => {
                if (!selectedClassKey) return 0.5;
                return String(cell?.className) === selectedClassKey ? 1.3 : 0.5;
            });

        attentionYAxisLabels
            .style('font-weight', label => {
                if (!selectedClassKey) return '400';
                return String(label) === selectedClassKey ? '700' : '400';
            })
            .style('opacity', label => {
                if (!selectedClassKey) return 1;
                return String(label) === selectedClassKey ? 1 : 0.65;
            });
    };

    const attentionYAxisLabels = svg.append('g')
        .selectAll('text')
        .data(visibleClasses)
        .enter()
        .append('text')
        .attr('class', 'attention-y-axis-label')
        .attr('x', -10)
        .attr('y', d => yScale(d) + yScale.bandwidth() / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '12px')
        .style('font-family', HEATMAP_LABEL_FONT_FAMILY)
        .style('cursor', 'pointer') // Indicate clickable
        .style('fill', 'var(--color-secondary)')
        .text(d => {
            const compactLabel = compactUnderscoreLabel(d);
            return truncateHeatmapLabel(compactLabel, yAxisLabelMaxWidth, 12, 400);
        })
        .on('click', function(_event, d) {
            if (window.selectedAttentionClass === d) {
                window.selectedAttentionClass = null;
            } else {
                window.selectedAttentionClass = d;
            }
            updateAttentionClassSelectionStyles();
        })
        .append('title')
        .text(d => d);
    updateAttentionClassSelectionStyles();

    // X-Axis Label
    svg.append('text')
        .attr('x', -10)
        .attr('y', -2)
        .attr('text-anchor', 'end')
        .attr('font-size', '12px')
        .style('fill','var(--color-secondary)')
        .text('Score');


    // 7. Axis Labels

    // X-Axis Label
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + 40)
        .attr('text-anchor', 'middle')
        .attr('font-size', '16px')
        .style('fill','var(--color-secondary)')
        .text('Images');

    // Y-Axis Label
    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -(margin.left - 20))
        .attr('text-anchor', 'middle')
        .attr('font-size', '16px')
        .style('fill','var(--color-secondary)')
        .text('Classes');

    // Optional: Add a legend here (omitted for brevity, but recommended for a complete visualization)
    document.getElementById("attention-heatmap-plot-legend").innerHTML = "";
    // Assume heatmapData is available and contains objects with rawValue
    const values = cellData.map(d => d.rawValue);
    const minVal = d3.min(values);
    const maxVal = d3.max(values);
    // Select container
    const container2 = d3.select("#attention-heatmap-plot-legend");
    const width2 = container2.node().getBoundingClientRect().width;
    const height2 = container2.node().getBoundingClientRect().height;
    // SVG
    const svgLegend = container2.append("svg")
        .attr("width", width2)
        .attr("height", height2);

    // Legend rect size & position
    const barWidth = width2 / 3;
    const barHeight = height2*0.7;
    const barX = (width2 - barWidth) / 2;
    const barY = (height2 - barHeight) / 2;
    // Gradient
    const defs = svgLegend.append("defs");
    const gradient = defs.append("linearGradient")
        .attr("id", "participant-attention-gradient")
        .attr("x1", "0%")
        .attr("y1", "100%")
        .attr("x2", "0%")
        .attr("y2", "0%");

    gradient.selectAll("stop")
        .data([
            { offset: "0%", color: colorScale(0) },
            { offset: "50%", color: colorScale(0.5) },
            { offset: "100%", color: colorScale(1) }
        ])
        .enter()
        .append("stop")
        .attr("offset", d => d.offset)
        .attr("stop-color", d => d.color);

    // Bar
    svgLegend.append("rect")
        .attr("x", barX)
        .attr("y", barY)
        .attr("width", barWidth)
        .attr("height", barHeight)
        .attr("fill", "url(#participant-attention-gradient)");

    // Min & max labels
    const legendMinLabel = svgLegend.append("text")
        .attr("x", barX + barWidth / 2)
        .attr("y", barY + barHeight + 4)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "hanging")
        .attr('class', 'text-sm font-bold')
        .attr('fill', 'var(--color-secondary)')
        .text(colNormalize == true? '0': minVal.toFixed(2));

    // Max label (top of bar)
    const legendMaxLabel = svgLegend.append("text")
        .attr("x", barX + barWidth / 2)
        .attr("y", barY - 4)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "auto")
        .attr('class', 'text-sm font-bold')
        .attr('fill', 'var(--color-secondary)')
        .text(colNormalize == true? '1':maxVal.toFixed(2));

    // Legend label
    svgLegend.append("text")
        .attr("x", barX + barWidth + 8)
        .attr("y", barY + barHeight / 2)
        .attr("text-anchor", "middle")
        .attr('class', 'text-sm')
        .attr('fill', 'var(--color-secondary)')
        .attr("transform", "rotate(90," + (barX + barWidth + 8) + "," + (barY + barHeight / 2) + ")")
        .text("Attention");

    attentionHeatmapRenderState = {
        dataRef: data,
        cellData,
        cellsSelection: cells.selectAll('.rect-heatmap'),
        colorScale,
        columnStatsByImage,
        rawMin: minVal,
        rawMax: maxVal,
        legendMinLabel,
        legendMaxLabel,
        isColumnNormalized: Boolean(colNormalize)
    };

    if (typeof window.updateLinkedSelectionViews === 'function') {
        window.updateLinkedSelectionViews();
    }
}

function loadHeatmap(imageId, dataType = 'gaze', mode = 'attention') {
    const baseUrl = window.location.origin;
    const apiUrl = `${baseUrl}/api/heatmap/${imageId}?data_type=${dataType}&dataset_select=${currentDatasetSelect}&mode=${mode}`;
    heatmapLog(`=== LOADING HEATMAP ===`);
    heatmapLog(`API URL: ${apiUrl}`);
    heatmapLog(`Parameters: imageId=${imageId}, dataType=${dataType}, currentDatasetSelect=${currentDatasetSelect}, mode=${mode}`);
    fetch(apiUrl)
        .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.error) {
                        console.error('Error en respuesta:', data.error);
                        showHeatmapError(data.error);
                    } else {
                        heatmapLog(`Heatmap data loaded (${dataType}, mode=${mode}):`, data);
                        visualizeHeatmap(data);
                        // updateHeatmapLegend(data);
                    }
                })
                .catch(error => {
                    console.error('Error loading heatmap:', error);
                    showHeatmapError('Error cargando heatmap');
                });
}

function loadAttentionHeatmap(participantId) {
    const baseUrl = window.location.origin;
    const datasetSelect = document.getElementById('data-set-select-v2')?.value || 'main_class';
    const apiUrl = `${baseUrl}/api/heatmap/participant/${participantId}?dataset_select=${datasetSelect}`;
    fetch(apiUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                console.error('Error en respuesta:', data.error);
            } else {
                heatmapLog(`Heatmap data loaded:`, data);
                var normChecked = document.getElementById('heatmap-normalize').checked;
                attentionHeatmapData = data;
                visualizeAttentionHeatmap(data, normChecked);
                // Load saliency coverage data
                loadSaliencyCoverageData(participantId);
                // Load embedding projection data
                loadEmbeddingProjectionData(participantId);
            }
        })
        .catch(error => {
            console.error('Error loading heatmap:', error);
        });
}

function updateHeatmapLegend(data) {
            const bar = document.getElementById('heatmap-legend-bar');
            const gradient = [];
            for (let i = 0; i <= 100; i += 10) {
                const value = i / 100;
                const color = d3.scaleLinear()
                    .domain([0, 0.5, 1])
                    .range(['#ffffcc', '#ff7f00', '#d92000'])(value);
                gradient.push(`<div style="flex: 1; background-color: ${color};"></div>`);
            }
            bar.innerHTML = gradient.join('');

            // Mostrar min/max valores
            const info = document.getElementById('heatmap-legend');
            const minMaxSpan = info.querySelector('.min-max-info') || document.createElement('span');
            minMaxSpan.className = 'min-max-info';
            minMaxSpan.style.cssText = 'margin-left: 10px; font-size: 10px; color: #666;';
            minMaxSpan.textContent = `Min: ${data.min_value.toFixed(2)} | Max: ${data.max_value.toFixed(2)}`;
            if (!info.querySelector('.min-max-info')) {
                info.appendChild(minMaxSpan);
            }
}

        /**
         * Mostrar error en heatmap
         */
function showHeatmapError(message) {
            const container = document.getElementById('heatmap-plot');
            container.innerHTML = `<p style="text-align: center; color: #999;">${message}</p>`;
}

function highlightHeatmapAreaEntities(areaData) {
    clearHeatmapAreaFrames();

    if (!areaData) {
        return;
    }

    const svg = d3.select('#heatmap-plot svg g');
    if (svg.empty()) {
        return;
    }

    const { participants, classes } = getAreaEntitiesForHeatmap(areaData);
    if (participants.size === 0 && classes.size === 0) {
        return;
    }

    const participantSet = new Set(Array.from(participants).map(String));
    const classSetLower = new Set(
        Array.from(classes).map(className => String(className).trim().toLowerCase())
    );

    const frameLayer = svg.append('g')
        .attr('id', 'heatmap-area-frame-layer')
        .style('pointer-events', 'none');

    const PARTICIPANT_STROKE = '#E69F00'; // Okabe-Ito orange — warm, distinct from Blues data scale
    const PARTICIPANT_FILL = 'rgba(230, 159, 0, 0.08)';
    const CLASS_STROKE = '#009E73'; // Okabe-Ito bluish green — no overlap with Blues data scale
    const CLASS_FILL = 'rgba(0, 158, 115, 0.08)';

    const matchedRows = new Set();
    svg.selectAll('.heatmap-cell').each(function(d) {
        if (!d || d.row === null || d.row === undefined) {
            return;
        }
        const normalizedRow = String(d.row).trim().toLowerCase();
        if (classSetLower.has(normalizedRow)) {
            matchedRows.add(String(d.row));
        }
    });

    matchedRows.forEach(rowName => {
        const rowCells = svg.selectAll('.heatmap-cell')
            .filter(d => d && String(d.row) === rowName)
            .nodes();

        const bounds = getHeatmapBoundsFromCells(rowCells);
        if (!bounds) {
            return;
        }

        frameLayer.append('rect')
            .attr('class', 'heatmap-area-class-frame')
            .attr('x', bounds.x - 1.5)
            .attr('y', bounds.y - 1.5)
            .attr('width', bounds.width + 3)
            .attr('height', bounds.height + 3)
            .attr('fill', CLASS_FILL)
            .attr('stroke', CLASS_STROKE)
            .attr('stroke-width', 1.4)
            .attr('rx', 2)
            .attr('ry', 2);
    });

    participantSet.forEach(participantId => {
        const participantCells = svg.selectAll('.heatmap-cell')
            .filter(d => d && String(d.col) === participantId)
            .nodes();

        const bounds = getHeatmapBoundsFromCells(participantCells);
        if (!bounds) {
            return;
        }

        frameLayer.append('rect')
            .attr('class', 'heatmap-area-participant-frame')
            .attr('x', bounds.x - 1.5)
            .attr('y', bounds.y - 1.5)
            .attr('width', bounds.width + 3)
            .attr('height', bounds.height + 3)
            .attr('fill', PARTICIPANT_FILL)
            .attr('stroke', PARTICIPANT_STROKE)
            .attr('stroke-width', 1.8)
            .attr('rx', 2)
            .attr('ry', 2);
    });
}

function highlightParticipantColumnInHeatmap(participantId) {
    heatmapLog('Highlighting participant column:', participantId);

    d3.select('#heatmap-participant-highlight').remove();

    const heatmapContainer = document.getElementById('heatmap-plot');
    if (!heatmapContainer) return;

    const svg = d3.select('#heatmap-plot svg g');
    if (svg.empty()) return;

    // Encontrar todas las celdas del heatmap con este participante
    const allRects = svg.selectAll('rect');
    const participantRects = [];

    const participantKey = String(participantId);

    allRects.each(function(d) {
        if (d && String(d.col) === participantKey) {
            participantRects.push(this);
        }
    });

    if (participantRects.length === 0) {
        console.warn('No rects found for participant:', participantId);
        return;
    }

    // Obtener posición y dimensiones de la primera celda para calcular la columna
    const firstRect = participantRects[0];
    const rectX = parseFloat(d3.select(firstRect).attr('x'));
    const rectWidth = parseFloat(d3.select(firstRect).attr('width'));

    // Obtener altura total del heatmap
    const allYPositions = participantRects.map(rect => parseFloat(d3.select(rect).attr('y')));
    const minY = Math.min(...allYPositions);
    const maxY = Math.max(...allYPositions);
    const lastRectHeight = parseFloat(d3.select(participantRects[participantRects.length - 1]).attr('height'));
    const totalHeight = (maxY - minY) + lastRectHeight;

    // Crear overlay de resaltado sobre la columna
    svg.append('rect')
        .attr('id', 'heatmap-participant-highlight')
        .attr('x', rectX)
        .attr('y', minY)
        .attr('width', rectWidth)
        .attr('height', totalHeight)
        .attr('fill', 'none')
        .attr('stroke', '#E69F00')  // Okabe-Ito orange — consistent with participant frame
        .attr('stroke-width', 3)
        .style('pointer-events', 'none')
        .style('opacity', 0.8);

    d3.selectAll('.heatmap-participant-axis-label')
        .style('font-weight', d => {
            const value = String(d?.participant ?? d);
            return value === participantKey ? '700' : '400';
        })
        .style('opacity', d => {
            const value = String(d?.participant ?? d);
            return value === participantKey ? 1 : 0.65;
        });

    heatmapLog('Participant column highlighted at x:', rectX, 'width:', rectWidth, 'height:', totalHeight);
}

// Remover highlight de columna de participante
function removeParticipantColumnHighlight() {
    d3.select('#heatmap-participant-highlight').remove();
    d3.selectAll('.heatmap-participant-axis-label')
        .style('font-weight', '400')
        .style('opacity', 1);
}

function clearHeatmapAreaFrames() {
    d3.select('#heatmap-area-frame-layer').remove();
}

function getHeatmapClassFieldForCurrentDataset() {
    switch (currentDatasetSelect) {
        case 'grouped':
            return 'group';
        case 'grouped_disorder':
            return 'group_name';
        case 'disorder':
        case 'main_class':
        default:
            return 'main_class';
    }
}

function normalizeHeatmapClassValue(value) {
    if (value === null || value === undefined) return null;
    const parsed = String(value).trim();
    if (!parsed) return null;
    const lowered = parsed.toLowerCase();
    if (lowered === 'nan' || lowered === 'none' || lowered === 'null' || lowered === 'undefined') {
        return null;
    }
    return parsed;
}

function parseClassNamesFallback(rawValue) {
    if (Array.isArray(rawValue)) {
        return rawValue
            .map(normalizeHeatmapClassValue)
            .filter(Boolean);
    }

    if (typeof rawValue !== 'string') {
        return [];
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
        return [];
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map(normalizeHeatmapClassValue).filter(Boolean);
            }
        } catch (_error) {
            try {
                const normalized = trimmed
                    .replace(/'/g, '"')
                    .replace(/\bNone\b/g, 'null');
                const parsedNormalized = JSON.parse(normalized);
                if (Array.isArray(parsedNormalized)) {
                    return parsedNormalized.map(normalizeHeatmapClassValue).filter(Boolean);
                }
            } catch (_errorAgain) {
                // Fallback below
            }
        }
    }

    return trimmed
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .split(',')
        .map(item => item.replace(/^['"]|['"]$/g, ''))
        .map(normalizeHeatmapClassValue)
        .filter(Boolean);
}

function getAreaEntitiesForHeatmap(areaData) {
    const participants = new Set();
    const classes = new Set();
    const classField = getHeatmapClassFieldForCurrentDataset();

    const collect = (points, includeClassFallback = false) => {
        if (!Array.isArray(points)) return;

        points.forEach(point => {
            const participantId = getPointParticipantId(point);
            if (participantId) {
                participants.add(String(participantId));
            }

            const classValue = normalizeHeatmapClassValue(point?.[classField]);
            if (classValue) {
                classes.add(classValue);
                return;
            }

            if (includeClassFallback) {
                const fallbackClasses = parseClassNamesFallback(point?.class_names);
                fallbackClasses.forEach(name => classes.add(name));
            }
        });
    };

    // Priorizar gaze_points porque corresponden a puntos reales dentro del glyph
    collect(areaData?.gaze_points, false);

    // Fallback cuando no vengan clases en gaze_points (ej: fuentes antiguas)
    if (classes.size === 0) {
        collect(areaData?.data_for_analysis, true);
    }
    if (classes.size === 0) {
        collect(areaData?.fixations, true);
    }

    return { participants, classes };
}

function getHeatmapBoundsFromCells(cellNodes) {
    if (!Array.isArray(cellNodes) || cellNodes.length === 0) {
        return null;
    }

    const boxes = cellNodes
        .map(node => {
            const rect = d3.select(node);
            const x = Number(rect.attr('x'));
            const y = Number(rect.attr('y'));
            const width = Number(rect.attr('width'));
            const height = Number(rect.attr('height'));
            if (![x, y, width, height].every(Number.isFinite)) {
                return null;
            }
            return { x, y, width, height };
        })
        .filter(Boolean);

    if (boxes.length === 0) {
        return null;
    }

    const minX = Math.min(...boxes.map(box => box.x));
    const minY = Math.min(...boxes.map(box => box.y));
    const maxX = Math.max(...boxes.map(box => box.x + box.width));
    const maxY = Math.max(...boxes.map(box => box.y + box.height));

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
    };
}

function updateHighlightsGlobal() {
    const rowSelectors = document.querySelectorAll('.row-selector');
    rowSelectors.forEach(element => {
        const className = element.__data__;
        if (window.selectedClass === className) {
            element.setAttribute('opacity', '0.2');
        } else {
            element.setAttribute('opacity', '0');
        }
    });

    const yAxisLabels = document.querySelectorAll('.y-axis-label');
    yAxisLabels.forEach(element => {
        const className = element.__data__;
        if (window.selectedClass === className) {
            element.style.fontWeight = 'bold';
        } else {
            element.style.fontWeight = 'normal';
        }
    });

    if (window.selectedClass != null) {
        const activeScarfSegment = (typeof currentScarfSegment !== 'undefined')
            ? currentScarfSegment
            : window.currentScarfSegment;
        if (activeScarfSegment && typeof highlightScarfSegment === 'function') {
            // Si hay un segmento temporal seleccionado, preservar highlight puntual
            // en lugar de resaltar toda la clase.
            highlightScarfSegment(activeScarfSegment);
        } else {
            d3.selectAll('.scarf-segment')
                .attr('opacity', d => 0.3);
            d3.selectAll('.scarf-segment-' + window.selectedClass)
                .attr('opacity', d => 1);
        }

        if (!activeScarfSegment && currentImageBlendPercent <= 0) {
            setImageBlendPercentage(50);
        }
        syncSegmentationLayerImage();

    } else {
        d3.selectAll('.scarf-segment')
            .attr('opacity', d => 1);

        syncSegmentationLayerImage();
    }
}

