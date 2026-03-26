// brush.js — circular brush selection, glyph tooltip, area analysis

function computeGlyphLayoutFromSelectionRadius(selectionRadius) {
    const ringBoundaryRadius = Math.max(24, selectionRadius);
    const ring1OuterRadius = Math.max(16, ringBoundaryRadius * 0.88);
    const ring1InnerRadius = Math.max(10, ringBoundaryRadius * 0.60);
    const centerRadius = Math.max(8, ringBoundaryRadius * 0.46);
    const ring2InnerRadius = Math.max(ring1OuterRadius + 8, ringBoundaryRadius * 1.06);
    const ring2OuterRadius = Math.max(ring2InnerRadius + 18, ringBoundaryRadius * 1.55);
    const ring2LabelFontSize = 12;
    const ring2LabelHalfExtent = Math.max(6, Math.round(ring2LabelFontSize * 0.95));
    const ring2LabelOffset = 10;
    const glyphCanvasRadius = ring2OuterRadius + ring2LabelOffset + ring2LabelHalfExtent;

    return {
        centerRadius,
        ring1InnerRadius,
        ring1OuterRadius,
        ring2InnerRadius,
        ring2OuterRadius,
        ring2LabelFontSize,
        ring2LabelHalfExtent,
        ring2LabelOffset,
        glyphCanvasRadius
    };
}

function fitSelectionRadiusToGlyphContainer(targetRadius, maxContainerRadius, minRadius = 0) {
    const safeTargetRadius = Math.max(0, targetRadius || 0);
    const safeMaxContainerRadius = Math.max(0, maxContainerRadius || 0);
    let low = 0;
    let high = safeTargetRadius;

    // Binary search for max selection radius whose glyph container fits.
    for (let i = 0; i < 28; i++) {
        const mid = (low + high) / 2;
        const layout = computeGlyphLayoutFromSelectionRadius(mid);
        if (layout.glyphCanvasRadius <= safeMaxContainerRadius) {
            low = mid;
        } else {
            high = mid;
        }
    }

    const fittedMinRadius = Math.max(0, minRadius || 0);
    if (computeGlyphLayoutFromSelectionRadius(fittedMinRadius).glyphCanvasRadius <= safeMaxContainerRadius) {
        return Math.max(fittedMinRadius, low);
    }
    return low;
}

function applyImagePanTransform(imageWrapper, panX, panY) {
    if (!imageWrapper) return;
    const nextX = Number.isFinite(panX) ? panX : 0;
    const nextY = Number.isFinite(panY) ? panY : 0;
    imagePanOffsetX = nextX;
    imagePanOffsetY = nextY;
    imageWrapper.style.setProperty('--img-pan-x', `${nextX}px`);
    imageWrapper.style.setProperty('--img-pan-y', `${nextY}px`);
}

function resetImagePanTransformState(imageWrapper) {
    applyImagePanTransform(imageWrapper, 0, 0);
}

window.resetImagePanTransform = function() {
    const imageWrapper = document.getElementById('component-1');
    resetImagePanTransformState(imageWrapper);
    if (typeof alignOverlayWithImage === 'function') {
        alignOverlayWithImage();
    }
    if (typeof syncImageBlendDividerPosition === 'function') {
        syncImageBlendDividerPosition();
    }
};

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

    applyImagePanTransform(imageWrapper, imagePanOffsetX, imagePanOffsetY);

    function getImageGeometry() {
        const currentImgRect = img.getBoundingClientRect();
        const currentWrapperRect = imageWrapper.getBoundingClientRect();
        return {
            imgRect: currentImgRect,
            wrapperRect: currentWrapperRect,
            imgWidth: currentImgRect.width,
            imgHeight: currentImgRect.height,
            svgOffsetLeft: currentImgRect.left - currentWrapperRect.left,
            svgOffsetTop: currentImgRect.top - currentWrapperRect.top
        };
    }

    function getMinRadiusDisplay(width, height) {
        return Math.max(4, Math.min(24, (Math.min(width, height) / 2) - 2));
    }

    const initialGeometry = getImageGeometry();
    const overlayPad = 2; // Compensa seams de subpíxel en bordes
    const overlayWidth = Math.max(1, initialGeometry.wrapperRect.width + overlayPad);
    const overlayHeight = Math.max(1, initialGeometry.wrapperRect.height + overlayPad);

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

    const defaultRadius = Math.max(
        getMinRadiusDisplay(initialGeometry.imgWidth, initialGeometry.imgHeight),
        Math.min(initialGeometry.imgWidth, initialGeometry.imgHeight) * 0.15
    );

    const selectionState = {
        cx: initialGeometry.imgWidth / 2,
        cy: initialGeometry.imgHeight / 2,
        radius: defaultRadius
    };
    circleSelectionState = selectionState;

    // Restaurar última selección circular cuando existe
    if (currentAnalyzedArea && currentAnalyzedArea.shape === 'circle') {
        const screenScaleX = initialGeometry.imgWidth / DATA_WIDTH;
        const screenScaleY = initialGeometry.imgHeight / DATA_HEIGHT;
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
    let selectionConstraintMode = 'glyph';

    function clampSelection(geometry = getImageGeometry()) {
        const imgWidth = geometry.imgWidth;
        const imgHeight = geometry.imgHeight;
        const minRadiusDisplay = getMinRadiusDisplay(imgWidth, imgHeight);
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

        if (selectionConstraintMode === 'image') {
            // Modo pan: permitir llegar a bordes y esquinas de la imagen.
            selectionState.cx = clamp(selectionState.cx, 0, imgWidth);
            selectionState.cy = clamp(selectionState.cy, 0, imgHeight);

            const maxRadius = Math.max(minRadiusDisplay, Math.hypot(imgWidth, imgHeight));
            selectionState.radius = clamp(selectionState.radius, minRadiusDisplay, maxRadius);
            return;
        }

        // Colisión basada en TODO el contenedor del glyph (no solo el círculo rojo).
        const edgePadding = 2;

        const maxContainerRadiusGlobal = Math.max(0, (Math.min(imgWidth, imgHeight) / 2) - edgePadding);
        selectionState.radius = fitSelectionRadiusToGlyphContainer(
            selectionState.radius,
            maxContainerRadiusGlobal,
            minRadiusDisplay
        );

        let glyphCollisionRadius = computeGlyphLayoutFromSelectionRadius(selectionState.radius).glyphCanvasRadius;
        selectionState.cx = clamp(
            selectionState.cx,
            edgePadding + glyphCollisionRadius,
            imgWidth - edgePadding - glyphCollisionRadius
        );
        selectionState.cy = clamp(
            selectionState.cy,
            edgePadding + glyphCollisionRadius,
            imgHeight - edgePadding - glyphCollisionRadius
        );

        const maxContainerRadiusAtCenter = Math.max(
            0,
            Math.min(
                selectionState.cx - edgePadding,
                imgWidth - edgePadding - selectionState.cx,
                selectionState.cy - edgePadding,
                imgHeight - edgePadding - selectionState.cy
            )
        );

        selectionState.radius = fitSelectionRadiusToGlyphContainer(
            selectionState.radius,
            maxContainerRadiusAtCenter,
            minRadiusDisplay
        );

        glyphCollisionRadius = computeGlyphLayoutFromSelectionRadius(selectionState.radius).glyphCanvasRadius;
        selectionState.cx = clamp(
            selectionState.cx,
            edgePadding + glyphCollisionRadius,
            imgWidth - edgePadding - glyphCollisionRadius
        );
        selectionState.cy = clamp(
            selectionState.cy,
            edgePadding + glyphCollisionRadius,
            imgHeight - edgePadding - glyphCollisionRadius
        );
    }

    function toCircleAreaData(geometry = getImageGeometry()) {
        const imgWidth = geometry.imgWidth;
        const imgHeight = geometry.imgHeight;
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

    function syncImagePanDependentLayers() {
        if (typeof alignOverlayWithImage === 'function') {
            alignOverlayWithImage();
        }
        if (typeof syncImageBlendDividerPosition === 'function') {
            syncImageBlendDividerPosition();
        }
    }

    let panResetAnimationFrame = null;
    let glyphDragLockUntil = 0;

    function cancelPanResetAnimation() {
        if (panResetAnimationFrame !== null) {
            cancelAnimationFrame(panResetAnimationFrame);
            panResetAnimationFrame = null;
        }
    }

    function lockGlyphDragFor(durationMs) {
        glyphDragLockUntil = performance.now() + Math.max(0, durationMs || 0);
    }

    function isGlyphDragLocked() {
        return performance.now() < glyphDragLockUntil;
    }

    function animateImagePanBackToOrigin(options = {}) {
        const duration = Math.max(120, Number(options.duration) || 260);
        const keepGlyphScreenPosition = options.keepGlyphScreenPosition === true;
        const targetConstraintMode = options.targetConstraintMode || 'glyph';

        if (Math.abs(imagePanOffsetX) < 0.5 && Math.abs(imagePanOffsetY) < 0.5) {
            selectionConstraintMode = targetConstraintMode;
            return;
        }

        cancelPanResetAnimation();

        const startPanX = imagePanOffsetX;
        const startPanY = imagePanOffsetY;
        const startCx = selectionState.cx;
        const startCy = selectionState.cy;

        if (keepGlyphScreenPosition) {
            selectionConstraintMode = 'free';
        }

        const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
        const startedAt = performance.now();

        const step = (now) => {
            const rawT = Math.min(1, (now - startedAt) / duration);
            const eased = easeOutCubic(rawT);
            const currentPanX = startPanX * (1 - eased);
            const currentPanY = startPanY * (1 - eased);

            applyImagePanTransform(imageWrapper, currentPanX, currentPanY);

            if (keepGlyphScreenPosition) {
                selectionState.cx = startCx + (startPanX - currentPanX);
                selectionState.cy = startCy + (startPanY - currentPanY);
            }

            syncImagePanDependentLayers();
            renderSelector();

            if (rawT < 1) {
                panResetAnimationFrame = requestAnimationFrame(step);
                return;
            }

            panResetAnimationFrame = null;
            selectionConstraintMode = targetConstraintMode;
            renderSelector();
        };

        panResetAnimationFrame = requestAnimationFrame(step);
    }

    let isImagePanPointerActive = false;
    let isImagePanDragging = false;
    let imagePanPointerId = null;
    let imagePanStartClientX = 0;
    let imagePanStartClientY = 0;
    let imagePanLastClientX = 0;
    let imagePanLastClientY = 0;
    const imagePanStartThreshold = 2;

    function renderSelector() {
        const geometry = getImageGeometry();
        const imgWidth = geometry.imgWidth;
        const imgHeight = geometry.imgHeight;
        const svgOffsetLeft = geometry.svgOffsetLeft;
        const svgOffsetTop = geometry.svgOffsetTop;

        clampSelection(geometry);

        const isVisible = userHasInteracted ? 'block' : 'none';
        if (!isImagePanDragging) {
            svgContainer.style('cursor', userHasInteracted ? 'default' : 'crosshair');
        }
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
            selectionConstraintMode = 'glyph';
            window.brushActive = true;
            userHasInteracted = true;
            enableClearButton();
            clearAreaAnalysisVisualsDuringDrag();
            const resetDurationMs = 260;
            if (Math.abs(imagePanOffsetX) > 0.5 || Math.abs(imagePanOffsetY) > 0.5) {
                animateImagePanBackToOrigin({
                    keepGlyphScreenPosition: true,
                    targetConstraintMode: 'glyph',
                    duration: resetDurationMs
                });
                lockGlyphDragFor(resetDurationMs);
            }
        })
        .on('drag', function(event) {
            if (isGlyphDragLocked()) return;
            cancelPanResetAnimation();
            const geometry = getImageGeometry();
            const [mx, my] = d3.pointer(event, svgContainer.node());
            selectionState.cx = mx - geometry.svgOffsetLeft;
            selectionState.cy = my - geometry.svgOffsetTop;
            renderSelector();
        })
        .on('end', function() {
            window.brushActive = false;
            scheduleAreaAnalysis(true);
        });

    const resizeDrag = d3.drag()
        .on('start', function() {
            selectionConstraintMode = 'glyph';
            window.brushActive = true;
            userHasInteracted = true;
            enableClearButton();
            clearAreaAnalysisVisualsDuringDrag();
            const resetDurationMs = 260;
            if (Math.abs(imagePanOffsetX) > 0.5 || Math.abs(imagePanOffsetY) > 0.5) {
                animateImagePanBackToOrigin({
                    keepGlyphScreenPosition: true,
                    targetConstraintMode: 'glyph',
                    duration: resetDurationMs
                });
                lockGlyphDragFor(resetDurationMs);
            }
        })
        .on('drag', function(event) {
            if (isGlyphDragLocked()) return;
            cancelPanResetAnimation();
            const geometry = getImageGeometry();
            const [mx, my] = d3.pointer(event, svgContainer.node());
            const localX = mx - geometry.svgOffsetLeft;
            const localY = my - geometry.svgOffsetTop;
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

    function isPointOutsideGlyphContainer(localX, localY) {
        const dx = localX - selectionState.cx;
        const dy = localY - selectionState.cy;
        const distanceToCenter = Math.sqrt((dx * dx) + (dy * dy));
        const glyphContainerRadius = computeGlyphLayoutFromSelectionRadius(selectionState.radius).glyphCanvasRadius + 2;
        return distanceToCenter > glyphContainerRadius;
    }

    const svgNode = svgContainer.node();

    function handleImagePanPointerDown(event) {
        if (event.button !== 0) return;
        if (!userHasInteracted) return;
        if (window.brushActive) return;

        const geometry = getImageGeometry();
        const [mx, my] = d3.pointer(event, svgNode);
        const localX = mx - geometry.svgOffsetLeft;
        const localY = my - geometry.svgOffsetTop;

        if (!isPointOutsideGlyphContainer(localX, localY)) return;

        isImagePanPointerActive = true;
        isImagePanDragging = false;
        imagePanPointerId = event.pointerId;
        imagePanStartClientX = event.clientX;
        imagePanStartClientY = event.clientY;
        imagePanLastClientX = event.clientX;
        imagePanLastClientY = event.clientY;

        if (svgNode.setPointerCapture) {
            svgNode.setPointerCapture(event.pointerId);
        }

        event.preventDefault();
        event.stopPropagation();
    }

    function handleImagePanPointerMove(event) {
        if (!isImagePanPointerActive) return;
        if (event.pointerId !== imagePanPointerId) return;

        const deltaX = event.clientX - imagePanLastClientX;
        const deltaY = event.clientY - imagePanLastClientY;
        if (deltaX === 0 && deltaY === 0) return;

        if (!isImagePanDragging) {
            const totalDx = event.clientX - imagePanStartClientX;
            const totalDy = event.clientY - imagePanStartClientY;
            if (Math.abs(totalDx) < imagePanStartThreshold && Math.abs(totalDy) < imagePanStartThreshold) {
                imagePanLastClientX = event.clientX;
                imagePanLastClientY = event.clientY;
                return;
            }

            isImagePanDragging = true;
            selectionConstraintMode = 'image';
            window.brushActive = true;
            enableClearButton();
            clearAreaAnalysisVisualsDuringDrag();
        }

        const targetCx = selectionState.cx - deltaX;
        const targetCy = selectionState.cy - deltaY;
        selectionState.cx = targetCx;
        selectionState.cy = targetCy;

        const geometry = getImageGeometry();
        clampSelection(geometry);
        const correctionX = selectionState.cx - targetCx;
        const correctionY = selectionState.cy - targetCy;

        applyImagePanTransform(
            imageWrapper,
            imagePanOffsetX + deltaX - correctionX,
            imagePanOffsetY + deltaY - correctionY
        );

        syncImagePanDependentLayers();
        svgContainer.style('cursor', 'grabbing');
        renderSelector();

        imagePanLastClientX = event.clientX;
        imagePanLastClientY = event.clientY;

        event.preventDefault();
    }

    function handleImagePanPointerEnd(event) {
        if (!isImagePanPointerActive) return;
        if (event.pointerId !== imagePanPointerId) return;

        if (svgNode.releasePointerCapture && svgNode.hasPointerCapture && svgNode.hasPointerCapture(event.pointerId)) {
            svgNode.releasePointerCapture(event.pointerId);
        }

        const shouldAnalyze = isImagePanDragging;
        isImagePanPointerActive = false;
        isImagePanDragging = false;
        imagePanPointerId = null;
        selectionConstraintMode = 'image';
        imagePanStartClientX = 0;
        imagePanStartClientY = 0;
        imagePanLastClientX = 0;
        imagePanLastClientY = 0;
        window.brushActive = false;

        renderSelector();

        if (shouldAnalyze) {
            scheduleAreaAnalysis(true);
            event.preventDefault();
        }
    }

    svgNode.addEventListener('pointerdown', handleImagePanPointerDown);
    svgNode.addEventListener('pointermove', handleImagePanPointerMove);
    svgNode.addEventListener('pointerup', handleImagePanPointerEnd);
    svgNode.addEventListener('pointercancel', handleImagePanPointerEnd);

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
        cancelPanResetAnimation();
        isImagePanPointerActive = false;
        isImagePanDragging = false;
        imagePanPointerId = null;
        selectionConstraintMode = 'glyph';
        window.brushActive = false;

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

        const geometry = getImageGeometry();
        selectionConstraintMode = 'glyph';
        userHasInteracted = false;
        selectionState.cx = geometry.imgWidth / 2;
        selectionState.cy = geometry.imgHeight / 2;
        selectionState.radius = Math.max(
            getMinRadiusDisplay(geometry.imgWidth, geometry.imgHeight),
            Math.min(geometry.imgWidth, geometry.imgHeight) * 0.15
        );
        renderSelector();

        setClearButtonEnabled(false);

        console.log('Selector circular, tooltip y estado limpiados');
    }

    svgContainer.on('click.circleSelectionActivate', function(event) {
        if (window.brushActive || userHasInteracted) return;
        selectionConstraintMode = 'glyph';
        const geometry = getImageGeometry();
        const [mx, my] = d3.pointer(event, svgContainer.node());
        const localX = mx - geometry.svgOffsetLeft;
        const localY = my - geometry.svgOffsetTop;
        if (localX < 0 || localX > geometry.imgWidth || localY < 0 || localY > geometry.imgHeight) return;
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

    syncImagePanDependentLayers();
    renderSelector();

    const btnClear = document.getElementById('clearBrushBtn');
    if (btnClear) {
        btnClear.onclick = clearCircleSelection;
    }

    // Exponer clear para que otros cambios de UI (imagen/participante)
    // puedan reutilizar exactamente la misma lógica que el botón Clear.
    window.clearCircleSelection = clearCircleSelection;

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
    const desiredLayout = computeGlyphLayoutFromSelectionRadius(selectionRadius);

    // Verificar que el contenedor completo del glyph cabe en el recuadro.
    const edgePadding = 2;
    const minDistanceToEdge = Math.min(
        centerX - edgePadding,
        wrapperRect.width - centerX - edgePadding,
        centerY - edgePadding,
        wrapperRect.height - centerY - edgePadding
    );
    const maxDrawableRadius = Math.max(0, minDistanceToEdge);
    if (maxDrawableRadius + 0.5 < desiredLayout.glyphCanvasRadius) {
        return;
    }

    const centerRadius = desiredLayout.centerRadius;
    const ring1InnerRadius = desiredLayout.ring1InnerRadius;
    const ring1OuterRadius = desiredLayout.ring1OuterRadius;
    const ring2InnerRadius = desiredLayout.ring2InnerRadius;
    const ring2OuterRadius = desiredLayout.ring2OuterRadius;
    const ring2LabelOffset = desiredLayout.ring2LabelOffset;
    const ring2LabelHalfExtent = desiredLayout.ring2LabelHalfExtent;
    const ring2LabelFontSize = desiredLayout.ring2LabelFontSize;
    const glyphCanvasRadius = desiredLayout.glyphCanvasRadius;
    const glyphSize = Math.max(2, Math.floor(glyphCanvasRadius * 2));
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
        ring2OuterRadius: ring2OuterRadius,
        ring2LabelOffset: ring2LabelOffset,
        ring2LabelHalfExtent: ring2LabelHalfExtent,
        ring2LabelFontSize: ring2LabelFontSize
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
