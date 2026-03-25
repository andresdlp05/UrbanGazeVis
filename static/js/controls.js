// controls.js — UI controls, selectors, image view switching

function setClearButtonEnabled(enabled) {
    const btnClear = document.getElementById('clearBrushBtn');
    if (!btnClear) return;
    btnClear.classList.toggle('btn-disabled', !enabled);
}

function switchImageView(mode) {
    const imgView = document.getElementById('sel-img-view');
    const imageWrapper = document.getElementById('component-1');
    const hasImage = currentImageOriginalPath && currentImageSegmentationPath;

    if (!imgView || !imageWrapper || !hasImage) {
        return;
    }

    if (mode === 'original') {
        setImageBlendPercentage(0);
    } else if (mode === 'segmentation') {
        syncSegmentationLayerImage();
        setImageBlendPercentage(100);
    } else {
        setImageBlendPercentage(currentImageBlendPercent);
    }

    // Remover SVG de contorno si existe
    d3.select(imageWrapper).select('svg.contour-svg').remove();

    // Recrear brush para mantener consistencia de interacción
    alignOverlayWithImage();
    createBrushSelection(imageWrapper, imgView);
    updateOverlay(); // Actualizar overlay para aplicar opacidad según estado
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

function updateDirectionRingToggleButtonLabel() {
    const btn = document.getElementById('toggle-direction-ring-btn');
    if (!btn) return;
    btn.textContent = isDirectionRingVisible ? 'Hide 4-Sector Ring' : 'Show 4-Sector Ring';
}

function initializeDirectionRingToggleControl() {
    const btn = document.getElementById('toggle-direction-ring-btn');
    if (!btn) {
        console.warn('Direction ring toggle button not found');
        return;
    }

    updateDirectionRingToggleButtonLabel();

    btn.addEventListener('click', () => {
        isDirectionRingVisible = !isDirectionRingVisible;
        updateDirectionRingToggleButtonLabel();

        if (currentGlyph && typeof currentGlyph.setDirectionRingVisible === 'function') {
            currentGlyph.setDirectionRingVisible(isDirectionRingVisible);
        }
    });
}

function getParticipantScoresForImage(imageId) {
    if (imageId === null || imageId === undefined || imageId === '' || imageId === 'all') {
        return null;
    }

    const imageData = globalData.find(d => String(d.id) === String(imageId));
    if (!imageData || !Array.isArray(imageData.participants)) {
        return null;
    }

    const scoresByParticipant = new Map();
    imageData.participants.forEach(entry => {
        const participantId = entry?.participant;
        const score = Number(entry?.score);
        if (participantId !== undefined && participantId !== null && Number.isFinite(score)) {
            scoresByParticipant.set(String(participantId), score);
        }
    });

    return scoresByParticipant;
}

function populateSelect(selectId, values, labelPrefix, all=true, scoresByValue=null) {
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
    // En Controls > Participant: ordenar numérico ascendente (igual que backend)
    if (labelPrefix === 'part' && selectId === 'part-select') {
        sortedValues.sort((a, b) => Number(b) - Number(a));
    }

    sortedValues.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v; // value = id only

        // Si es imagen y tenemos score, agregarlo en paréntesis
        if (labelPrefix === 'img' && imageScores[v] !== undefined) {
            opt.textContent = `${labelPrefix}-${v} (${imageScores[v].toFixed(1)})`;
        } else if (labelPrefix === 'part' && scoresByValue && scoresByValue.has(String(v))) {
            opt.textContent = `${labelPrefix}-${v} (${scoresByValue.get(String(v)).toFixed(1)})`;
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
