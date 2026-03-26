// init.js — event listener setup and initialization calls

// Tab listeners
document.querySelectorAll('.tabs input[name="tabs-nav"]').forEach(input => {
    input.addEventListener('change', updateTabs);
});

initializeImageBlendSlider();
initializeDirectionRingToggleControl();

function resetInteractionSelections() {
    if (typeof window.clearCircleSelection === 'function') {
        window.clearCircleSelection();
    }

    window.selectedClass = null;
    currentScarfSegment = null;
    window.currentScarfSegment = null;

    if (typeof removeScarfSegmentHighlight === 'function') {
        removeScarfSegmentHighlight();
    }
    if (typeof clearScarfAreaSelectionHighlight === 'function') {
        clearScarfAreaSelectionHighlight();
    }
    if (typeof removeParticipantColumnHighlight === 'function') {
        removeParticipantColumnHighlight();
    }
    if (typeof clearHeatmapAreaFrames === 'function') {
        clearHeatmapAreaFrames();
    }

    d3.selectAll('.rect-h-img').attr('opacity', 0);
    d3.selectAll('.rect-heatmap').attr('opacity', 1);

    const overlayCheckboxes = document.querySelectorAll('.overlay-checkbox');
    overlayCheckboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    currentOverlayTypes = [];

    if (typeof updateHighlightsGlobal === 'function') {
        updateHighlightsGlobal();
    }
}

// Cargar scores y luego popular los selectores
loadImageScores().then(() => {
    populateSelect("img-select", allImages, "img", all=false);
    populateSelect("part-select", allParticipants, "part");
    populateSelect("part-select-v2", allParticipants, "part", all=false);
    populateSelect("img-select-v3", allImages, "img", all=false);
});

// Toggle de orden de imágenes (Sorted by Image / ID)
document.getElementById('img-sort-toggle').addEventListener('change', function() {
    const previousValue = document.getElementById('img-select').value;
    populateSelect("img-select", allImages, "img", false);
    const select = document.getElementById('img-select');
    if (previousValue && [...select.options].some(o => o.value === previousValue)) {
        select.value = previousValue;
    }
});

// Add event listeners
document.getElementById("img-select").addEventListener("change", function() {
    const selectedImage = this.value;
    const partSelect = document.getElementById("part-select");
    const participantScores = getParticipantScoresForImage(selectedImage);
const previousParticipant = partSelect.value; // guardar selección actual

    if (selectedImage === "all") {
        populateSelect("part-select", allParticipants, "part", true, null);
        // restaurar selección si sigue siendo válida
        if (allParticipants.map(String).includes(previousParticipant)) {
            partSelect.value = previousParticipant;
        }
    } else {
        // Fetch participants from backend (same source as heatmap/scarf plot)
        fetch(`/api/participants/${selectedImage}`)
            .then(response => response.json())
            .then(data => {
                if (data.participants && Array.isArray(data.participants)) {
                    const parts = data.participants.map(String);
                    console.log(`Participants for image ${selectedImage}:`, parts);
                    populateSelect("part-select", parts, "part", true, participantScores);
                    // restaurar selección si el participante existe en la nueva imagen
                    if (parts.includes(previousParticipant)) {
                        partSelect.value = previousParticipant;
                    }
                } else {
                    console.warn('No participants found for image', selectedImage);
                    populateSelect("part-select", allParticipants, "part", true, participantScores);
                }
            })
            .catch(error => {
                console.error('Error fetching participants:', error);
                populateSelect("part-select", allParticipants, "part", true, participantScores);
            });
    }

    selectedImg = this.value;
    resetInteractionSelections();
    if (areaAnalysisAbortController) {
        areaAnalysisAbortController.abort();
        areaAnalysisAbortController = null;
    }
    areaAnalysisRequestCounter += 1;
    lastAreaAnalysisSignature = null;
    const imgView = document.getElementById("sel-img-view");
    const segView = getSegmentationLayerImage();
    const imageWrapper = document.getElementById('component-1');
    if (typeof window.resetImagePanTransform === 'function') {
        window.resetImagePanTransform();
    }
    if (typeof alignOverlayWithImage === 'function') {
        alignOverlayWithImage();
    }
    if (typeof syncImageBlendDividerPosition === 'function') {
        syncImageBlendDividerPosition();
    }
    if (selectedImage !== "all") {
        currentImageOriginalPath = `/static/images/images/images/${selectedImage}.jpg`;
        currentImageSegmentationPath = getSegmentationPath(selectedImage, currentDatasetSelect);

        // Resetear canvas de segmentación para la nueva imagen
        segmentationCanvas = null;
        originalSegmentationImage = null;
        syncSegmentationLayerImage();
        setImageBlendPercentage(50);

        // Crear brush cuando la imagen carga
        imgView.onload = function() {
            createBrushSelection(imageWrapper, imgView);
            setImageBlendPercentage(50);
            // Cargar todos los puntos de gaze y fixation para la imagen completa
            loadAllPointsForImage(selectedImage);
        };
        imgView.src = currentImageOriginalPath;

        loadScarfPlot(selectedImage, currentDataType);
        loadHeatmap(selectedImage, currentDataType, currentHeatmapMode);
    } else {
        imgView.src = ""; // or some placeholder
        if (segView) segView.src = "";
        setImageBlendPercentage(0);
        currentImageOriginalPath = null;
        currentImageSegmentationPath = null;
        segmentationCanvas = null;
        originalSegmentationImage = null;
        // Remover brush
        d3.select('#brushOverlay').remove();
        d3.select('#outsideDimLayer').remove();
        d3.select('#glyphTooltip').remove();
        currentGlyph = null;
        currentAnalyzedArea = null;
        currentAreaData = null;
        clearHeatmapAreaFrames();
    }
});

document.getElementById("img-select-v3").addEventListener("change", function() {
    const partSelect = document.getElementById("part-select-v3");
    selectedImgV3 = this.value;


    populateSelect('part-select-v3', imgPartIndex[selectedImgV3], 'part', all=false);
});

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

            syncSegmentationLayerImage();
            setImageBlendPercentage(currentImageBlendPercent);
            console.log(`Reloaded segmentation layer with new dataset`);

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
    resetInteractionSelections();
    setImageBlendPercentage(50);

    // Actualizar overlay si hay tipos seleccionados
    // if (currentOverlayTypes && currentOverlayTypes.length > 0) {
    //     updateOverlay();
    // }
    if (currentOverlayTypes && currentOverlayTypes.length > 0 && !window._scarfSelecting) {
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
