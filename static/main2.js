// global
var selectedImg = null;
var selectedPart = null;
var selectedPartV2 = null;
var selectedImgV3 = null;
var selectedPartV3 = null;
window.selectedClass = null;
var currentImageMode = 'original'; // 'original' o 'segmentation'
var currentImageOriginalPath = null;
var currentImageSegmentationPath = null;
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
var overlayContainer = null; // Contenedor para los puntos

// Función para obtener la ruta de segmentación según el dataset seleccionado
function getSegmentationPath(imageId, datasetSelect) {
    let folder = '';
    let extension = '';

    switch(datasetSelect) {
        case 'grouped':
            folder = 'ADE20K-Group/images';
            extension = 'png';
            break;
        case 'disorder':
            folder = 'ADE20K-Disorder/images';
            extension = 'png';
            break;
        case 'grouped_disorder':
            folder = 'ADE20K-GroupDisorder/images';
            extension = 'png';
            break;
        case 'main_class':
        default:
            folder = 'images_seg';
            extension = 'png';
            break;
    }

    return `/static/images/images/${folder}/${imageId}.${extension}`;
}

// Funciones de visualización de puntos
function alignOverlayWithImage() {
    const overlayContainer = document.getElementById('overlay-points-container');
    const img = document.getElementById('sel-img-view');
    const component1 = document.getElementById('component-1');

    if (!overlayContainer || !img || !component1) {
        console.log('Cannot align overlay - missing elements');
        return;
    }

    // Get the image's bounding rectangle within the component
    const imgRect = img.getBoundingClientRect();
    const component1Rect = component1.getBoundingClientRect();

    // Calculate the image's position relative to component-1
    const relativeLeft = imgRect.left - component1Rect.left;
    const relativeTop = imgRect.top - component1Rect.top;
    const displayWidth = imgRect.width;
    const displayHeight = imgRect.height;

    // Data coordinates are in 800x600 space (not the actual image size)
    const dataSpaceWidth = 800;
    const dataSpaceHeight = 600;

    // Position the overlay to exactly match the image
    overlayContainer.style.position = 'absolute';
    overlayContainer.style.left = relativeLeft + 'px';
    overlayContainer.style.top = relativeTop + 'px';
    overlayContainer.style.width = displayWidth + 'px';
    overlayContainer.style.height = displayHeight + 'px';
    overlayContainer.style.pointerEvents = 'none';

    console.log(`=== Overlay Alignment ===`);
    console.log(`Image position: (${relativeLeft}, ${relativeTop})`);
    console.log(`Image display size: ${displayWidth}x${displayHeight}`);
    console.log(`Data coordinate space: ${dataSpaceWidth}x${dataSpaceHeight}`);
    console.log(`Scale factor: ${displayWidth / dataSpaceWidth}`);
}

function clearOverlayPoints() {
    const container = document.getElementById('overlay-points-container');
    if (!container) return;

    container.innerHTML = '';

    // También limpiar SVG de contornos y canvas de heatmap si existen
    const imageWrapper = document.getElementById('component-1');
    if (imageWrapper) {
        d3.select(imageWrapper).select('svg.contour-svg').remove();

        // Limpiar canvas del heatmap
        const heatmapCanvas = imageWrapper.querySelector('canvas.heatmap-canvas');
        if (heatmapCanvas) {
            heatmapCanvas.remove();
        }
    }

    console.log('Cleared overlay points, contours and heatmap');
}

function drawContoursOverlay(points, dataType) {
    console.log('Drawing contours overlay for', dataType, ':', points.length, 'points');

    if (!points || points.length === 0) {
        console.log('No points to draw contours');
        return;
    }

    const imageWrapper = document.getElementById('component-1');
    const img = document.getElementById('sel-img-view');
    if (!imageWrapper || !img) {
        console.log('Cannot draw contours - missing elements');
        return;
    }

    // Remover SVG anterior si existe
    d3.select(imageWrapper).select('svg.contour-svg').remove();

    // Obtener dimensiones de la imagen
    const imgRect = img.getBoundingClientRect();
    const containerRect = imageWrapper.getBoundingClientRect();
    const imgWidth = imgRect.width;
    const imgHeight = imgRect.height;
    const imgOffsetTop = imgRect.top - containerRect.top;
    const imgOffsetLeft = imgRect.left - containerRect.left;

    // Crear SVG para dibujar contornos
    const svg = d3.select(imageWrapper)
        .append('svg')
        .attr('class', 'contour-svg')
        .attr('width', imgWidth)
        .attr('height', imgHeight)
        .style('position', 'absolute')
        .style('top', imgOffsetTop + 'px')
        .style('left', imgOffsetLeft + 'px')
        .style('pointer-events', 'none')
        .style('z-index', '1001');

    // CSV data coordinates are in 800x600 space
    const dataSpaceWidth = 800;
    const dataSpaceHeight = 600;

    // Calculate scale factors from data space to display space
    const scaleX = imgWidth / dataSpaceWidth;
    const scaleY = imgHeight / dataSpaceHeight;

    // Preparar datos para contourDensity - escalar e invertir Y
    const contourPoints = points.map(p => {
        const scaledX = p.x * scaleX;
        const scaledY = (dataSpaceHeight - p.y) * scaleY;  // Invert Y
        return [scaledX, scaledY];
    });

    console.log('Creating density contours from', contourPoints.length, 'scaled points');

    // Crear density contours
    const contours = d3.contourDensity()
        .x(d => d[0])
        .y(d => d[1])
        .size([imgWidth, imgHeight])
        .bandwidth(24)(contourPoints);

    // Determinar color según el tipo de datos
    const strokeColor = dataType === 'gaze' ? 'red' : 'orange';

    // Dibujar contornos - solo líneas, sin relleno
    svg.selectAll('path')
        .data(contours)
        .join('path')
        .attr('d', d3.geoPath())
        .attr('fill', 'none')          // Sin relleno - transparente
        .attr('stroke', strokeColor)   // Rojo para gaze, naranja para fixations
        .attr('stroke-width', 2)
        .attr('opacity', 0.8);

    console.log('✓ Contours drawn:', contours.length, 'contour lines');
}

function drawHeatmapOverlay(points, dataType) {
    console.log('Drawing heatmap overlay for', dataType, ':', points.length, 'points');

    if (!points || points.length === 0) {
        console.log('No points to draw heatmap');
        return;
    }

    const imageWrapper = document.getElementById('component-1');
    const img = document.getElementById('sel-img-view');
    if (!imageWrapper || !img) {
        console.log('Cannot draw heatmap - missing elements');
        return;
    }

    // Remover canvas anterior si existe
    const existingCanvas = imageWrapper.querySelector('canvas.heatmap-canvas');
    if (existingCanvas) {
        existingCanvas.remove();
    }

    // Obtener dimensiones de la imagen
    const imgRect = img.getBoundingClientRect();
    const containerRect = imageWrapper.getBoundingClientRect();
    const imgWidth = imgRect.width;
    const imgHeight = imgRect.height;
    const imgOffsetTop = imgRect.top - containerRect.top;
    const imgOffsetLeft = imgRect.left - containerRect.left;

    // Crear canvas para el heatmap con mayor resolución interna
    const canvas = document.createElement('canvas');
    canvas.className = 'heatmap-canvas';

    // Usar resolución interna optimizada (2x para balance entre calidad y velocidad)
    const resolutionScale = 2; // 2x resolución interna
    canvas.width = imgWidth;
    canvas.height = imgHeight;
    canvas.style.position = 'absolute';
    canvas.style.top = imgOffsetTop + 'px';
    canvas.style.left = imgOffsetLeft + 'px';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '1001';
    imageWrapper.appendChild(canvas);

    const ctx = canvas.getContext('2d');

    // Habilitar interpolación suave para el canvas
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // CSV data coordinates are in 800x600 space
    const dataSpaceWidth = 800;
    const dataSpaceHeight = 600;

    // Calculate scale factors from data space to display space
    const scaleX = imgWidth / dataSpaceWidth;
    const scaleY = imgHeight / dataSpaceHeight;

    // Crear matriz de acumulación con mayor resolución para más suavidad
    const heatmapWidth = Math.ceil(imgWidth * resolutionScale);
    const heatmapHeight = Math.ceil(imgHeight * resolutionScale);
    const heatmap = new Array(heatmapHeight).fill(0).map(() => new Array(heatmapWidth).fill(0));

    // Acumular puntos en la matriz de alta resolución
    points.forEach(p => {
        const scaledX = Math.round(p.x * scaleX * resolutionScale);
        const scaledY = Math.round((dataSpaceHeight - p.y) * scaleY * resolutionScale);  // Invert Y

        if (scaledX >= 0 && scaledX < heatmapWidth && scaledY >= 0 && scaledY < heatmapHeight) {
            heatmap[scaledY][scaledX] += 1;
        }
    });

    // Aplicar suavizado Gaussiano optimizado (sigma menor para mayor velocidad)
    const sigma = 24; // Sigma fijo optimizado (no escalar con resolución)
    const smoothedHeatmap = gaussianBlur(heatmap, sigma);

    // Encontrar el valor máximo para normalizar
    let maxValue = 0;
    for (let y = 0; y < heatmapHeight; y++) {
        for (let x = 0; x < heatmapWidth; x++) {
            if (smoothedHeatmap[y][x] > maxValue) {
                maxValue = smoothedHeatmap[y][x];
            }
        }
    }

    // Crear canvas temporal de alta resolución para renderizar el heatmap
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = heatmapWidth;
    tempCanvas.height = heatmapHeight;
    const tempCtx = tempCanvas.getContext('2d');

    // Crear imagen del heatmap con colormap tipo 'jet' en resolución alta
    const imageData = tempCtx.createImageData(heatmapWidth, heatmapHeight);

    for (let y = 0; y < heatmapHeight; y++) {
        for (let x = 0; x < heatmapWidth; x++) {
            const value = maxValue > 0 ? smoothedHeatmap[y][x] / maxValue : 0;
            const color = getJetColor(value);

            const index = (y * heatmapWidth + x) * 4;
            imageData.data[index] = color.r;
            imageData.data[index + 1] = color.g;
            imageData.data[index + 2] = color.b;
            imageData.data[index + 3] = color.a;
        }
    }

    // Poner la imagen en el canvas temporal
    tempCtx.putImageData(imageData, 0, 0);

    // Escalar con interpolación suave al canvas final
    ctx.drawImage(tempCanvas, 0, 0, heatmapWidth, heatmapHeight, 0, 0, imgWidth, imgHeight);

    console.log('✓ Heatmap drawn with', points.length, 'points at', resolutionScale + 'x resolution');
}

// Función para aplicar blur Gaussiano a una matriz 2D
function gaussianBlur(matrix, sigma) {
    const height = matrix.length;
    const width = matrix[0].length;

    // Crear kernel Gaussiano
    const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
    const kernel = [];
    const center = Math.floor(kernelSize / 2);
    let sum = 0;

    for (let i = 0; i < kernelSize; i++) {
        const x = i - center;
        const value = Math.exp(-(x * x) / (2 * sigma * sigma));
        kernel.push(value);
        sum += value;
    }

    // Normalizar kernel
    for (let i = 0; i < kernelSize; i++) {
        kernel[i] /= sum;
    }

    // Aplicar blur horizontal
    const temp = matrix.map(row => [...row]);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let value = 0;
            for (let k = 0; k < kernelSize; k++) {
                const srcX = x + k - center;
                if (srcX >= 0 && srcX < width) {
                    value += matrix[y][srcX] * kernel[k];
                }
            }
            temp[y][x] = value;
        }
    }

    // Aplicar blur vertical
    const result = temp.map(row => [...row]);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let value = 0;
            for (let k = 0; k < kernelSize; k++) {
                const srcY = y + k - center;
                if (srcY >= 0 && srcY < height) {
                    value += temp[srcY][x] * kernel[k];
                }
            }
            result[y][x] = value;
        }
    }

    return result;
}

// Función para obtener color tipo 'jet' colormap (similar a matplotlib)
function getJetColor(value) {
    // value debe estar entre 0 y 1
    value = Math.max(0, Math.min(1, value));

    // Umbral optimizado para eliminar pixelado sin perder información
    const threshold = 0.08; // Valores menores a 8% del máximo son transparentes
    if (value < threshold) {
        return { r: 0, g: 0, b: 0, a: 0 };
    }

    // Remapear valores desde threshold hasta 1
    const remappedValue = (value - threshold) / (1 - threshold);

    // Jet colormap: blue -> cyan -> green -> yellow -> red
    let r, g, b;

    if (remappedValue < 0.125) {
        r = 0;
        g = 0;
        b = 0.5 + remappedValue / 0.125 * 0.5;
    } else if (remappedValue < 0.375) {
        r = 0;
        g = (remappedValue - 0.125) / 0.25;
        b = 1;
    } else if (remappedValue < 0.625) {
        r = (remappedValue - 0.375) / 0.25;
        g = 1;
        b = 1 - (remappedValue - 0.375) / 0.25;
    } else if (remappedValue < 0.875) {
        r = 1;
        g = 1 - (remappedValue - 0.625) / 0.25;
        b = 0;
    } else {
        r = 1 - (remappedValue - 0.875) / 0.125 * 0.5;
        g = 0;
        b = 0;
    }

    // Alpha variable: más transparente para valores bajos, más opaco para valores altos
    const alpha = 0.3 + (remappedValue * 0.4); // De 0.3 a 0.7

    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255),
        a: Math.round(alpha * 255)
    };
}

function visualizeGazePointsOverlay() {
    console.log('Visualizing gaze points overlay:', currentGazePoints.length);

    if (!currentGazePoints || currentGazePoints.length === 0) {
        console.log('No gaze points to visualize');
        return;
    }

    const overlayContainer = document.getElementById('overlay-points-container');
    const img = document.getElementById('sel-img-view');
    const component1 = document.getElementById('component-1');

    if (!overlayContainer || !img || !component1) {
        console.log('Missing overlay container, image or component-1');
        return;
    }

    // First, align the overlay container with the image
    alignOverlayWithImage();

    // CSV data coordinates are in 800x600 space, NOT the actual image size (400x300)
    const dataSpaceWidth = 800;
    const dataSpaceHeight = 600;

    // Get the display dimensions to calculate scale factor
    const imgRect = img.getBoundingClientRect();
    const scaleFactorX = imgRect.width / dataSpaceWidth;
    const scaleFactorY = imgRect.height / dataSpaceHeight;

    console.log(`=== Gaze Points Overlay Debug ===`);
    console.log(`Data coordinate space: ${dataSpaceWidth}x${dataSpaceHeight}`);
    console.log(`Display size: ${imgRect.width}x${imgRect.height}`);
    console.log(`Scale factors: X=${scaleFactorX.toFixed(3)}, Y=${scaleFactorY.toFixed(3)}`);
    console.log(`Total gaze points to render: ${currentGazePoints.length}`);

    const fragment = document.createDocumentFragment();

    currentGazePoints.forEach((point, index) => {
        const gazeElement = document.createElement('div');
        gazeElement.className = 'gaze-point';

        // Scale coordinates from data space (800x600) to display space
        // Invert Y axis: data has Y=0 at bottom, screen has Y=0 at top
        const scaledX = point.x * scaleFactorX;
        const scaledY = (dataSpaceHeight - point.y) * scaleFactorY;

        if (index < 3) {
            console.log(`=== Gaze Point ${index} ===`);
            console.log(`  Original coords: (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`);
            console.log(`  Scaled position: (${scaledX.toFixed(1)}, ${scaledY.toFixed(1)})`);
        }

        gazeElement.style.left = scaledX + 'px';
        gazeElement.style.top = scaledY + 'px';

        // Los gaze points siempre mantienen el color celeste (definido en CSS)

        fragment.appendChild(gazeElement);
    });

    overlayContainer.appendChild(fragment);
    console.log(`✓ Rendered ${currentGazePoints.length} gaze points`);
    console.log(`  Overlay container now has ${overlayContainer.children.length} children`);
}

function visualizeFixationPointsOverlay() {
    console.log('Visualizing fixation points overlay:', currentFixationPoints.length);

    if (!currentFixationPoints || currentFixationPoints.length === 0) {
        console.log('No fixation points to visualize');
        return;
    }

    const overlayContainer = document.getElementById('overlay-points-container');
    const img = document.getElementById('sel-img-view');
    const component1 = document.getElementById('component-1');

    if (!overlayContainer || !img || !component1) {
        console.log('Missing overlay container, image or component-1');
        return;
    }

    // First, align the overlay container with the image
    alignOverlayWithImage();

    // CSV data coordinates are in 800x600 space, NOT the actual image size (400x300)
    const dataSpaceWidth = 800;
    const dataSpaceHeight = 600;

    // Get the display dimensions to calculate scale factor
    const imgRect = img.getBoundingClientRect();
    const scaleFactorX = imgRect.width / dataSpaceWidth;
    const scaleFactorY = imgRect.height / dataSpaceHeight;

    console.log(`=== Fixation Overlay Debug ===`);
    console.log(`Data coordinate space: ${dataSpaceWidth}x${dataSpaceHeight}`);
    console.log(`Display size: ${imgRect.width}x${imgRect.height}`);
    console.log(`Scale factors: X=${scaleFactorX.toFixed(3)}, Y=${scaleFactorY.toFixed(3)}`);

    const fragment = document.createDocumentFragment();

    currentFixationPoints.forEach((point, index) => {
        const fixationElement = document.createElement('div');
        fixationElement.className = 'fixation-point';

        // Scale coordinates from data space (800x600) to display space
        // Invertir Y para ser consistente con gaze points
        const scaledX = point.x * scaleFactorX;
        const scaledY = (dataSpaceHeight - point.y) * scaleFactorY;

        if (index < 3) {
            console.log(`=== Fixation Point ${index} ===`);
            console.log(`  Original coords: (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`);
            console.log(`  Scaled position: (${scaledX.toFixed(1)}, ${scaledY.toFixed(1)})`);
            console.log(`  Duration: ${point.duration?.toFixed(3) || 0}s`);
        }

        fixationElement.style.left = scaledX + 'px';
        fixationElement.style.top = scaledY + 'px';

        // Tamaño basado en duración (también escalado para mantener proporción)
        const size = Math.max(8, Math.min(point.duration / 30, 20)) * Math.min(scaleFactorX, scaleFactorY);
        fixationElement.style.width = size + 'px';
        fixationElement.style.height = size + 'px';

        // Usar el color del segmento del scarf plot si está disponible
        if (currentScarfSegment && currentScarfSegment.color) {
            fixationElement.style.borderColor = currentScarfSegment.color;
            fixationElement.style.borderWidth = '2px';
            fixationElement.style.opacity = '0.9';
        }

        fragment.appendChild(fixationElement);
    });

    overlayContainer.appendChild(fragment);
    console.log('Rendered', currentFixationPoints.length, 'fixation points in overlay container');
}

function filterPointsByParticipant(allPoints, participantId) {
    if (!participantId || participantId === 'all') {
        return allPoints;
    }

    const filteredPoints = allPoints.filter(point => {
        const pointParticipant = String(point.participante || point.participant);
        return pointParticipant === String(participantId);
    });

    console.log(`Filtered ${allPoints.length} points to ${filteredPoints.length} for participant ${participantId}`);
    return filteredPoints;
}

function updateOverlay() {
    console.log('updateOverlay called with types:', currentOverlayTypes, 'data type:', currentDataType, 'participant:', selectedPart);
    clearOverlayPoints();

    const imgView = document.getElementById('sel-img-view');

    // Si no hay overlays seleccionados, restaurar opacidad normal
    if (!currentOverlayTypes || currentOverlayTypes.length === 0) {
        if (imgView) {
            imgView.style.opacity = '1';
        }
        return;
    }

    // Reducir opacidad de la imagen cuando hay overlay activo
    if (imgView) {
        imgView.style.opacity = '0.2';
    }

    // Filtrar puntos por participante seleccionado
    const gazeToVisualize = filterPointsByParticipant(allGazePointsWithParticipant, selectedPart);
    const fixationsToVisualize = filterPointsByParticipant(allFixationPointsWithParticipant, selectedPart);

    // Asignar a las variables actuales para que las funciones de visualización las usen
    currentGazePoints = gazeToVisualize;
    currentFixationPoints = fixationsToVisualize;

    // Renderizar cada overlay seleccionado simultáneamente
    currentOverlayTypes.forEach(overlayType => {
        if (overlayType === 'points') {
            // Mostrar puntos según el tipo de datos seleccionado
            if (currentDataType === 'gaze') {
                visualizeGazePointsOverlay();
            } else if (currentDataType === 'fixations') {
                visualizeFixationPointsOverlay();
            }
        } else if (overlayType === 'contour') {
            // Mostrar contornos según el tipo de datos seleccionado
            if (currentDataType === 'gaze') {
                drawContoursOverlay(gazeToVisualize, 'gaze');
            } else if (currentDataType === 'fixations') {
                drawContoursOverlay(fixationsToVisualize, 'fixations');
            }
        } else if (overlayType === 'heatmap') {
            // Mostrar heatmap según el tipo de datos seleccionado
            if (currentDataType === 'gaze') {
                drawHeatmapOverlay(gazeToVisualize, 'gaze');
            } else if (currentDataType === 'fixations') {
                drawHeatmapOverlay(fixationsToVisualize, 'fixations');
            }
        }
    });
}

function loadAllPointsForImage(imageId) {
    console.log('Loading all points for image:', imageId, 'with data type:', currentDataType);

    if (!imageId) {
        console.log('No image ID provided');
        return;
    }

    // CSV data coordinates are in 800x600 space (not the actual image size)
    const dataSpaceWidth = 800;
    const dataSpaceHeight = 600;
    console.log(`Using data coordinate space: ${dataSpaceWidth}x${dataSpaceHeight}`);

    // Hacer fetch de TODOS los puntos para la imagen completa usando el tipo de datos actual
    fetch(`/api/analyze-area/${imageId}?data_type=${currentDataType}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            x: 0,
            y: 0,
            width: dataSpaceWidth,
            height: dataSpaceHeight
        })
    })
    .then(response => response.json())
    .then(data => {
        console.log('All points loaded for image:', imageId);

        // Limpiar overlay antes de procesar nuevos puntos
        clearOverlayPoints();

        // Procesar puntos de gaze y fixation (mantener información de participante)
        if (data.gaze_points && Array.isArray(data.gaze_points)) {
            allGazePointsWithParticipant = data.gaze_points.map(point => {
                // Coordinates come in 800x600 native image space
                // Scaling to display space is handled in visualizeGazePointsOverlay()
                const rawX = point.x_centroid || point.pixelX || point.x || 0;
                const rawY = point.y_centroid || point.pixelY || point.y || 0;

                return {
                    x: rawX,  // Keep native coordinates (800x600)
                    y: rawY,
                    participante: point.participante || point.participant || null,
                    time: point.Time || point.time || 0  // Timestamp para filtrado temporal
                };
            });
            console.log('Loaded all gaze points:', allGazePointsWithParticipant.length);
            if (allGazePointsWithParticipant.length > 0) {
                console.log('Sample gaze point:', allGazePointsWithParticipant[0]);
            }
        }

        if (data.fixations && Array.isArray(data.fixations)) {
            allFixationPointsWithParticipant = data.fixations.map(point => {
                // Coordinates come in 800x600 native image space
                // Scaling to display space is handled in visualizeFixationPointsOverlay()
                const rawX = point.x_centroid || point.x || 0;
                const rawY = point.y_centroid || point.y || 0;

                return {
                    x: rawX,  // Keep native coordinates (800x600)
                    y: rawY,
                    duration: point.duration || 0,
                    participante: point.participante || point.participant || null,
                    start: point.start || point.start_time || 0,  // Timestamp de inicio
                    end: point.end || point.end_time || 0  // Timestamp de fin
                };
            });
            console.log('Loaded all fixation points:', allFixationPointsWithParticipant.length);
            if (allFixationPointsWithParticipant.length > 0) {
                console.log('Sample fixation point:', allFixationPointsWithParticipant[0]);
            }
        }

        // Mostrar overlay si hay tipos seleccionados
        if (currentOverlayTypes && currentOverlayTypes.length > 0) {
            updateOverlay();
        }
    })
    .catch(error => {
        console.error('Error loading all points for image:', error);
    });
}

function createSegmentationCanvas() {
    const container = document.getElementById('component-1');

    // Crear canvas si no existe
    if (!segmentationCanvas) {
        segmentationCanvas = document.createElement('canvas');
        segmentationCanvas.id = 'seg-canvas';
        segmentationCanvas.style.display = 'none';
    }

    // Cargar la imagen original de segmentación
    if (!originalSegmentationImage) {
        originalSegmentationImage = new Image();
        originalSegmentationImage.crossOrigin = 'anonymous';
        originalSegmentationImage.src = currentImageSegmentationPath;
        originalSegmentationImage.onload = function() {
            segmentationCanvas.width = originalSegmentationImage.width;
            segmentationCanvas.height = originalSegmentationImage.height;

            const ctx = segmentationCanvas.getContext('2d');
            ctx.drawImage(originalSegmentationImage, 0, 0);
        };
    }
}

function getSaturation(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    if (max === min) {
        return 0;
    }

    return l < 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min);
}

function hexToRgb(hex) {
    // Convertir color hex a RGB (ej: "#FF6B35" → [255, 107, 53])
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function applySegmentationFilter(selectedClass) {
    const imgView = document.getElementById('sel-img-view');

    if (!segmentationCanvas || !originalSegmentationImage) {
        createSegmentationCanvas();
        setTimeout(() => applySegmentationFilter(selectedClass), 100);
        return;
    }

    if (!selectedClass) {
        resetSegmentationView();
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = segmentationCanvas.width;
    canvas.height = segmentationCanvas.height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(segmentationCanvas, 0, 0);

    // Obtener datos de píxeles
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Obtener el color RGB asociado a la clase seleccionada
    const hexColor = classColorMap[selectedClass];
    if (!hexColor) {
        console.warn(`No color found for class: ${selectedClass}`);
        resetSegmentationView();
        return;
    }

    const selectedRgb = hexToRgb(hexColor);
    if (!selectedRgb) {
        console.warn(`Could not parse color: ${hexColor}`);
        resetSegmentationView();
        return;
    }

    // Crear tolerancia para matching de color (permitir pequeñas variaciones)
    const colorTolerance = 15;

    // Aplicar opacidad - 0.3 para todos excepto la clase seleccionada
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a > 128) { // Solo píxeles visibles
            // Verificar si este píxel coincide con el color de la clase seleccionada
            const isSelectedColor =
                Math.abs(r - selectedRgb.r) <= colorTolerance &&
                Math.abs(g - selectedRgb.g) <= colorTolerance &&
                Math.abs(b - selectedRgb.b) <= colorTolerance;

            if (!isSelectedColor) {
                // Reducir opacidad al 30% para píxeles que NO son de la clase seleccionada
                data[i + 3] = data[i + 3] * 0.3;
            }
            // Si es de la clase seleccionada, mantener opacidad original
        }
    }

    ctx.putImageData(imageData, 0, 0);
    imgView.src = canvas.toDataURL();
}


function resetSegmentationView() {
    const imgView = document.getElementById('sel-img-view');
    if (currentImageSegmentationPath) {
        imgView.src = currentImageSegmentationPath;
    }
}

function createBrushSelection(imageWrapper, img) {
    console.log('Creando brush D3 para selección de área...');

    // Remover brush anterior si existe
    d3.select('#brushOverlay').remove();

    // Variables de estado del brush
    window.brushActive = false;
    window.brushSelection = null;

    // Esperar a que la imagen cargue completamente
    if (!img.complete || img.naturalWidth === 0) {
        console.log('Esperando a que cargue la imagen...');
        setTimeout(() => createBrushSelection(imageWrapper, img), 100);
        return;
    }

    // Obtener dimensiones sin escala usando offsetWidth/offsetHeight
    const imgWidth = img.offsetWidth;
    const imgHeight = img.offsetHeight;

    // Obtener dimensiones del contenedor para centrar
    const containerWidth = imageWrapper.offsetWidth;
    const containerHeight = imageWrapper.offsetHeight;

    // Calcular posición centrada (igual a cómo flex centra la imagen)
    const svgOffsetLeft = (containerWidth - imgWidth) / 2;
    const svgOffsetTop = (containerHeight - imgHeight) / 2;

    console.log(`Dimensiones de imagen (sin escala): ${imgWidth}x${imgHeight}`);
    console.log(`Contenedor: ${containerWidth}x${containerHeight}`);
    console.log(`Posición SVG centrada: left=${svgOffsetLeft}, top=${svgOffsetTop}`);

    // Crear contenedor SVG para el brush
    // El SVG ocupa todo el contenedor y está centrado junto con la imagen
    // Cuando ambos se escalan 1.5x desde center center, se alinean
    const svgContainer = d3.select(imageWrapper)
        .append('svg')
        .attr('id', 'brushOverlay')
        .attr('width', imgWidth)
        .attr('height', imgHeight)
        .style('position', 'absolute')
        .style('top', svgOffsetTop + 'px')
        .style('left', svgOffsetLeft + 'px')
        .style('width', imgWidth + 'px')
        .style('height', imgHeight + 'px')
        .style('pointer-events', 'all')
        .style('z-index', '10')
        .style('cursor', 'crosshair');

    // El brush ocupa todo el SVG (que tiene el mismo tamaño que la imagen)
    // Ambos están centrados y se escalan 1.5x, así coinciden perfectamente
    const brush = d3.brush()
        .extent([[0, 0], [imgWidth, imgHeight]])
        .on('start', function() {
            console.log('Brush iniciado');
            window.brushActive = true;
        })
        .on('brush', function(event) {
            if (event.selection) {
                window.brushSelection = event.selection;
                console.log('Selección brush:', event.selection);
            }
        })
        .on('end', function(event) {
            console.log('Brush finalizado');
            window.brushActive = false;

            if (event.selection) {
                const [[x0, y0], [x1, y1]] = event.selection;

                console.log(`Selección brush (pantalla): (${x0.toFixed(1)}, ${y0.toFixed(1)}) to (${x1.toFixed(1)}, ${y1.toFixed(1)})`);

                // IMPORTANTE: Los datos gaze están en espacio 800x600 (nativo)
                // pero el brush está en espacio de pantalla (imgWidth x imgHeight)
                // Necesitamos escalar las coordenadas del brush al espacio de datos
                const DATA_WIDTH = 800;
                const DATA_HEIGHT = 600;

                const scaleX = DATA_WIDTH / imgWidth;
                const scaleY = DATA_HEIGHT / imgHeight;

                console.log(`Factores de escala: X=${scaleX.toFixed(3)}, Y=${scaleY.toFixed(3)} (pantalla ${imgWidth}x${imgHeight} -> datos ${DATA_WIDTH}x${DATA_HEIGHT})`);

                // Convertir coordenadas de pantalla a espacio de datos
                // IMPORTANTE: Tanto Gaze como Fixations invierten Y en visualización (líneas 442 y 504)
                // Por lo tanto, el brush debe invertir Y para AMBOS tipos de datos

                // Ambos tipos invierten Y porque la visualización lo hace
                const areaY = Math.round((DATA_HEIGHT - (y1 * scaleY)));
                const areaHeight = Math.round((y1 - y0) * scaleY);

                console.log(`Modo ${currentDataType}: Invirtiendo Y - y0_pantalla=${y0.toFixed(1)}, y1_pantalla=${y1.toFixed(1)} -> y_datos=${areaY}`);

                const area = {
                    x: Math.round(x0 * scaleX),
                    y: areaY,
                    width: Math.round((x1 - x0) * scaleX),
                    height: areaHeight
                };

                console.log(`Área seleccionada (espacio datos): ${area.width}x${area.height}px en (${area.x}, ${area.y})`);

                // Validar que el área no sea demasiado pequeña (en espacio de datos)
                if (area.width < 40 || area.height < 40) {
                    console.log('Área seleccionada muy pequeña (mínimo 40x40px en espacio de datos)');
                    return;
                }

                console.log(`✅ Área para análisis: ${area.width}x${area.height}px en (${area.x}, ${area.y})`);

                // Llamar función para generar glyph del área seleccionada
                analyzeSelectedArea(area);
            } else {
                console.log('Selección cancelada');
            }
        });

    // Aplicar el brush al SVG
    const brushGroup = svgContainer.append('g')
        .attr('class', 'brush')
        .call(brush);

    // Personalizar el estilo del brush
    brushGroup.selectAll('.overlay')
        .style('fill-opacity', 0.5);

    brushGroup.selectAll('.selection')
        .style('stroke', '#ff6b35')
        .style('stroke-width', '2px')
        .style('fill', 'rgba(255, 107, 53, 0.1)')
        .style('stroke-dasharray', '5,5');

    // Agregar botón para limpiar selección directamente al SVG
    /*const btnClear = document.createElement('button');
    btnClear.id = 'clearBrushBtn';
    btnClear.innerHTML = 'Clear';
    btnClear.className = 'btn btn-xs';*/
    /*btnClear.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 20;
        background: #ff6b35;
        color: white;
        border: none;
        padding: 5px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
    `;*/
    const btnClear = document.getElementById('clearBrushBtn');
    btnClear.classList.remove('btn-disabled');
    btnClear.addEventListener('click', () => {
        // Limpiar la selección del brush D3
        brush.clear(brushGroup);
        console.log('Selección limpiada');

        // Remover el tooltip del glyph si está visible
        d3.select('#glyphTooltip').remove();
        console.log('Tooltip del glyph removido');

        // Reset del área analizada y datos
        currentAnalyzedArea = null;
        currentAreaData = null;
        console.log('Área analizada reseteada');

        // Limpiar puntos y overlays del scarf plot
        clearOverlayPoints();
        removeBoundingBoxOverlay();
        removeParticipantColumnHighlight();
        removeScarfSegmentHighlight();
        currentScarfSegment = null; // Resetear segmento del scarf
        console.log('Selección del scarf plot limpiada');

        // Desmarcar todos los checkboxes de overlay
        const overlayCheckboxes = document.querySelectorAll('.overlay-checkbox');
        overlayCheckboxes.forEach(checkbox => {
            checkbox.checked = false;
        });

        // Limpiar overlays y restaurar opacidad
        currentOverlayTypes = [];
        updateOverlay();
        console.log('Overlay checkboxes desmarcados');

        // Re-deshabilitar el botón Clear
        btnClear.classList.add('btn-disabled');
        console.log(' Brush, tooltip, scarf plot y estado limpiados completamente');
    });

    // img.parentNode.appendChild(btnClear);
    document.getElementById('img-view-controls').append(btnClear);

    console.log(' Brush D3 creado exitosamente');
}

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
            .style("background", "transparent");

        this.centerGroup = this.svg.append("g")
            .attr("class", "center-group")
            .attr("transform", `translate(${this.config.width/2}, ${this.config.height/2})`);

        this.ring1Group = this.svg.append("g")
            .attr("class", "ring1-group")
            .attr("transform", `translate(${this.config.width/2}, ${this.config.height/2})`);

        this.ring2Group = this.svg.append("g")
            .attr("class", "ring2-group")
            .attr("transform", `translate(${this.config.width/2}, ${this.config.height/2})`);

        console.log("RadialGlyph.initializeSVG: SVG reinitialized completely");
    }

    update(data) {
        console.log("RadialGlyph.update() iniciado con datos:", data);
        this.rawData = data; // Guardar datos originales para acceso posterior

        // Log información detallada sobre qué datos recibimos
        console.log("=== RadialGlyph Data Sources ===");
        console.log(`data_type: ${data?.data_type || 'unknown'}`);
        console.log(`gaze_points: ${data?.gaze_points?.length || 0}`);
        console.log(`fixations: ${data?.fixations?.length || 0}`);
        console.log(`data_for_analysis: ${data?.data_for_analysis?.length || 0}`);

        if (data?.gaze_points && data.gaze_points.length > 0) {
            console.log("Sample gaze point:", data.gaze_points[0]);
        }
        if (data?.fixations && data.fixations.length > 0) {
            console.log("Sample fixation:", data.fixations[0]);
        }
        if (data?.data_for_analysis && data.data_for_analysis.length > 0) {
            console.log("Sample data_for_analysis:", data.data_for_analysis[0]);
        }

        const processedData = this.processData(data);
        console.log("Datos procesados:", processedData);

        this.renderHistogramCenter(processedData.histogramData);
        this.renderRing1(processedData.directions);
        this.renderRing2(processedData.timeData);

        console.log("RadialGlyph.update() completado!");
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

        console.log(`processData: Using ${data.data_type || 'unknown'} data with ${analysisData.length} points`);

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
                console.log(`Skipping fixation - x=${f.x_centroid}, y=${f.y_centroid}, p=${f.participante}`);
            }

            return hasValidCoordinates && hasValidParticipant;
        });

        console.log(`RadialGlyph.sanitizeFixations: ${original} -> ${sanitized.length} fixations`);
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
            console.log("calculateDirections: Not enough fixations to calculate movement directions");
            return directions;
        }

        console.log(`calculateDirections: Processing movement for ${fixations.length} fixations`);

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

        console.log("calculateDirections (movement) result:", directions);
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

        console.log(`calculateTimeData: Processing ${fixations.length} items`);
        if (fixations.length > 0) {
            console.log(`Sample item:`, fixations[0]);
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

        console.log(`calculateTimeData: Found ${sortedParticipants.length} participants:`, sortedParticipants);

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

        // Validate histogram data
        if (!histogramData) {
            console.warn("Center histogram: No data provided");
            this.centerGroup.append("text")
                .attr("text-anchor", "middle")
                .attr("dy", "0.3em")
                .style("font-size", "11px")
                .style("fill", "#999")
                .text("(no data)");
            return;
        }

        const { allHistogram, patchHistogram, patchAvg, patchCount, allAvg, allCount } = histogramData;

        // Validate histogram arrays
        if (!allHistogram || !patchHistogram || allHistogram.length === 0 || patchHistogram.length === 0) {
            console.warn("Center histogram: Invalid histogram data");
            this.centerGroup.append("text")
                .attr("text-anchor", "middle")
                .attr("dy", "0.3em")
                .style("font-size", "11px")
                .style("fill", "#999")
                .text("(no data)");
            return;
        }

        const histogramWidth = this.config.centerRadius * 1.8;
        const histogramHeight = this.config.centerRadius * 1.2;
        const margin = { top: 5, right: 3, bottom: 10, left: 3 };

        const histogramGroup = this.centerGroup.append("g")
            .attr("class", "histogram-group")
            .attr("transform", `translate(${-histogramWidth/2}, ${-histogramHeight/2})`);

        // Use linear scale for x-axis (for smooth line)
        const xScale = d3.scaleLinear()
            .domain([0, 9])
            .range([margin.left, histogramWidth - margin.right]);

        const maxFreq = Math.max(...allHistogram, ...patchHistogram, 1);
        const yScale = d3.scaleLinear()
            .domain([0, maxFreq])
            .range([histogramHeight - margin.bottom, margin.top]);

        // Create line generator with Catmull-Rom curve
        const lineGenerator = d3.line()
            .x((d, i) => xScale(i))
            .y(d => yScale(d))
            .curve(d3.curveCatmullRom);

        // Draw the TODOS smooth curve (blue/cyan, lighter)
        histogramGroup.append("path")
            .attr("class", "histogram-curve-todos")
            .attr("d", lineGenerator(allHistogram))
            .attr("fill", "none")
            .attr("stroke", "#4ECDC4")
            .attr("stroke-width", 1.5)
            .attr("opacity", 0.6);

        // Draw points on TODOS curve
        histogramGroup.selectAll(".histogram-point-todos")
            .data(allHistogram)
            .join("circle")
            .attr("class", "histogram-point-todos")
            .attr("cx", (d, i) => xScale(i))
            .attr("cy", d => yScale(d))
            .attr("r", 1.5)
            .attr("fill", "#4ECDC4")
            .attr("opacity", 0.5);

        // Draw the PATCH smooth curve (orange, stronger) - positioned lower
        histogramGroup.append("path")
            .attr("class", "histogram-curve-patch")
            .attr("d", lineGenerator(patchHistogram))
            .attr("fill", "none")
            .attr("stroke", "#FF6B35")
            .attr("stroke-width", 2)
            .attr("opacity", 0.9)
            .attr("transform", "translate(0, 8)");

        // Draw points on PATCH curve
        histogramGroup.selectAll(".histogram-point-patch")
            .data(patchHistogram)
            .join("circle")
            .attr("class", "histogram-point-patch")
            .attr("cx", (d, i) => xScale(i))
            .attr("cy", d => yScale(d) + 8)
            .attr("r", 2)
            .attr("fill", "#FF6B35")
            .attr("opacity", 0.7);

        // Mostrar "Todos(N): X.X | Patch(N): X.X" - positioned above histogram
        this.centerGroup.append("text")
            .attr("class", "avg-text")
            .attr("text-anchor", "middle")
            .attr("dy", "-50px")
            .style("font-size", "9px")
            .style("font-weight", "bold")
            .style("fill", "#4ECDC4")
            .style("pointer-events", "none")
            .style("z-index", "1000")
            .text(`All(${allCount}): ${allAvg.toFixed(1)}`);

        this.centerGroup.append("text")
            .attr("class", "patch-text")
            .attr("text-anchor", "middle")
            .attr("dy", "-36px")
            .style("font-size", "9px")
            .style("font-weight", "bold")
            .style("fill", "#FF6B35")
            .style("pointer-events", "none")
            .style("z-index", "1000")
            .text(`Selection(${patchCount}): ${patchAvg.toFixed(1)}`);
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
        console.log("=== renderRing1 Input Data ===");
        console.log("directionsData:", directionsData);

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
        console.log("Direction values:", { Arriba: counts[0], Derecha: counts[1], Abajo: counts[2], Izquierda: counts[3] });
        console.log("localMaxCount:", localMaxCount, "GLOBAL_MAX:", GLOBAL_MAX_DIRECTION_COUNT);

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

            console.log(`getBlueColor(${value}): normalized=${normalized.toFixed(3)}, color=${color}`);
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
        console.log("=== Final Ring1 DOM Segments ===");
        console.log("Color Cache (value -> color mapping):", colorCache);

        /*this.ring1Group.selectAll(".direction-segment").each(function(d, i) {
            const element = d3.select(this);
            const style = element.attr("style");
            const fill = element.attr("fill");
            const opacity = element.attr("opacity");
            const classList = element.attr("class");
            const value = directionsData[d] || 0;

            console.log(`%c Segment ${d} (index=${i}, value=${value})`, 'color: blue; font-weight: bold');
            console.log(`  Data-bound value: ${value}`);
            console.log(`  style="${style}"`);
            console.log(`  fill="${fill}"}`);
            console.log(`  opacity="${opacity}"`);
            console.log(`  class="${classList}"`);

            // Extract actual fill color from style
            const styleMatch = style.match(/fill:\s*([^;!]+)/);
            const fillFromStyle = styleMatch ? styleMatch[1].trim() : 'NOT FOUND';
            console.log(`  Actual fill color from style: ${fillFromStyle}`);
        });

        console.log("=== Verify Consistency ===");
        directions.forEach(direction => {
            const value = directionsData[direction] || 0;
            const expectedColor = colorCache[value];
            console.log(`Direction=${direction}, Value=${value}, Expected Color=${expectedColor}`);
        });

        // Double-check: verify there are exactly 4 segments
        const segmentCount = this.ring1Group.selectAll(".direction-segment").size();
        console.log(`Total direction segments rendered: ${segmentCount} (expected: 4)`);
        */
        console.log("=== End Ring1 DOM ===");
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

        console.log("renderRing2: participants=", participants, "histogram length=", histogram.length);

        // If no participants or no data, show empty state
        if (participants.length === 0 || !histogram || histogram.length === 0) {
            console.log("Ring2: No data to render");
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

        // Prepare data for stacked visualization (radially stacked by time, not concentric by participant)
        // Architecture: Each time segment gets its own radial band of fixed height (50px)
        // Within each band, participants are distributed proportionally (0-100%)
        const stackedData = [];
        const FIXED_BAR_HEIGHT = 50;  // Fixed height for each time block in pixels

        // Process ALL 15 time segments (0-14), even those without data
        // This ensures blocks align with time labels
        const FIXED_SEGMENT_HEIGHT = 10;  // Fixed height for each participant segment
        var maxOuterRadius = 0;
        d3.range(15).forEach((timeIdx, blockIndex) => {
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
            // Each gets FIXED height regardless of number of participants
            const barInnerRadius = this.config.ring2InnerRadius;
            let currentRadius = barInnerRadius;

            participantsInThisTime.forEach((participantId, idx) => {
                const count = participantCounts[participantId] || 0;

                const innerRadius = currentRadius;
                const outerRadius = currentRadius + FIXED_SEGMENT_HEIGHT;

                stackedData.push({
                    timeIdx: timeIdx,
                    participantId: participantId,
                    count: count,
                    innerRadius: innerRadius,
                    outerRadius: outerRadius
                });

                // Next participant starts where this one ends
                currentRadius = outerRadius;
                if (outerRadius > maxOuterRadius){
                    maxOuterRadius = outerRadius;
                }
            });
        });

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
            .style("cursor", "pointer")
            .on("mouseover", (event, d) => {
                const fixationsList = details[d.timeIdx] || [];
                const participantFixations = fixationsList.filter(f => f.participante == d.participantId);

                if (participantFixations.length > 0) {
                    // DEBUG: Check what data we have
                    if (participantFixations.length > 0) {
                        console.log(`Sample fixation for P${d.participantId}:`, participantFixations[0]);
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
                return Math.cos(angle - Math.PI/2) * maxOuterRadius*1.01;
            })
            .attr("y2", d => {
                const angle = angleScale(d);
                return Math.sin(angle - Math.PI/2) * maxOuterRadius*1.01;
            })
            .attr("stroke",  d=>"#555")
            .attr("stroke-width",1.3)
            .attr("opacity", 0.6);

        this.ring2Group.selectAll(".time-segment-divider-text")
            .data(d3.range(15))  // 16 divisores: inicio de cada bloque (0-14) + final (15)
            .enter()
            .append("text")
            .attr("class", "time-segment-divider-text")
            .attr("x", d => {
                const angle = angleScale(d);
                return Math.cos(angle - Math.PI/2) * maxOuterRadius*1.05;
            })
            .attr("y", d => {
                const angle = angleScale(d);
                return Math.sin(angle - Math.PI/2) * maxOuterRadius*1.05;
            })
            .attr("text-anchor", "middle")
            .style("font-size", "12px")
            .style("fill", "#333")
            .text(d => `${d}s`);    
        // Add circular dividers between participant bands
        // These show the stacking of participants within each time segment
        if (participants.length > 1) {
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
                // Each divider is at fixed intervals (FIXED_SEGMENT_HEIGHT)
                for (let i = 1; i < numInThisTime; i++) {
                    dividerData.push({
                        timeIdx: timeIdx,
                        dividerIdx: i,
                        radius: this.config.ring2InnerRadius + (i * FIXED_SEGMENT_HEIGHT)
                    });
                }
            });

            this.ring2Group.selectAll(".participant-band-divider")
                .data(dividerData, d => `${d.timeIdx}-${d.dividerIdx}`)
                .join("circle")
                .attr("class", "participant-band-divider")
                .attr("r", d => d.radius)
                .attr("fill", "none")
                .attr("stroke", "#777")
                .attr("stroke-width", 0.8)
                .attr("opacity", 0.5)
                .attr("stroke-dasharray", "2,2");
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

function analyzeSelectedArea(area) {
    console.log('Analizando área seleccionada:', area);

    // Guardar el área actual para reutilizarla cuando cambie el tipo de datos
    currentAnalyzedArea = area;

    const currentImage = selectedImg;
    if (!currentImage) {
        console.log('No image selected');
        return;
    }

    // Obtener el tipo de datos seleccionado
    const dataTypeSelect = document.getElementById('data-type-select');
    const dataType = dataTypeSelect ? dataTypeSelect.value : 'fixations';
    currentDataType = dataType;

    // Construir URL con parámetros
    let apiUrl = `/api/analyze-area/${currentImage}?data_type=${dataType}`;

    // Agregar filtro de participante si hay uno seleccionado
    if (selectedPart !== null && selectedPart !== 'all') {
        apiUrl += `&participant_id=${selectedPart}`;
        console.log(`Filtering glyph by participant: ${selectedPart}`);
    }

    // Llamar endpoint para obtener datos del área
    fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            x: area.x,
            y: area.y,
            width: area.width,
            height: area.height
        })
    })
    .then(response => response.json())
    .then(data => {
        console.log('Datos del área:', data);
        currentAreaData = data; // Guardar los datos

        // NO cambiar currentGazePoints ni currentFixationPoints
        // Los puntos del overlay se cargan con toda la imagen y deben mantenerse en su posición
        // Solo usamos data_for_analysis para el glyph/tooltip

        console.log('Area selected - keeping overlay points from full image');
        console.log('Gaze points in overlay:', currentGazePoints.length);
        console.log('Fixation points in overlay:', currentFixationPoints.length);

        showGlyphTooltip(area, data);
    })
    .catch(error => {
        console.error('Error analyzing area:', error);
    });
}

function showGlyphTooltip(area, data) {
    // Remover tooltip anterior si existe
    d3.select('#glyphTooltip').remove();

    // Verificar si hay datos para mostrar
    const hasData = data && (
        (data.data_for_analysis && data.data_for_analysis.length > 0) ||
        (data.fixations && data.fixations.length > 0)
    );

    console.log(`showGlyphTooltip: hasData=${hasData}, data_for_analysis=${data?.data_for_analysis?.length || 0}, fixations=${data?.fixations?.length || 0}`);

    // Crear contenedor del tooltip
    const tooltip = d3.select('body')
        .append('div')
        .attr('id', 'glyphTooltip')
        .style('position', 'fixed')
        .style('background', 'white')
        .style('border', '2px solid var(--color-base-300)')
        .style('border-radius', '8px')
        .style('padding', '21px')
        .style('box-shadow', '0 8px 24px rgba(0,0,0,0.3)')
        .style('z-index', '10000')
        .style('width', '600px')
        .style('height', '600px');

    // Posicionar el tooltip a la derecha del glyph sin interferencias
    const img = document.getElementById('sel-img-view');
    const imgRect = img.getBoundingClientRect();

    const tooltipWidth = 600;
    const tooltipHeight = 600;
    const gap = 40;  // Aumentado de 15px a 40px para más separación

    // Posicionar a la derecha de la imagen, centrado verticalmente
    let left = imgRect.right + gap;
    let top = imgRect.top + (imgRect.height / 2) - (tooltipHeight / 2);

    // Ajustar si se sale de la pantalla
    if (left + tooltipWidth > window.innerWidth) {
        // Si no cabe a la derecha, poner a la izquierda con el mismo gap
        left = imgRect.left - tooltipWidth - gap;
    }
    if (left < 10) {
        left = 10;
    }
    if (top < 10) top = 10;
    if (top + tooltipHeight > window.innerHeight) top = window.innerHeight - tooltipHeight - 10;

    console.log(`Posicionando tooltip sin interferencias: left=${left}, top=${top}, imgRight=${imgRect.right}`);

    tooltip.style('left', left + 'px')
        .style('top', top + 'px');

    // Agregar etiqueta del tipo de datos
    const dataTypeLabel = currentDataType === 'fixations' ? 'Fixations Points' : 'Gaze Points';
    const labelColor = currentDataType === 'fixations' ? '#FF9500' : '#E53935';
    const labelBgColor = currentDataType === 'fixations' ? '#FFF4E6' : '#FFEBEE';

    /*tooltip.append('div')
        .style('display', 'inline-block')
        .style('background-color', labelBgColor)
        .style('color', labelColor)
        .style('padding', '5px 11px')
        .style('border-radius', '4px')
        .style('font-size', '15px')
        .style('font-weight', 'bold')
        .style('margin-bottom', '14px')
        .text(dataTypeLabel);*/

    // Si no hay datos, mostrar mensaje
    if (!hasData) {
        tooltip.append('div')
            .style('padding', '56px 28px')
            .style('text-align', 'center')
            .style('color', '#666')
            .style('font-size', '19px')
            .html(`<div style="margin-bottom: 14px;">No hay datos ${dataTypeLabel.toLowerCase()} en esta área</div>
                   <div style="font-size: 17px; color: #999;">Intenta seleccionar un área con puntos</div>`);

        // Botón de cerrar
        tooltip.append('button')
            .text('✕')
            .style('position', 'absolute')
            .style('top', '7px')
            .style('right', '7px')
            .style('background', '#ff6b35')
            .style('color', 'white')
            .style('border', 'none')
            .style('border-radius', '4px')
            .style('padding', '7px 14px')
            .style('cursor', 'pointer')
            .style('font-size', '17px')
            .on('click', function() {
                d3.select('#glyphTooltip').remove();
            });

        return;
    }

    // Agregar contenedor del glyph
    const glyphContainer = tooltip.append('div')
        .attr('id', 'glyphContainer')
        .attr('class', ' w-full h-full')


    var glyphContainer_width = d3.select('#glyphContainer').node().getBoundingClientRect().width;
    var glyphContainer_height = d3.select('#glyphContainer').node().getBoundingClientRect().height;

    // Crear instancia del glyph y guardarla globalmente
    currentGlyph = new RadialGlyph('glyphContainer', {
        width: glyphContainer_width,
        height: glyphContainer_height,
        margin: 30,
        centerRadius: 60,
        ring1InnerRadius: 75,
        ring1OuterRadius: 127,
        ring2InnerRadius: 142,
        ring2OuterRadius: 209
    });

    // Actualizar con los datos
    currentGlyph.update(data);


    // Botón de cerrar
    tooltip.append('button')
        .text('✕')
        .style('position', 'absolute')
        .style('top', '7px')
        .style('right', '7px')
        .style('background', '#ff6b35')
        .style('color', 'white')
        .style('border', 'none')
        .style('border-radius', '4px')
        .style('padding', '7px 14px')
        .style('cursor', 'pointer')
        .style('font-size', '17px')
        .on('click', function() {
            d3.select('#glyphTooltip').remove();
        });
}

function switchImageView(mode) {
    const imgView = document.getElementById('sel-img-view');
    const btnOriginal = document.getElementById('btn-original');
    const btnSegmentation = document.getElementById('btn-segmentation');
    const imageWrapper = document.getElementById('component-1');

    currentImageMode = mode;

    if (mode === 'original' && currentImageOriginalPath) {
        // Remover SVG de contorno si existe
        d3.select(imageWrapper).select('svg.contour-svg').remove();

        // Remover handler de contorno para evitar que se vuelva a dibujar
        imgView.onload = null;

        imgView.src = currentImageOriginalPath;
        btnOriginal.classList.add('btn-primary');
        btnOriginal.classList.remove('btn-outline');
        btnSegmentation.classList.remove('btn-primary');
        btnSegmentation.classList.add('btn-outline');

        imgView.onload = function() {
            alignOverlayWithImage();
            createBrushSelection(imageWrapper, imgView);
            updateOverlay(); // Actualizar overlay para aplicar opacidad según estado
        };

        // Recrear brush cuando se carga la imagen
        if (imgView.complete) {
            alignOverlayWithImage();
            createBrushSelection(imageWrapper, imgView);
            updateOverlay(); // Actualizar overlay para aplicar opacidad según estado
        }
    } else if (mode === 'segmentation' && currentImageSegmentationPath) {
        // Remover SVG de contorno si existe
        d3.select(imageWrapper).select('svg.contour-svg').remove();

        // Remover handler de contorno para evitar que se vuelva a dibujar
        imgView.onload = null;

        // Si hay una clase seleccionada, aplicar filtro
        if (window.selectedClass) {
            createSegmentationCanvas();
            applySegmentationFilter(window.selectedClass);
        } else {
            imgView.src = currentImageSegmentationPath;
        }
        btnOriginal.classList.remove('btn-primary');
        btnOriginal.classList.add('btn-outline');
        btnSegmentation.classList.add('btn-primary');
        btnSegmentation.classList.remove('btn-outline');

        imgView.onload = function() {
            alignOverlayWithImage();
            createBrushSelection(imageWrapper, imgView);
            updateOverlay(); // Actualizar overlay para aplicar opacidad según estado
        };

        // Recrear brush cuando se carga la imagen
        if (imgView.complete) {
            alignOverlayWithImage();
            createBrushSelection(imageWrapper, imgView);
            updateOverlay(); // Actualizar overlay para aplicar opacidad según estado
        }
    }
}


function updateTabs() {
    document.querySelectorAll('.tabs input[name="tabs-nav"]').forEach(input => {
        const targetId = input.getAttribute('data-target');
        const targetDiv = document.getElementById(targetId);

        if (input.checked) {
            targetDiv.classList.remove('hidden');
        } else {
            targetDiv.classList.add('hidden');
        }
    });
}

// Add listener
document.querySelectorAll('.tabs input[name="tabs-nav"]').forEach(input => {
    input.addEventListener('change', updateTabs);
});


function populateSelect(selectId, values, labelPrefix, all=true) {
    const select = document.getElementById(selectId);
    select.innerHTML = "";
    if (all){
        const optAll = document.createElement("option");
        optAll.value = "all";
        optAll.textContent = "All";
        select.appendChild(optAll);
    }
    else{
        const optAll = document.createElement("option");
        optAll.value = "";
        optAll.textContent = "Select an element";
        optAll.disabled = true;
        optAll.selected = true;
        select.appendChild(optAll);
    }

    // Si es selector de imágenes y tenemos scores, ordenar por score descendente
    let sortedValues = [...values];
    if (labelPrefix === 'img' && Object.keys(imageScores).length > 0) {
        sortedValues.sort((a, b) => {
            const scoreA = imageScores[a] || 0;
            const scoreB = imageScores[b] || 0;
            return scoreB - scoreA; // Descendente (mayor score primero)
        });
        console.log('Images sorted by score (descending):', sortedValues.map(v => `${v}:${imageScores[v]?.toFixed(1)}`));
    }

    sortedValues.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v; // value = id only

        // Si es imagen y tenemos score, agregarlo en paréntesis
        if (labelPrefix === 'img' && imageScores[v] !== undefined) {
            opt.textContent = `${labelPrefix}-${v} (${imageScores[v].toFixed(1)})`;
        } else {
            opt.textContent = `${labelPrefix}-${v}`; // text = img-0 or part-4 etc.
        }

        select.appendChild(opt);
    });
}

// Cargar scores de imágenes
async function loadImageScores() {
    try {
        const response = await fetch('/static/data/data_hololens.json');
        const data = await response.json();

        // Calcular promedio de score por imagen
        for (const imageId in data) {
            const scoreParticipants = data[imageId].score_participant || [];
            if (scoreParticipants.length > 0) {
                const totalScore = scoreParticipants.reduce((sum, p) => sum + (p.score || 0), 0);
                const avgScore = totalScore / scoreParticipants.length;
                imageScores[imageId] = avgScore;
            } else {
                imageScores[imageId] = 0;
            }
        }

        console.log('Image scores loaded:', imageScores);
        return imageScores;
    } catch (error) {
        console.error('Error loading image scores:', error);
        return {};
    }
}

// Cargar scores y luego popular los selectores
loadImageScores().then(() => {
    populateSelect("img-select", allImages, "img", all=false);
    populateSelect("part-select", allParticipants, "part");
    populateSelect("part-select-v2", allParticipants, "part", all=false);
    populateSelect("img-select-v3", allImages, "img", all=false);
});


// Load functions
// NOTE: The original visualizeHeatmap function definition was removed here (was duplicate/overridden by a second definition below)
// The second definition at line 2229+ is the one that's actually used and includes additional features like classColorMap handling


function visualizeAttentionHeatmap(data, colNormalize=false) {    
    const container = document.getElementById('attention-heatmap-plot');
    container.innerHTML = ''; // Clear container

    // 1. Data Validation
    if (!data.matrix_normalized || data.matrix_normalized.length === 0 || data.images.length === 0 || data.classes.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No data available</p>';
        return;
    }

    // Guardar datos globalmente para acceso posterior
    window.currentAttentionHeatmapData = data;
    console.log('ATTENTION HEATMAP DATA');
    console.log(data);
    // 2. Setup Dimensions
    const margin = { top: 15, right: 20, bottom: 50, left: 120 }; // Increased margins for axis labels
    let containerWidth = container.clientWidth;
    let containerHeight = container.clientHeight;

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
    const sortedImages = data.image_scores.sort((a, b) => a[1] - b[1]);
    // 4. Scales and Bandwidth (Key Update)
    console.log('SORTED IMAGES');
    console.log(sortedImages);
    // Color Scale (YlOrRd - Yellow-Orange-Red)
    /*const colorScale = d3.scaleLinear()
        .domain([0, 0.5, 1])
        .range(['#ffffcc', '#ff7f00', '#d92000']);*/

    // 5. Draw Heatmap Cells (D3 Idiomatic Way)
    // Create a joint array of all (class, image) pairs using sorted images
    const cellData = d3.cross(data.classes, sortedImages, (className, imageIdx, i, j) => {
        // imageIdx es ImageIndex (0-based), convertir a ImageName (número real)
        //const imageNameValue = imageNames[imageIdx];

        return {
            className: className,
            imageIdx: imageIdx[0],  // ImageIndex (0-based, para posicionamiento y lookup en matrices)
            imageName: imageIdx[0],  // ImageName (número real de imagen, ej: 114)
            value: data.matrix_normalized[data.classes.indexOf(className)][data.images.indexOf(imageIdx[0])],
            rawValue: data.matrix_raw[data.classes.indexOf(className)][data.images.indexOf(imageIdx[0])],
            imageScore: imageIdx[1] || 0
        };
    });

    if (colNormalize == true){
        const groups = cellData.reduce((acc, item) => {
            if (!acc[item.imageName]) acc[item.imageName] = [];
            acc[item.imageName].push(item);
            return acc;
        }, {});
        for (const imageName in groups) {
            const group = groups[imageName];
            const values = group.map(d => d.rawValue);
            const min = Math.min(...values);
            const max = Math.max(...values);
            const range = max - min || 1; // avoid divide-by-zero
            for (const d of group) {
                d.value = (d.rawValue - min) / range;
            }
        }

    }

    const imageOrder = sortedImages.map(d => d[0]);

    const data_matrix = [];
    for (let i = 0; i < data.classes.length; i++) {
        const className = data.classes[i];
        // Build a lookup map: imageName -> value for this class
        var mapForClass = new Map();
        cellData
            .filter(d => d.className === className)
            .forEach(d => mapForClass.set(d.imageName, d.value));

        // Fill the row following imageOrder
        const row = imageOrder.map(imgName => {
            // If no entry exists for this image/class, decide fallback:
            // return null, 0, or any default you prefer. I'll use null here.
            return mapForClass.get(imgName);// ? mapForClass.get(imgName) : null;
        });
        data_matrix.push(row);
    }

    
    var perm = reorder.optimal_leaf_order()(data_matrix);
    var permIds = [];
    for (let i = 0; i < data.classes.length; i++) {
        permIds.push(data.classes[perm[i]]);
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
        .interpolate(() => d3.interpolateBlues);
        
    // The size of each cell is determined by the bandwidth of the scales
    const cellWidth = xScale.bandwidth();
    const cellHeight = yScale.bandwidth();

    // Create a group for all cells
    const cells = svg.append('g')
        .attr('class', 'heatmap-cells');

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
        .on('click', function(_, d) {
            // d.imageName es el ImageName (número real de imagen, ej: 114)
            const imageName = d.imageName;

            console.log(`=== CELL CLICKED ===`);
            console.log(`d.imageName (ImageName): ${imageName}`);
            console.log(`Loading image: ${imageName}`);

            if (imageName !== undefined) {
                // Pass ONLY the imageName, not imageIndex
                loadImageInControls2(imageName);
            }
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
        .attr('opacity', 0);

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
        .attr('x', d => xScale(d[0]) + xScale.bandwidth() / 2)
        .attr('y', 12)
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .text(d => d[0]);

    // 7. Y Axis (Added class 'y-axis-label')
    svg.append('g')
        .selectAll('text')
        .data(data.classes)
        .enter()
        .append('text')
        .attr('class', 'y-axis-label') // Class needed for selection later
        .attr('x', -10)
        .attr('y', d => yScale(d) + yScale.bandwidth() / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '12px')
        .style('cursor', 'pointer') // Indicate clickable
        .text(d => d);

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
        .attr('y', -80)
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
    const barHeight = height2*0.5;
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
    svgLegend.append("text")
        .attr("x", barX + barWidth / 2)
        .attr("y", barY + barHeight + 4)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "hanging")
        .attr('class', 'text-sm font-bold')
        .attr('fill', 'var(--color-secondary)')
        .text(colNormalize == true? '0': minVal.toFixed(2));

    // Max label (top of bar)
    svgLegend.append("text")
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
}
// Función para cargar datos de proyección de embeddings (t-SNE)
function loadEmbeddingProjectionData(participantId) {
    // Clear any previous selection
    if (window.clearTSNESelection) {
        window.clearTSNESelection();
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
    svg.selectAll('circle')
        .data(scatterData)
        .enter()
        .append('circle')
        .attr('class', 'scatter-saliency-point')
        .attr('id', d => 'scatter-saliency-point-'+d.image_name)
        .attr('cx', (d, i) => xScale(i))
        .attr('cy', d => yScale(d.saliency_coverage))
        .attr('r', 4)
        .attr('fill', d => "black")//colorScale(d.saliency_coverage))
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            d3.select(this)
                .attr('r', 6)
                .attr('stroke-width', 2);

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
            d3.select(this)
                .attr('r', 4)
                .attr('stroke-width', 1);
            d3.select(container).selectAll('.scatter-tooltip').remove();
        });

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
        .style('text-anchor', 'end')
        .attr('dx', '-0.5em')
        .attr('dy', '0.5em')
        .attr('transform', 'rotate(-45)');

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
        .text('Images (ordered by score)');

    // Y Axis Label
    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -40)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('fill', 'var(--color-secondary)')
        .text('Saliency Coverage (%)');

    /*document.getElementById("saliency-scatterplot-legend").innerHTML = "";
    // Assume heatmapData is available and contains objects with rawValue
    const values = scatterData.map(d => d.saliency_coverage);
    const minVal = d3.min(values);
    const maxVal = d3.max(values);

    // Select container
    const container2 = d3.select("#saliency-scatterplot-legend");
    const width2 = container2.node().getBoundingClientRect().width;
    const height2 = container2.node().getBoundingClientRect().height;
    // SVG
    const svgLegend = container2.append("svg")
        .attr("width", width2)
        .attr("height", height2);

    // Legend rect size & position
    const barWidth = width2 / 3;
    const barHeight = height2*0.75;
    const barX = (width2 - barWidth) / 2;
    const barY = (height2 - barHeight) / 2;
    // Gradient
    const defs = svgLegend.append("defs");
    const gradient = defs.append("linearGradient")
        .attr("id", "saliency-coverage-gradient")
        .attr("x1", "0%")
        .attr("y1", "100%")
        .attr("x2", "0%")
        .attr("y2", "0%");

    gradient.selectAll("stop")
        .data([
            { offset: "0%", color: colorScale(minCoverage) },
            { offset: "50%", color: colorScale((minCoverage + maxCoverage) / 2) },
            { offset: "100%", color: colorScale(maxCoverage) }
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
        .attr("fill", "url(#saliency-coverage-gradient)");

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
        .text("Coverage");*/
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
    svg.selectAll('circle')
        .data(scatterData)
        .enter()
        .append('circle')
        .attr('class', 'scatter-saliency-point')
        .attr('id', d => 'scatter-saliency-point-'+d.image_name)
        .attr('cx', d => xScale(d.score) + jitterGenerator())
        .attr('cy', d => yScale(d.saliency_coverage))
        .attr('r', 4)
        .attr('fill', d => "#6daed5")//colorScale(d.saliency_coverage))
        .attr('stroke', 'black')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            d3.select(this)
                .attr('r', 6)
                .attr('stroke-width', 2)
                .attr('opacity', 1);

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
            d3.select(this)
                .attr('r', 4)
                .attr('stroke-width', 1)
                .attr('opacity', 0.7);
            d3.select(container).selectAll('.scatter-tooltip').remove();
        });

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
        .text('Saliency Coverage (%)');
    
    
    /*document.getElementById("saliency-scatterplot-legend").innerHTML = "";
    // Assume heatmapData is available and contains objects with rawValue
    const values = scatterData.map(d => d.saliency_coverage);
    const minVal = d3.min(values);
    const maxVal = d3.max(values);

    // Select container
    const container2 = d3.select("#saliency-scatterplot-legend");
    const width2 = container2.node().getBoundingClientRect().width;
    const height2 = container2.node().getBoundingClientRect().height;
    // SVG
    const svgLegend = container2.append("svg")
        .attr("width", width2)
        .attr("height", height2);

    // Legend rect size & position
    const barWidth = width2 / 3;
    const barHeight = height2*0.75;
    const barX = (width2 - barWidth) / 2;
    const barY = (height2 - barHeight) / 2;
    // Gradient
    const defs = svgLegend.append("defs");
    const gradient = defs.append("linearGradient")
        .attr("id", "saliency-coverage-gradient")
        .attr("x1", "0%")
        .attr("y1", "100%")
        .attr("x2", "0%")
        .attr("y2", "0%");

    gradient.selectAll("stop")
        .data([
            { offset: "0%", color: colorScale(minCoverage) },
            { offset: "50%", color: colorScale((minCoverage + maxCoverage) / 2) },
            { offset: "100%", color: colorScale(maxCoverage) }
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
        .attr("fill", "url(#saliency-coverage-gradient)");

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
        .text("Coverage");*/
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
    svg.selectAll('circle')
        .data(dataWithTime)
        .enter()
        .append('circle')
        .attr('class', 'scatter-saliency-point')
        .attr('id', d => 'scatter-saliency-point-'+d.image_name)
        .attr('cx', d => xScale(d.time_minutes))
        .attr('cy', d => yScale(d.saliency_coverage))
        .attr('r', 4)
        .attr('fill', d => "#6daed5")
        .attr('stroke', 'black')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            d3.select(this)
                .attr('r', 6)
                .attr('stroke-width', 2)
                .attr('opacity', 1);

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
            d3.select(this)
                .attr('r', 4)
                .attr('stroke-width', 1)
                .attr('opacity', 0.7);
            d3.select(container).selectAll('.scatter-tooltip').remove();
        });

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
        .text('Time (minutes)');

    // Y Axis Label
    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -40)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill', 'var(--color-secondary)')
        .text('Saliency Coverage (%)');
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
    svg.selectAll('circle')
        .data(scatterData)
        .enter()
        .append('circle')
        .attr('cx', (d, i) => xScale(i))
        .attr('cy', d => yScale(d.stationary_entropy))
        .attr('r', 4)
        .attr('fill', d => "black")//colorScale(d.stationary_entropy))
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            d3.select(this)
                .attr('r', 6)
                .attr('stroke-width', 2);

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
            d3.select(this)
                .attr('r', 4)
                .attr('stroke-width', 1);
            d3.select(container).selectAll('.scatter-tooltip').remove();
        });

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
        .style('text-anchor', 'end')
        .attr('dx', '-0.5em')
        .attr('dy', '0.5em')
        .attr('transform', 'rotate(-45)');

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
        .text('Images (ordered by score)');

    // Y Axis Label
    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -40)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill', 'var(--color-secondary)')
        .text('Stationary Entropy (bits)');
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
    svg.selectAll('circle')
        .data(scatterData)
        .enter()
        .append('circle')
        .attr('cx', d => xScale(d.score) + jitterGenerator())
        .attr('cy', d => yScale(d.stationary_entropy))
        .attr('r', 4)
        .attr('fill', d => "black")//colorScale(d.stationary_entropy))
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            d3.select(this)
                .attr('r', 6)
                .attr('stroke-width', 2)
                .attr('opacity', 1);

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
            d3.select(this)
                .attr('r', 4)
                .attr('stroke-width', 1)
                .attr('opacity', 0.7);
            d3.select(container).selectAll('.scatter-tooltip').remove();
        });

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
        .text('Stationary Entropy (bits)');
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
    svg.selectAll('circle')
        .data(dataWithTime)
        .enter()
        .append('circle')
        .attr('cx', d => xScale(d.time_minutes))
        .attr('cy', d => yScale(d.stationary_entropy))
        .attr('r', 4)
        .attr('fill', d => "black")
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            d3.select(this)
                .attr('r', 6)
                .attr('stroke-width', 2)
                .attr('opacity', 1);

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
            d3.select(this)
                .attr('r', 4)
                .attr('stroke-width', 1)
                .attr('opacity', 0.7);
            d3.select(container).selectAll('.scatter-tooltip').remove();
        });

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
        .text('Time (minutes)');

    // Y Axis Label
    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -40)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .style('fill', 'var(--color-secondary)')
        .text('Stationary Entropy (bits)');
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
        .attr('cx', d => xScale(d.tsne_x))
        .attr('cy', d => yScale(d.tsne_y))
        .attr('r', 5)
        .attr('fill', d => colorScale(d.score))
        .attr('stroke', 'black')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            d3.select(this)
                .attr('r', 7)
                .attr('stroke-width', 2.5);

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
            d3.select(this)
                .attr('r', 5)
                .attr('stroke-width', 1.5);
            d3.select(plotContainer).selectAll('.scatter-tooltip').remove();
        });

    // Add brush functionality
    const brush = d3.brush()
        .extent([[0, 0], [width, height]])
        .on('end', function(event) {
            if (!event.selection) {
                // Clear selection
                circles.style('opacity', 1);
                d3.selectAll('.rect-h-img').attr('opacity', 0);
                d3.selectAll('.rect-heatmap').attr('opacity', 1);
                d3.selectAll('.scatter-saliency-point').attr('fill', '#6daed5');
                d3.selectAll('.scatter-saliency-point').attr('stroke', 'black');
                d3.selectAll('.scatter-saliency-point').attr('r', 4);
                const controls2SelectedImages = document.getElementById('controls2-selected-images');
                if (controls2SelectedImages) {
                    controls2SelectedImages.innerHTML = '';
                }
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
                // Update circle opacity
                circles.style('opacity', d => {
                    return selectedPoints.some(sp => sp.image_name === d.image_name) ? 1 : 0.5;
                });

                d3.selectAll('.rect-h-img').attr('opacity', 0);
                d3.selectAll('.rect-heatmap').attr('opacity', 0.15);
                d3.selectAll('.scatter-saliency-point').attr('stroke', 'black');
                d3.selectAll('.scatter-saliency-point').attr('fill', '#6daed5');
                d3.selectAll('.scatter-saliency-point').attr('r', 4);
                for (let x = 0; x<selectedPoints.length; x++){
                    d3.select('#rect-h-img-'+selectedPoints[x].image_name).attr('opacity', 0.75);
                    d3.selectAll('.rect-heatmap-'+selectedPoints[x].image_name).attr('opacity', 1);
                    d3.select('#scatter-saliency-point-'+selectedPoints[x].image_name).attr('stroke', 'red');
                    d3.select('#scatter-saliency-point-'+selectedPoints[x].image_name).attr('fill', 'red');
                    d3.select('#scatter-saliency-point-'+selectedPoints[x].image_name).attr('r', 6);

                }

                // Display in controls2
                displaySelectedImagesInControls(selectedPoints);
            } else {
                circles.style('opacity', 1);
                d3.selectAll('.rect-h-img').attr('opacity', 0);
                d3.selectAll('.rect-heatmap').attr('opacity', 1);
                d3.selectAll('.scatter-saliency-point').attr('stroke', 'black');
                d3.selectAll('.scatter-saliency-point').attr('fill', '#6daed5');
                d3.selectAll('.scatter-saliency-point').attr('r', 4);
                const controls2SelectedImages = document.getElementById('controls2-selected-images');
                if (controls2SelectedImages) {
                    controls2SelectedImages.innerHTML = '';
                }
            }
        });

    // Add brush to SVG
    svg.append('g')
        .attr('class', 'brush')
        .call(brush);

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
        selectedPoints.sort((a, b) => b.score - a.score);
        if (!controls2SelectedImages) {
            return;
        }

        controls2SelectedImages.innerHTML = '';

        selectedPoints.forEach(point => {
            const img = document.createElement('div');
            img.classList.add("h-[calc(49%)]")
            img.classList.add("w-full")
            // img.classList.add("my-1")

            img.innerHTML = `
                <div class="btn btn-xs btn-ghost pointer-events-none w-full h-[calc(10%)]">
                    id: ${point.image_name} | score: ${point.score}
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
        const controls2SelectedImages = document.getElementById('controls2-selected-images');
        if (controls2SelectedImages) {
            controls2SelectedImages.innerHTML = '';
        }

        circles.style('opacity', 1);
        svg.selectAll('.brush').call(brush.move, null);
    };

    // Store reference to display selected images
    window.displayTSNESelectedImages = displaySelectedImagesInControls;
}

// Global variable to store selection
window.selectedClass = null;

// MODIFICACIÓN: Función global para actualizar highlights en heatmap, scarf plot y segmentación
function updateHighlightsGlobal() {
    // 1. Actualizar heatmap
    const rowSelectors = document.querySelectorAll('.row-selector');
    rowSelectors.forEach(element => {
        const className = element.__data__;
        if (window.selectedClass === className) {
            element.setAttribute('opacity', '0.2');
        } else {
            element.setAttribute('opacity', '0');
        }
    });

    // 2. Actualizar etiquetas Y del heatmap
    const yAxisLabels = document.querySelectorAll('.y-axis-label');
    yAxisLabels.forEach(element => {
        const className = element.__data__;
        if (window.selectedClass === className) {
            element.style.fontWeight = 'bold';
        } else {
            element.style.fontWeight = 'normal';
        }
    });

    // 3. Actualizar scarf plot
    if (window.selectedClass != null) {
        // Opacificar todos los segmentos
        d3.selectAll('.scarf-segment')
            .attr('opacity', d => 0.3);
        // Resaltar solo la clase seleccionada
        d3.selectAll('.scarf-segment-' + window.selectedClass)
            .attr('opacity', d => 1);

        // // Cambiar automáticamente a segmentation cuando se selecciona una clase
        // if (currentImageMode !== 'segmentation' && currentImageSegmentationPath) {
        //     switchImageView('segmentation');
        // } else if (currentImageMode === 'segmentation') {
        //     // Si ya estamos en segmentation, aplicar el filtro
        //     applySegmentationFilter(window.selectedClass);
        // }

        //if (window.selectedClass != null) {
            // Si no estamos en modo segmentación, cambiamos
        if (currentImageMode !== 'segmentation') {
            switchImageView('segmentation');
            
            // --- CORRECCIÓN 2: Esperar a que la imagen cargue ---
            // Asignamos un evento one-time para aplicar el filtro apenas cargue
            const img = document.getElementById('sel-img-view');
            
            // Pequeño hack: esperamos un poco o usamos el evento de carga global
            // Lo ideal es llamar al filtro dentro de la función que carga la imagen
            setTimeout(() => {
                applySegmentationFilter(window.selectedClass); 
            }, 100); // Espera breve para dar tiempo al cambio de src
            
        } else {
            // Si ya estamos en segmentación, aplicamos directo
            applySegmentationFilter(window.selectedClass);
        }

    } else {
        // Restablecer opacidad completa en scarf plot
        d3.selectAll('.scarf-segment')
            .attr('opacity', d => 1);

        // Resetear la vista de segmentación cuando se deselecciona una clase
        if (currentImageMode === 'segmentation') {
            resetSegmentationView();
        }
    }
}

function visualizeHeatmap(data) {
    const container = document.getElementById('heatmap-plot');
    container.innerHTML = '';

    console.log('=== visualizeHeatmap ===');
    console.log('Data received - Classes count:', data.classes.length);
    console.log('Classes:', data.classes);
    console.log('Matrix raw rows:', data.matrix_raw.length);
    console.log('Matrix raw first row:', data.matrix_raw[0]);

    if (!data.matrix_normalized || data.matrix_normalized.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No data available</p>';
        return;
    }

    if (data.class_colors) {
        classColorMap = { ...data.class_colors };
        console.log('Updated classColorMap:', classColorMap);
    }

    // 1. Setup dimensions
    const margin = { top: 20, right: 20, bottom: 50, left: 100 };
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
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
    data.classes.forEach((className, i) => {
        const sum = data.matrix_raw[i].reduce((a, b) => a + b, 0);
        classSums[className] = sum;
    });

    // Obtener scores de clases (si existen en los datos)
    const classScores = data.class_scores || {};

    // Ordenar clases: primero por score (menor a mayor), luego por suma (mayor a menor si scores iguales)
    const sortedClasses = [...data.classes].sort((a, b) => {
        const scoreA = classScores[a] !== undefined ? classScores[a] : Infinity;
        const scoreB = classScores[b] !== undefined ? classScores[b] : Infinity;

        if (scoreA !== scoreB) {
            return scoreA - scoreB;  // Menor score primero (izquierda)
        }

        // Si scores son iguales, ordenar por suma (mayor suma primero)
        return classSums[b] - classSums[a];
    });

    console.log('Class scores:', classScores);
    console.log('Class sums:', classSums);
    console.log('Sorted classes:', sortedClasses);

    // 2. Create Scales
    const xScale = d3.scaleBand()
        .domain(dataParticipant.map(d => d.participant))
        .range([0, width])
        .padding(0.0);

    const yScale = d3.scaleBand()
        .domain(sortedClasses)
        .range([0, height])
        .padding(0.0);

    console.log('yScale domain:', yScale.domain());
    console.log('yScale domain length:', yScale.domain().length);

    // Color Scale - usar valores sin normalizar (rawValue)
    const minRawValue = data.min_value || 0;
    const maxRawValue = data.max_value || 1;

    console.log('[HEATMAP DEBUG] visualizeHeatmap Color Scale:');
    console.log('  - min_value from backend:', data.min_value);
    console.log('  - max_value from backend:', data.max_value);

    const colorScale = d3.scaleSequential()
        .domain([minRawValue, maxRawValue])  // Rango de valores crudos
        .interpolator(d3.interpolateBlues);

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

    console.log('heatmapData length:', heatmapData.length);
    console.log('Expected data points:', data.classes.length * data.participants.length);
    console.log('Classes in heatmapData:', [...new Set(heatmapData.map(d => d.row))].length);

    // 4. Draw Cells - usar rawValue (sin normalizar)
    svg.selectAll('rect')
        .data(heatmapData)
        .enter()
        .append('rect')
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

    // 6. X Axis
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .selectAll('text')
        .data(dataParticipant)
        .enter()
        .append('text')
        .attr('x', d => xScale(d.participant) + xScale.bandwidth() / 2)
        .attr('y', 15)
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .style('fill','var(--color-secondary)')
        .text(d => d.participant);

    svg.selectAll('heatmap-scores')
        .data(dataParticipant)
        .enter()
        .append('text')
        .attr('x', d => xScale(d.participant) + xScale.bandwidth() / 2)
        .attr('y', -5)
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .style('fill','var(--color-secondary)')
        .text(d => d.score);

    // 7. Y Axis (Added class 'y-axis-label')
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
        .style('cursor', 'pointer') // Indicate clickable
        .style('fill','var(--color-secondary)')
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
        .attr('x', -10)
        .attr('y', -5)
        .attr('text-anchor', 'end')
        .attr('font-size', '12px')
        .style('fill','var(--color-secondary)')
        .text('Score');

    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -80)
        .attr('text-anchor', 'middle')
        .attr('font-size', '16px')
        .style('fill','var(--color-secondary)')
        .text('Classes');

    // ---------------------------------------------------------
    // 9. ROW SELECTORS (Interaction Layer)
    // ---------------------------------------------------------
    
    // Function to update visual state based on global variable
    // MODIFICACIÓN: Ahora simplemente delega a la función global
    function updateHighlights() {
        updateHighlightsGlobal();
    }

    svg.selectAll('.row-selector')
        .data(data.classes)
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
            if (window.selectedClass === d) {
                // Deselect if clicking the same one
                window.selectedClass = null;
            } else {
                // Select new one
                window.selectedClass = d;
            }
            updateHighlights();
            console.log("Selected Class:", window.selectedClass);
        });
        
    // Initialize state in case of re-render
    updateHighlights();

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
    const barHeight = height2*0.5;
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
function showScarfError(message) {
            const container = document.getElementById('scarf-plot');
            container.innerHTML = `<p style="text-align: center; color: #999;">${message}</p>`;
}
function loadHeatmap(imageId, dataType = 'gaze', mode = 'attention') {
    const baseUrl = window.location.origin;
    const apiUrl = `${baseUrl}/api/heatmap/${imageId}?data_type=${dataType}&dataset_select=${currentDatasetSelect}&mode=${mode}`;
    console.log(`=== LOADING HEATMAP ===`);
    console.log(`API URL: ${apiUrl}`);
    console.log(`Parameters: imageId=${imageId}, dataType=${dataType}, currentDatasetSelect=${currentDatasetSelect}, mode=${mode}`);
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
                        console.log(`Heatmap data loaded (${dataType}, mode=${mode}):`, data);
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
    const apiUrl = `${baseUrl}/api/heatmap/participant/${participantId}`;
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
                console.log(`Heatmap data loaded:`, data);
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

function loadImageInControls2(imageName) {
    // Carga una imagen en el panel controls2 al hacer click en una columna del heatmap
    // SIN eliminar el selector de participante
    const controls2 = document.getElementById('controls2');

    // Verificar que controls2 existe
    if (!controls2) {
        console.warn('controls2 element not found - function only works on index2.html page');
        return;
    }

    // Obtener el ancho de controls2
    const controls2Width = controls2.offsetWidth;

    // Construir ruta de imagen
    const imagePath = `/static/images/images/images/${imageName}.jpg`;

    // Buscar o crear un contenedor separado para la imagen (sin tocar el fieldset)
    let imageContainer = document.getElementById('image-container-controls2');
    if (!imageContainer) {
        imageContainer = document.createElement('div');
        imageContainer.id = 'image-container-controls2';
        imageContainer.style.marginTop = '15px';
        imageContainer.style.borderTop = '1px solid #ccc';
        imageContainer.style.paddingTop = '10px';
        controls2.appendChild(imageContainer);
    }

    // Insertar la imagen en el contenedor (sin afectar el fieldset)
    imageContainer.innerHTML = `
        <div style="font-weight: bold; color: #333; font-size: 14px; margin-bottom: 10px;">
            Image ${imageName}
        </div>
        <div style="display: flex; align-items: center; justify-content: center; max-height: 300px;">
            <img src="${imagePath}"
                 alt="Image ${imageName}"
                 style="max-width: ${controls2Width * 0.95}px; max-height: 300px; object-fit: contain; border: 1px solid #ddd; border-radius: 4px;">
        </div>
    `;

    console.log(`Imagen cargada: ${imageName} en controls2 con ancho máximo: ${controls2Width * 0.95}px`);
}

// ===== FUNCIONES PARA INTERACCIÓN CON SCARF PLOT =====

// Crear bounding box overlay sobre la imagen
function createBoundingBoxOverlay(boundingBox) {
    // Remover overlay anterior si existe
    const existingOverlay = document.getElementById('scarf-bounding-overlay');
    const existingBorder = document.getElementById('scarf-bounding-border');
    if (existingOverlay) existingOverlay.remove();
    if (existingBorder) existingBorder.remove();

    const img = document.getElementById('sel-img-view');
    const component1 = document.getElementById('component-1');

    if (!img || !component1) return;

    const imgRect = img.getBoundingClientRect();
    const component1Rect = component1.getBoundingClientRect();

    // Calcular posición de la imagen relativa al contenedor
    const imgLeft = (component1Rect.width - imgRect.width) / 2;
    const imgTop = (component1Rect.height - imgRect.height) / 2;

    // Crear overlay con opacidad (todo excepto el bounding box)
    const overlay = document.createElement('div');
    overlay.id = 'scarf-bounding-overlay';
    overlay.style.position = 'absolute';
    overlay.style.top = imgTop + 'px';
    overlay.style.left = imgLeft + 'px';
    overlay.style.width = imgRect.width + 'px';
    overlay.style.height = imgRect.height + 'px';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)'; // 70% opacidad
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '99';

    // Crear recorte usando clip-path (mostrar solo el área del bounding box sin opacidad)
    const { x, y, width, height } = boundingBox;
    overlay.style.clipPath = `polygon(
        0% 0%, 0% 100%, ${x}px 100%, ${x}px ${y}px,
        ${x + width}px ${y}px, ${x + width}px ${y + height}px,
        ${x}px ${y + height}px, ${x}px 100%, 100% 100%, 100% 0%
    )`;

    component1.appendChild(overlay);

    // Crear rectángulo de borde dorado
    const border = document.createElement('div');
    border.id = 'scarf-bounding-border';
    border.style.position = 'absolute';
    border.style.top = (imgTop + y) + 'px';
    border.style.left = (imgLeft + x) + 'px';
    border.style.width = width + 'px';
    border.style.height = height + 'px';
    border.style.border = '2px solid #FFD700'; // Borde dorado
    border.style.boxShadow = '0 0 10px rgba(255, 215, 0, 0.5)';
    border.style.pointerEvents = 'none';
    border.style.zIndex = '101';

    component1.appendChild(border);
}

// Remover bounding box overlay
function removeBoundingBoxOverlay() {
    const overlay = document.getElementById('scarf-bounding-overlay');
    const border = document.getElementById('scarf-bounding-border');
    if (overlay) overlay.remove();
    if (border) border.remove();
}

// Resaltar columna de participante en el heatmap
function highlightParticipantColumnInHeatmap(participantId) {
    console.log('Highlighting participant column:', participantId);

    // Remover highlight anterior si existe
    d3.select('#heatmap-participant-highlight').remove();

    const heatmapContainer = document.getElementById('heatmap-plot');
    if (!heatmapContainer) return;

    const svg = d3.select('#heatmap-plot svg g');
    if (svg.empty()) return;

    // Encontrar todas las celdas del heatmap con este participante
    const allRects = svg.selectAll('rect');
    const participantRects = [];

    allRects.each(function(d) {
        if (d && d.col === participantId) {
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
        .attr('stroke', '#FFD700')  // Borde dorado
        .attr('stroke-width', 3)
        .style('pointer-events', 'none')
        .style('opacity', 0.8);

    console.log('Participant column highlighted at x:', rectX, 'width:', rectWidth, 'height:', totalHeight);
}

// Remover highlight de columna de participante
function removeParticipantColumnHighlight() {
    d3.select('#heatmap-participant-highlight').remove();
}

// Resaltar bloque seleccionado en scarf plot (opacar el resto)
function highlightScarfSegment(segment) {
    console.log('Highlighting scarf segment:', segment);

    // Opacar todos los segmentos
    d3.selectAll('.scarf-segment')
        .attr('opacity', 0.3);

    // Encontrar y resaltar el segmento específico
    d3.selectAll('.scarf-segment')
        .filter(function(d) {
            return d &&
                   d.participant === segment.participant &&
                   d.start_time === segment.start_time &&
                   d.end_time === segment.end_time;
        })
        .attr('opacity', 1)
        .attr('stroke', '#FFD700')  // Borde dorado
        .attr('stroke-width', 2);
}

// Remover highlight de scarf plot
function removeScarfSegmentHighlight() {
    // Restaurar opacidad completa a todos los segmentos
    d3.selectAll('.scarf-segment')
        .attr('opacity', 1)
        .attr('stroke', '#333')
        .attr('stroke-width', 1);
}

// Función principal: mostrar puntos para un segmento del scarf plot
function showPointsForScarfSegment(segment) {
    console.log('Showing points for scarf segment:', segment);

    // Guardar el segmento actual para usar su color
    currentScarfSegment = segment;

    const { start_time, end_time, participant } = segment;

    // Convertir tiempos de milisegundos a segundos si es necesario
    const startSec = start_time / 1000;
    const endSec = end_time / 1000;

    console.log(`Filtering for participant ${participant}, time range: ${startSec.toFixed(2)}s - ${endSec.toFixed(2)}s (${start_time}ms - ${end_time}ms)`);

    // Filtrar gaze points
    const filteredGaze = allGazePointsWithParticipant.filter(point => {
        if (point.participante !== participant) return false;
        // Los tiempos pueden estar en segundos o milisegundos, probar ambos
        const timeInSeconds = point.time < 100 ? point.time : point.time / 1000;
        return timeInSeconds >= startSec && timeInSeconds <= endSec;
    });

    // Filtrar fixation points
    const filteredFixations = allFixationPointsWithParticipant.filter(point => {
        if (point.participante !== participant) return false;
        // Los tiempos pueden estar en segundos o milisegundos
        const startInSeconds = point.start < 100 ? point.start : point.start / 1000;
        const endInSeconds = point.end < 100 ? point.end : point.end / 1000;

        // Check if fixation overlaps with segment time range
        return (startInSeconds >= startSec && startInSeconds <= endSec) ||
               (endInSeconds >= startSec && endInSeconds <= endSec) ||
               (startInSeconds <= startSec && endInSeconds >= endSec);
    });

    console.log(`Found ${filteredGaze.length} gaze points, ${filteredFixations.length} fixation points`);

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

    // Resaltar columna de participante en heatmap
    highlightParticipantColumnInHeatmap(participant);

    // Calcular bounding box de los puntos filtrados
    const allPoints = currentDataType === 'gaze' ? filteredGaze : filteredFixations;

    if (allPoints.length > 0) {
        // Obtener dimensiones de la imagen para escalar
        const img = document.getElementById('sel-img-view');
        const imgRect = img.getBoundingClientRect();
        const DATA_WIDTH = 800;
        const DATA_HEIGHT = 600;
        const scaleX = imgRect.width / DATA_WIDTH;
        const scaleY = imgRect.height / DATA_HEIGHT;

        // Calcular min/max en espacio de datos
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        allPoints.forEach(point => {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        });

        // Agregar padding (en espacio de datos)
        const padding = 30;
        minX = Math.max(0, minX - padding);
        maxX = Math.min(DATA_WIDTH, maxX + padding);
        minY = Math.max(0, minY - padding);
        maxY = Math.min(DATA_HEIGHT, maxY + padding);

        // Escalar a espacio de pantalla e invertir Y
        const boundingBox = {
            x: minX * scaleX,
            y: (DATA_HEIGHT - maxY) * scaleY,  // Invertir Y
            width: (maxX - minX) * scaleX,
            height: (maxY - minY) * scaleY
        };

        console.log('Bounding box:', boundingBox);

        // Crear overlay con bounding box
        createBoundingBoxOverlay(boundingBox);
    }

    if (currentDataType === 'gaze' && filteredGaze.length > 0) {
        visualizeGazePointsOverlay();
    } else if (currentDataType === 'fixations' && filteredFixations.length > 0) {
        visualizeFixationPointsOverlay();
    } else if (filteredGaze.length === 0 && filteredFixations.length === 0) {
        console.warn('No points found in this time segment');
        removeBoundingBoxOverlay();
    }
}

// ===== FIN DE FUNCIONES PARA SCARF PLOT =====

function visualizeScarfPlot(data) {
    const container = document.getElementById('scarf-plot');
    container.innerHTML = ''; // Limpiar
    // container.style.overflow = 'auto'; // Permitir scroll
    if (!data.scarf_data || data.scarf_data.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No hay datos disponibles</p>';
        return;
    }

    // LOG: Ver qué colores están llegando del backend
    console.log('%c=== SCARF PLOT COLORS DEBUG ===', 'color: orange; font-weight: bold');
    const allSegments = data.scarf_data.flatMap(d => d.segments);
    const uniqueColorsByClass = {};
    allSegments.forEach(seg => {
        if (!uniqueColorsByClass[seg.class]) {
            uniqueColorsByClass[seg.class] = seg.color;
        }
    });
    console.log('Colors by class:', uniqueColorsByClass);
    console.log('Dataset:', currentDatasetSelect);

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
        .data(data.scarf_data) // Bind the array of participants
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
        .attr('stroke-width', 1)
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
        .attr('x', -10)
        .attr('y', d => participantScale(d.participant) + participantScale.bandwidth() / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '12px')
        .style('cursor', 'pointer') // Indicate clickable
        .style('fill','var(--color-secondary)')
        .text(d => 'part-' + d.participant + ' ('+d.score+')');

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

    // Crear leyenda con los main_class únicos
            const classes = [];
            const legendContainer = document.getElementById('scarf-plot-legend');
            legendContainer.innerHTML = "";

            data.scarf_data.forEach(participant => {
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
            btnLegend.className = 'btn btn-ghost btn-sm text-right pointer-events-none h-full w-1/'+(classes.length+1);;
            legendContainer.append(btnLegend);

            for (let i = 0; i<classes.length; i++){
                var btnLegend = document.createElement('div');
                btnLegend.id = 'legend-'+ classes[i].name;
                btnLegend.className = 'btn btn-ghost btn-sm flex flex-row h-full w-1/'+(classes.length+1);
                var innerhtml = "<div class='w-1/4 h-full' style='background-color:"+ classes[i].color+"'></div>" + classes[i].name;
                btnLegend.innerHTML = innerhtml;

                // MODIFICACIÓN: Agregar evento click para cross-filtering
                btnLegend.style.cursor = 'pointer';
                btnLegend.addEventListener('click', function() {
                    const className = classes[i].name;

                    // Toggle: si ya está seleccionada, deselecciona; sino, selecciona
                    if (window.selectedClass === className) {
                        window.selectedClass = null;
                    } else {
                        window.selectedClass = className;
                    }

                    // Llamar a función global que actualiza heatmap, scarf plot y segmentación
                    updateHighlightsGlobal();

                    console.log('Selected class from legend:', window.selectedClass);
                });

                legendContainer.append(btnLegend);
            }
            
            
}


function loadScarfPlot(imageId, dataType = 'gaze') {
            const baseUrl = window.location.origin;
            const apiUrl = `${baseUrl}/api/scarf-plot/${imageId}?data_type=${dataType}&dataset_select=${currentDatasetSelect}`;

            console.log(`Cargando scarf plot desde: ${apiUrl} (data_type=${dataType}, dataset_select=${currentDatasetSelect})`);

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
                        console.log(`Scarf plot data loaded (${dataType}):`, data);
                        visualizeScarfPlot(data);
                        // updateScarfLegend(data);
                    }
                })
                .catch(error => {
                    console.error('Error loading scarf plot:', error);
                    showScarfError('Error cargando scarf plot');
                });
}

// Add event listeners
document.getElementById("img-select").addEventListener("change", function() {
    const selectedImage = this.value;
    const partSelect = document.getElementById("part-select");
    if (partSelect.value === "all") {
        if (selectedImage === "all") {
            populateSelect("part-select", allParticipants, "part");
        }
        else {
            // Fetch participants from backend (same source as heatmap/scarf plot)
            fetch(`/api/participants/${selectedImage}`)
                .then(response => response.json())
                .then(data => {
                    if (data.participants && Array.isArray(data.participants)) {
                        const parts = data.participants.map(String);
                        console.log(`Participants for image ${selectedImage}:`, parts);
                        populateSelect("part-select", parts, "part");
                    } else {
                        console.warn('No participants found for image', selectedImage);
                        populateSelect("part-select", allParticipants, "part");
                    }
                })
                .catch(error => {
                    console.error('Error fetching participants:', error);
                    // Fallback to allParticipants if fetch fails
                    populateSelect("part-select", allParticipants, "part");
                });
        }
        partSelect.value = "all";
    }
    selectedImg = this.value;
    const imgView = document.getElementById("sel-img-view");
    const imageWrapper = document.getElementById('component-1');
    if (selectedImage !== "all") {
        currentImageOriginalPath = `/static/images/images/images/${selectedImage}.jpg`;
        currentImageSegmentationPath = getSegmentationPath(selectedImage, currentDatasetSelect);
        currentImageMode = 'original';
        imgView.src = currentImageOriginalPath;

        // Resetear canvas de segmentación para la nueva imagen
        segmentationCanvas = null;
        originalSegmentationImage = null;

        // Actualizar estado de botones
        const btnOriginal = document.getElementById('btn-original');
        const btnSegmentation = document.getElementById('btn-segmentation');
        btnOriginal.classList.add('btn-primary');
        btnOriginal.classList.remove('btn-outline');
        btnSegmentation.classList.remove('btn-primary');
        btnSegmentation.classList.add('btn-outline');

        // Crear brush cuando la imagen carga
        imgView.onload = function() {
            createBrushSelection(imageWrapper, imgView);
            // Cargar todos los puntos de gaze y fixation para la imagen completa
            loadAllPointsForImage(selectedImage);
        };

        loadScarfPlot(selectedImage);
        loadHeatmap(selectedImage, currentDataType, currentHeatmapMode);
    } else {
        imgView.src = ""; // or some placeholder
        currentImageOriginalPath = null;
        currentImageSegmentationPath = null;
        segmentationCanvas = null;
        originalSegmentationImage = null;
        // Remover brush
        d3.select('#brushOverlay').remove();
    }
});

document.getElementById("img-select-v3").addEventListener("change", function() {
    const partSelect = document.getElementById("part-select-v3");
    selectedImgV3 = this.value;


    populateSelect('part-select-v3', imgPartIndex[selectedImgV3], 'part', all=false);
});

// Función para refetch datos cuando cambia el tipo de datos (gaze vs fixations) o dataset
function refetchAreaDataWithNewType(newDataType) {
    console.log(`%c Cambiando tipo de datos a: ${newDataType}, dataset_select: ${currentDatasetSelect}`, 'color: blue; font-weight: bold; font-size: 14px');

    // Si no hay imagen seleccionada, no podemos hacer nada
    if (!selectedImg) {
        console.log('No hay imagen seleccionada');
        return;
    }

    currentDataType = newDataType;

    // Si hay área seleccionada, refetch el área
    if (currentAnalyzedArea) {
        // Construir URL con parámetro
        const apiUrl = `/api/analyze-area/${selectedImg}?data_type=${newDataType}`;
        console.log(`URL de fetch: ${apiUrl}`);
        console.log(`Área actual: x=${currentAnalyzedArea.x}, y=${currentAnalyzedArea.y}, width=${currentAnalyzedArea.width}, height=${currentAnalyzedArea.height}`);

        // Hacer fetch con el nuevo tipo de datos
        fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                x: currentAnalyzedArea.x,
                y: currentAnalyzedArea.y,
                width: currentAnalyzedArea.width,
                height: currentAnalyzedArea.height
            })
        })
        .then(response => {
            console.log(`Response status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            console.log(`%c Datos recibidos:`, 'color: green; font-weight: bold');
            console.log(`data_type: ${data.data_type}`);
            console.log(`algorithm: ${data.algorithm}`);
            console.log(`count: ${data.count}`);
            console.log(`total_fixations_in_image: ${data.total_fixations_in_image}`);
            console.log('Datos del área con nuevo tipo:', data);
            currentAreaData = data;

            // Actualizar el glyph con los nuevos datos
            if (currentGlyph) {
                currentGlyph.update(data);
                console.log('Glyph actualizado con nuevos datos');
            }

            // Recargar heatmap con el nuevo tipo de datos
            if (selectedImg) {
                console.log(`Recargando heatmap con data_type=${newDataType}, mode=${currentHeatmapMode}`);
                loadHeatmap(selectedImg, newDataType, currentHeatmapMode);
            }

            // Recargar scarf plot con el nuevo tipo de datos
            if (selectedImg) {
                console.log(`Recargando scarf plot con data_type=${newDataType}`);
                loadScarfPlot(selectedImg, newDataType);
            }
        })
        .catch(error => {
            console.error('Error refetching data:', error);
        });
    } else {
        // Si no hay área seleccionada, solo actualiza heatmap y scarf plot
        console.log('No hay área seleccionada, actualizando solo heatmap y scarf plot');
        if (selectedImg) {
            console.log(`Recargando heatmap con data_type=${newDataType}, mode=${currentHeatmapMode}`);
            loadHeatmap(selectedImg, newDataType, currentHeatmapMode);
        }
        if (selectedImg) {
            console.log(`Recargando scarf plot con data_type=${newDataType}`);
            loadScarfPlot(selectedImg, newDataType);
        }
    }

    // IMPORTANTE: Recargar TODOS los puntos de la imagen con el nuevo tipo de datos
    if (selectedImg) {
        console.log(`Recargando todos los puntos de la imagen con data_type=${newDataType}`);
        loadAllPointsForImage(selectedImg);

        // Actualizar overlay si hay tipos que dependen de data-type (points, contour, heatmap)
        if (currentOverlayTypes && currentOverlayTypes.some(type => ['points', 'contour', 'heatmap'].includes(type))) {
            setTimeout(() => {
                console.log('Actualizando overlay después de cambiar data type a:', newDataType);
                updateOverlay();
            }, 150);
        }
    }
}

// Listener para cambios en el tipo de datos
const dataTypeSelect = document.getElementById("data-type-select");
if (dataTypeSelect) {
    console.log(`%c Data type selector found, attaching listener`, 'color: purple; font-weight: bold');
    dataTypeSelect.addEventListener("change", function() {
        const newDataType = this.value;
        console.log(`%c DATA TYPE SELECTOR CHANGED - New value: ${newDataType}`, 'color: red; font-weight: bold; font-size: 12px');
        refetchAreaDataWithNewType(newDataType);
    });
} else {
    console.error("Data type selector NOT found!");
}

const datasetSelect = document.getElementById("data-set-select");
if (datasetSelect) {
    console.log(`%c Data set selector found, attaching listener`, 'color: purple; font-weight: bold');
    datasetSelect.addEventListener("change", function() {
        currentDatasetSelect = this.value;
        console.log(`%c DATA SET SELECTOR CHANGED - New value: ${currentDatasetSelect}`, 'color: blue; font-weight: bold; font-size: 12px');

        // Si hay una imagen seleccionada, recargar visualizaciones
        if (selectedImg) {
            console.log(`Reloading heatmap and scarf plot with dataset_select=${currentDatasetSelect}, mode=${currentHeatmapMode}`);

            // Actualizar ruta de segmentación
            currentImageSegmentationPath = getSegmentationPath(selectedImg, currentDatasetSelect);
            console.log(`Updated segmentation path: ${currentImageSegmentationPath}`);

            // Resetear canvas de segmentación para forzar recarga
            segmentationCanvas = null;
            originalSegmentationImage = null;

            // Si estamos en modo segmentación, recargar la imagen
            if (currentImageMode === 'segmentation') {
                const imgView = document.getElementById('sel-img-view');
                imgView.src = currentImageSegmentationPath;
                console.log(`Reloaded segmentation image with new dataset`);
            }

            loadHeatmap(selectedImg, currentDataType, currentHeatmapMode);
            loadScarfPlot(selectedImg, currentDataType);

            // Si hay un área seleccionada, también refetch del área
            if (currentAnalyzedArea) {
                refetchAreaDataWithNewType(currentDataType);
            }
        } else {
            console.log('No hay imagen seleccionada para actualizar');
        }
    });
} else {
    console.error("Data set selector NOT found!");
}

document.getElementById("part-select").addEventListener("change", function() {
    selectedPart = this.value;
    console.log("Selected participant:", selectedPart);

    // Actualizar overlay si hay tipos seleccionados
    if (currentOverlayTypes && currentOverlayTypes.length > 0) {
        updateOverlay();
    }
});

document.getElementById("part-select-v2").addEventListener("change", function() {
    // alert("Selected participant: " + this.value);
    selectedPartV2 = this.value;
    loadAttentionHeatmap(selectedPartV2);
});

document.getElementById("part-select-v3").addEventListener("change", function() {
    selectedPartV3 = this.value;
    const imgView = document.getElementById("sel-img-view-v3");
    currentImageOriginalPath = `/static/images/images/images/${selectedImgV3}.jpg`;
    //currentImageSegmentationPath = `/static/images/images/images_seg/${selectedImgV3}.jpeg`;
    currentImageSegmentationPath = `/static/images/images/images_seg/${selectedImgV3}.png`;

    currentImageMode = 'original';
    imgView.src = currentImageOriginalPath;

    document.getElementById("sel-img-id-v3").innerHTML = "Image: " + selectedImgV3;
    document.getElementById("sel-part-id-v3").innerHTML = "Participant: " + selectedPartV3;
});


// Listener para cambios en los checkboxes de overlay
const overlayCheckboxes = document.querySelectorAll('.overlay-checkbox');
if (overlayCheckboxes.length > 0) {
    console.log('Overlay checkboxes found:', overlayCheckboxes.length, 'attaching listeners');

    overlayCheckboxes.forEach(checkbox => {
        checkbox.addEventListener("change", function() {
            // Obtener todos los checkboxes marcados
            const checkedBoxes = document.querySelectorAll('.overlay-checkbox:checked');
            const selectedOptions = Array.from(checkedBoxes).map(cb => cb.value);

            console.log('Overlay types changed to:', selectedOptions, 'data type:', currentDataType);
            currentOverlayTypes = selectedOptions;

            // Si no hay puntos cargados aún, cargar todos los puntos para la imagen actual
            if (selectedImg && (currentGazePoints.length === 0 && currentFixationPoints.length === 0)) {
                console.log('Points not loaded yet, loading for selected image:', selectedImg);
                loadAllPointsForImage(selectedImg);
            } else {
                // Si ya están cargados, solo actualizar la visualización
                updateOverlay();
            }
        });
    });
} else {
    console.error("Overlay checkboxes NOT found!");
}

// Agregar manejador para el selector de modo de heatmap (Attention vs Time)
const heatmapModeSelector = document.getElementById("heatmap-mode-sel");
if (heatmapModeSelector) {
    heatmapModeSelector.addEventListener("change", function() {
        const newMode = this.value.toLowerCase();
        console.log('Heatmap mode changed to:', newMode);
        currentHeatmapMode = newMode;

        // Si hay una imagen seleccionada en la pestaña Img/Part, recargar el heatmap con el nuevo modo
        if (selectedImg) {
            loadHeatmap(selectedImg, currentDataType, newMode);
        }
    });
} else {
    console.warn("Heatmap mode selector NOT found!");
}



document.getElementById("heatmap-normalize").addEventListener("change", (e) => {
  const normalize = e.target.checked;
  if (attentionHeatmapData != null){
    visualizeAttentionHeatmap(attentionHeatmapData, normalize);
  }
});