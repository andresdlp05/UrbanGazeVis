// scarf.js - scarf plot visualization and related highlight utilities

const scarfLog = window.debugLog || function(...args) {
    if (window.DEBUG_LOGS) {
        console.log(...args);
    }
};

let previousSelectedPartBeforeScarfSegment = null;

function isUnknownScarfClass(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'unknown';
}

function getParticipantIndexedPoints(points, indexMap, participantId) {
    if (!participantId || participantId === 'all') {
        return points || [];
    }
    if (indexMap && typeof indexMap.get === 'function') {
        return indexMap.get(String(participantId)) || [];
    }
    return (points || []).filter(point => String(point.participante || point.participant) === String(participantId));
}
function visualizeScarfPlot(data) {
    const container = document.getElementById('scarf-plot');
    container.innerHTML = ''; // Limpiar
    // container.style.overflow = 'auto'; // Permitir scroll
    if (!data.scarf_data || data.scarf_data.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No hay datos disponibles</p>';
        return;
    }

    const filteredScarfData = (data.scarf_data || []).map(item => ({
        ...item,
        segments: (item.segments || []).filter(segment => !isUnknownScarfClass(segment?.class))
    }));
    const totalVisibleSegments = filteredScarfData.reduce((sum, item) => sum + item.segments.length, 0);
    if (totalVisibleSegments === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No hay datos disponibles</p>';
        return;
    }
    if (window.selectedClass && isUnknownScarfClass(window.selectedClass)) {
        window.selectedClass = null;
    }

    // LOG: Ver quÃ© colores estÃ¡n llegando del backend
    scarfLog('%c=== SCARF PLOT COLORS DEBUG ===', 'color: orange; font-weight: bold');
    const allSegments = filteredScarfData.flatMap(d => d.segments);
    const uniqueColorsByClass = {};
    allSegments.forEach(seg => {
        if (!uniqueColorsByClass[seg.class]) {
            uniqueColorsByClass[seg.class] = seg.color;
        }
    });
    scarfLog('Colors by class:', uniqueColorsByClass);
    scarfLog('Dataset:', currentDatasetSelect);

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const margin = { top: 0, right: containerWidth*0.05, bottom: 40, left: containerWidth*0.1};
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;
    const totalHeight = height + margin.top + margin.bottom;

    const svg = d3.select(container)
        .append('svg')
        .attr('width', containerWidth)
        .attr('height', containerHeight)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    const timeScale = d3.scaleLinear()
        .domain([0, 15000])
        .range([0, width]);

    var dataParticipant = globalData.find(d => Number(d.id) === data.image_id).participants;
    const participantScale = d3.scaleBand()
        .domain(dataParticipant.map(d => d.participant))
        .range([0, height])
        .padding(0.2);

    const rowHeight = participantScale.bandwidth();
        // --- D3-style Data Binding ---
    const participantRows = svg.selectAll('.participant-row')
        .data(filteredScarfData) // Bind the array of participants
        .enter()
        .append('g') // Create a new group element for each participant
        .attr('class', 'participant-row')
        .attr('transform', d => `translate(0, ${participantScale(d.participant)})`);
        // Use the transform attribute to position the *entire row* vertically

    participantRows.selectAll('rect')
        .data(d => d.segments.map(seg => ({...seg, participant: d.participant}))) // Include participant info
        .enter()
        .append('rect') // Create a new rect for each segment
        .attr('x', segment => timeScale(segment.start_time))
        .attr('y', 0)
        .attr('width', segment => {
            const x = timeScale(segment.start_time);
            return timeScale(segment.end_time) - x;
        })
        .attr('height', rowHeight)
        .attr('class', segment => 'scarf-segment scarf-segment-' + segment.class)
        .attr('fill', segment => segment.color || '#999999')
        .attr('stroke', '#333')
        .attr('stroke-width', 0.5)
        .style('cursor', 'pointer')
        .on('click', function(_event, segment) {
            // Show points for this time segment
            showPointsForScarfSegment(segment);
        })
        .append('title')
        .text(segment => `${segment.class}\n${segment.points} puntos\n${(segment.end_time - segment.start_time).toFixed(0)}ms\nClick para ver puntos`);

    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + 30)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill','var(--color-secondary)')
        .text('Time (s)');

    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -80)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill','var(--color-secondary)')
        .text('Participants');

    /*svg.append('g')
        .call(d3.axisLeft(participantScale).tickFormat( d => 'P-'+d))
        .select(".domain").remove()
        .select(".tick")
        .attr("y1", 0)
        .attr("y2", 0)
        .attr('fill','transparent');*/

    svg.append('g')
        .selectAll('text')
        .data(dataParticipant)
        .enter()
        .append('text')
        .attr('class', 'scarf-participant-label')
        .attr('x', -10)
        .attr('y', d => participantScale(d.participant) + participantScale.bandwidth() / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '12px')
        .style('cursor', 'pointer') // Indicate clickable
        .style('fill','var(--color-secondary)')
        .text(d => 'P-' + d.participant)
        .on('click', function(_event, d) {
            const participantId = d?.participant;
            if (participantId === undefined || participantId === null) {
                return;
            }

            selectedPart = String(participantId);
            const partSelect = document.getElementById('part-select');
            if (partSelect) {
                partSelect.value = selectedPart;
            }

            highlightParticipantInScarf(selectedPart);
            highlightParticipantColumnInHeatmap(selectedPart);

            if (currentOverlayTypes && currentOverlayTypes.length > 0) {
                updateOverlay();
            }
        });

    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(timeScale).ticks(15).tickFormat(d => `${d/1000}s`))

    // Grid vertical
    /*svg.append('g')
                .attr('class', 'grid')
                .attr('opacity', 0.1)
                .call(d3.axisBottom(timeScale)
                    .tickSize(-height)
                    .tickFormat('')
                )
                .style('stroke-dasharray', '2,2');*/

    // Crear leyenda con los main_class Ãºnicos
            const classes = [];
            const legendContainer = document.getElementById('scarf-plot-legend');
            legendContainer.innerHTML = "";
            legendContainer.style.gap = '6px';
            legendContainer.style.justifyContent = 'center';
            legendContainer.style.alignItems = 'center';
            legendContainer.style.padding = '0 4px';
            legendContainer.style.overflowX = 'auto';
            legendContainer.style.fontFamily = '"Avenir Next Custom", "Inter", sans-serif';

            filteredScarfData.forEach(participant => {
                participant.segments.forEach(segment => {
                    const existing = classes.find(c => c.name === segment.class);
                    if (!existing) {
                        classes.push({
                            name: segment.class,
                            color: segment.color || '#999999'
                        });
                    }
                });
            });

            var btnLegend = document.createElement('div');
            btnLegend.innerHTML = 'Classes:';
            btnLegend.className = 'btn btn-ghost btn-xs pointer-events-none h-6 min-h-0 px-1 normal-case shrink-0 flex items-center font-semibold';
            legendContainer.append(btnLegend);

            for (let i = 0; i<classes.length; i++){
                var btnLegend = document.createElement('div');
                btnLegend.id = 'legend-'+ classes[i].name;
                btnLegend.className = 'btn btn-ghost btn-xs flex flex-row items-center h-6 min-h-0 px-1 gap-1 normal-case shrink-0';
                var innerhtml = "<div class='rounded-sm shrink-0' style='width:14px;height:14px;background-color:"+ classes[i].color+"'></div><span class='text-xs leading-none'>"+ classes[i].name+"</span>";
                btnLegend.innerHTML = innerhtml;

                // MODIFICACIÃ“N: Agregar evento click para cross-filtering
                btnLegend.style.cursor = 'pointer';
                btnLegend.addEventListener('click', function() {
                    const className = classes[i].name;

                    // Toggle: si ya estÃ¡ seleccionada, deselecciona; sino, selecciona
                    if (window.selectedClass === className) {
                        window.selectedClass = null;
                    } else {
                        window.selectedClass = className;
                    }

                    // Si la selecciÃ³n viene desde la leyenda por clase, liberar
                    // el lock de segmento temporal para permitir highlight por clase.
                    currentScarfSegment = null;
                    window.currentScarfSegment = null;

                    // Llamar a funciÃ³n global que actualiza heatmap, scarf plot y segmentaciÃ³n
                    updateHighlightsGlobal();

                    scarfLog('Selected class from legend:', window.selectedClass);
                });

                legendContainer.append(btnLegend);
            }

    if (currentAnalyzedArea && currentAreaData) {
        highlightScarfSegmentsForArea(currentAreaData);
    }

    if (selectedPart && selectedPart !== 'all') {
        highlightParticipantInScarf(selectedPart);
    }
}


function loadScarfPlot(imageId, dataType = 'gaze') {
            const baseUrl = window.location.origin;
            const apiUrl = `${baseUrl}/api/scarf-plot/${imageId}?data_type=${dataType}&dataset_select=${currentDatasetSelect}`;

            scarfLog(`Cargando scarf plot desde: ${apiUrl} (data_type=${dataType}, dataset_select=${currentDatasetSelect})`);

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
                        showScarfError(data.error);
                    } else {
                        scarfLog(`Scarf plot data loaded (${dataType}):`, data);
                        visualizeScarfPlot(data);
                        // updateScarfLegend(data);
                    }
                })
                .catch(error => {
                    console.error('Error loading scarf plot:', error);
                    showScarfError('Error cargando scarf plot');
                });
}

// Resaltar bloque seleccionado en scarf plot (opacar el resto)
function highlightScarfSegment(segment) {
    scarfLog('Highlighting scarf segment:', segment);

    // Opacar todos los segmentos
    d3.selectAll('.scarf-segment')
        .attr('opacity', SCARF_SEGMENT_DIM_OPACITY);

    // Encontrar y resaltar el segmento especÃ­fico
    d3.selectAll('.scarf-segment')
        .filter(function(d) {
            return d &&
                   d.participant === segment.participant &&
                   d.start_time === segment.start_time &&
                   d.end_time === segment.end_time;
        })
        .attr('opacity', 1)
        .attr('stroke', SCARF_SEGMENT_HIGHLIGHT_STROKE)
        .attr('stroke-width', 0.5);
}

// Remover highlight de scarf plot
function removeScarfSegmentHighlight() {
    clearScarfAreaSelectionHighlight();

    // Restaurar opacidad completa a todos los segmentos
    d3.selectAll('.scarf-segment')
        .attr('opacity', 1)
        .attr('stroke', '#333')
        .attr('stroke-width', 1);
}

function restorePointsForCurrentParticipantSelection() {
    const participantGaze = getPointsForParticipant(allGazePointsWithParticipant, selectedPart, gazePointsByParticipant);
    const participantFixations = getPointsForParticipant(allFixationPointsWithParticipant, selectedPart, fixationPointsByParticipant);

    currentGazePoints = participantGaze;
    currentFixationPoints = participantFixations;

    clearOverlayPoints();

    if (currentDataType === 'gaze' && participantGaze.length > 0) {
        visualizeGazePointsOverlay();
    } else if (currentDataType === 'fixations' && participantFixations.length > 0) {
        visualizeFixationPointsOverlay();
    }
}

function clearScarfSegmentSelection() {
    const previousPart = previousSelectedPartBeforeScarfSegment;

    currentScarfSegment = null;
    window.currentScarfSegment = null;
    window.selectedClass = null;

    if (previousPart !== null && previousPart !== undefined) {
        selectedPart = String(previousPart);
        const partSelect = document.getElementById('part-select');
        if (partSelect) {
            partSelect.value = selectedPart;
        }
    }
    previousSelectedPartBeforeScarfSegment = null;

    removeScarfSegmentHighlight();
    removeBoundingBoxOverlay();
    removeParticipantColumnHighlight();

    if (typeof updateHighlightsGlobal === 'function') {
        updateHighlightsGlobal();
    }

    // Al deseleccionar el mismo segmento (segundo click), no restaurar puntos
    // por participante: el requisito es dejar el overlay sin puntos.
    currentGazePoints = [];
    currentFixationPoints = [];
    clearOverlayPoints();
    setClearButtonEnabled(Boolean(currentAnalyzedArea));
}

// FunciÃ³n principal: mostrar puntos para un segmento del scarf plot
function showPointsForScarfSegment(segment) {
    scarfLog('Showing points for scarf segment:', segment);

    if (currentScarfSegment && isSameScarfSegment(segment, currentScarfSegment)) {
        clearScarfSegmentSelection();
        return;
    }

    window._scarfSelecting = true;

    if (!currentScarfSegment) {
        previousSelectedPartBeforeScarfSegment = selectedPart || 'all';
    }

    // Guardar el segmento actual para usar su color
    currentScarfSegment = segment;
    window.currentScarfSegment = segment;
    window.selectedClass = segment?.class || null;
    setClearButtonEnabled(true);

    const { start_time, end_time, participant } = segment;
    selectedPart = String(participant);
    const partSelect = document.getElementById('part-select');
    if (partSelect) {
        partSelect.value = selectedPart;
    }

    const hasRealTimeWindow = Number.isFinite(segment.start_time_real) && Number.isFinite(segment.end_time_real);
    // Convertir tiempos de milisegundos a segundos si es necesario
    const startSec = hasRealTimeWindow
        ? (segment.start_time_real < 100 ? segment.start_time_real : segment.start_time_real / 1000)
        : null;
    const endSec = hasRealTimeWindow
        ? (segment.end_time_real < 100 ? segment.end_time_real : segment.end_time_real / 1000)
        : null;

    if (hasRealTimeWindow) {
        scarfLog(`Filtering for participant ${participant}, time range: ${startSec.toFixed(2)}s - ${endSec.toFixed(2)}s (${start_time}ms - ${end_time}ms)`);
    } else {
        scarfLog(`Filtering for participant ${participant} with normalized scarf time range (${start_time}ms - ${end_time}ms)`);
    }

    const participantGaze = getParticipantIndexedPoints(allGazePointsWithParticipant, gazePointsByParticipant, participant);
    const participantFixations = getParticipantIndexedPoints(allFixationPointsWithParticipant, fixationPointsByParticipant, participant);

    // Filtrar gaze points
    const filteredGaze = hasRealTimeWindow
        ? participantGaze.filter(point => {
            const timeInSeconds = Number.isFinite(point.timeSec)
                ? point.timeSec
                : (point.time < 100 ? point.time : point.time / 1000);
            return timeInSeconds >= startSec && timeInSeconds <= endSec;
        })
        : [];

    let filteredFixations = [];
    if (hasRealTimeWindow) {
        filteredFixations = participantFixations.filter(point => {
            const startInSeconds = Number.isFinite(point.startSec)
                ? point.startSec
                : (point.start < 100 ? point.start : point.start / 1000);
            const endInSeconds = Number.isFinite(point.endSec)
                ? point.endSec
                : (point.end < 100 ? point.end : point.end / 1000);

            // Check if fixation overlaps with segment time range
            return (startInSeconds >= startSec && startInSeconds <= endSec) ||
                   (endInSeconds >= startSec && endInSeconds <= endSec) ||
                   (startInSeconds <= startSec && endInSeconds >= endSec);
        });
    } else {
        const segmentStartNorm = Number(segment.start_time);
        const segmentEndNorm = Number(segment.end_time);

        const participantStartTimesMs = participantFixations
            .map(point => toMilliseconds(point.start ?? point.start_time))
            .filter(Number.isFinite);

        const minStartMs = participantStartTimesMs.length > 0 ? Math.min(...participantStartTimesMs) : 0;
        const maxStartMs = participantStartTimesMs.length > 0 ? Math.max(...participantStartTimesMs) : 1;
        const timelineRangeMs = Math.max(maxStartMs - minStartMs, 1);

        filteredFixations = participantFixations.filter(point => {
            const rawStartMs = toMilliseconds(point.start ?? point.start_time);
            if (!Number.isFinite(rawStartMs)) {
                return false;
            }

            const durationMs = Math.max(0, toMilliseconds(point.duration) ?? 0);
            const startNorm = ((rawStartMs - minStartMs) / timelineRangeMs) * SCARF_TIMELINE_DURATION_MS;
            const endNorm = startNorm + durationMs;

            // Check if fixation overlaps with segment time range in normalized scarf timeline.
            return (startNorm >= segmentStartNorm && startNorm <= segmentEndNorm) ||
                   (endNorm >= segmentStartNorm && endNorm <= segmentEndNorm) ||
                   (startNorm <= segmentStartNorm && endNorm >= segmentEndNorm);
        });
    }

    scarfLog(`Found ${filteredGaze.length} gaze points, ${filteredFixations.length} fixation points`);

    // Actualizar puntos actuales
    currentGazePoints = filteredGaze;
    currentFixationPoints = filteredFixations;

    // Limpiar y mostrar
    clearOverlayPoints();
    removeBoundingBoxOverlay();
    removeParticipantColumnHighlight();
    removeScarfSegmentHighlight();

    // Resaltar en scarf plot
    highlightScarfSegment(segment);

    // Cross-filter: resaltar clase en segmentaciÃ³n al hacer click en segmento temporal.
    if (typeof updateHighlightsGlobal === 'function') {
        updateHighlightsGlobal();
    } else {
        if (currentImageBlendPercent <= 0 && typeof setImageBlendPercentage === 'function') {
            setImageBlendPercentage(50);
        }
        if (typeof syncSegmentationLayerImage === 'function') {
            syncSegmentationLayerImage();
        }
    }

    // Requisito: en click de segmento temporal, dejar segmentación en 0%.
    if (typeof setImageBlendPercentage === 'function') {
        setImageBlendPercentage(100);
    }

    // Resaltar columna de participante en heatmap
    highlightParticipantColumnInHeatmap(participant);

    if (currentDataType === 'gaze' && filteredGaze.length > 0) {
        visualizeGazePointsOverlay();
    } else if (currentDataType === 'fixations' && filteredFixations.length > 0) {
        visualizeFixationPointsOverlay();
    } else if (filteredGaze.length === 0 && filteredFixations.length === 0) {
        console.warn('No points found in this time segment');
    }
    window._scarfSelecting = false;

}

function highlightScarfSegmentsForArea(areaData) {
    clearScarfAreaSelectionHighlight();

    const scarfSegments = d3.selectAll('.scarf-segment');
    if (scarfSegments.empty()) {
        return;
    }

    const effectiveDataType = (areaData && areaData.data_type) ? areaData.data_type : currentDataType;
    const intervalsByParticipant = buildAreaIntervalsForScarf(areaData, effectiveDataType);
    if (intervalsByParticipant.size === 0) {
        return;
    }

    let highlightedCount = 0;

    scarfSegments.each(function(segment) {
        const segmentSelection = d3.select(this);
        if (!segment) {
            segmentSelection
                .classed('scarf-segment-area-highlight', false)
                .classed('scarf-segment-area-muted', true)
                .attr('opacity', SCARF_AREA_DIM_OPACITY)
                .attr('stroke', '#333')
                .attr('stroke-width', 1);
            return;
        }

        const participantId = String(segment.participant);
        const participantIntervals = intervalsByParticipant.get(participantId);
        const segmentStart = Number(segment.start_time);
        const segmentEnd = Number(segment.end_time);

        const hasValidSegmentTimes = Number.isFinite(segmentStart) && Number.isFinite(segmentEnd);
        const start = hasValidSegmentTimes ? Math.min(segmentStart, segmentEnd) : null;
        const end = hasValidSegmentTimes ? Math.max(segmentStart, segmentEnd) : null;

        const matchesAnyInterval = Boolean(
            participantIntervals &&
            participantIntervals.length > 0 &&
            hasValidSegmentTimes &&
            participantIntervals.some(interval =>
                end >= (interval.start - SCARF_SEGMENT_MATCH_TOLERANCE_MS) &&
                start <= (interval.end + SCARF_SEGMENT_MATCH_TOLERANCE_MS)
            )
        );

        if (matchesAnyInterval) {
            highlightedCount++;
            segmentSelection
                .classed('scarf-segment-area-highlight', true)
                .classed('scarf-segment-area-muted', false)
                .attr('opacity', 1)
                .attr('stroke', SCARF_SEGMENT_HIGHLIGHT_STROKE)
                .attr('stroke-width', 0.5);
        } else {
            segmentSelection
                .classed('scarf-segment-area-highlight', false)
                .classed('scarf-segment-area-muted', true)
                .attr('opacity', SCARF_AREA_DIM_OPACITY)
                .attr('stroke', '#333')
                .attr('stroke-width', 0.5);
        }
    });

    scarfLog(`Area-driven scarf highlight: ${highlightedCount} segmentos`);
}

function clearScarfAreaSelectionHighlight() {
    d3.selectAll('.scarf-segment')
        .classed('scarf-segment-area-highlight', false)
        .classed('scarf-segment-area-muted', false)
        .each(function(segment) {
            const segmentSelection = d3.select(this);
            const keepManualHighlight = currentScarfSegment && isSameScarfSegment(segment, currentScarfSegment);

            segmentSelection
                .attr('opacity', 1)
                .attr('stroke', keepManualHighlight ? SCARF_SEGMENT_HIGHLIGHT_STROKE : '#333')
                .attr('stroke-width', keepManualHighlight ? 1 : 1);
        });
}

function highlightParticipantInScarf(participantId) {
    const participantKey = (participantId !== null && participantId !== undefined && participantId !== '' && participantId !== 'all')
        ? String(participantId)
        : null;

    if (!participantKey) {
        if (currentAnalyzedArea && currentAreaData) {
            highlightScarfSegmentsForArea(currentAreaData);
        } else {
            removeScarfSegmentHighlight();
        }
        return;
    }

    d3.selectAll('.scarf-segment')
        .attr('opacity', d => (d && String(d.participant) === participantKey ? 1 : SCARF_SEGMENT_DIM_OPACITY))
        .attr('stroke', d => (d && String(d.participant) === participantKey ? '#000000' : '#333'))
        .attr('stroke-width', d => (d && String(d.participant) === participantKey ? 0.8 : 0.5));

    d3.selectAll('.scarf-participant-label')
        .style('font-weight', d => (d && String(d.participant) === participantKey ? '700' : '400'))
        .style('opacity', d => (d && String(d.participant) === participantKey ? 1 : 0.5));
}

function buildScarfTimelineDomains(dataType) {
    const sourcePoints = dataType === 'fixations'
        ? allFixationPointsWithParticipant
        : allGazePointsWithParticipant;

    const domains = new Map();

    sourcePoints.forEach(point => {
        const participantId = getPointParticipantId(point);
        if (!participantId) return;

        const rawTime = dataType === 'fixations'
            ? toMilliseconds(point.start ?? point.start_time)
            : toMilliseconds(point.time ?? point.Time ?? point.start ?? point.start_time);

        if (!Number.isFinite(rawTime)) return;

        if (!domains.has(participantId)) {
            domains.set(participantId, { min: rawTime, max: rawTime });
            return;
        }

        const domain = domains.get(participantId);
        domain.min = Math.min(domain.min, rawTime);
        domain.max = Math.max(domain.max, rawTime);
    });

    return domains;
}

function normalizeTimeToScarfTimeline(rawTimeMs, participantId, domainsByParticipant) {
    if (!Number.isFinite(rawTimeMs)) {
        return null;
    }

    const domain = domainsByParticipant.get(participantId);
    if (!domain || !Number.isFinite(domain.min) || !Number.isFinite(domain.max) || domain.max <= domain.min) {
        return Math.max(0, Math.min(SCARF_TIMELINE_DURATION_MS, rawTimeMs));
    }

    const normalized = ((rawTimeMs - domain.min) / (domain.max - domain.min)) * SCARF_TIMELINE_DURATION_MS;
    return Math.max(0, Math.min(SCARF_TIMELINE_DURATION_MS, normalized));
}

function mergeIntervals(intervals, mergeGapMs = 80) {
    if (!intervals || intervals.length <= 1) {
        return intervals || [];
    }

    const sorted = [...intervals]
        .map(i => ({ start: Number(i.start), end: Number(i.end) }))
        .filter(i => Number.isFinite(i.start) && Number.isFinite(i.end))
        .sort((a, b) => a.start - b.start);

    if (sorted.length === 0) {
        return [];
    }

    const merged = [{ start: sorted[0].start, end: sorted[0].end }];

    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const last = merged[merged.length - 1];
        if (current.start <= (last.end + mergeGapMs)) {
            last.end = Math.max(last.end, current.end);
        } else {
            merged.push({ start: current.start, end: current.end });
        }
    }

    return merged;
}

function buildAreaIntervalsForScarf(areaData, dataType) {
    const areaPoints = Array.isArray(areaData?.data_for_analysis) ? areaData.data_for_analysis : [];
    const domainsByParticipant = buildScarfTimelineDomains(dataType);
    const intervalsByParticipant = new Map();

    areaPoints.forEach(point => {
        const participantId = getPointParticipantId(point);
        if (!participantId) return;

        let intervalStart = null;
        let intervalEnd = null;

        if (dataType === 'fixations') {
            const rawStartMs = toMilliseconds(point.start ?? point.start_time ?? point.Time ?? point.time);
            if (!Number.isFinite(rawStartMs)) return;

            const normalizedStart = normalizeTimeToScarfTimeline(rawStartMs, participantId, domainsByParticipant);
            if (!Number.isFinite(normalizedStart)) return;

            let normalizedEnd = normalizedStart;
            const durationMs = toMilliseconds(point.duration);

            if (Number.isFinite(durationMs)) {
                normalizedEnd = normalizedStart + Math.max(0, durationMs);
            } else {
                const rawEndMs = toMilliseconds(point.end ?? point.end_time);
                if (Number.isFinite(rawEndMs)) {
                    normalizedEnd = normalizeTimeToScarfTimeline(rawEndMs, participantId, domainsByParticipant);
                }
            }

            intervalStart = Math.max(0, Math.min(SCARF_TIMELINE_DURATION_MS, Math.min(normalizedStart, normalizedEnd)));
            intervalEnd = Math.max(0, Math.min(SCARF_TIMELINE_DURATION_MS, Math.max(normalizedStart, normalizedEnd)));
        } else {
            const rawTimeMs = toMilliseconds(point.Time ?? point.time ?? point.start ?? point.start_time);
            if (!Number.isFinite(rawTimeMs)) return;

            const normalizedTime = normalizeTimeToScarfTimeline(rawTimeMs, participantId, domainsByParticipant);
            if (!Number.isFinite(normalizedTime)) return;

            intervalStart = normalizedTime;
            intervalEnd = normalizedTime;
        }

        if (!Number.isFinite(intervalStart) || !Number.isFinite(intervalEnd)) return;

        if (!intervalsByParticipant.has(participantId)) {
            intervalsByParticipant.set(participantId, []);
        }
        intervalsByParticipant.get(participantId).push({
            start: intervalStart,
            end: intervalEnd
        });
    });

    intervalsByParticipant.forEach((intervals, participantId) => {
        intervalsByParticipant.set(participantId, mergeIntervals(intervals));
    });

    return intervalsByParticipant;
}

function isSameScarfSegment(a, b) {
    if (!a || !b) {
        return false;
    }

    const sameParticipant = String(a.participant) === String(b.participant);
    const startDiff = Math.abs(Number(a.start_time) - Number(b.start_time));
    const endDiff = Math.abs(Number(a.end_time) - Number(b.end_time));

    return sameParticipant && startDiff < 0.001 && endDiff < 0.001;
}

function updateScarfBoundingOverlayDimMask(overlayElement = null) {
    const overlay = overlayElement || document.getElementById('scarf-bounding-overlay');
    const img = document.getElementById('sel-img-view');

    if (!overlay || !img) return;

    overlay.style.background = '';
    overlay.style.backgroundColor = `rgba(255, 255, 255, ${OUTSIDE_DIM_OPACITY})`;

    if (
        currentAnalyzedArea &&
        currentAnalyzedArea.shape === 'circle' &&
        Number.isFinite(currentAnalyzedArea.center_x) &&
        Number.isFinite(currentAnalyzedArea.center_y) &&
        Number.isFinite(currentAnalyzedArea.radius)
    ) {
        const imgRect = img.getBoundingClientRect();
        const DATA_WIDTH = 800;
        const DATA_HEIGHT = 600;
        const scaleX = imgRect.width / DATA_WIDTH;
        const scaleY = imgRect.height / DATA_HEIGHT;
        const circleCx = currentAnalyzedArea.center_x * scaleX;
        const circleCy = (DATA_HEIGHT - currentAnalyzedArea.center_y) * scaleY;
        const circleRadius = Math.max(1, currentAnalyzedArea.radius * ((scaleX + scaleY) / 2));

        overlay.style.background = `radial-gradient(circle at ${circleCx}px ${circleCy}px, rgba(255,255,255,0) ${circleRadius}px, rgba(255,255,255,${OUTSIDE_DIM_OPACITY}) ${circleRadius + 1}px)`;
    }
}

function createBoundingBoxOverlay(boundingBox) {
    const existingOverlay = document.getElementById('scarf-bounding-overlay');
    const existingBorder = document.getElementById('scarf-bounding-border');
    if (existingOverlay) existingOverlay.remove();
    if (existingBorder) existingBorder.remove();

    const img = document.getElementById('sel-img-view');
    const component1 = document.getElementById('component-1');

    if (!img || !component1) return;

    const imgRect = img.getBoundingClientRect();
    const component1Rect = component1.getBoundingClientRect();

    // Calcular posiciÃ³n de la imagen relativa al contenedor
    const imgLeft = imgRect.left - component1Rect.left;
    const imgTop = imgRect.top - component1Rect.top;

    // Crear overlay con opacidad en toda la imagen (incluyendo el Ã¡rea del bounding box)
    const overlay = document.createElement('div');
    overlay.id = 'scarf-bounding-overlay';
    overlay.style.position = 'absolute';
    overlay.style.top = imgTop + 'px';
    overlay.style.left = imgLeft + 'px';
    overlay.style.width = imgRect.width + 'px';
    overlay.style.height = imgRect.height + 'px';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '99';

    const { x, y, width, height } = boundingBox;
    updateScarfBoundingOverlayDimMask(overlay);

    component1.appendChild(overlay);

    // Crear rectÃ¡ngulo de borde negro
    const border = document.createElement('div');
    border.id = 'scarf-bounding-border';
    border.style.position = 'absolute';
    border.style.top = (imgTop + y) + 'px';
    border.style.left = (imgLeft + x) + 'px';
    border.style.width = width + 'px';
    border.style.height = height + 'px';
    border.style.border = '2px solid #000000'; // Borde negro
    border.style.boxShadow = 'none';
    border.style.pointerEvents = 'none';
    border.style.zIndex = '101';

    component1.appendChild(border);
}

function removeBoundingBoxOverlay() {
    const overlay = document.getElementById('scarf-bounding-overlay');
    const border = document.getElementById('scarf-bounding-border');
    if (overlay) overlay.remove();
    if (border) border.remove();
}

function toMilliseconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return null;
    }
    return Math.abs(numeric) < 100 ? numeric * 1000 : numeric;
}

function getPointParticipantId(point) {
    if (!point) {
        return null;
    }
    const participantId = point.participante ?? point.participant;
    if (participantId === null || participantId === undefined || participantId === '') {
        return null;
    }
    return String(participantId);
}

function showScarfError(message) {
            const container = document.getElementById('scarf-plot');
            container.innerHTML = `<p style="text-align: center; color: #999;">${message}</p>`;
}


