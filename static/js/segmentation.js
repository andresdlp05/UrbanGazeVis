// segmentation.js — segmentation canvas, filter, blend slider

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
    const imgView = document.getElementById('sel-img-view-seg');
    if (!imgView) return;

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
    const imgView = document.getElementById('sel-img-view-seg');
    if (!imgView) return;
    if (currentImageSegmentationPath) {
        imgView.src = currentImageSegmentationPath;
    }
}

function getSegmentationLayerImage() {
    return document.getElementById('sel-img-view-seg');
}

function setImageBlendPercentage(percent) {
    const imgView = document.getElementById('sel-img-view');
    const segView = getSegmentationLayerImage();
    const imageWrapper = document.getElementById('component-1');
    const slider = document.getElementById('img-compare-slider');
    const valueLabel = document.getElementById('img-compare-value');
    const divider = document.getElementById('img-compare-divider');

    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    currentImageBlendPercent = safePercent;

    if (slider && Number(slider.value) !== safePercent) {
        slider.value = String(safePercent);
    }
    if (valueLabel) {
        valueLabel.textContent = `${Math.round(safePercent)}%`;
    }

    if (imgView) {
        // Mostrar ORIGINAL solo en la parte izquierda complementaria
        const rightInset = Math.max(0, Math.min(100, safePercent));
        imgView.style.clipPath = `inset(0 ${rightInset}% 0 0)`;
        imgView.style.webkitClipPath = `inset(0 ${rightInset}% 0 0)`;
    }

    if (segView) {
        // Mostrar SEGMENTACIÓN solo en la parte derecha
        const leftInset = Math.max(0, Math.min(100, 100 - safePercent));
        segView.style.clipPath = `inset(0 0 0 ${leftInset}%)`;
        segView.style.webkitClipPath = `inset(0 0 0 ${leftInset}%)`;
        const shouldDimForOverlay = currentOverlayTypes && currentOverlayTypes.length > 0 && !window.brushSelection;
        segView.style.opacity = safePercent <= 0 ? '0' : (shouldDimForOverlay ? '0.2' : '1');
    }

    if (imgView) {
        const shouldDimForOverlay = currentOverlayTypes && currentOverlayTypes.length > 0 && !window.brushSelection;
        imgView.style.opacity = shouldDimForOverlay ? '0.2' : '1';
    }

    if (safePercent <= 0) {
        currentImageMode = 'original';
    } else if (safePercent >= 100) {
        currentImageMode = 'segmentation';
    } else {
        currentImageMode = 'blend';
    }

    if (divider && imgView && imageWrapper) {
        const imgRect = imgView.getBoundingClientRect();
        const wrapperRect = imageWrapper.getBoundingClientRect();

        if (safePercent <= 0 || safePercent >= 100 || imgRect.width === 0 || imgRect.height === 0) {
            divider.style.display = 'none';
        } else {
            const splitRatio = (100 - safePercent) / 100; // Segmentación visible desde la derecha
            const splitX = (imgRect.left - wrapperRect.left) + (imgRect.width * splitRatio);
            divider.style.display = 'block';
            divider.style.left = `${splitX}px`;
            divider.style.top = `${imgRect.top - wrapperRect.top}px`;
            divider.style.height = `${imgRect.height}px`;
        }
    }
}

function syncSegmentationLayerImage() {
    const segView = getSegmentationLayerImage();
    if (!segView) return;

    if (!currentImageSegmentationPath) {
        segView.src = '';
        return;
    }

    if (window.selectedClass) {
        createSegmentationCanvas();
        applySegmentationFilter(window.selectedClass);
    } else {
        resetSegmentationView();
    }
}

function initializeImageBlendSlider() {
    const slider = document.getElementById('img-compare-slider');
    if (!slider) {
        return;
    }

    slider.addEventListener('input', function() {
        setImageBlendPercentage(this.value);
    });

    setImageBlendPercentage(slider.value);

    // Debounced resize handler (150ms)
    let _resizeDebounceTimer = null;
    window.addEventListener('resize', () => {
        if (_resizeDebounceTimer) clearTimeout(_resizeDebounceTimer);
        _resizeDebounceTimer = setTimeout(() => {
            setImageBlendPercentage(currentImageBlendPercent);
        }, 150);
    });
}
