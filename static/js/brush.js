// brush.js — circular brush selection, glyph tooltip, area analysis

function createBrushSelection(imageWrapper, img) {
    console.log('Creando selector circular para selección de área...');

    // Remover selector anterior si existe
    d3.select('#brushOverlay').remove();
    d3.select('#outsideDimLayer').remove();
    d3.select('#glyphTooltip').remove();
    currentGlyph = null;
    window.brushActive = false;
    window.brushSelection = null;
    circleSelectionState = null;
    if (circleSelectionDebounceTimer) {
        clearTimeout(circleSelectionDebounceTimer);
        circleSelectionDebounceTimer = null;
    }
    if (areaAnalysisAbortController) {
        areaAnalysisAbortController.abort();
        areaAnalysisAbortController = null;
    }
    lastAreaAnalysisSignature = null;

    // Esperar a que la imagen cargue completamente
    if (!img.complete || img.naturalWidth === 0) {
        console.log('Esperando a que cargue la imagen...');
        setTimeout(() => createBrushSelection(imageWrapper, img), 100);
        return;
    }

    const DATA_WIDTH = 800;
    const DATA_HEIGHT = 600;

    // Usar el tamaño visual real del img (post-transform) para evitar desalineaciones
    const imgRect = img.getBoundingClientRect();
    const wrapperRect = imageWrapper.getBoundingClientRect();
    const imgWidth = imgRect.width;
    const imgHeight = imgRect.height;
    const svgOffsetLeft = imgRect.left - wrapperRect.left;
    const svgOffsetTop = imgRect.top - wrapperRect.top;
    const overlayPad = 2; // Compensa seams de subpíxel en bordes
    const overlayWidth = Math.max(1, wrapperRect.width + overlayPad);
    const overlayHeight = Math.max(1, wrapperRect.height + overlayPad);

    const outsideDimLayer = d3.select(imageWrapper)
        .append('div')
        .attr('id', 'outsideDimLayer')
        .style('position', 'absolute')
        .style('top', '0px')
        .style('left', '0px')
        .style('width', overlayWidth + 'px')
        .style('height', overlayHeight + 'px')
        .style('pointer-events', 'none')
        .style('z-index', '1190')
        .style('display', 'none')
        .style('background', 'transparent');

    const svgContainer = d3.select(imageWrapper)
        .append('svg')
        .attr('id', 'brushOverlay')
        .attr('width', overlayWidth)
        .attr('height', overlayHeight)
        .style('position', 'absolute')
        .style('top', '0px')
        .style('left', '0px')
        .style('width', overlayWidth + 'px')
        .style('height', overlayHeight + 'px')
        .style('pointer-events', 'all')
        .style('z-index', '1200')
        .style('transform', 'none')
        .style('transform-origin', 'center center')
        .style('cursor', 'default');

    const outsideDimPath = svgContainer.append('path')
        .attr('class', 'circle-selection-dim')
        .style('fill', `rgba(255, 255, 255, ${OUTSIDE_DIM_OPACITY})`)
        .style('fill-rule', 'evenodd')
        .style('pointer-events', 'none')
        .style('display', 'none');

    const minRadiusDisplay = Math.max(4, Math.min(24, (Math.min(imgWidth, imgHeight) / 2) - 2));
    const defaultRadius = Math.max(minRadiusDisplay, Math.min(imgWidth, imgHeight) * 0.15);

    const selectionState = {
        cx: imgWidth / 2,
        cy: imgHeight / 2,
        radius: defaultRadius
    };
    circleSelectionState = selectionState;

    // Restaurar última selección circular cuando existe
    if (currentAnalyzedArea && currentAnalyzedArea.shape === 'circle') {
        const screenScaleX = imgWidth / DATA_WIDTH;
        const screenScaleY = imgHeight / DATA_HEIGHT;
        const restoredCenterX = currentAnalyzedArea.center_x;
        const restoredCenterY = currentAnalyzedArea.center_y;
        const restoredRadius = currentAnalyzedArea.radius;

        if (Number.isFinite(restoredCenterX) && Number.isFinite(restoredCenterY) && Number.isFinite(restoredRadius)) {
            selectionState.cx = restoredCenterX * screenScaleX;
            selectionState.cy = (DATA_HEIGHT - restoredCenterY) * screenScaleY;
            selectionState.radius = restoredRadius * ((screenScaleX + screenScaleY) / 2);
        }
    }

    let userHasInteracted = false;

    function clampSelection() {
        // Permitir mover el círculo parcialmente fuera de la imagen para cubrir costados/esquinas
        const overflowX = Math.max(40, Math.round(imgWidth * 0.4));
        const overflowY = Math.max(40, Math.round(imgHeight * 0.4));

        selectionState.cx = Math.max(-overflowX, Math.min(imgWidth + overflowX, selectionState.cx));
        selectionState.cy = Math.max(-overflowY, Math.min(imgHeight + overflowY, selectionState.cy));

        // Limitar radio con un máximo amplio (ya no forzamos que el círculo quede totalmente dentro)
        const maxRadius = Math.max(
            minRadiusDisplay,
            Math.hypot(imgWidth + overflowX, imgHeight + overflowY)
        );
        selectionState.radius = Math.max(minRadiusDisplay, Math.min(selectionState.radius, maxRadius));
    }

    function toCircleAreaData() {
        const dataScaleX = DATA_WIDTH / imgWidth;
        const dataScaleY = DATA_HEIGHT / imgHeight;

        const centerX = Math.round(selectionState.cx * dataScaleX);
        const centerY = Math.round(DATA_HEIGHT - (selectionState.cy * dataScaleY));
        const radius = Math.max(1, Math.round(selectionState.radius * ((dataScaleX + dataScaleY) / 2)));

        const width = radius * 2;
        const height = radius * 2;
        const x = Math.max(0, centerX - radius);
        const y = Math.max(0, centerY - radius);

        return {
            shape: 'circle',
            center_x: centerX,
            center_y: centerY,
            radius: radius,
            x: x,
            y: y,
            width: width,
            height: height
        };
    }

    function scheduleAreaAnalysis(immediate = false) {
        if (!userHasInteracted) return;

        const runAnalysis = () => {
            const area = toCircleAreaData();
            window.brushSelection = [[area.x, area.y], [area.x + area.width, area.y + area.height]];
            const imgView = document.getElementById('sel-img-view');
            if (imgView && currentOverlayTypes && currentOverlayTypes.length > 0) {
                imgView.style.opacity = '1';
            }
            analyzeSelectedArea(area);
        };

        if (immediate) {
            if (circleSelectionDebounceTimer) {
                clearTimeout(circleSelectionDebounceTimer);
                circleSelectionDebounceTimer = null;
            }
            runAnalysis();
            return;
        }

        if (circleSelectionDebounceTimer) {
            clearTimeout(circleSelectionDebounceTimer);
        }
        circleSelectionDebounceTimer = setTimeout(runAnalysis, 220);
    }

    function enableClearButton() {
        setClearButtonEnabled(true);
    }

    function clearAreaAnalysisVisualsDuringDrag() {
        // Cancelar timers/requests para que no reaparezcan estadísticas viejas durante el movimiento.
        if (circleSelectionDebounceTimer) {
            clearTimeout(circleSelectionDebounceTimer);
            circleSelectionDebounceTimer = null;
        }
        if (areaAnalysisAbortController) {
            areaAnalysisAbortController.abort();
            areaAnalysisAbortController = null;
        }
        areaAnalysisRequestCounter += 1;
        lastAreaAnalysisSignature = null;

        // Limpiar elementos estadísticos vinculados al área actual.
        currentAnalyzedArea = null;
        currentAreaData = null;
        d3.select('#glyphTooltip').remove();
        currentGlyph = null;
        clearHeatmapAreaFrames();
        clearScarfAreaSelectionHighlight();

        // Mantener únicamente highlights globales de participante (si existen).
        if (selectedPart !== null && selectedPart !== undefined && selectedPart !== 'all' && selectedPart !== '') {
            highlightParticipantColumnInHeatmap(selectedPart);
            highlightParticipantInScarf(selectedPart);
        } else {
            removeParticipantColumnHighlight();
        }
    }

    const selectionHitArea = svgContainer.append('circle')
        .attr('class', 'circle-selection-hit')
        .style('fill', 'transparent')
        .style('cursor', 'move');

    const selectionCircle = svgContainer.append('circle')
        .attr('class', 'circle-selection-shape')
        .style('fill', 'transparent')
        .style('stroke', '#D55E00') // Okabe-Ito vermilion — visible on photo backgrounds
        .style('stroke-width', '1.5px')
        .style('pointer-events', 'none');

    const resizeHandle = svgContainer.append('rect')
        .attr('class', 'circle-selection-handle')
        .attr('rx', 2)
        .attr('ry', 2)
        .style('fill', '#000')
        .style('cursor', 'ns-resize')
        .style('pointer-events', 'all');

    function renderSelector() {
        clampSelection();

        const isVisible = userHasInteracted ? 'block' : 'none';
        svgContainer.style('cursor', userHasInteracted ? 'default' : 'crosshair');
        const screenCx = svgOffsetLeft + selectionState.cx;
        const screenCy = svgOffsetTop + selectionState.cy;

        selectionHitArea
            .attr('cx', screenCx)
            .attr('cy', screenCy)
            .attr('r', selectionState.radius)
            .style('display', isVisible);

        selectionCircle
            .attr('cx', screenCx)
            .attr('cy', screenCy)
            .attr('r', selectionState.radius)
            .style('display', isVisible);

        const handleWidth = Math.max(20, Math.round(selectionState.radius * 0.35));
        const handleHeight = 10;
        const marginFromCircle = 2;
        const rawHandleY = screenCy + selectionState.radius + marginFromCircle;
        const handleY = Math.min(rawHandleY, (svgOffsetTop + imgHeight) - handleHeight);

        resizeHandle
            .attr('x', screenCx - (handleWidth / 2))
            .attr('y', handleY)
            .attr('width', handleWidth)
            .attr('height', handleHeight)
            .style('display', isVisible);

        const diameter = selectionState.radius * 2;
        const maskPath = [
            `M0,0 H${overlayWidth} V${overlayHeight} H0 Z`,
            `M${screenCx - selectionState.radius},${screenCy}`,
            `a${selectionState.radius},${selectionState.radius} 0 1,0 ${diameter},0`,
            `a${selectionState.radius},${selectionState.radius} 0 1,0 -${diameter},0`
        ].join(' ');

        outsideDimLayer
            .style('display', userHasInteracted ? 'block' : 'none')
            .style(
                'background',
                `radial-gradient(circle at ${screenCx}px ${screenCy}px, rgba(255,255,255,0) ${selectionState.radius}px, rgba(255,255,255,${OUTSIDE_DIM_OPACITY}) ${selectionState.radius + 1}px)`
            );

        outsideDimPath
            .attr('d', maskPath)
            .style('display', 'none');
    }

    const moveDrag = d3.drag()
        .on('start', function() {
            window.brushActive = true;
            userHasInteracted = true;
            enableClearButton();
            clearAreaAnalysisVisualsDuringDrag();
        })
        .on('drag', function(event) {
            const [mx, my] = d3.pointer(event, svgContainer.node());
            selectionState.cx = mx - svgOffsetLeft;
            selectionState.cy = my - svgOffsetTop;
            renderSelector();
        })
        .on('end', function() {
            window.brushActive = false;
            scheduleAreaAnalysis(true);
        });

    const resizeDrag = d3.drag()
        .on('start', function() {
            window.brushActive = true;
            userHasInteracted = true;
            enableClearButton();
            clearAreaAnalysisVisualsDuringDrag();
        })
        .on('drag', function(event) {
            const [mx, my] = d3.pointer(event, svgContainer.node());
            const localX = mx - svgOffsetLeft;
            const localY = my - svgOffsetTop;
            const dx = localX - selectionState.cx;
            const dy = localY - selectionState.cy;
            selectionState.radius = Math.sqrt((dx * dx) + (dy * dy));
            renderSelector();
        })
        .on('end', function() {
            window.brushActive = false;
            scheduleAreaAnalysis(true);
        });

    selectionHitArea.call(moveDrag);
    resizeHandle.call(resizeDrag);

    function clearCircleSelection() {
        console.log('Limpiando selector circular');

        if (circleSelectionDebounceTimer) {
            clearTimeout(circleSelectionDebounceTimer);
            circleSelectionDebounceTimer = null;
        }
        if (areaAnalysisAbortController) {
            areaAnalysisAbortController.abort();
            areaAnalysisAbortController = null;
        }

        window.brushSelection = null;
        currentAnalyzedArea = null;
        currentAreaData = null;
        lastAreaAnalysisSignature = null;
        d3.select('#glyphTooltip').remove();
        currentGlyph = null;

        clearOverlayPoints();
        removeBoundingBoxOverlay();
        removeParticipantColumnHighlight();
        clearHeatmapAreaFrames();
        removeScarfSegmentHighlight();
        currentScarfSegment = null;

        const overlayCheckboxes = document.querySelectorAll('.overlay-checkbox');
        overlayCheckboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
        currentOverlayTypes = [];
        updateOverlay();

        userHasInteracted = false;
        selectionState.cx = imgWidth / 2;
        selectionState.cy = imgHeight / 2;
        selectionState.radius = defaultRadius;
        renderSelector();

        setClearButtonEnabled(false);

        console.log('Selector circular, tooltip y estado limpiados');
    }

    svgContainer.on('click.circleSelectionActivate', function(event) {
        if (window.brushActive || userHasInteracted) return;
        const [mx, my] = d3.pointer(event, svgContainer.node());
        const localX = mx - svgOffsetLeft;
        const localY = my - svgOffsetTop;
        if (localX < 0 || localX > imgWidth || localY < 0 || localY > imgHeight) return;
        selectionState.cx = localX;
        selectionState.cy = localY;
        userHasInteracted = true;
        enableClearButton();
        renderSelector();
        scheduleAreaAnalysis(true);
    });

    svgContainer.on('dblclick.circleSelectionClear', function(event) {
        if (!userHasInteracted) return;
        event.preventDefault();
        clearCircleSelection();
    });

    svgContainer.on('contextmenu.circleSelectionClear', function(event) {
        if (!userHasInteracted) return;
        event.preventDefault();
        clearCircleSelection();
    });

    renderSelector();

    const btnClear = document.getElementById('clearBrushBtn');
    if (btnClear) {
        btnClear.onclick = clearCircleSelection;
    }

    const controlsContainer = document.getElementById('img-view-controls');
    if (controlsContainer && btnClear) {
        controlsContainer.append(btnClear);
    }
    console.log('Selector circular creado');
}

function analyzeSelectedArea(area) {
    const requestPayload = buildAreaRequestPayload(area);
    console.log('Analizando selección:', requestPayload);

    // Guardar el área actual para reutilizarla cuando cambie el tipo de datos
    currentAnalyzedArea = requestPayload;
    updateScarfBoundingOverlayDimMask();

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

    const currentSignature = buildAreaSignature(requestPayload, currentImage, selectedPart, dataType);
    if (currentSignature === lastAreaAnalysisSignature) {
        return;
    }
    lastAreaAnalysisSignature = currentSignature;

    // Identificador para ignorar respuestas viejas cuando hay cambios dinámicos
    const requestId = ++areaAnalysisRequestCounter;
    if (areaAnalysisAbortController) {
        areaAnalysisAbortController.abort();
    }
    areaAnalysisAbortController = new AbortController();

    // Llamar endpoint para obtener datos del área
    fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
        signal: areaAnalysisAbortController.signal
    })
    .then(response => response.json())
    .then(data => {
        if (requestId !== areaAnalysisRequestCounter) {
            console.log(`Ignorando respuesta vieja de selección (requestId=${requestId})`);
            return;
        }

        console.log('Datos del área:', data);
        currentAreaData = data; // Guardar los datos

        // NO cambiar currentGazePoints ni currentFixationPoints
        // Los puntos del overlay se cargan con toda la imagen y deben mantenerse en su posición
        // Solo usamos data_for_analysis para el glyph/tooltip

        console.log('Area selected - keeping overlay points from full image');
        console.log('Gaze points in overlay:', currentGazePoints.length);
        console.log('Fixation points in overlay:', currentFixationPoints.length);

        highlightScarfSegmentsForArea(data);
        highlightHeatmapAreaEntities(data);
        showGlyphTooltip(requestPayload, data);
    })
    .catch(error => {
        if (error && error.name === 'AbortError') {
            return;
        }
        lastAreaAnalysisSignature = null;
        console.error('Error analyzing area:', error);
    });
}

function showGlyphTooltip(area, data) {
    const imageWrapper = document.getElementById('component-1');
    const img = document.getElementById('sel-img-view');
    if (!imageWrapper || !img) return;

    // Remover contenedor anterior (ya no usamos popup externo)
    d3.select('#glyphTooltip').remove();

    const hasData = data && (
        (data.data_for_analysis && data.data_for_analysis.length > 0) ||
        (data.fixations && data.fixations.length > 0)
    );

    const imgRect = img.getBoundingClientRect();
    const wrapperRect = imageWrapper.getBoundingClientRect();
    const offsetX = imgRect.left - wrapperRect.left;
    const offsetY = imgRect.top - wrapperRect.top;
    const scaleX = imgRect.width / 800;
    const scaleY = imgRect.height / 600;

    let centerX = null;
    let centerY = null;
    let radius = null;

    if (area && area.shape === 'circle' &&
        Number.isFinite(area.center_x) &&
        Number.isFinite(area.center_y) &&
        Number.isFinite(area.radius)) {
        centerX = offsetX + (area.center_x * scaleX);
        centerY = offsetY + ((600 - area.center_y) * scaleY);
        radius = Math.max(24, area.radius * ((scaleX + scaleY) / 2));
    } else if (circleSelectionState) {
        centerX = offsetX + circleSelectionState.cx;
        centerY = offsetY + circleSelectionState.cy;
        radius = Math.max(24, circleSelectionState.radius);
    } else {
        return;
    }

    const selectionRadius = Math.max(24, radius);

    // El círculo rojo (selección) debe quedar entre el anillo de sectores y las barras externas
    const ringBoundaryRadius = selectionRadius;
    const ring1OuterRadius = Math.max(16, Math.round(ringBoundaryRadius * 0.88));
    const ring1InnerRadius = Math.max(10, Math.round(ringBoundaryRadius * 0.60));
    const centerRadius = Math.max(8, Math.round(ringBoundaryRadius * 0.46));
    const ring2InnerRadius = Math.max(ring1OuterRadius + 8, Math.round(ringBoundaryRadius * 1.06));
    const ring2OuterRadius = Math.max(ring2InnerRadius + 18, Math.round(ringBoundaryRadius * 1.55));

    const glyphCanvasRadius = Math.max(110, ring2OuterRadius + 40);
    const glyphSize = Math.max(220, Math.floor(glyphCanvasRadius * 2));
    const overlayLeft = centerX - glyphCanvasRadius;
    const overlayTop = centerY - glyphCanvasRadius;
    const glyphOverlay = d3.select(imageWrapper)
        .append('div')
        .attr('id', 'glyphTooltip')
        .style('position', 'absolute')
        .style('left', `${overlayLeft}px`)
        .style('top', `${overlayTop}px`)
        .style('width', `${glyphSize}px`)
        .style('height', `${glyphSize}px`)
        .style('border-radius', '0')
        .style('overflow', 'visible')
        .style('pointer-events', 'none')
        .style('z-index', '1205')
        .style('background', 'transparent');

    if (!hasData) {
        glyphOverlay.append('div')
            .style('width', '100%')
            .style('height', '100%')
            .style('display', 'flex')
            .style('align-items', 'center')
            .style('justify-content', 'center')
            .style('text-align', 'center')
            .style('padding', '16px')
            .style('font-size', '12px')
            .style('font-weight', '600')
            .style('color', '#555')
            .text('No data');
        currentGlyph = null;
        return;
    }

    const glyphContainer = glyphOverlay.append('div')
        .attr('id', 'glyphContainer')
        .style('width', '100%')
        .style('height', '100%')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('pointer-events', 'none');

    // ring1 queda dentro del círculo rojo y ring2 queda fuera para respetar la jerarquía visual
    const margin = Math.max(12, Math.round(glyphSize * 0.08));

    currentGlyph = new RadialGlyph('glyphContainer', {
        width: glyphSize,
        height: glyphSize,
        margin: margin,
        centerRadius: centerRadius,
        ring1InnerRadius: ring1InnerRadius,
        ring1OuterRadius: ring1OuterRadius,
        ring2InnerRadius: ring2InnerRadius,
        ring2OuterRadius: ring2OuterRadius
    });

    currentGlyph.update(data);
}

function buildAreaRequestPayload(area) {
    const safeArea = area || {};
    const x = Number.isFinite(safeArea.x) ? safeArea.x : 0;
    const y = Number.isFinite(safeArea.y) ? safeArea.y : 0;
    const width = Number.isFinite(safeArea.width) ? safeArea.width : 50;
    const height = Number.isFinite(safeArea.height) ? safeArea.height : 50;

    const payload = {
        x: x,
        y: y,
        width: width,
        height: height
    };

    if (safeArea.shape === 'circle') {
        const fallbackCenterX = Math.round(x + (width / 2));
        const fallbackCenterY = Math.round(y + (height / 2));
        const fallbackRadius = Math.max(1, Math.round(Math.min(width, height) / 2));
        payload.shape = 'circle';
        payload.center_x = Number.isFinite(safeArea.center_x) ? safeArea.center_x : fallbackCenterX;
        payload.center_y = Number.isFinite(safeArea.center_y) ? safeArea.center_y : fallbackCenterY;
        payload.radius = Number.isFinite(safeArea.radius) ? safeArea.radius : fallbackRadius;
    } else {
        payload.shape = 'rectangle';
    }

    return payload;
}

function buildAreaSignature(payload, imageId, participantId, dataType) {
    const participantKey = (participantId !== null && participantId !== 'all') ? String(participantId) : 'all';
    if (payload.shape === 'circle') {
        return [
            imageId,
            participantKey,
            dataType,
            'circle',
            payload.center_x,
            payload.center_y,
            payload.radius
        ].join('|');
    }
    return [
        imageId,
        participantKey,
        dataType,
        'rectangle',
        payload.x,
        payload.y,
        payload.width,
        payload.height
    ].join('|');
}

function refetchAreaDataWithNewType(newDataType) {
    console.log(`%c Cambiando tipo de datos a: ${newDataType}, dataset_select: ${currentDatasetSelect}`, 'color: blue; font-weight: bold; font-size: 14px');

    // Si no hay imagen seleccionada, no podemos hacer nada
    if (!selectedImg) {
        console.log('No hay imagen seleccionada');
        return;
    }

    currentDataType = newDataType;

    // Si hay área seleccionada, recalcular glyph con nuevo tipo de datos
    if (currentAnalyzedArea) {
        const requestPayload = buildAreaRequestPayload(currentAnalyzedArea);
        if (requestPayload.shape === 'circle') {
            console.log(`Selección circular actual: cx=${requestPayload.center_x}, cy=${requestPayload.center_y}, r=${requestPayload.radius}`);
        } else {
            console.log(`Área actual: x=${requestPayload.x}, y=${requestPayload.y}, width=${requestPayload.width}, height=${requestPayload.height}`);
        }
        lastAreaAnalysisSignature = null;
        analyzeSelectedArea(currentAnalyzedArea);
    } else {
        console.log('No hay área seleccionada, actualizando solo heatmap y scarf plot');
    }

    if (selectedImg) {
        console.log(`Recargando heatmap con data_type=${newDataType}, mode=${currentHeatmapMode}`);
        loadHeatmap(selectedImg, newDataType, currentHeatmapMode);
    }
    if (selectedImg) {
        console.log(`Recargando scarf plot con data_type=${newDataType}`);
        loadScarfPlot(selectedImg, newDataType);
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
