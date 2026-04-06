// charts.js — embedding projection, saliency coverage, entropy, t-SNE

function normalizeImageName(imageName) {
    return String(imageName ?? '');
}

function dedupeImageNames(imageNames) {
    return [...new Set((imageNames || []).map(name => normalizeImageName(name)).filter(Boolean))];
}

function getTSNESelectionState() {
    if (!Array.isArray(window.tsneSelectedPoints)) {
        window.tsneSelectedPoints = [];
    }

    if (!(window.tsneSelectedImageSet instanceof Set)) {
        window.tsneSelectedImageSet = new Set(
            window.tsneSelectedPoints.map(point => normalizeImageName(point.image_name))
        );
    }

    return {
        selectedPoints: window.tsneSelectedPoints,
        selectedImageSet: window.tsneSelectedImageSet
    };
}

function setTSNESelectionState(selectedPoints) {
    const normalizedPoints = (selectedPoints || []).map(point => ({
        ...point,
        image_name: normalizeImageName(point.image_name)
    }));
    const dedupedPoints = [];
    const seen = new Set();
    normalizedPoints.forEach(point => {
        if (!point.image_name || seen.has(point.image_name)) {
            return;
        }
        seen.add(point.image_name);
        dedupedPoints.push(point);
    });

    window.tsneSelectedPoints = dedupedPoints;
    window.tsneSelectedImageSet = new Set(
        dedupedPoints.map(point => point.image_name)
    );
}

function clearTSNESelectionState() {
    window.tsneSelectedPoints = [];
    window.tsneSelectedImageSet = new Set();
}

function getSelectionPointsForImageNames(imageNames) {
    const normalizedNames = dedupeImageNames(imageNames);
    if (normalizedNames.length === 0) {
        return [];
    }

    const saliencyRows = window.currentSaliencyCoverageData?.data || [];
    const projectionRows = window.currentEmbeddingProjectionData?.data || [];
    const saliencyByImage = new Map(
        saliencyRows.map(row => [normalizeImageName(row.image_name), row])
    );
    const projectionByImage = new Map(
        projectionRows.map(row => [normalizeImageName(row.image_name), row])
    );

    return normalizedNames.map(imageName => {
        const saliencyRow = saliencyByImage.get(imageName);
        if (saliencyRow) {
            return {
                ...saliencyRow,
                image_name: imageName
            };
        }

        const projectionRow = projectionByImage.get(imageName);
        if (projectionRow) {
            return {
                ...projectionRow,
                image_name: imageName
            };
        }

        return { image_name: imageName, score: null };
    });
}

function setTSNESelectionByImageNames(imageNames) {
    const selectedPoints = getSelectionPointsForImageNames(imageNames);
    if (selectedPoints.length > 0) {
        setTSNESelectionState(selectedPoints);
    } else {
        clearTSNESelectionState();
    }
}

function registerSaliencyScatterDefaults(pointsSelection) {
    pointsSelection
        .attr('data-image-name', d => normalizeImageName(d.image_name))
        .attr('data-base-fill', function() {
            return d3.select(this).attr('fill') ?? '';
        })
        .attr('data-base-stroke', function() {
            return d3.select(this).attr('stroke') ?? '';
        })
        .attr('data-base-r', function() {
            return d3.select(this).attr('r') ?? '4';
        })
        .attr('data-base-opacity', function() {
            const opacity = d3.select(this).attr('opacity');
            return opacity ?? '1';
        });
}

function restoreSaliencyScatterPointStyle(pointSelection) {
    pointSelection
        .attr('fill', function() {
            return this.getAttribute('data-base-fill') || '#6daed5';
        })
        .attr('stroke', function() {
            return this.getAttribute('data-base-stroke') || 'black';
        })
        .attr('r', function() {
            return this.getAttribute('data-base-r') || 4;
        })
        .attr('opacity', function() {
            return this.getAttribute('data-base-opacity') || 1;
        });
}

function registerProjectionPointDefaults(pointsSelection) {
    pointsSelection
        .attr('data-image-name', d => normalizeImageName(d.image_name))
        .attr('data-base-fill', function() {
            return d3.select(this).attr('fill') ?? '';
        })
        .attr('data-base-stroke', function() {
            return d3.select(this).attr('stroke') ?? '';
        })
        .attr('data-base-r', function() {
            return d3.select(this).attr('r') ?? '5';
        });
}

function restoreProjectionPointStyle(pointSelection) {
    pointSelection
        .attr('fill', function() {
            return this.getAttribute('data-base-fill') || '#6daed5';
        })
        .attr('stroke', function() {
            return this.getAttribute('data-base-stroke') || 'black';
        })
        .attr('r', function() {
            return this.getAttribute('data-base-r') || 5;
        })
        .attr('opacity', 1);
}

function applyTSNESelectionToProjectionPoints() {
    const { selectedImageSet } = getTSNESelectionState();

    d3.selectAll('.projection-point').each(function(d) {
        const imageName = normalizeImageName(d?.image_name ?? this.getAttribute('data-image-name'));
        const point = d3.select(this);

        if (selectedImageSet.size > 0 && selectedImageSet.has(imageName)) {
            point
                .attr('fill', 'red')
                .attr('stroke', 'red')
                .attr('r', 7)
                .attr('opacity', 1);
        } else {
            restoreProjectionPointStyle(point);
        }
    });
}

function applyTSNESelectionToScatterPoints() {
    const { selectedImageSet } = getTSNESelectionState();

    d3.selectAll('.scatter-saliency-point').each(function(d) {
        const imageName = normalizeImageName(d?.image_name ?? this.getAttribute('data-image-name'));
        const point = d3.select(this);

        if (selectedImageSet.size > 0 && selectedImageSet.has(imageName)) {
            point
                .attr('fill', 'red')
                .attr('stroke', 'red')
                .attr('r', 6)
                .attr('opacity', 1);
        } else {
            restoreSaliencyScatterPointStyle(point);
        }
    });
}

function applyTSNESelectionToLinkedViews() {
    const { selectedPoints, selectedImageSet } = getTSNESelectionState();
    const hasSelection = selectedImageSet.size > 0;

    d3.selectAll('.rect-h-img').attr('opacity', 0);
    d3.selectAll('.rect-heatmap').attr('opacity', 1);

    if (hasSelection) {
        selectedImageSet.forEach(imageName => {
            d3.select('#rect-h-img-' + imageName).attr('opacity', 0.75);
            d3.selectAll('.rect-heatmap-' + imageName).attr('opacity', 1);
        });
    }

    applyTSNESelectionToScatterPoints();

    const controls2SelectedImages = document.getElementById('controls2-selected-images');
    if (!controls2SelectedImages) {
        return;
    }

    if (!hasSelection) {
        controls2SelectedImages.innerHTML = '';
        return;
    }

    if (typeof window.displayTSNESelectedImages === 'function') {
        window.displayTSNESelectedImages([...selectedPoints]);
    }
}

function updateLinkedSelectionViews() {
    const selectedImageNames = [...getTSNESelectionState().selectedImageSet];
    if (selectedImageNames.length > 0) {
        setTSNESelectionState(getSelectionPointsForImageNames(selectedImageNames));
    }
    applyTSNESelectionToLinkedViews();
    applyTSNESelectionToProjectionPoints();
}

function createSaliencySelectionBrush(svg, width, height, scatterPoints) {
    const brush = d3.brush()
        .extent([[0, 0], [width, height]])
        .on('end', function(event) {
            if (!event.selection) {
                clearTSNESelectionState();
                updateLinkedSelectionViews();
                return;
            }

            const [[x0, y0], [x1, y1]] = event.selection;
            const selectedPoints = [];
            scatterPoints.each(function(d) {
                const cx = Number(this.getAttribute('cx'));
                const cy = Number(this.getAttribute('cy'));
                if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) {
                    selectedPoints.push(d);
                }
            });

            if (selectedPoints.length > 0) {
                setTSNESelectionState(selectedPoints);
            } else {
                clearTSNESelectionState();
            }

            updateLinkedSelectionViews();
        });

    const brushLayer = svg.append('g')
        .attr('class', 'saliency-selection-brush')
        .call(brush);

    // Keep brush behind points so hover tooltips remain accessible.
    brushLayer.lower();
}

window.setLinkedSelectionByImageNames = setTSNESelectionByImageNames;
window.clearLinkedSelectionState = clearTSNESelectionState;
window.getLinkedSelectedImageNames = function() {
    return [...getTSNESelectionState().selectedImageSet];
};
window.updateLinkedSelectionViews = updateLinkedSelectionViews;
window.applyTSNESelectionToProjectionPoints = applyTSNESelectionToProjectionPoints;

// Función para cargar datos de proyección de embeddings (t-SNE)
function loadEmbeddingProjectionData(participantId) {
    // Clear any previous selection
    if (window.clearTSNESelection) {
        window.clearTSNESelection();
    } else {
        clearTSNESelectionState();
        updateLinkedSelectionViews();
    }

    const baseUrl = window.location.origin;
    const apiUrl = `${baseUrl}/by-participant/api/embedding-projection/${participantId}`;
    fetch(apiUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                console.error('Error loading embedding projection:', data.error);
                document.getElementById('attention-heatmap-bottom-left').innerHTML =
                    '<p style="text-align: center; color: #999;">No embedding data available: ' + data.error + '</p>';
            } else {
                console.log(`Embedding projection data loaded:`, data);
                window.currentEmbeddingProjectionData = data;
                visualizeTSNEProjection(data);
            }
        })
        .catch(error => {
            console.error('Error loading embedding projection:', error);
            document.getElementById('attention-heatmap-bottom-left').innerHTML =
                '<p style="text-align: center; color: #999;">Error loading embedding data</p>';
        });
}

// Función para cargar datos de saliency coverage
function loadSaliencyCoverageData(participantId) {
    const baseUrl = window.location.origin;
    const apiUrl = `${baseUrl}/api/saliency-coverage/${participantId}`;
    fetch(apiUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                console.error('Error loading saliency coverage:', data.error);
                document.getElementById('attention-heatmap-bottom').innerHTML =
                    '<p style="text-align: center; color: #999;">No saliency coverage data available</p>';
            } else {
                console.log(`Saliency coverage data loaded:`, data);
                // Guardar datos globalmente para poder cambiar entre vistas
                window.currentSaliencyCoverageData = data;

                // Renderizar vista inicial (Coverage, By Image)
                // visualizeSaliencyCoverageScatterPlot(data);
                visualizeSaliencyCoverageByScore(data);

                // Agregar event listener al select de vista (By Image / By Score)
                const viewSelect = document.getElementById('coverage-view-select');
                if (viewSelect) {
                    viewSelect.removeEventListener('change', window.onCoverageViewChange);
                    window.onCoverageViewChange = (e) => {
                        const viewType = e.target.value;
                        const metric = document.getElementById('metric-select')?.value || 'coverage';
                        renderSaliencyVisualization(data, metric, viewType);
                    };
                    viewSelect.addEventListener('change', window.onCoverageViewChange);
                }

                // Agregar event listener al select de métrica (Coverage / Entropy)
                const metricSelect = document.getElementById('metric-select');
                if (metricSelect) {
                    metricSelect.removeEventListener('change', window.onMetricChange);
                    window.onMetricChange = (e) => {
                        const metric = e.target.value;
                        const viewType = document.getElementById('coverage-view-select')?.value || 'by-image';
                        renderSaliencyVisualization(data, metric, viewType);
                    };
                    metricSelect.addEventListener('change', window.onMetricChange);
                }
            }
        })
        .catch(error => {
            console.error('Error loading saliency coverage:', error);
            document.getElementById('attention-heatmap-bottom').innerHTML =
                '<p style="text-align: center; color: #999;">Error loading saliency coverage data</p>';
        });
}

// Función para visualizar el scatter plot de saliency coverage
function visualizeSaliencyCoverageScatterPlot(data) {
    const container = document.getElementById('attention-heatmap-bottom');
    container.innerHTML = ''; // Clear container

    // Data validation
    if (!data.data || data.data.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No saliency coverage data available</p>';
        return;
    }

    // Setup Dimensions
    const margin = { top: 20, right: 40, bottom: 60, left: 60 };
    let containerWidth = container.clientWidth;
    let containerHeight = container.clientHeight;

    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    // Setup SVG
    const svg = d3.select(container)
        .append('svg')
        .attr('width', containerWidth)
        .attr('height', containerHeight)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Extract data
    const scatterData = data.data;

    // Calculate min and max of saliency coverage
    const coverageValues = scatterData.map(d => d.saliency_coverage);
    const minCoverage = Math.min(...coverageValues);
    const maxCoverage = Math.max(...coverageValues);

    // Add 10% padding to both min and max for better visualization
    const yAxisMin = Math.max(0, minCoverage * 0.9);  // Ensure it doesn't go below 0
    const yAxisMax = maxCoverage * 1.1;

    // Create scales
    // X-Scale: Image position (0 to number of images)
    const xScale = d3.scaleLinear()
        .domain([0, scatterData.length - 1])
        .range([0, width]);

    // Y-Scale: Saliency coverage (adapted to min/max of data, not 0-100)
    const yScale = d3.scaleLinear()
        .domain([yAxisMin, yAxisMax])
        .range([height, 0]);

    // Color scale for coverage values (adapted to min/max)
    /*const colorScale = d3.scaleLinear()
        .domain([minCoverage, (minCoverage + maxCoverage) / 2, maxCoverage])
        .range(['#ff6b6b', '#ffd93d', '#6bcf7f']);*/

    const colorScale = d3.scaleLinear()
        .domain([minCoverage, maxCoverage])         // your data range
        .interpolate(() => d3.interpolateBlues);

    // Add grid lines
    svg.append('g')
        .attr('class', 'grid')
        .attr('opacity', 0.1)
        .call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat('')
        );

    // Draw scatter points
    const scatterPoints = svg.selectAll('circle')
        .data(scatterData)
        .enter()
        .append('circle')
        .attr('class', 'scatter-saliency-point')
        .attr('id', d => 'scatter-saliency-point-' + normalizeImageName(d.image_name))
        .attr('cx', (d, i) => xScale(i))
        .attr('cy', d => yScale(d.saliency_coverage))
        .attr('r', 4)
        .attr('fill', d => "black")//colorScale(d.saliency_coverage))
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            // Show tooltip with image number, score, and saliency coverage
            const tooltip = d3.select(container).append('div')
                .attr('class', 'scatter-tooltip')
                .style('position', 'absolute')
                .style('background', 'rgba(0, 0, 0, 0.9)')
                .style('color', '#fff')
                .style('padding', '10px 14px')
                .style('border-radius', '6px')
                .style('font-size', '13px')
                .style('font-weight', '500')
                .style('pointer-events', 'none')
                .style('z-index', '10000')
                .style('border', '1px solid rgba(255,255,255,0.2)')
                .style('box-shadow', '0 4px 12px rgba(0,0,0,0.3)')
                .html(`<strong>Image ${d.image_name}</strong><br/>Score: ${d.score.toFixed(2)}<br/>Coverage: ${d.saliency_coverage.toFixed(2)}%`);

            // Position tooltip at mouse location
            tooltip.style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mousemove', function(event, d) {
            // Update tooltip position as mouse moves
            d3.select(container).selectAll('.scatter-tooltip')
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseout', function() {
            d3.select(container).selectAll('.scatter-tooltip').remove();
            applyTSNESelectionToScatterPoints();
        });

    registerSaliencyScatterDefaults(scatterPoints);

    // X Axis
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).tickFormat(d => {
            const idx = Math.round(d);
            if (idx >= 0 && idx < scatterData.length) {
                return scatterData[idx].image_name;
            }
            return d;
        }))
        .style('font-size', '12px')
        .selectAll('text')
        .style('text-anchor', 'middle')
        .attr('dx', '0')
        .attr('dy', '0.71em')
        .attr('transform', 'rotate(0)');

    // Y Axis
    svg.append('g')
        .call(d3.axisLeft(yScale))
        .style('font-size', '12px');

    // X Axis Label
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + 50)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('fill', 'var(--color-secondary)')
        .text('Images');

    // Y Axis Label
    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -40)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('fill', 'var(--color-secondary)')
        .text('Saliency Coverage');

    createSaliencySelectionBrush(svg, width, height, scatterPoints);
    applyTSNESelectionToScatterPoints();
}

// Función para visualizar scatter plot por Score (mostrando todas las 50 imágenes)
function visualizeSaliencyCoverageByScore(data) {
    const container = document.getElementById('attention-heatmap-bottom');
    container.innerHTML = ''; // Clear container

    // Data validation
    if (!data.data || data.data.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No saliency coverage data available</p>';
        return;
    }

    // Setup Dimensions
    const margin = { top: 20, right: 40, bottom: 60, left: 60 };
    let containerWidth = container.clientWidth;
    let containerHeight = container.clientHeight;

    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    // Setup SVG
    const svg = d3.select(container)
        .append('svg')
        .attr('width', containerWidth)
        .attr('height', containerHeight)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Usar todos los datos directamente (ya están ordenados por score y coverage)
    const scatterData = data.data;

    // Calculate min and max of saliency coverage
    const coverageValues = scatterData.map(d => d.saliency_coverage);
    const minCoverage = Math.min(...coverageValues);
    const maxCoverage = Math.max(...coverageValues);

    // Add 10% padding to both min and max for better visualization
    const yAxisMin = Math.max(0, minCoverage * 0.9);  // Ensure it doesn't go below 0
    const yAxisMax = maxCoverage * 1.1;

    // Create scales
    // X-Scale: Score (1 to 10)
    const xScale = d3.scaleLinear()
        .domain([0.5, 10.5])
        .range([0, width]);

    // Y-Scale: Saliency coverage (adapted to min/max of data, not 0-100)
    const yScale = d3.scaleLinear()
        .domain([yAxisMin, yAxisMax])
        .range([height, 0]);

    // Color scale for coverage values
    const colorScale = d3.scaleLinear()
        .domain([minCoverage, maxCoverage])
        .interpolate(() => d3.interpolateBlues);
        //.range(['#ff6b6b', '#ffd93d', '#6bcf7f']);


    // Add grid lines
    svg.append('g')
        .attr('class', 'grid')
        .attr('opacity', 0.1)
        .call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat('')
        );

    // Agregar jitter en X para evitar que se superpongan los puntos con el mismo score
    // Cada punto se desplaza un poco aleatoriamente alrededor de su score
    const jitterGenerator = () => (Math.random() - 0.5) * 0.3;

    // Draw scatter points para cada imagen individual
    const scatterPoints = svg.selectAll('circle')
        .data(scatterData)
        .enter()
        .append('circle')
        .attr('class', 'scatter-saliency-point')
        .attr('id', d => 'scatter-saliency-point-' + normalizeImageName(d.image_name))
        .attr('cx', d => xScale(d.score) + jitterGenerator())
        .attr('cy', d => yScale(d.saliency_coverage))
        .attr('r', 4)
        .attr('fill', d => "#6daed5")//colorScale(d.saliency_coverage))
        .attr('stroke', 'black')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            // Show tooltip con info de cada imagen
            const tooltip = d3.select(container).append('div')
                .attr('class', 'scatter-tooltip')
                .style('position', 'absolute')
                .style('background', 'rgba(0, 0, 0, 0.9)')
                .style('color', '#fff')
                .style('padding', '10px 14px')
                .style('border-radius', '6px')
                .style('font-size', '13px')
                .style('font-weight', '500')
                .style('pointer-events', 'none')
                .style('z-index', '10000')
                .style('border', '1px solid rgba(255,255,255,0.2)')
                .style('box-shadow', '0 4px 12px rgba(0,0,0,0.3)')
                .html(`<strong>Image ${d.image_name}</strong><br/>
                    Score: ${d.score}<br/>
                    Coverage: ${d.saliency_coverage.toFixed(2)}%`);

            // Position tooltip at mouse location
            tooltip.style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mousemove', function(event, d) {
            // Update tooltip position as mouse moves
            d3.select(container).selectAll('.scatter-tooltip')
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseout', function() {
            d3.select(container).selectAll('.scatter-tooltip').remove();
            applyTSNESelectionToScatterPoints();
        });

    registerSaliencyScatterDefaults(scatterPoints);

    // X Axis
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(10).tickFormat(d => Math.round(d)))
        .style('font-size', '12px');

    // Y Axis
    svg.append('g')
        .call(d3.axisLeft(yScale))
        .style('font-size', '12px');

    // X Axis Label
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + 50)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill', 'var(--color-secondary)')
        .text('Score');

    // Y Axis Label
    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -40)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill', 'var(--color-secondary)')
        .text('Saliency Coverage');

    createSaliencySelectionBrush(svg, width, height, scatterPoints);
    applyTSNESelectionToScatterPoints();
}

// Función para visualizar saliency coverage por tiempo (ordenado por imagen)
function visualizeSaliencyCoverageByTime(data) {
    const container = document.getElementById('attention-heatmap-bottom');
    container.innerHTML = ''; // Clear container

    // Data validation
    if (!data.data || data.data.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No saliency coverage data available</p>';
        return;
    }

    // Setup Dimensions
    const margin = { top: 20, right: 40, bottom: 60, left: 60 };
    let containerWidth = container.clientWidth;
    let containerHeight = container.clientHeight;

    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    // Setup SVG
    const svg = d3.select(container)
        .append('svg')
        .attr('width', containerWidth)
        .attr('height', containerHeight)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Ordenar datos por image_name (ID de imagen) para seguir el orden de visualización
    const scatterData = [...data.data].sort((a, b) => a.image_name - b.image_name);

    // Calcular tiempo para cada imagen
    // Cada imagen se vio por 15 segundos + 5 segundos de descanso = 20 segundos por imagen
    const dataWithTime = scatterData.map((d, index) => ({
        ...d,
        time_seconds: index * 20,  // 20 segundos por imagen
        time_minutes: (index * 20) / 60  // Convertir a minutos
    }));

    // Calculate min and max of saliency coverage
    const coverageValues = dataWithTime.map(d => d.saliency_coverage);
    const minCoverage = Math.min(...coverageValues);
    const maxCoverage = Math.max(...coverageValues);

    // Add 10% padding to both min and max for better visualization
    const yAxisMin = Math.max(0, minCoverage * 0.9);  // Ensure it doesn't go below 0
    const yAxisMax = maxCoverage * 1.1;

    // Calculate time range
    const maxTime = Math.max(...dataWithTime.map(d => d.time_minutes));

    // Create scales
    // X-Scale: Time in minutes
    const xScale = d3.scaleLinear()
        .domain([0, maxTime])
        .range([0, width]);

    // Y-Scale: Saliency coverage
    const yScale = d3.scaleLinear()
        .domain([yAxisMin, yAxisMax])
        .range([height, 0]);

    // Color scale for coverage values
    const colorScale = d3.scaleLinear()
        .domain([minCoverage, maxCoverage])
        .interpolate(() => d3.interpolateBlues);

    // Add grid lines
    svg.append('g')
        .attr('class', 'grid')
        .attr('opacity', 0.1)
        .call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat('')
        );

    // Draw scatter points
    const scatterPoints = svg.selectAll('circle')
        .data(dataWithTime)
        .enter()
        .append('circle')
        .attr('class', 'scatter-saliency-point')
        .attr('id', d => 'scatter-saliency-point-' + normalizeImageName(d.image_name))
        .attr('cx', d => xScale(d.time_minutes))
        .attr('cy', d => yScale(d.saliency_coverage))
        .attr('r', 4)
        .attr('fill', d => "#6daed5")
        .attr('stroke', 'black')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            // Show tooltip
            const tooltip = d3.select(container).append('div')
                .attr('class', 'scatter-tooltip')
                .style('position', 'absolute')
                .style('background', 'rgba(0, 0, 0, 0.9)')
                .style('color', '#fff')
                .style('padding', '10px 14px')
                .style('border-radius', '6px')
                .style('font-size', '13px')
                .style('font-weight', '500')
                .style('pointer-events', 'none')
                .style('z-index', '10000')
                .style('border', '1px solid rgba(255,255,255,0.2)')
                .style('box-shadow', '0 4px 12px rgba(0,0,0,0.3)')
                .html(`<strong>Image ${d.image_name}</strong><br/>
                    Time: ${d.time_minutes.toFixed(2)} min<br/>
                    Score: ${d.score}<br/>
                    Coverage: ${d.saliency_coverage.toFixed(2)}%`);

            // Position tooltip at mouse location
            tooltip.style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mousemove', function(event, d) {
            // Update tooltip position as mouse moves
            d3.select(container).selectAll('.scatter-tooltip')
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseout', function() {
            d3.select(container).selectAll('.scatter-tooltip').remove();
            applyTSNESelectionToScatterPoints();
        });

    registerSaliencyScatterDefaults(scatterPoints);

    // X Axis
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(10).tickFormat(d => d.toFixed(1)))
        .style('font-size', '12px');

    // Y Axis
    svg.append('g')
        .call(d3.axisLeft(yScale))
        .style('font-size', '12px');

    // X Axis Label
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + 50)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill', 'var(--color-secondary)')
        .text('Time');

    // Y Axis Label
    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -40)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill', 'var(--color-secondary)')
        .text('Saliency Coverage');

    createSaliencySelectionBrush(svg, width, height, scatterPoints);
    applyTSNESelectionToScatterPoints();
}

// Helper function to render the correct visualization based on metric and view type
function renderSaliencyVisualization(data, metric, viewType) {
    if (metric === 'coverage') {
        if (viewType === 'by-image') {
            visualizeSaliencyCoverageScatterPlot(data);
        } else if (viewType === 'by-score') {
            visualizeSaliencyCoverageByScore(data);
        } else if (viewType === 'by-time') {
            visualizeSaliencyCoverageByTime(data);
        }
    } else if (metric === 'entropy') {
        if (viewType === 'by-image') {
            visualizeEntropyScatterPlot(data);
        } else if (viewType === 'by-score') {
            visualizeEntropyByScore(data);
        } else if (viewType === 'by-time') {
            visualizeEntropyByTime(data);
        }
    }
}

// Función para visualizar scatter plot de entropía (By Image)
function visualizeEntropyScatterPlot(data) {
    const container = document.getElementById('attention-heatmap-bottom');
    container.innerHTML = ''; // Clear container

    // Data validation
    if (!data.data || data.data.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No entropy data available</p>';
        return;
    }

    // Setup Dimensions
    const margin = { top: 20, right: 40, bottom: 60, left: 60 };
    let containerWidth = container.clientWidth;
    let containerHeight = container.clientHeight;

    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    // Setup SVG
    const svg = d3.select(container)
        .append('svg')
        .attr('width', containerWidth)
        .attr('height', containerHeight)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Extract data
    const scatterData = data.data;

    // Calculate min and max of entropy
    const entropyValues = scatterData.map(d => d.stationary_entropy);
    const minEntropy = Math.min(...entropyValues);
    const maxEntropy = Math.max(...entropyValues);

    // Add 10% padding to both min and max for better visualization
    const yAxisMin = Math.max(0, minEntropy * 0.9);  // Ensure it doesn't go below 0
    const yAxisMax = maxEntropy * 1.1;

    // Create scales
    // X-Scale: Image position (0 to number of images)
    const xScale = d3.scaleLinear()
        .domain([0, scatterData.length - 1])
        .range([0, width]);

    // Y-Scale: Entropy (adapted to min/max of data, not 0-100)
    const yScale = d3.scaleLinear()
        .domain([yAxisMin, yAxisMax])
        .range([height, 0]);

    // Color scale for entropy values (adapted to min/max)
    const colorScale = d3.scaleLinear()
        .domain([minEntropy, (minEntropy + maxEntropy) / 2, maxEntropy])
        .interpolate(() => d3.interpolateBlues);
        //.range(['#6bcf7f', '#ffd93d', '#ff6b6b']);

    // Add grid lines
    svg.append('g')
        .attr('class', 'grid')
        .attr('opacity', 0.1)
        .call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat('')
        );

    // Draw scatter points
    const scatterPoints = svg.selectAll('circle')
        .data(scatterData)
        .enter()
        .append('circle')
        .attr('class', 'scatter-saliency-point')
        .attr('id', d => 'scatter-saliency-point-' + normalizeImageName(d.image_name))
        .attr('cx', (d, i) => xScale(i))
        .attr('cy', d => yScale(d.stationary_entropy))
        .attr('r', 4)
        .attr('fill', d => "black")//colorScale(d.stationary_entropy))
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            // Show tooltip with image number, score, and entropy
            const tooltip = d3.select(container).append('div')
                .attr('class', 'scatter-tooltip')
                .style('position', 'absolute')
                .style('background', 'rgba(0, 0, 0, 0.9)')
                .style('color', '#fff')
                .style('padding', '10px 14px')
                .style('border-radius', '6px')
                .style('font-size', '13px')
                .style('font-weight', '500')
                .style('pointer-events', 'none')
                .style('z-index', '10000')
                .style('border', '1px solid rgba(255,255,255,0.2)')
                .style('box-shadow', '0 4px 12px rgba(0,0,0,0.3)')
                .html(`<strong>Image ${d.image_name}</strong><br/>Score: ${d.score.toFixed(2)}<br/>Entropy: ${d.stationary_entropy.toFixed(3)}`);

            // Position tooltip at mouse location
            tooltip.style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mousemove', function(event, d) {
            // Update tooltip position as mouse moves
            d3.select(container).selectAll('.scatter-tooltip')
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseout', function() {
            d3.select(container).selectAll('.scatter-tooltip').remove();
            applyTSNESelectionToScatterPoints();
        });

    registerSaliencyScatterDefaults(scatterPoints);

    // X Axis
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).tickFormat(d => {
            const idx = Math.round(d);
            if (idx >= 0 && idx < scatterData.length) {
                return scatterData[idx].image_name;
            }
            return d;
        }))
        .style('font-size', '12px')
        .selectAll('text')
        .style('text-anchor', 'middle')
        .attr('dx', '0')
        .attr('dy', '0.71em')
        .attr('transform', 'rotate(0)');

    // Y Axis
    svg.append('g')
        .call(d3.axisLeft(yScale))
        .style('font-size', '12px');

    // X Axis Label
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + 50)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill', 'var(--color-secondary)')
        .text('Images');

    // Y Axis Label
    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -40)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill', 'var(--color-secondary)')
        .text('Stationary Entropy');

    createSaliencySelectionBrush(svg, width, height, scatterPoints);
    applyTSNESelectionToScatterPoints();
}

// Función para visualizar scatter plot de entropía por Score (mostrando todas las 50 imágenes)
function visualizeEntropyByScore(data) {
    const container = document.getElementById('attention-heatmap-bottom');
    container.innerHTML = ''; // Clear container

    // Data validation
    if (!data.data || data.data.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No entropy data available</p>';
        return;
    }

    // Setup Dimensions
    const margin = { top: 20, right: 40, bottom: 60, left: 60 };
    let containerWidth = container.clientWidth;
    let containerHeight = container.clientHeight;

    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    // Setup SVG
    const svg = d3.select(container)
        .append('svg')
        .attr('width', containerWidth)
        .attr('height', containerHeight)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Usar todos los datos directamente (ya están ordenados por score y entropy)
    const scatterData = data.data;

    // Calculate min and max of entropy
    const entropyValues = scatterData.map(d => d.stationary_entropy);
    const minEntropy = Math.min(...entropyValues);
    const maxEntropy = Math.max(...entropyValues);

    // Add 10% padding to both min and max for better visualization
    const yAxisMin = Math.max(0, minEntropy * 0.9);  // Ensure it doesn't go below 0
    const yAxisMax = maxEntropy * 1.1;

    // Create scales
    // X-Scale: Score (1 to 10)
    const xScale = d3.scaleLinear()
        .domain([0.5, 10.5])
        .range([0, width]);

    // Y-Scale: Entropy (adapted to min/max of data, not 0-100)
    const yScale = d3.scaleLinear()
        .domain([yAxisMin, yAxisMax])
        .range([height, 0]);

    // Color scale for entropy values
    // Inverted from coverage: green (low entropy = concentrated) to red (high entropy = distributed)
    const colorScale = d3.scaleLinear()
        .domain([minEntropy, (minEntropy + maxEntropy) / 2, maxEntropy])
        .interpolate(() => d3.interpolateBlues);
        // .range(['#6bcf7f', '#ffd93d', '#ff6b6b']);

    // Add grid lines
    svg.append('g')
        .attr('class', 'grid')
        .attr('opacity', 0.1)
        .call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat('')
        );

    // Agregar jitter en X para evitar que se superpongan los puntos con el mismo score
    // Cada punto se desplaza un poco aleatoriamente alrededor de su score
    const jitterGenerator = () => (Math.random() - 0.5) * 0.3;

    // Draw scatter points para cada imagen individual
    const scatterPoints = svg.selectAll('circle')
        .data(scatterData)
        .enter()
        .append('circle')
        .attr('class', 'scatter-saliency-point')
        .attr('id', d => 'scatter-saliency-point-' + normalizeImageName(d.image_name))
        .attr('cx', d => xScale(d.score) + jitterGenerator())
        .attr('cy', d => yScale(d.stationary_entropy))
        .attr('r', 4)
        .attr('fill', d => "black")//colorScale(d.stationary_entropy))
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            // Show tooltip con info de cada imagen
            const tooltip = d3.select(container).append('div')
                .attr('class', 'scatter-tooltip')
                .style('position', 'absolute')
                .style('background', 'rgba(0, 0, 0, 0.9)')
                .style('color', '#fff')
                .style('padding', '10px 14px')
                .style('border-radius', '6px')
                .style('font-size', '13px')
                .style('font-weight', '500')
                .style('pointer-events', 'none')
                .style('z-index', '10000')
                .style('border', '1px solid rgba(255,255,255,0.2)')
                .style('box-shadow', '0 4px 12px rgba(0,0,0,0.3)')
                .html(`<strong>Image ${d.image_name}</strong><br/>
                    Score: ${d.score}<br/>
                    Entropy: ${d.stationary_entropy.toFixed(3)} bits`);

            // Position tooltip at mouse location
            tooltip.style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mousemove', function(event, d) {
            // Update tooltip position as mouse moves
            d3.select(container).selectAll('.scatter-tooltip')
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseout', function() {
            d3.select(container).selectAll('.scatter-tooltip').remove();
            applyTSNESelectionToScatterPoints();
        });

    registerSaliencyScatterDefaults(scatterPoints);

    // X Axis
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(10).tickFormat(d => Math.round(d)))
        .style('font-size', '12px');

    // Y Axis
    svg.append('g')
        .call(d3.axisLeft(yScale))
        .style('font-size', '12px');

    // X Axis Label
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + 50)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill', 'var(--color-secondary)')
        .text('Score');

    // Y Axis Label
    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -40)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill', 'var(--color-secondary)')
        .text('Stationary Entropy');

    createSaliencySelectionBrush(svg, width, height, scatterPoints);
    applyTSNESelectionToScatterPoints();
}

// Función para visualizar entropy por tiempo (ordenado por imagen)
function visualizeEntropyByTime(data) {
    const container = document.getElementById('attention-heatmap-bottom');
    container.innerHTML = ''; // Clear container

    // Data validation
    if (!data.data || data.data.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No entropy data available</p>';
        return;
    }

    // Setup Dimensions
    const margin = { top: 20, right: 40, bottom: 60, left: 60 };
    let containerWidth = container.clientWidth;
    let containerHeight = container.clientHeight;

    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    // Setup SVG
    const svg = d3.select(container)
        .append('svg')
        .attr('width', containerWidth)
        .attr('height', containerHeight)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Ordenar datos por image_name (ID de imagen) para seguir el orden de visualización
    const scatterData = [...data.data].sort((a, b) => a.image_name - b.image_name);

    // Calcular tiempo para cada imagen
    // Cada imagen se vio por 15 segundos + 5 segundos de descanso = 20 segundos por imagen
    const dataWithTime = scatterData.map((d, index) => ({
        ...d,
        time_seconds: index * 20,  // 20 segundos por imagen
        time_minutes: (index * 20) / 60  // Convertir a minutos
    }));

    // Calculate min and max of entropy
    const entropyValues = dataWithTime.map(d => d.stationary_entropy);
    const minEntropy = Math.min(...entropyValues);
    const maxEntropy = Math.max(...entropyValues);

    // Add 10% padding to both min and max for better visualization
    const yAxisMin = Math.max(0, minEntropy * 0.9);  // Ensure it doesn't go below 0
    const yAxisMax = maxEntropy * 1.1;

    // Calculate time range
    const maxTime = Math.max(...dataWithTime.map(d => d.time_minutes));

    // Create scales
    // X-Scale: Time in minutes
    const xScale = d3.scaleLinear()
        .domain([0, maxTime])
        .range([0, width]);

    // Y-Scale: Entropy
    const yScale = d3.scaleLinear()
        .domain([yAxisMin, yAxisMax])
        .range([height, 0]);

    // Add grid lines
    svg.append('g')
        .attr('class', 'grid')
        .attr('opacity', 0.1)
        .call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat('')
        );

    // Draw scatter points
    const scatterPoints = svg.selectAll('circle')
        .data(dataWithTime)
        .enter()
        .append('circle')
        .attr('class', 'scatter-saliency-point')
        .attr('id', d => 'scatter-saliency-point-' + normalizeImageName(d.image_name))
        .attr('cx', d => xScale(d.time_minutes))
        .attr('cy', d => yScale(d.stationary_entropy))
        .attr('r', 4)
        .attr('fill', d => "black")
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            // Show tooltip
            const tooltip = d3.select(container).append('div')
                .attr('class', 'scatter-tooltip')
                .style('position', 'absolute')
                .style('background', 'rgba(0, 0, 0, 0.9)')
                .style('color', '#fff')
                .style('padding', '10px 14px')
                .style('border-radius', '6px')
                .style('font-size', '13px')
                .style('font-weight', '500')
                .style('pointer-events', 'none')
                .style('z-index', '10000')
                .style('border', '1px solid rgba(255,255,255,0.2)')
                .style('box-shadow', '0 4px 12px rgba(0,0,0,0.3)')
                .html(`<strong>Image ${d.image_name}</strong><br/>
                    Time: ${d.time_minutes.toFixed(2)} min<br/>
                    Score: ${d.score}<br/>
                    Entropy: ${d.stationary_entropy.toFixed(3)} bits`);

            // Position tooltip at mouse location
            tooltip.style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mousemove', function(event, d) {
            // Update tooltip position as mouse moves
            d3.select(container).selectAll('.scatter-tooltip')
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseout', function() {
            d3.select(container).selectAll('.scatter-tooltip').remove();
            applyTSNESelectionToScatterPoints();
        });

    registerSaliencyScatterDefaults(scatterPoints);

    // X Axis
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(10).tickFormat(d => d.toFixed(1)))
        .style('font-size', '12px');

    // Y Axis
    svg.append('g')
        .call(d3.axisLeft(yScale))
        .style('font-size', '12px');

    // X Axis Label
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + 50)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill', 'var(--color-secondary)')
        .text('Time');

    // Y Axis Label
    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -40)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill', 'var(--color-secondary)')
        .text('Stationary Entropy');

    createSaliencySelectionBrush(svg, width, height, scatterPoints);
    applyTSNESelectionToScatterPoints();
}

// Función para visualizar proyección t-SNE de embeddings segmentarios
function visualizeTSNEProjection(data) {
    const container = document.getElementById('attention-heatmap-bottom-left');
    if (!container) {
        console.error('Container attention-heatmap-bottom-left not found');
        return;
    }
    container.innerHTML = ''; // Clear container

    // Data validation
    if (!data.data || data.data.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No t-SNE projection data available</p>';
        return;
    }

    // Create wrapper with flex layout
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    container.appendChild(wrapper);

    // Create plot container
    const plotContainer = document.createElement('div');
    plotContainer.style.flex = '1';
    plotContainer.style.overflow = 'hidden';
    wrapper.appendChild(plotContainer);

    // Setup Dimensions

    const margin = { top: 0, right: 0, bottom: 0, left: 0 };
    let containerWidth = container.clientWidth;
    let containerHeight = container.clientHeight;
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    // Setup SVG
    const svg = d3.select(plotContainer)
        .append('svg')
        .attr('width', containerWidth)
        .attr('height', containerHeight)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Extract data
    const projectionData = data.data;

    // Get min/max of t-SNE coordinates for scaling
    const xValues = projectionData.map(d => d.tsne_x);
    const yValues = projectionData.map(d => d.tsne_y);
    const scoreValues = projectionData.map(d => d.score);

    let avgScore = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length;

    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);
    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);
    const minScore = Math.min(...scoreValues);
    const maxScore = Math.max(...scoreValues);

    var xLength = xMax - xMin;
    var yLength = yMax - yMin;
    // Create scales
    const xScale = d3.scaleLinear()
        .domain([xMin - xLength*0.1, xMax + xLength*0.1])
        .range([0, width]);

    const yScale = d3.scaleLinear()
        .domain([yMin - yLength*0.05, yMax + yLength*0.05])
        .range([height, 0]);

    // Color scale for scores (red → yellow → green, same as participant score visualization)
    /*const colorScale = d3.scaleLinear()
        .domain([minScore, (minScore + maxScore) / 2, maxScore])
        .range(['#ff6b6b', '#ffd93d', '#6bcf7f']);*/

    /*const colorScale = d3.scaleLinear()
        .domain([minScore, maxScore])         // your data range
        .interpolate(() => d3.interpolateBlues);*/

    const colorScale = d3.scaleLinear()
        .domain([minScore, avgScore, maxScore])
        .range(["#a50026", "#f9f7ae", "#006837"]);

    // Add grid lines
    /*svg.append('g')
        .attr('class', 'grid')
        .attr('opacity', 0.1)
        .call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat('')
        );*/

    // Draw scatter points
    const circles = svg.selectAll('circle')
        .data(projectionData)
        .enter()
        .append('circle')
        .attr('class', 'projection-point')
        .attr('id', d => 'projection-point-' + normalizeImageName(d.image_name))
        .attr('cx', d => xScale(d.tsne_x))
        .attr('cy', d => yScale(d.tsne_y))
        .attr('r', 5)
        .attr('fill', d => colorScale(d.score))
        .attr('stroke', 'black')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            // Show tooltip with image number and score
            const tooltip = d3.select(plotContainer).append('div')
                .attr('class', 'scatter-tooltip')
                .style('position', 'fixed')
                .style('background', 'rgba(0, 0, 0, 0.9)')
                .style('color', '#fff')
                .style('padding', '10px 14px')
                .style('border-radius', '6px')
                .style('font-size', '13px')
                .style('font-weight', '500')
                .style('pointer-events', 'none')
                .style('z-index', '10000')
                .style('border', '1px solid rgba(255,255,255,0.2)')
                .style('box-shadow', '0 4px 12px rgba(0,0,0,0.3)')
                .html(`<strong>Image ${d.image_name}</strong><br/>Score: ${d.score.toFixed(1)}`);

            // Position tooltip at mouse location
            tooltip.style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mousemove', function(event, d) {
            // Update tooltip position as mouse moves
            d3.select(plotContainer).selectAll('.scatter-tooltip')
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseout', function() {
            d3.select(plotContainer).selectAll('.scatter-tooltip').remove();
            applyTSNESelectionToProjectionPoints();
        });

    registerProjectionPointDefaults(circles);
    applyTSNESelectionToProjectionPoints();

    // Add brush functionality
    const brush = d3.brush()
        .extent([[0, 0], [width, height]])
        .on('end', function(event) {
            if (!event.selection) {
                clearTSNESelectionState();
                updateLinkedSelectionViews();
                return;
            }

            const [[x0, y0], [x1, y1]] = event.selection;

            // Find points within the brush selection
            const selectedPoints = projectionData.filter(d => {
                const cx = xScale(d.tsne_x);
                const cy = yScale(d.tsne_y);
                return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
            });

            if (selectedPoints.length > 0) {
                setTSNESelectionState(selectedPoints);
            } else {
                clearTSNESelectionState();
            }

            updateLinkedSelectionViews();
        });

    // Add brush to SVG
    const projectionBrushLayer = svg.append('g')
        .attr('class', 'brush')
        .call(brush);

    // Keep brush behind points so hover tooltips remain accessible.
    projectionBrushLayer.lower();

    document.getElementById("image-projection-legend").innerHTML = "";
    // Assume heatmapData is available and contains objects with rawValue
    const values = projectionData.map(d => d.score);
    const minVal = d3.min(values);
    const maxVal = d3.max(values);
    // Select container
    const container2 = d3.select("#image-projection-legend");
    const width2 = container2.node().getBoundingClientRect().width;
    const height2 = container2.node().getBoundingClientRect().height;
    // SVG
    const svgLegend = container2.append("svg")
        .attr("width", width2)
        .attr("height", height2);

    // Legend rect size & position
    const barWidth = width2 *0.5;
    const barHeight = height2/3;
    const barX = (width2 - barWidth) / 2;
    const barY = (height2 - barHeight) / 2;
    // Gradient
    const defs = svgLegend.append("defs");
    const gradient = defs.append("linearGradient")
        .attr("id", "projection-score-gradient")
        .attr("x1", "0%")
        .attr("y1", "0%")
        .attr("x2", "100%")
        .attr("y2", "0%");

    gradient.selectAll("stop")
        .data([
            { offset: "0%", color: colorScale(minScore) },
            { offset: "50%", color: colorScale(avgScore) },
            { offset: "100%", color: colorScale(maxScore) }
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
        .attr("fill", "url(#projection-score-gradient)");

    // Min & max labels
    svgLegend.append("text")
        .attr("x", barX)
        .attr("y", barY + barHeight + 5)
        .attr("text-anchor", "start")
        .attr('class', 'text-xs')
        .attr('dominant-baseline', 'hanging')
        .attr('fill', 'var(--color-secondary)')
        .text(minVal.toFixed(0));

    svgLegend.append("text")
        .attr("x", barX + barWidth/2)
        .attr("y", barY + barHeight + 5)
        .attr("text-anchor", "middle")
        .attr('class', 'text-xs')
        .attr('dominant-baseline', 'hanging')
        .attr('fill', 'var(--color-secondary)')
        .text(avgScore.toFixed(0));


    // Max label (top of bar)
    svgLegend.append("text")
        .attr("x", barX + barWidth)
        .attr("y", barY + barHeight + 5)
        .attr("text-anchor", "end")
        .attr('class', 'text-xs')
        .attr('dominant-baseline', 'hanging')
        .attr('fill', 'var(--color-secondary)')
        .text(maxVal.toFixed(0));

    // Legend label
    svgLegend.append("text")
        .attr("x", barX - 5)
        .attr("y", barY + barHeight/2)
        .attr("text-anchor", "end")
        .attr('dominant-baseline', 'middle')
        .attr('class', 'text-sm')
        .attr('fill', 'var(--color-secondary)')
        .text("Unsafe");

    svgLegend.append("text")
        .attr("x", barX + barWidth + 5)
        .attr("y", barY + barHeight/2)
        .attr("text-anchor", "start")
        .attr('dominant-baseline', 'middle')
        .attr('class', 'text-sm')
        .attr('fill', 'var(--color-secondary)')
        .text("Safe");

    // Helper function to display selected images in both containers
    function displaySelectedImagesInControls(selectedPoints) {
        const controls2SelectedImages = document.getElementById('controls2-selected-images');
        const orderedPoints = [...selectedPoints].sort((a, b) => {
            const scoreA = Number.isFinite(Number(a?.score)) ? Number(a.score) : -Infinity;
            const scoreB = Number.isFinite(Number(b?.score)) ? Number(b.score) : -Infinity;
            return scoreB - scoreA;
        });
        if (!controls2SelectedImages) {
            return;
        }

        controls2SelectedImages.innerHTML = '';

        orderedPoints.forEach(point => {
            const scoreValue = Number(point?.score);
            const scoreLabel = Number.isFinite(scoreValue) ? scoreValue.toFixed(1) : 'N/A';
            const img = document.createElement('div');
            img.classList.add("h-[calc(49%)]")
            img.classList.add("w-full")
            // img.classList.add("my-1")

            img.innerHTML = `
                <div class="btn btn-xs btn-ghost pointer-events-none w-full h-[calc(10%)]">
                    id: ${point.image_name} | score: ${scoreLabel}
                </div>
                <img src='/static/images/images/images/${point.image_name}.jpg' class="h-[calc(90%)] w-full object-scale-down">
            `
            // Click on image to load it in controls
            img.addEventListener('click', () => {
                loadImageInControls2(point.image_name);
            });

            controls2SelectedImages.appendChild(img);
        });
    }

    // Store reference to clear on heatmap selection
    window.clearTSNESelection = function() {
        clearTSNESelectionState();
        updateLinkedSelectionViews();
        svg.selectAll('.brush').call(brush.move, null);
    };

    window.displayTSNESelectedImages = displaySelectedImagesInControls;
    updateLinkedSelectionViews();
}
