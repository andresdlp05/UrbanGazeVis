// global
var selectedImg = null;
var selectedPart = null;
var selectedPartV2 = null;
var selectedImgV3 = null;
var selectedPartV3 = null;
window.selectedClass = null;
var currentImageMode = 'original'; // 'original' o 'segmentation'
var currentImageBlendPercent = 0; // 0 = original, 100 = segmentation
var currentImageOriginalPath = null;
var currentImageSegmentationPath = null;
var imagePanOffsetX = 0;
var imagePanOffsetY = 0;
var globalData = data;
var attentionHeatmapData = null;
// Canvas para procesar segmentación
var segmentationCanvas = null;
var originalSegmentationImage = null;
var classColorMap = {}; // Mapeo de clase → color RGB para resaltar en segmentación

// Variables para rastrear el área y datos actuales
var currentAnalyzedArea = null;
var currentAreaData = null;
var currentGlyph = null;
var isDirectionRingVisible = false;
var currentDataType = 'gaze'; // 'fixations' o 'gaze'
var currentDatasetSelect = 'main_class'; // 'main_class' o 'grupo'
var currentHeatmapMode = 'attention'; // 'attention' o 'time'
var currentScarfSegment = null; // Segmento del scarf plot seleccionado (incluye color)

// Variables para visualización de puntos (overlay)
var currentOverlayTypes = []; // Array de overlays seleccionados: 'points', 'contour', 'heatmap'
var currentGazePoints = []; // Puntos de gaze del área actual
var currentFixationPoints = []; // Puntos de fixation del área actual
var allGazePointsWithParticipant = []; // Todos los gaze points con información de participante
var imageScores = {}; // Scores promedio por imagen cargados desde data_hololens.json
var allFixationPointsWithParticipant = []; // Todos los fixation points con información de participante
var gazePointsByParticipant = new Map(); // Índice por participante para gaze points
var fixationPointsByParticipant = new Map(); // Índice por participante para fixations
var overlayContainer = null; // Contenedor para los puntos
var circleSelectionState = null; // Estado del selector circular (pantalla)
var circleSelectionDebounceTimer = null; // Debounce para análisis dinámico
var areaAnalysisRequestCounter = 0; // Evitar aplicar respuestas viejas
var areaAnalysisAbortController = null; // Cancelar request anterior en drag
var lastAreaAnalysisSignature = null; // Evitar requests idénticos consecutivos
const OUTSIDE_DIM_OPACITY = 0.8; // Equivale al efecto anterior de overlays (img opacity 0.2)
const SCARF_TIMELINE_DURATION_MS = 15000;
const SCARF_SEGMENT_MATCH_TOLERANCE_MS = 60;
const SCARF_AREA_DIM_OPACITY = 0.12;
const SCARF_SEGMENT_DIM_OPACITY = 0.12;
const SCARF_SEGMENT_HIGHLIGHT_STROKE = '#000000';

window.DEBUG_LOGS = window.DEBUG_LOGS === true;
window.debugLog = window.debugLog || function(...args) {
    if (window.DEBUG_LOGS) {
        console.log(...args);
    }
};
const debugLog = window.debugLog;


// Clase RadialGlyph (adaptada para tooltip)
/**
 * RadialGlyph: A D3-based radial visualization for eye-tracking data
 *
 * Structure:
 * - Ring 0 (Center): Histogram comparing "All participants" vs "Patch area" scores
 * - Ring 1: 4 directional quadrants (Arriba, Derecha, Abajo, Izquierda) with fixation density
 * - Ring 2: 15-second timeline with per-participant stacked bars
 *
 * Features:
 * - Interactive tooltips on hover
 * - Participant color coding
 * - Dynamic data processing and validation
 */
class RadialGlyph {
    constructor(containerId, options = {}) {
        this.containerId = containerId;
        this.container = d3.select(`#${containerId}`);

        this.config = {
            width: 280,
            height: 600,
            margin: 10,
            centerRadius: 32,
            ring1InnerRadius: 35,
            ring1OuterRadius: 55,
            ring2InnerRadius: 80,
            ring2OuterRadius: 100,
            ring2LabelOffset: 10,
            ring2LabelHalfExtent: 12,
            ring2LabelFontSize: 12,
            ...options
        };

        this.colors = {
            directions: ['#FF6B35', '#4ECDC4', '#45B7D1', '#96CEB4'],
            density: d3.scaleSequential(d3.interpolateViridis),
            // Ring 1: Continuous sequential gradient (Orange scheme) for point quantity
            ring1Gradient: d3.scaleSequential(d3.interpolateBlues),
            // Legend: Discrete categorical colors for participants (distinct colors)
            participants: [
                '#E74C3C', '#3498DB', '#2ECC71', '#F39C12',  // Red, Blue, Green, Orange
                '#9B59B6', '#1ABC9C', '#E67E22', '#95A5A6',  // Purple, Teal, Dark Orange, Gray
                '#C0392B', '#16A085'                           // Dark Red, Dark Teal
            ]
        };

        this.initializeSVG();
    }

    initializeSVG() {
        // Clear absolutely everything from the container
        this.container.selectAll("*").remove();

        this.svg = this.container
            .append("svg")
            .attr("width", this.config.width)
            .attr("height", this.config.height)
            .attr("overflow", "visible")
            .style("background", "transparent")
            .style("pointer-events", "none")
            .style("overflow", "visible");

        this.centerGroup = this.svg.append("g")
            .attr("class", "center-group")
            .attr("transform", `translate(${this.config.width/2}, ${this.config.height/2})`);

        this.ring1Group = this.svg.append("g")
            .attr("class", "ring1-group")
            .attr("transform", `translate(${this.config.width/2}, ${this.config.height/2})`);

        this.ring2Group = this.svg.append("g")
            .attr("class", "ring2-group")
            .attr("transform", `translate(${this.config.width/2}, ${this.config.height/2})`);

        debugLog("RadialGlyph.initializeSVG: SVG reinitialized completely");
    }

    setDirectionRingVisible(visible) {
        const shouldShow = Boolean(visible);
        this.ring1Group.style("display", shouldShow ? null : "none");
    }

    update(data) {
        debugLog("RadialGlyph.update() iniciado con datos:", data);
        this.rawData = data; // Guardar datos originales para acceso posterior

        // Log información detallada sobre qué datos recibimos
        debugLog("=== RadialGlyph Data Sources ===");
        debugLog(`data_type: ${data?.data_type || 'unknown'}`);
        debugLog(`gaze_points: ${data?.gaze_points?.length || 0}`);
        debugLog(`fixations: ${data?.fixations?.length || 0}`);
        debugLog(`data_for_analysis: ${data?.data_for_analysis?.length || 0}`);

        if (data?.gaze_points && data.gaze_points.length > 0) {
            debugLog("Sample gaze point:", data.gaze_points[0]);
        }
        if (data?.fixations && data.fixations.length > 0) {
            debugLog("Sample fixation:", data.fixations[0]);
        }
        if (data?.data_for_analysis && data.data_for_analysis.length > 0) {
            debugLog("Sample data_for_analysis:", data.data_for_analysis[0]);
        }

        const processedData = this.processData(data);
        debugLog("Datos procesados:", processedData);

        this.renderHistogramCenter(processedData.histogramData);
        this.renderRing1(processedData.directions);
        this.renderRing2(processedData.timeData);
        this.setDirectionRingVisible(isDirectionRingVisible);

        debugLog("RadialGlyph.update() completado!");
    }

    processData(data) {
        // Validar datos de entrada
        if (!data) {
            console.warn("RadialGlyph.processData: No data provided");
            data = {};
        }

        // Use the appropriate dataset based on data_type
        // If data_type is 'gaze', use data_for_analysis (which will be gaze points)
        // If data_type is 'fixations', use fixations
        // Default to data_for_analysis if available
        let analysisData = data.data_for_analysis || data.fixations || [];

        debugLog(`processData: Using ${data.data_type || 'unknown'} data with ${analysisData.length} points`);

        const points = this.sanitizeFixations(analysisData);
        const participantScores = data.participant_scores || {};

        const histogramData = this.calculateHistogramData(points, participantScores);
        const directions = this.calculateDirections(points);
        const timeData = this.calculateTimeData(points);

        return { histogramData, directions, timeData };
    }

    sanitizeFixations(fixations) {
        /**Validate and clean fixation data - only filter clearly invalid data*/
        if (!Array.isArray(fixations)) {
            console.warn("RadialGlyph: fixations is not an array", fixations);
            return [];
        }

        const original = fixations.length;
        const sanitized = fixations.filter(f => {
            // Skip null, undefined, or empty fixations
            if (!f) return false;

            // Only require coordinates and participant to exist
            // Convert to numbers but allow 0 and valid numeric values
            const x = parseFloat(f.x_centroid);
            const y = parseFloat(f.y_centroid);

            // Accept if we got valid numbers (including 0)
            // Only reject if coordinates are explicitly missing or NaN
            const hasValidCoordinates = f.x_centroid !== undefined && f.x_centroid !== null &&
                                        f.y_centroid !== undefined && f.y_centroid !== null &&
                                        !isNaN(x) && !isNaN(y);

            const hasValidParticipant = f.participante !== undefined && f.participante !== null;

            if (!hasValidCoordinates || !hasValidParticipant) {
                debugLog(`Skipping fixation - x=${f.x_centroid}, y=${f.y_centroid}, p=${f.participante}`);
            }

            return hasValidCoordinates && hasValidParticipant;
        });

        debugLog(`RadialGlyph.sanitizeFixations: ${original} -> ${sanitized.length} fixations`);
        return sanitized;
    }

    calculateHistogramData(fixations, participantScores = {}) {
        // Todos: ALL participants' scores from the endpoint
        const allScores = [];
        const allParticipants = new Set();

        Object.entries(participantScores).forEach(([participantId, scoreInfo]) => {
            if (scoreInfo && scoreInfo.score !== null && scoreInfo.score !== undefined) {
                const score = parseFloat(scoreInfo.score);
                // Only include valid numbers (not NaN or Infinity)
                if (!isNaN(score) && isFinite(score)) {
                    allScores.push(score);
                    allParticipants.add(parseInt(participantId));
                } else {
                    console.warn(`Invalid score for participant ${participantId}: ${scoreInfo.score}`);
                }
            }
        });

        // Patch: only participants with fixations in the selected area
        const patchParticipants = new Set(fixations.map(f => f.participante).filter(p => p != null));
        const patchScores = [];

        patchParticipants.forEach(participantId => {
            const scoreInfo = participantScores[participantId];
            if (scoreInfo && scoreInfo.score !== null && scoreInfo.score !== undefined) {
                const score = parseFloat(scoreInfo.score);
                if (!isNaN(score) && isFinite(score)) {
                    patchScores.push(score);
                }
            }
        });

        // Create histogram bins for TODOS (all participants)
        const allBins = new Array(10).fill(0);
        allScores.forEach(score => {
            if (!isNaN(score) && isFinite(score)) {
                const binIndex = Math.min(Math.floor(score), 9);
                allBins[binIndex]++;
            }
        });

        // Create histogram bins for PATCH (selected area participants)
        const patchBins = new Array(10).fill(0);
        patchScores.forEach(score => {
            if (!isNaN(score) && isFinite(score)) {
                const binIndex = Math.min(Math.floor(score), 9);
                patchBins[binIndex]++;
            }
        });

        const patchAvg = patchScores.length > 0 ? d3.mean(patchScores) : 5;
        const allAvg = allScores.length > 0 ? d3.mean(allScores) : 5;

        return {
            allHistogram: allBins,
            patchHistogram: patchBins,
            patchAvg: isNaN(patchAvg) ? 5 : patchAvg,
            patchCount: patchScores.length,
            allAvg: isNaN(allAvg) ? 5 : allAvg,
            allCount: allParticipants.size
        };
    }

    calculateDirections(fixations) {
        const directions = { Arriba: 0, Derecha: 0, Abajo: 0, Izquierda: 0 };

        if (!fixations || fixations.length < 2) {
            debugLog("calculateDirections: Not enough fixations to calculate movement directions");
            return directions;
        }

        debugLog(`calculateDirections: Processing movement for ${fixations.length} fixations`);

        // 1. Sort fixations by start time to get the chronological path
        const sortedFixations = [...fixations].sort((a, b) => {
            const timeA = parseFloat(a.start || a.Time || 0);
            const timeB = parseFloat(b.start || b.Time || 0);
            return timeA - timeB;
        });

        // 2. Iterate through fixations to calculate movement vectors (saccades)
        for (let i = 1; i < sortedFixations.length; i++) {
            const prevFix = sortedFixations[i - 1];
            const currFix = sortedFixations[i];

            // Ensure both fixations have valid coordinates
            if (prevFix.x_centroid == null || prevFix.y_centroid == null || currFix.x_centroid == null || currFix.y_centroid == null) {
                continue; // Skip if coordinates are missing
            }

            const dx = currFix.x_centroid - prevFix.x_centroid;
            const dy = currFix.y_centroid - prevFix.y_centroid;

            // Ignore movements that are too small (i.e., likely noise or microsaccades)
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
                continue;
            }

            // 3. Classify the direction of the movement vector
            if (Math.abs(dx) > Math.abs(dy)) {
                // Horizontal movement is dominant
                if (dx > 0) {
                    directions.Derecha++;
                } else {
                    directions.Izquierda++;
                }
            } else {
                // Vertical movement is dominant
                if (dy > 0) {
                    // In screen coordinates, a positive dy means moving DOWN
                    directions.Abajo++;
                } else {
                    // A negative dy means moving UP
                    directions.Arriba++;
                }
            }
        }

        debugLog("calculateDirections (movement) result:", directions);
        return directions;
    }

    calculateTimeData(fixations) {
        const timeHistogram = new Array(16).fill(0);
        const timeDetails = new Array(16).fill(null).map(() => []);

        // Per-participant breakdown for each time segment
        const perParticipantCounts = new Array(16).fill(null).map(() => ({}));
        const participantSet = new Set();

        if (!fixations || fixations.length === 0) {
            return {
                histogram: timeHistogram,
                details: timeDetails,
                perParticipant: perParticipantCounts,
                participants: Array.from(participantSet)
            };
        }

        debugLog(`calculateTimeData: Processing ${fixations.length} items`);
        if (fixations.length > 0) {
            debugLog(`Sample item:`, fixations[0]);
        }

        fixations.forEach(fix => {
            if (!fix) return;

            // Extract participant ID first (works for both fixations and gaze points)
            const participantId = fix.participante || fix.participant || 'Unknown';
            if (participantId !== 'Unknown') {
                participantSet.add(participantId);
            }

            // Determine time value - support both fixations (start) and gaze points (Time)
            let timeValue = null;

            if (fix.start != null) {
                // Fixations have 'start' field (in seconds)
                timeValue = parseFloat(fix.start);
            } else if (fix.Time != null) {
                // Gaze points have 'Time' field (in seconds)
                timeValue = parseFloat(fix.Time);
            } else if (fix.time != null) {
                // Alternative: lowercase 'time'
                timeValue = parseFloat(fix.time);
            }

            // If we don't have a valid time value, skip
            if (timeValue == null || isNaN(timeValue) || !isFinite(timeValue)) {
                return;
            }

            // IMPORTANTE: Ignorar valores negativos (ocurren antes del offset de 4 segundos)
            if (timeValue < 0) {
                return;
            }

            const timeInSeconds = Math.min(Math.floor(timeValue), 15);
            timeHistogram[timeInSeconds]++;

            // Count per participant for this time segment
            if (!perParticipantCounts[timeInSeconds][participantId]) {
                perParticipantCounts[timeInSeconds][participantId] = 0;
            }
            perParticipantCounts[timeInSeconds][participantId]++;

            // Guardar detalles - support both fixations and gaze points
            const startVal = parseFloat(fix.start || fix.Time || 0) || 0;
            const endVal = parseFloat(fix.end || 0) || 0;
            const durationVal = parseFloat(fix.duration || 0) || 0;
            const xVal = parseFloat(fix.x_centroid || fix.pixelX || 0) || 0;
            const yVal = parseFloat(fix.y_centroid || fix.pixelY || 0) || 0;

            timeDetails[timeInSeconds].push({
                participante: participantId,
                start: isNaN(startVal) ? '0.000' : startVal.toFixed(3),
                end: isNaN(endVal) ? '0.000' : endVal.toFixed(3),
                duration: isNaN(durationVal) ? '0.000' : durationVal.toFixed(3),
                x_centroid: isNaN(xVal) ? '0.0' : xVal.toFixed(1),
                y_centroid: isNaN(yVal) ? '0.0' : yVal.toFixed(1)
            });
        });

        const sortedParticipants = Array.from(participantSet).sort((a, b) => {
            const aNum = parseInt(a);
            const bNum = parseInt(b);
            if (isNaN(aNum) || isNaN(bNum)) return String(a).localeCompare(String(b));
            return aNum - bNum;
        });

        debugLog(`calculateTimeData: Found ${sortedParticipants.length} participants:`, sortedParticipants);

        return {
            histogram: timeHistogram,
            details: timeDetails,
            perParticipant: perParticipantCounts,
            participants: sortedParticipants
        };
    }

    renderHistogramCenter(histogramData) {
        // Clear previous center elements
        this.centerGroup.selectAll("*").remove();

        // User request: remove center "All/Selection" curves and labels.
        // Keep center empty so only rings are shown.
        return;
    }

    renderRing1(directionsData) {
        // Clear previous ring 1 elements
        this.ring1Group.selectAll("*").remove();

        const directions = ['Arriba', 'Derecha', 'Abajo', 'Izquierda'];
        const quadrantWidth = (2 * Math.PI) / 4;

        var startAngles1 = {
            'Arriba': -Math.PI * 3/4,
            'Derecha': -Math.PI / 4,
            'Abajo': Math.PI / 4,
            'Izquierda': Math.PI * 3/4
        };

        const startAngles = {
            'Arriba':    startAngles1['Derecha'],
            'Derecha':   startAngles1['Abajo'],
            'Abajo':     startAngles1['Izquierda'],
            'Izquierda': startAngles1['Arriba']
        };

        // Validate and ensure directionsData is an object
        if (!directionsData || typeof directionsData !== 'object') {
            console.warn("Ring1: No valid directions data provided");
            directionsData = { Arriba: 0, Derecha: 0, Abajo: 0, Izquierda: 0 };
        }

        // Ensure all direction keys exist
        directions.forEach(dir => {
            if (directionsData[dir] === undefined || directionsData[dir] === null) {
                directionsData[dir] = 0;
            }
        });

        // Log input data
        debugLog("=== renderRing1 Input Data ===");
        debugLog("directionsData:", directionsData);

        // Get counts for color scaling - use GLOBAL absolute scale for consistency
        const counts = directions.map(d => {
            const val = directionsData[d];
            // Ensure value is a number
            return typeof val === 'number' ? val : 0;
        });

        // IMPORTANTE: Usar escala GLOBAL fija para que colores sean consistentes entre glyphs
        // Valor estimado basado en el rango típico del dataset (ajustar según datos reales)
        const GLOBAL_MAX_DIRECTION_COUNT = 100; // Máximo esperado de fixations por dirección

        const localMaxCount = Math.max(...counts, 1);
        debugLog("Direction values:", { Arriba: counts[0], Derecha: counts[1], Abajo: counts[2], Izquierda: counts[3] });
        debugLog("localMaxCount:", localMaxCount, "GLOBAL_MAX:", GLOBAL_MAX_DIRECTION_COUNT);

        // Create a color cache to verify consistent mapping
        const colorCache = {};

        const getOrangeColor = (value) => {
            // Check cache first
            /*if (colorCache[value] !== undefined) {
                return colorCache[value];
            }*/

            // Usar escala GLOBAL en lugar de local para consistencia entre glyphs
            const normalized = Math.min(value / GLOBAL_MAX_DIRECTION_COUNT, 1);

            // Usar interpolateBlues definido en this.colors.ring1Gradient
            // Configurar el dominio del gradiente
            this.colors.ring1Gradient.domain([0, 1]);
            const color = this.colors.ring1Gradient(normalized);

            // Cache the color
            colorCache[value] = color;

            debugLog(`getBlueColor(${value}): normalized=${normalized.toFixed(3)}, color=${color}`);
            return color;
        };

        const getTextColor = (value) => {
            // Text color changes based on background intensity - usar escala GLOBAL
            const normalized = Math.min(value / GLOBAL_MAX_DIRECTION_COUNT, 1);
            // Use white for dark backgrounds (top 25%), dark for light backgrounds
            return normalized > 0.75 ? 'white' : '#333';
        };

        const dictValues = Object.values(directionsData);
        // Compute min and max
        const minVal = Math.min(...dictValues);
        const maxVal = Math.max(...dictValues);
        // Create the scale
        // Extract entries and sort them by value ascending
        const entries = Object.entries(directionsData).sort((a, b) => a[1] - b[1]);
        // Fixed positions in the color scale
        const positions = [0, 0.33, 0.66, 1];
        // Build a new dict mapping each direction to its fixed color
        const textColorMap = {};
            entries.forEach(([key, value], i) => {
            textColorMap[key] = d3.interpolateBlues(positions[i]);
        });
        
        const arc = d3.arc()
            .innerRadius(this.config.ring1InnerRadius)
            .outerRadius(this.config.ring1OuterRadius)
            .startAngle(d => startAngles[d])
            .endAngle(d => startAngles[d] + quadrantWidth);

        this.ring1Group.selectAll(".direction-segment")
            .data(directions, d => d)  // Use direction name as key to ensure proper binding
            .join("path")
            .attr("class", "direction-segment")
            .attr("d", arc)
            .attr('fill', d => {
                return textColorMap[d]
            })
            .attr("stroke", "var(--color-base-200)")
            /*.attr('')
            .attr("style", (d) => {
                const value = directionsData[d] || 0;
                const color = getOrangeColor(value);
                return `fill: ${color} !important; stroke: white !important; stroke-width: 1.5px !important; opacity: 0.8 !important;`;
            });*/

        // Render count values
        this.ring1Group.selectAll(".direction-count")
            .data(directions, d => d)  // Use direction name as key to ensure proper binding
            .join("text")
            .attr("class", "direction-count")
            .attr("transform", d => {
                const angle = startAngles1[d] + quadrantWidth / 2;
                const radius = (this.config.ring1InnerRadius + this.config.ring1OuterRadius) / 2;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                return `translate(${x}, ${y})`;
            })
            .attr("text-anchor", "middle")
            .attr("dy", "0.3em")
            .attr("font-size", "12px")
            .attr("font-weight", "bold")
            .attr("style", d => {
                const value = directionsData[d] || 0;
                // const textColor = getTextColor(value);
                const textColor = directionsData[d] > (minVal+maxVal)/2? 'white': 'black';
                return `fill: ${textColor} !important;`;
                // return `fill: black !important;`;
            })
            .text(d =>  directionsData[d] || 0);

        // Render direction labels OUTSIDE the ring for identification
        // Directional labels removed per user request (arriba, abajo, derecha, izquierda)
        // this.ring1Group.selectAll(".direction-label")
        //     .data(directions, d => d)
        //     .join("text")
        //     .attr("class", "direction-label")
        //     .attr("transform", d => {
        //         const angle = startAngles[d] + quadrantWidth / 2;
        //         const radius = this.config.ring1OuterRadius + 20;  // Outside the ring
        //         const x = Math.cos(angle) * radius;
        //         const y = Math.sin(angle) * radius;
        //         return `translate(${x}, ${y})`;
        //     })
        //     .attr("text-anchor", "middle")
        //     .attr("dy", "0.3em")
        //     .attr("font-size", "11px")
        //     .attr("font-weight", "bold")
        //     .attr("style", "fill: #333 !important; pointer-events: none !important; text-shadow: 1px 1px 2px white;")
        //     .text(d => d);

        // Render value labels INSIDE each segment for absolute clarity
        /*this.ring1Group.selectAll(".direction-value-label")
            .data(directions, d => d)
            .join("text")
            .attr("class", "direction-value-label")
            .attr("transform", d => {
                const angle = startAngles[d] + quadrantWidth / 2;
                const radius = (this.config.ring1InnerRadius + this.config.ring1OuterRadius) / 2;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                return `translate(${x}, ${y})`;
            })
            .attr("text-anchor", "middle")
            .attr("dy", "0.3em")
            .attr("font-size", "16px")
            .attr("font-weight", "bold")
            .attr("style", d => {
                const value = directionsData[d] || 0;
                const textColor = getTextColor(value);
                return `fill: ${textColor} !important; pointer-events: none !important; text-shadow: 0px 0px 2px rgba(255,255,255,0.8);`;
            })
            .text(d => directionsData[d] || 0);*/

        // Verify final DOM state with COMPLETE attribute inspection
        debugLog("=== Final Ring1 DOM Segments ===");
        debugLog("Color Cache (value -> color mapping):", colorCache);

        /*this.ring1Group.selectAll(".direction-segment").each(function(d, i) {
            const element = d3.select(this);
            const style = element.attr("style");
            const fill = element.attr("fill");
            const opacity = element.attr("opacity");
            const classList = element.attr("class");
            const value = directionsData[d] || 0;

            debugLog(`%c Segment ${d} (index=${i}, value=${value})`, 'color: blue; font-weight: bold');
            debugLog(`  Data-bound value: ${value}`);
            debugLog(`  style="${style}"`);
            debugLog(`  fill="${fill}"}`);
            debugLog(`  opacity="${opacity}"`);
            debugLog(`  class="${classList}"`);

            // Extract actual fill color from style
            const styleMatch = style.match(/fill:\s*([^;!]+)/);
            const fillFromStyle = styleMatch ? styleMatch[1].trim() : 'NOT FOUND';
            debugLog(`  Actual fill color from style: ${fillFromStyle}`);
        });

        debugLog("=== Verify Consistency ===");
        directions.forEach(direction => {
            const value = directionsData[direction] || 0;
            const expectedColor = colorCache[value];
            debugLog(`Direction=${direction}, Value=${value}, Expected Color=${expectedColor}`);
        });

        // Double-check: verify there are exactly 4 segments
        const segmentCount = this.ring1Group.selectAll(".direction-segment").size();
        debugLog(`Total direction segments rendered: ${segmentCount} (expected: 4)`);
        */
        debugLog("=== End Ring1 DOM ===");
    }

    renderRing2(timeData) {
        // Clear previous ring 2 elements
        this.ring2Group.selectAll("*").remove();

        // Validate input data
        if (!timeData) {
            console.warn("Ring2: No timeData provided");
            return;
        }

        // Handle both formats: simple array or object with histogram and details
        const histogram = timeData.histogram || timeData;
        const details = timeData.details || [];
        const perParticipantData = timeData.perParticipant || [];
        let participants = timeData.participants || [];

        // Ensure participants is an array with valid entries
        if (!Array.isArray(participants)) {
            participants = [];
        }
        participants = participants.filter(p => p != null && p !== undefined && p !== '');

        debugLog("renderRing2: participants=", participants, "histogram length=", histogram.length);

        // If no participants or no data, show empty state
        if (participants.length === 0 || !histogram || histogram.length === 0) {
            debugLog("Ring2: No data to render");
            this.ring2Group.append("text")
                .attr("text-anchor", "middle")
                .attr("dy", "0.3em")
                .style("font-size", "12px")
                .style("fill", "#999")
                .text("(no data)");
            return;
        }
        const angleScale = d3.scaleBand()
            .domain(d3.range(15))
            .range([0, 2*Math.PI])//.range([-Math.PI / 2, -Math.PI / 2 + 2 * Math.PI]) // Start at -90 degrees (North)
            .padding(0.01);

        // Create participant color mapping
        const participantColorMap = {};
        participants.forEach((participantId, idx) => {
            participantColorMap[participantId] = this.colors.participants[idx % this.colors.participants.length];
        });

        // Create tooltip if it doesn't exist - DENTRO del contenedor del glyph
        if (!this.tooltip) {
            this.tooltip = this.container
                .append("div")
                .style("position", "absolute")
                .style("background", "rgba(0, 0, 0, 0.85)")
                .style("color", "white")
                .style("padding", "8px 12px")
                .style("border-radius", "4px")
                .style("font-size", "10px")
                .style("z-index", "9999")
                .style("pointer-events", "none")
                .style("max-width", "250px")
                .style("max-height", "200px")
                .style("overflow-y", "auto")
                .style("opacity", "0")
                .style("word-wrap", "break-word");
        }

        // Prepare data for stacked visualization.
        // Ring2 is constrained to the configured radial band: [ring2InnerRadius, ring2OuterRadius].
        const stackedData = [];
        const availableRingThickness = Math.max(0, this.config.ring2OuterRadius - this.config.ring2InnerRadius);
        const maxParticipantsInAnySecond = d3.max(d3.range(15).map((timeIdx) => {
            const participantCounts = perParticipantData[timeIdx] || {};
            let count = 0;
            participants.forEach((participantId) => {
                if ((participantCounts[participantId] || 0) > 0) {
                    count++;
                }
            });
            return count;
        })) || 0;
        const segmentHeight = maxParticipantsInAnySecond > 0 ? (availableRingThickness / maxParticipantsInAnySecond) : 0;
        let maxOuterRadius = this.config.ring2InnerRadius;

        // Process all 15 time segments (0-14), even those without data.
        d3.range(15).forEach((timeIdx) => {
            const participantCounts = perParticipantData[timeIdx] || {};

            // Get list of participants that have data in this time segment
            const participantsInThisTime = [];
            participants.forEach((participantId) => {
                const count = participantCounts[participantId] || 0;
                if (count > 0) {
                    participantsInThisTime.push(participantId);
                }
            });

            // Stack participants that are present in this time
            const barInnerRadius = this.config.ring2InnerRadius;
            let currentRadius = barInnerRadius;

            participantsInThisTime.forEach((participantId) => {
                const count = participantCounts[participantId] || 0;

                const innerRadius = currentRadius;
                const outerRadius = Math.min(this.config.ring2OuterRadius, currentRadius + segmentHeight);

                if (outerRadius <= innerRadius) {
                    return;
                }

                stackedData.push({
                    timeIdx: timeIdx,
                    participantId: participantId,
                    count: count,
                    innerRadius: innerRadius,
                    outerRadius: outerRadius
                });

                // Next participant starts where this one ends
                currentRadius = outerRadius;
                maxOuterRadius = Math.max(maxOuterRadius, outerRadius);
            });
        });

        const dividerOuterRadius = Math.min(
            this.config.ring2OuterRadius,
            Math.max(maxOuterRadius, this.config.ring2InnerRadius)
        );
        const desiredLabelRadius = dividerOuterRadius + this.config.ring2LabelOffset;
        const glyphHalfSize = Math.min(this.config.width, this.config.height) / 2;
        const maxLabelRadiusByCanvas = Math.max(
            dividerOuterRadius,
            glyphHalfSize - this.config.ring2LabelHalfExtent
        );
        const timeLabelRadius = Math.min(desiredLabelRadius, maxLabelRadiusByCanvas);

        const arc = d3.arc()
            .innerRadius(d => d.innerRadius)
            .outerRadius(d => d.outerRadius)
            .startAngle(d => angleScale(d.timeIdx))
            .endAngle(d => angleScale(d.timeIdx) + angleScale.bandwidth());

        // Render stacked arcs (stacked bar chart in radial format)
        // Each time segment is a solid radial bar with uniform blue color

        this.ring2Group.selectAll(".time-segment-participant")
            .data(stackedData, (d, i) => `${d.timeIdx}-${d.participantId}`)
            .join("path")
            .attr("class", "time-segment-participant")
            .attr("d", arc)
            .attr("fill", d => "#393d42")  // Azul uniforme similar a interpolateBlues
            .attr("stroke", "none")
            .attr("stroke-width", 0)
            .attr("opacity", 0.85)
            .style("pointer-events", "visiblePainted")
            .style("cursor", "pointer")
            .on("mouseover", (event, d) => {
                const fixationsList = details[d.timeIdx] || [];
                const participantFixations = fixationsList.filter(f => f.participante == d.participantId);

                if (participantFixations.length > 0) {
                    // DEBUG: Check what data we have
                    if (participantFixations.length > 0) {
                        debugLog(`Sample fixation for P${d.participantId}:`, participantFixations[0]);
                    }

                    // Get min and max times from fixations
                    // Try both 'start' and 'Time' fields since data might come from different sources
                    const timeValues = participantFixations.map(f => {
                        const time = parseFloat(f.start || f.Time || 0);
                        return time;
                    });
                    const minTime = Math.min(...timeValues);
                    const maxTime = Math.max(...timeValues);

                    let tooltipContent = `<strong>Time ${d.timeIdx}s - Participant ${d.participantId}</strong><br/>`;
                    tooltipContent += `Start: ${minTime.toFixed(2)}s<br/>`;
                    tooltipContent += `End: ${maxTime.toFixed(2)}s<br/>`;
                    tooltipContent += `Points: ${d.count}`;

                    // Calcular posición relativa al contenedor del glyph
                    const containerRect = this.container.node().getBoundingClientRect();
                    const tooltipX = Math.max(10, Math.min(event.pageX - containerRect.left + 10, 300 - 260));
                    const tooltipY = Math.max(10, Math.min(event.pageY - containerRect.top - 10, 300 - 100));

                    this.tooltip
                        .html(tooltipContent)
                        .style("left", tooltipX + "px")
                        .style("top", tooltipY + "px")
                        .style("opacity", "1");
                }
            })
            .on("mouseout", () => {
                this.tooltip.style("opacity", "0");
            });

        // Add radial dividers between time segments - EXACTAMENTE en las fronteras de los bloques
        /*this.ring2Group.selectAll(".time-segment-divider")
            .data(d3.range(16))  // 16 divisores: inicio de cada bloque (0-14) + final (15)
            .join("line")
            .attr("class", "time-segment-divider")
            .attr("x1", d => {
                // El ángulo debe ser exactamente angleScale(d) para estar en la frontera
                const angle = d < 15 ? angleScale(d) : angleScale(14) + angleScale.bandwidth();
                return Math.cos(angle) * this.config.ring2InnerRadius;
            })
            .attr("y1", d => {
                const angle = d < 15 ? angleScale(d) : angleScale(14) + angleScale.bandwidth();
                return Math.sin(angle) * this.config.ring2InnerRadius;
            })
            .attr("x2", d => {
                const angle = d < 15 ? angleScale(d) : angleScale(14) + angleScale.bandwidth();
                return Math.cos(angle) * this.config.ring2OuterRadius;
            })
            .attr("y2", d => {
                const angle = d < 15 ? angleScale(d) : angleScale(14) + angleScale.bandwidth();
                return Math.sin(angle) * this.config.ring2OuterRadius;
            })
            .attr("stroke", "#555")
            .attr("stroke-width", 1.3)
            .attr("opacity", 0.6);*/

        this.ring2Group.selectAll(".time-segment-divider")
            .data(d3.range(15))  // 16 divisores: inicio de cada bloque (0-14) + final (15)
            .join("line")
            .attr("class", "time-segment-divider")
            .attr("x1", d => {
                // El ángulo debe ser exactamente angleScale(d) para estar en la frontera
                const angle = angleScale(d);
                return Math.cos(angle - Math.PI/2) * this.config.ring2InnerRadius;
            })
            .attr("y1", d => {
                const angle = angleScale(d);
                return Math.sin(angle - Math.PI/2) * this.config.ring2InnerRadius;
            })
            .attr("x2", d => {
                const angle = angleScale(d);
                return Math.cos(angle - Math.PI/2) * dividerOuterRadius;
            })
            .attr("y2", d => {
                const angle = angleScale(d);
                return Math.sin(angle - Math.PI/2) * dividerOuterRadius;
            })
            .attr("stroke",  d=>"#555")
            .attr("stroke-width",1.3)
            .attr("opacity", 0.6);

        this.ring2Group.selectAll(".time-segment-divider-text")
            .data(d3.range(15))  // 16 divisores: inicio de cada bloque (0-14) + final (15)
            .join("text")
            .attr("class", "time-segment-divider-text")
            .attr("x", d => {
                const angle = angleScale(d);
                return Math.cos(angle - Math.PI/2) * timeLabelRadius;
            })
            .attr("y", d => {
                const angle = angleScale(d);
                return Math.sin(angle - Math.PI/2) * timeLabelRadius;
            })
            .attr("text-anchor", "middle")
            .style("font-size", `${this.config.ring2LabelFontSize}px`)
            .style("fill", "#333")
            .text(d => `${d}s`);    
        // Add circular dividers between participant bands
        // These show the stacking of participants within each time segment
        if (participants.length > 1 && segmentHeight > 0) {
            const dividerData = [];

            // Create dividers for each time segment based on how many participants are in that time
            d3.range(15).forEach((timeIdx) => {
                const participantCounts = perParticipantData[timeIdx] || {};

                // Count how many participants are in this time
                let numInThisTime = 0;
                participants.forEach((participantId) => {
                    if ((participantCounts[participantId] || 0) > 0) {
                        numInThisTime++;
                    }
                });

                // Create dividers between each participant in this time
                // Each divider is at the same dynamic segment height used for the bars.
                for (let i = 1; i < numInThisTime; i++) {
                    dividerData.push({
                        timeIdx: timeIdx,
                        dividerIdx: i,
                        radius: Math.min(
                            dividerOuterRadius,
                            this.config.ring2InnerRadius + (i * segmentHeight)
                        )
                    });
                }
            });

            this.ring2Group.selectAll(".participant-band-divider")
                .data(dividerData, d => `${d.timeIdx}-${d.dividerIdx}`)
                .join("circle")
                .attr("class", "participant-band-divider")
                .attr("r", d => d.radius)
                .attr("fill", "none")
                .attr("stroke", d => (d.timeIdx % 2 === 0 ? "#8ca5bb" : "#aac0d3"))
                .attr("stroke-width", 0.75)
                .attr("opacity", 0.35);
        }

        // Render time labels - sin rotación, siempre en la posición original (arriba)
        /*this.ring2Group.selectAll(".time-label")
            .data(d3.range(15))
            .join("text")
            .attr("class", "time-label")
            .attr("transform", (d, i) => {
                // Calcular ángulo sin rotación (0s siempre arriba)
                const segmentAngle = (2 * Math.PI) / 15;
                const angle = (i * segmentAngle) + (segmentAngle / 2) - Math.PI / 2; // -90° para que 0s esté arriba
                const radius = this.config.ring2OuterRadius + 12;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                return `translate(${x}, ${y})`;
            })
            .attr("text-anchor", "middle")
            .attr("dy", "0.3em")
            .style("font-size", "14px")
            .style("font-weight", "bold")
            .style("fill", "#333")
            .text(d => `${d}s`);*/

        // Leyenda de participantes deshabilitada por solicitud del usuario
        // if (participants.length >= 1) {
        //     const legendData = participants.map((p, idx) => ({
        //         participantId: p,
        //         color: participantColorMap[p],
        //         idx: idx
        //     }));
        //
        //     const legendContainerY = 250;
        //     const itemWidth = 45;
        //     const totalWidth = legendData.length * itemWidth;
        //     const startX = -totalWidth / 2;
        //
        //     this.ring2Group.selectAll(".participant-legend-item")
        //         .data(legendData, d => d.participantId)
        //         .join("g")
        //         .attr("class", "participant-legend-item")
        //         .attr("transform", (d, i) => `translate(${startX + (i * itemWidth)}, ${legendContainerY})`)
        //         .each(function(d) {
        //             const g = d3.select(this);
        //             g.selectAll("circle").data([d]).join("circle")
        //                 .attr("r", 3)
        //                 .attr("cx", 0)
        //                 .attr("cy", 0)
        //                 .attr("fill", d.color)
        //                 .attr("stroke", "#333")
        //                 .attr("stroke-width", 0.5);
        //             g.selectAll("text").data([d]).join("text")
        //                 .attr("x", 7)
        //                 .attr("y", 3)
        //                 .attr("font-size", "9px")
        //                 .attr("font-weight", "bold")
        //                 .style("fill", "#333")
        //                 .text(`P${d.participantId}`);
        //         });
        // }
    }

    clear() {
        this.container.selectAll("*").remove();

        // Eliminar específicamente cualquier elemento de leyenda de participantes
        this.container.selectAll(".participant-legend-item").remove();
        d3.selectAll(".participant-legend-item").remove();
    }
}

