// overlay.js - gaze/fixation overlay, contour, heatmap rendering

const overlayLog = window.debugLog || function(...args) {
    if (window.DEBUG_LOGS) {
        console.log(...args);
    }
};
let lastOverlayRenderSignature = null;
const precomputedOverlayCache = new Map();
const precomputedOverlayDataCache = new Map();
let precomputedOverlayDataRequestToken = 0;

function buildParticipantPointIndex(points) {
    const index = new Map();
    (points || []).forEach(point => {
        const key = String(point.participante ?? point.participant ?? '');
        if (!key || key === 'null' || key === 'undefined') return;
        if (!index.has(key)) {
            index.set(key, []);
        }
        index.get(key).push(point);
    });
    return index;
}

function getPointsForParticipant(allPoints, participantId, indexMap) {
    if (!participantId || participantId === 'all') {
        return allPoints || [];
    }
    if (!indexMap || typeof indexMap.get !== 'function') {
        return (allPoints || []).filter(point => String(point.participante || point.participant) === String(participantId));
    }
    return indexMap.get(String(participantId)) || [];
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

        imageWrapper.querySelectorAll('img.precomputed-overlay').forEach(el => el.remove());
    }

    overlayLog('Cleared overlay points, contours and heatmap');
}




function drawContoursFromPrecomputedData(contoursPayload, dataType) {
    const imageWrapper = document.getElementById('component-1');
    const img = document.getElementById('sel-img-view');
    if (!imageWrapper || !img) return;

    d3.select(imageWrapper).select('svg.contour-svg').remove();

    const levels = contoursPayload?.levels || [];
    if (!levels.length) return;

    const imgRect = img.getBoundingClientRect();
    const containerRect = imageWrapper.getBoundingClientRect();
    const imgWidth = imgRect.width;
    const imgHeight = imgRect.height;
    const imgOffsetTop = imgRect.top - containerRect.top;
    const imgOffsetLeft = imgRect.left - containerRect.left;

    const svg = d3.select(imageWrapper)
        .append('svg')
        .attr('class', 'contour-svg')
        .attr('width', imgWidth)
        .attr('height', imgHeight)
        .style('position', 'absolute')
        .style('top', imgOffsetTop + 'px')
        .style('left', imgOffsetLeft + 'px')
        .style('pointer-events', 'none')
        .style('z-index', '1196');

    const scaleX = imgWidth / 800;
    const scaleY = imgHeight / 600;
    const lineGenerator = d3.line()
        .x(d => d[0] * scaleX)
        .y(d => d[1] * scaleY)
        .curve(d3.curveLinearClosed);

    const paths = [];
    levels.forEach(levelObj => {
        const level = Number(levelObj?.level) || 0;
        (levelObj?.paths || []).forEach(path => {
            if (Array.isArray(path) && path.length >= 3) {
                paths.push({ level, path });
            }
        });
    });

    const strokeColor = dataType === 'gaze' ? 'red' : 'orange';
    svg.selectAll('path')
        .data(paths)
        .join('path')
        .attr('d', d => lineGenerator(d.path))
        .attr('fill', 'none')
        .attr('stroke', strokeColor)
        .attr('stroke-width', 2)
        .attr('opacity', 0.8);
}

function drawHeatmapFromPrecomputedData(heatmapPayload, dataType) {
    void dataType;
    const imageWrapper = document.getElementById('component-1');
    const img = document.getElementById('sel-img-view');
    if (!imageWrapper || !img) return;

    const width = Number(heatmapPayload?.width) || 0;
    const height = Number(heatmapPayload?.height) || 0;
    const values = heatmapPayload?.values || [];
    if (width <= 0 || height <= 0 || !Array.isArray(values) || values.length !== width * height) {
        return;
    }

    const existingCanvas = imageWrapper.querySelector('canvas.heatmap-canvas');
    if (existingCanvas) {
        existingCanvas.remove();
    }

    const imgRect = img.getBoundingClientRect();
    const containerRect = imageWrapper.getBoundingClientRect();
    const imgWidth = imgRect.width;
    const imgHeight = imgRect.height;
    const imgOffsetTop = imgRect.top - containerRect.top;
    const imgOffsetLeft = imgRect.left - containerRect.left;

    const canvas = document.createElement('canvas');
    canvas.className = 'heatmap-canvas';
    canvas.width = imgWidth;
    canvas.height = imgHeight;
    canvas.style.position = 'absolute';
    canvas.style.top = imgOffsetTop + 'px';
    canvas.style.left = imgOffsetLeft + 'px';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '1196';
    imageWrapper.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    const imageData = tempCtx.createImageData(width, height);

    for (let i = 0; i < values.length; i++) {
        const value = (Number(values[i]) || 0) / 255;
        const color = getJetColor(value);
        const idx = i * 4;
        imageData.data[idx] = color.r;
        imageData.data[idx + 1] = color.g;
        imageData.data[idx + 2] = color.b;
        imageData.data[idx + 3] = color.a;
    }

    tempCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0, width, height, 0, 0, imgWidth, imgHeight);
}

function drawContoursOverlay(points, dataType) {
    overlayLog('Drawing contours overlay for', dataType, ':', points.length, 'points');

    if (!points || points.length === 0) {
        overlayLog('No points to draw contours');
        return;
    }

    const imageWrapper = document.getElementById('component-1');
    const img = document.getElementById('sel-img-view');
    if (!imageWrapper || !img) {
        overlayLog('Cannot draw contours - missing elements');
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
        .style('z-index', '1196');

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

    overlayLog('Creating density contours from', contourPoints.length, 'scaled points');

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

    overlayLog('✓ Contours drawn:', contours.length, 'contour lines');
}

function drawHeatmapOverlay(points, dataType) {
    overlayLog('Drawing heatmap overlay for', dataType, ':', points.length, 'points');

    if (!points || points.length === 0) {
        overlayLog('No points to draw heatmap');
        return;
    }

    const imageWrapper = document.getElementById('component-1');
    const img = document.getElementById('sel-img-view');
    if (!imageWrapper || !img) {
        overlayLog('Cannot draw heatmap - missing elements');
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
    canvas.style.zIndex = '1196';
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

    overlayLog('✓ Heatmap drawn with', points.length, 'points at', resolutionScale + 'x resolution');
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
    overlayLog('Visualizing gaze points overlay:', currentGazePoints.length);

    if (!currentGazePoints || currentGazePoints.length === 0) {
        overlayLog('No gaze points to visualize');
        return;
    }

    const overlayContainer = document.getElementById('overlay-points-container');
    const img = document.getElementById('sel-img-view');
    const component1 = document.getElementById('component-1');

    if (!overlayContainer || !img || !component1) {
        overlayLog('Missing overlay container, image or component-1');
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

    overlayLog(`=== Gaze Points Overlay Debug ===`);
    overlayLog(`Data coordinate space: ${dataSpaceWidth}x${dataSpaceHeight}`);
    overlayLog(`Display size: ${imgRect.width}x${imgRect.height}`);
    overlayLog(`Scale factors: X=${scaleFactorX.toFixed(3)}, Y=${scaleFactorY.toFixed(3)}`);
    overlayLog(`Total gaze points to render: ${currentGazePoints.length}`);

    // Si hay un segmento de scarf plot seleccionado, pintar los puntos con su color
    let selectedSegmentPointColor = null;
    if (currentScarfSegment && currentScarfSegment.color) {
        const parsedColor = d3.color(currentScarfSegment.color);
        if (parsedColor) {
            parsedColor.opacity = 0.7;
            selectedSegmentPointColor = parsedColor.formatRgb();
        } else {
            selectedSegmentPointColor = currentScarfSegment.color;
        }
        overlayLog(`Using scarf segment color for gaze points: ${selectedSegmentPointColor}`);
    }

    const fragment = document.createDocumentFragment();

    currentGazePoints.forEach((point, index) => {
        const gazeElement = document.createElement('div');
        gazeElement.className = 'gaze-point';

        // Scale coordinates from data space (800x600) to display space
        // Invert Y axis: data has Y=0 at bottom, screen has Y=0 at top
        const scaledX = point.x * scaleFactorX;
        const scaledY = (dataSpaceHeight - point.y) * scaleFactorY;

        if (index < 3) {
            overlayLog(`=== Gaze Point ${index} ===`);
            overlayLog(`  Original coords: (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`);
            overlayLog(`  Scaled position: (${scaledX.toFixed(1)}, ${scaledY.toFixed(1)})`);
        }

        gazeElement.style.left = scaledX + 'px';
        gazeElement.style.top = scaledY + 'px';

        // Aplicar color del segmento seleccionado (si existe)
        if (selectedSegmentPointColor) {
            gazeElement.style.background = selectedSegmentPointColor;
            gazeElement.style.border = '1px solid #000';
            gazeElement.style.boxSizing = 'border-box';
        }

        fragment.appendChild(gazeElement);
    });

    overlayContainer.appendChild(fragment);
    overlayLog(`✓ Rendered ${currentGazePoints.length} gaze points`);
    overlayLog(`  Overlay container now has ${overlayContainer.children.length} children`);
}

function visualizeFixationPointsOverlay() {
    overlayLog('Visualizing fixation points overlay:', currentFixationPoints.length);

    if (!currentFixationPoints || currentFixationPoints.length === 0) {
        overlayLog('No fixation points to visualize');
        return;
    }

    const overlayContainer = document.getElementById('overlay-points-container');
    const img = document.getElementById('sel-img-view');
    const component1 = document.getElementById('component-1');

    if (!overlayContainer || !img || !component1) {
        overlayLog('Missing overlay container, image or component-1');
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

    overlayLog(`=== Fixation Overlay Debug ===`);
    overlayLog(`Data coordinate space: ${dataSpaceWidth}x${dataSpaceHeight}`);
    overlayLog(`Display size: ${imgRect.width}x${imgRect.height}`);
    overlayLog(`Scale factors: X=${scaleFactorX.toFixed(3)}, Y=${scaleFactorY.toFixed(3)}`);

    const fragment = document.createDocumentFragment();

    currentFixationPoints.forEach((point, index) => {
        const fixationElement = document.createElement('div');
        fixationElement.className = 'fixation-point';

        // Scale coordinates from data space (800x600) to display space
        // Invertir Y para ser consistente con gaze points
        const scaledX = point.x * scaleFactorX;
        const scaledY = (dataSpaceHeight - point.y) * scaleFactorY;

        if (index < 3) {
            overlayLog(`=== Fixation Point ${index} ===`);
            overlayLog(`  Original coords: (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`);
            overlayLog(`  Scaled position: (${scaledX.toFixed(1)}, ${scaledY.toFixed(1)})`);
            overlayLog(`  Duration: ${point.duration?.toFixed(3) || 0}s`);
        }

        fixationElement.style.left = scaledX + 'px';
        fixationElement.style.top = scaledY + 'px';

        // Tamaño basado en duración (también escalado para mantener proporción)
        const size = Math.max(8, Math.min(point.duration / 30, 20)) * Math.min(scaleFactorX, scaleFactorY);
        fixationElement.style.width = size + 'px';
        fixationElement.style.height = size + 'px';

        // Usar el color del segmento del scarf plot si está disponible
        if (currentScarfSegment && currentScarfSegment.color) {
            fixationElement.style.background = currentScarfSegment.color;
            fixationElement.style.borderColor = '#000';
            fixationElement.style.borderWidth = '2px';
            fixationElement.style.boxSizing = 'border-box';
            fixationElement.style.opacity = '0.95';
        }

        fragment.appendChild(fixationElement);
    });

    overlayContainer.appendChild(fragment);
    overlayLog('Rendered', currentFixationPoints.length, 'fixation points in overlay container');
}

function filterPointsByParticipant(allPoints, participantId) {
    return getPointsForParticipant(allPoints, participantId, null);
}

function updateOverlay() {
    overlayLog('updateOverlay called with types:', currentOverlayTypes, 'data type:', currentDataType, 'participant:', selectedPart);
    const imgView = document.getElementById('sel-img-view');
    const segView = getSegmentationLayerImage();

    // Si no hay overlays seleccionados, no aplicar overlays
    if (!currentOverlayTypes || currentOverlayTypes.length === 0) {
        clearOverlayPoints();
        lastOverlayRenderSignature = null;
        if (imgView) imgView.style.opacity = '1';
        if (segView) segView.style.opacity = currentImageBlendPercent <= 0 ? '0' : '1';
        return;
    }

    if (imgView) {
        imgView.style.opacity = window.brushSelection ? '1' : '0.2';
    }
    if (segView) {
        segView.style.opacity = currentImageBlendPercent <= 0 ? '0' : (window.brushSelection ? '1' : '0.2');
    }

    const gazeToVisualize = getPointsForParticipant(allGazePointsWithParticipant, selectedPart, gazePointsByParticipant);
    const fixationsToVisualize = getPointsForParticipant(allFixationPointsWithParticipant, selectedPart, fixationPointsByParticipant);

    const imgRect = imgView ? imgView.getBoundingClientRect() : null;
    const currentSignature = JSON.stringify({
        types: (currentOverlayTypes || []).slice().sort(),
        dataType: currentDataType,
        participant: selectedPart || 'all',
        gazeLen: gazeToVisualize.length,
        fixationLen: fixationsToVisualize.length,
        width: imgRect ? Math.round(imgRect.width) : 0,
        height: imgRect ? Math.round(imgRect.height) : 0,
        scarfSegment: currentScarfSegment ? `${currentScarfSegment.participant}:${currentScarfSegment.start_time}:${currentScarfSegment.end_time}` : ''
    });
    if (currentSignature === lastOverlayRenderSignature) {
        return;
    }
    lastOverlayRenderSignature = currentSignature;

    clearOverlayPoints();
    currentGazePoints = gazeToVisualize;
    currentFixationPoints = fixationsToVisualize;

    currentOverlayTypes.forEach(overlayType => {
        if (overlayType === 'points') {
            if (currentDataType === 'gaze') {
                visualizeGazePointsOverlay();
            } else if (currentDataType === 'fixations') {
                visualizeFixationPointsOverlay();
            }
        } else if (overlayType === 'contour') {
            if (currentDataType === 'gaze') {
                drawContoursOverlay(gazeToVisualize, 'gaze');
            } else if (currentDataType === 'fixations') {
                drawContoursOverlay(fixationsToVisualize, 'fixations');
            }
        } else if (overlayType === 'heatmap') {
            if (currentDataType === 'gaze') {
                drawHeatmapOverlay(gazeToVisualize, 'gaze');
            } else if (currentDataType === 'fixations') {
                drawHeatmapOverlay(fixationsToVisualize, 'fixations');
            }
        }
    });
}

function loadAllPointsForImage(imageId) {
    overlayLog('Loading all points for image:', imageId, 'with data type:', currentDataType);

    if (!imageId) {
        overlayLog('No image ID provided');
        return;
    }

    const dataSpaceWidth = 800;
    const dataSpaceHeight = 600;
    overlayLog(`Using data coordinate space: ${dataSpaceWidth}x${dataSpaceHeight}`);

    fetch(`/api/analyze-area/${imageId}?data_type=${currentDataType}&include_all_data=true`, {
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
        overlayLog('All points loaded for image:', imageId);

        clearOverlayPoints();
        lastOverlayRenderSignature = null;

        if (data.gaze_points && Array.isArray(data.gaze_points)) {
            allGazePointsWithParticipant = data.gaze_points.map(point => {
                const rawX = point.x_centroid || point.pixelX || point.x || 0;
                const rawY = point.y_centroid || point.pixelY || point.y || 0;
                const rawTime = point.Time || point.time || 0;
                const timeSec = Number(rawTime) < 100 ? Number(rawTime) : Number(rawTime) / 1000;

                return {
                    x: rawX,
                    y: rawY,
                    participante: point.participante || point.participant || null,
                    time: rawTime,  // Timestamp para filtrado temporal
                    timeSec: Number.isFinite(timeSec) ? timeSec : 0
                };
            });
            gazePointsByParticipant = buildParticipantPointIndex(allGazePointsWithParticipant);
            overlayLog('Loaded all gaze points:', allGazePointsWithParticipant.length);
            if (allGazePointsWithParticipant.length > 0) {
                overlayLog('Sample gaze point:', allGazePointsWithParticipant[0]);
            }
        }

        if (data.fixations && Array.isArray(data.fixations)) {
            allFixationPointsWithParticipant = data.fixations.map(point => {
                const rawX = point.x_centroid || point.x || 0;
                const rawY = point.y_centroid || point.y || 0;
                const rawStart = point.start || point.start_time || 0;
                const rawEnd = point.end || point.end_time || 0;
                const startSec = Number(rawStart) < 100 ? Number(rawStart) : Number(rawStart) / 1000;
                const endSec = Number(rawEnd) < 100 ? Number(rawEnd) : Number(rawEnd) / 1000;

                return {
                    x: rawX,  // Keep native coordinates (800x600)
                    y: rawY,
                    duration: point.duration || 0,
                    participante: point.participante || point.participant || null,
                    start: rawStart,  // Timestamp de inicio
                    end: rawEnd,  // Timestamp de fin
                    startSec: Number.isFinite(startSec) ? startSec : 0,
                    endSec: Number.isFinite(endSec) ? endSec : 0
                };
            });
            fixationPointsByParticipant = buildParticipantPointIndex(allFixationPointsWithParticipant);
            overlayLog('Loaded all fixation points:', allFixationPointsWithParticipant.length);
            if (allFixationPointsWithParticipant.length > 0) {
                overlayLog('Sample fixation point:', allFixationPointsWithParticipant[0]);
            }
        }

        if (currentOverlayTypes && currentOverlayTypes.length > 0) {
            updateOverlay();
        }
    })
    .catch(error => {
        console.error('Error loading all points for image:', error);
    });
}

function alignOverlayWithImage() {
    const overlayContainer = document.getElementById('overlay-points-container');
    const img = document.getElementById('sel-img-view');
    const component1 = document.getElementById('component-1');

    if (!overlayContainer || !img || !component1) {
        overlayLog('Cannot align overlay - missing elements');
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

    overlayLog(`=== Overlay Alignment ===`);
    overlayLog(`Image position: (${relativeLeft}, ${relativeTop})`);
    overlayLog(`Image display size: ${displayWidth}x${displayHeight}`);
    overlayLog(`Data coordinate space: ${dataSpaceWidth}x${dataSpaceHeight}`);
    overlayLog(`Scale factor: ${displayWidth / dataSpaceWidth}`);
}

