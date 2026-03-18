/**
 * Glyph Radial para visualización de Eye-Tracking y Percepción Urbana
 * Estructura:
 * - Centro: Gráfico de densidad de scores
 * - Anillo 1: Dirección de fijaciones (N, S, E, O)
 * - Anillo 2: Tiempo de fijación por participante
 */

class RadialGlyph {
    constructor(containerId, options = {}) {
        this.containerId = containerId;
        this.container = d3.select(`#${containerId}`);
        
        // Configuración por defecto
        this.config = {
            width: 500,  // Aumentar más para acomodar puntajes
            height: 500,
            margin: 80,  // Aumentar margen para las etiquetas de tiempo y puntajes
            centerRadius: 60,
            ring1InnerRadius: 70,
            ring1OuterRadius: 120,
            ring2InnerRadius: 130,
            ring2OuterRadius: 180,
            ...options
        };
        
        // Colores
        this.colors = {
            directions: ['#FF6B35', '#4ECDC4', '#45B7D1', '#96CEB4'], // N, S, E, O
            participants: d3.scaleOrdinal(d3.schemeCategory10),
            density: d3.scaleSequential(d3.interpolateViridis)
        };
        
        this.initializeSVG();
    }
    
    initializeSVG() {
        // Limpiar contenedor
        this.container.selectAll("*").remove();
        
        // Crear SVG
        this.svg = this.container
            .append("svg")
            .attr("width", this.config.width)
            .attr("height", this.config.height);
            
        // Crear grupos para cada nivel
        this.centerGroup = this.svg.append("g")
            .attr("class", "center-group")
            .attr("transform", `translate(${this.config.width/2}, ${this.config.height/2})`);
            
        this.ring1Group = this.svg.append("g")
            .attr("class", "ring1-group")
            .attr("transform", `translate(${this.config.width/2}, ${this.config.height/2})`);
            
        this.ring2Group = this.svg.append("g")
            .attr("class", "ring2-group")
            .attr("transform", `translate(${this.config.width/2}, ${this.config.height/2})`);
    }
    
    update(data) {
        console.log("🔄 RadialGlyph.update() iniciado con datos:", data);
        
        // Procesar datos
        console.log("📊 Procesando datos...");
        this.processedData = this.processData(data);
        console.log("✅ Datos procesados:", this.processedData);
        
        // Renderizar cada nivel
        console.log("🎨 Renderizando centro (histograma)...");
        this.renderHistogramCenter(this.processedData.histogramData);
        
        console.log("🎨 Renderizando anillo 1 (direcciones)...");
        this.renderRing1(this.processedData.directions);
        
        console.log("🎨 Renderizando anillo 2 (participantes)...");
        this.renderRing2(this.processedData.participants, data.fixations || []);
        
        console.log("✅ RadialGlyph.update() completado exitosamente!");
    }
    
    processData(data) {
        const { fixations, patchInfo, imageId, participant_scores } = data;
        
        // 1. Calcular datos para histograma comparativo
        const histogramData = this.calculateHistogramData(fixations, participant_scores);
        
        // 2. Calcular direcciones de fijaciones
        const directions = this.calculateDirections(fixations);
        
        // 3. Calcular tiempo por participante con puntajes
        const participants = this.calculateParticipantTimes(fixations, participant_scores);
        
        return { histogramData, directions, participants };
    }
    
    calculateHistogramData(fixations, participant_scores = {}) {
        // 1. Obtener participantes únicos que tienen fijaciones en este patch
        const participantsInPatch = [...new Set(fixations.map(fix => fix.participante))];
        console.log("🔍 Participantes en este patch:", participantsInPatch);
        
        // 2. Scores de participantes que miraron este patch específico Y tienen evaluación
        const participantRatings = [];
        const participantsWithScores = participantsInPatch.filter(participantId => {
            const scoreInfo = participant_scores[participantId];
            return scoreInfo && scoreInfo.score !== null && scoreInfo.score !== undefined;
        });
        
        participantsWithScores.forEach(participantId => {
            const scoreInfo = participant_scores[participantId];
            participantRatings.push(scoreInfo.score);
        });
        
        console.log("🔄 Participantes en patch:", participantsInPatch);
        console.log("✅ Participantes con scores:", participantsWithScores);
        console.log("❌ Participantes sin scores:", participantsInPatch.filter(p => !participantsWithScores.includes(p)));
        
        // 3. Scores de TODOS los participantes que vieron esta imagen (los 10 totales)
        const allParticipantRatings = [];
        Object.values(participant_scores).forEach(scoreInfo => {
            if (scoreInfo.score !== null && scoreInfo.score !== undefined) {
                allParticipantRatings.push(scoreInfo.score);
            }
        });
        
        console.log("📊 Scores patch participantes:", participantRatings);
        console.log("📊 Scores todos participantes:", allParticipantRatings);
        
        // 4. Crear histogramas para ambos conjuntos de datos
        const bins = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // Bins de 0 a 10
        
        // Función para crear histograma
        const createHistogram = (scores) => {
            const histogram = new Array(10).fill(0); // 10 bins (0-1, 1-2, ..., 9-10)
            scores.forEach(score => {
                const binIndex = Math.min(Math.floor(score), 9); // Limitar a bin 9 (score 10 va al bin 9)
                histogram[binIndex]++;
            });
            return histogram;
        };
        
        const patchParticipantsHistogram = createHistogram(participantRatings);
        const allParticipantsHistogram = createHistogram(allParticipantRatings);
        
        return {
            participantRatings: participantRatings,
            allParticipantRatings: allParticipantRatings,
            patchParticipantsHistogram: patchParticipantsHistogram,
            allParticipantsHistogram: allParticipantsHistogram,
            bins: bins,
            patchAvg: participantRatings.length > 0 ? d3.mean(participantRatings) : null,
            allAvg: allParticipantRatings.length > 0 ? d3.mean(allParticipantRatings) : null,
            patchCount: participantRatings.length,
            totalCount: allParticipantRatings.length
        };
    }
    
    calculateUrbanScores(fixations) {
        // Simular scores de percepción urbana basados en clases semánticas
        const classScores = {
            'building': 6.5, 'wall': 5.2, 'road': 4.8, 'tree': 7.8,
            'sidewalk': 6.1, 'car': 4.2, 'person': 7.0, 'sky': 6.8,
            'window': 5.9, 'door': 6.3
        };
        
        // Agrupar por participante
        const participantScores = {};
        fixations.forEach(fix => {
            const participant = fix.participante;
            const mainClass = fix.class_names?.[0] || 'unknown';
            const score = classScores[mainClass] || 5.0;
            
            if (!participantScores[participant]) {
                participantScores[participant] = [];
            }
            participantScores[participant].push(score + (Math.random() - 0.5) * 2); // Variación
        });
        
        // Calcular score total y distribución
        const allScores = Object.values(participantScores).flat().filter(s => !isNaN(s) && isFinite(s));
        const totalScore = allScores.length > 0 ? d3.mean(allScores) : 5.0;
        const participantAvgs = Object.entries(participantScores).map(([p, scores]) => {
            const validScores = scores.filter(s => !isNaN(s) && isFinite(s));
            return {
                participant: p,
                score: validScores.length > 0 ? d3.mean(validScores) : 5.0
            };
        });
        
        return {
            totalScore: totalScore,
            participantScores: participantAvgs,
            distribution: allScores
        };
    }
    
    calculateDirections(fixations) {
        const directions = { Arriba: 0, Derecha: 0, Abajo: 0, Izquierda: 0 };
        
        if (fixations.length === 0) {
            console.log("📍 No hay fijaciones para calcular direcciones");
            return directions;
        }
        
        // Calcular centro del patch basado en las coordenadas de las fijaciones
        const validFixations = fixations.filter(fix => 
            !isNaN(fix.x_centroid) && !isNaN(fix.y_centroid)
        );
        
        if (validFixations.length === 0) {
            console.log("📍 No hay fijaciones válidas para calcular direcciones");
            return directions;
        }
        
        const centerX = validFixations.reduce((sum, fix) => sum + fix.x_centroid, 0) / validFixations.length;
        const centerY = validFixations.reduce((sum, fix) => sum + fix.y_centroid, 0) / validFixations.length;
        
        console.log("📍 Centro calculado del patch:", { centerX, centerY });
        console.log("📍 Total de fijaciones a procesar:", validFixations.length);
        
        validFixations.forEach((fix, index) => {
            const dx = fix.x_centroid - centerX;
            const dy = fix.y_centroid - centerY;
            
            console.log(`📍 Fijación ${index + 1}:`, {
                x: fix.x_centroid,
                y: fix.y_centroid,
                dx: dx,
                dy: dy,
                participante: fix.participante
            });
            
            // CAMBIO: Contar TODAS las fijaciones, no solo las que están lejos del centro
            if (dx >= 0 && dy <= 0) {
                // Cuadrante superior derecho
                directions.Arriba++;
                console.log(`  -> Arriba (dx=${dx}, dy=${dy})`);
            } else if (dx >= 0 && dy > 0) {
                // Cuadrante inferior derecho  
                directions.Derecha++;
                console.log(`  -> Derecha (dx=${dx}, dy=${dy})`);
            } else if (dx < 0 && dy > 0) {
                // Cuadrante inferior izquierdo
                directions.Abajo++;
                console.log(`  -> Abajo (dx=${dx}, dy=${dy})`);
            } else {
                // Cuadrante superior izquierdo
                directions.Izquierda++;
                console.log(`  -> Izquierda (dx=${dx}, dy=${dy})`);
            }
        });
        
        const total = Object.values(directions).reduce((a, b) => a + b, 0);
        console.log("📍 Direcciones calculadas:", directions);
        console.log("📍 Total contado:", total, "vs Original:", fixations.length);
        
        return directions;
    }
    
    renderHistogramCenter(histogramData) {
        console.log("📊 renderHistogramCenter called with:", histogramData);
        
        const { 
            patchParticipantsHistogram, 
            allParticipantsHistogram, 
            patchAvg, 
            allAvg, 
            patchCount, 
            totalCount 
        } = histogramData;
        
        // Configuración del histograma
        const histogramWidth = this.config.centerRadius * 2 - 20;
        const histogramHeight = this.config.centerRadius * 1.5;
        const margin = { top: 10, right: 5, bottom: 15, left: 5 };
        const innerWidth = histogramWidth - margin.left - margin.right;
        const innerHeight = histogramHeight - margin.top - margin.bottom;
        
        // Crear grupo para el histograma
        const histogramGroup = this.centerGroup.append("g")
            .attr("class", "histogram-group")
            .attr("transform", `translate(${-histogramWidth/2}, ${-histogramHeight/2})`);
        
        // Escalas
        const xScale = d3.scaleBand()
            .domain(d3.range(10)) // 0 a 9 (representando 0-1, 1-2, ..., 9-10)
            .range([margin.left, innerWidth + margin.left])
            .padding(0.1);
        
        const maxFreq = Math.max(
            ...patchParticipantsHistogram,
            ...allParticipantsHistogram,
            1 // Mínimo 1 para evitar división por 0
        );
        
        const yScale = d3.scaleLinear()
            .domain([0, maxFreq])
            .range([innerHeight + margin.top, margin.top]);
        
        // Dibujar barras de todos los participantes (azul)
        histogramGroup.selectAll(".all-participants-bar")
            .data(allParticipantsHistogram)
            .join("rect")
            .attr("class", "all-participants-bar")
            .attr("x", (d, i) => xScale(i))
            .attr("y", d => yScale(d))
            .attr("width", xScale.bandwidth() / 2)
            .attr("height", d => yScale(0) - yScale(d))
            .attr("fill", "#4ECDC4")
            .attr("opacity", 0.7)
            .attr("stroke", "white")
            .attr("stroke-width", 0.5);
        
        // Dibujar barras de participantes del patch (naranja)
        histogramGroup.selectAll(".patch-participants-bar")
            .data(patchParticipantsHistogram)
            .join("rect")
            .attr("class", "patch-participants-bar")
            .attr("x", (d, i) => xScale(i) + xScale.bandwidth() / 2)
            .attr("y", d => yScale(d))
            .attr("width", xScale.bandwidth() / 2)
            .attr("height", d => yScale(0) - yScale(d))
            .attr("fill", "#FF6B35")
            .attr("opacity", 0.8)
            .attr("stroke", "white")
            .attr("stroke-width", 0.5);
        
        // Eje X (scores 0-10)
        const xAxis = d3.axisBottom(xScale)
            .tickFormat(i => `${i}`)
            .tickSize(3);
            
        histogramGroup.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0, ${innerHeight + margin.top})`)
            .call(xAxis)
            .selectAll("text")
            .style("font-size", "8px")
            .style("fill", "#666");
        
        // Etiquetas de promedio
        const avgText = histogramGroup.append("text")
            .attr("class", "avg-text")
            .attr("x", histogramWidth / 2)
            .attr("y", margin.top - 2)
            .attr("text-anchor", "middle")
            .style("font-size", "8px")
            .style("font-weight", "bold")
            .style("fill", "#333");
            
        if (patchAvg !== null && allAvg !== null) {
            avgText.text(`Todos(${totalCount}): ${allAvg.toFixed(1)} | Patch(${patchCount}): ${patchAvg.toFixed(1)}`);
        } else if (allAvg !== null) {
            avgText.text(`Todos(${totalCount}): ${allAvg.toFixed(1)} | Patch: N/A`);
        } else {
            avgText.text(`Sin datos de ratings`);
        }
        
        // Leyenda mini
        const legend = histogramGroup.append("g")
            .attr("class", "mini-legend")
            .attr("transform", `translate(${margin.left}, ${innerHeight + margin.top + 10})`);
            
        legend.append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", 8)
            .attr("height", 4)
            .attr("fill", "#4ECDC4");
            
        legend.append("text")
            .attr("x", 10)
            .attr("y", 3)
            .style("font-size", "6px")
            .style("fill", "#666")
            .text("Todos");
            
        legend.append("rect")
            .attr("x", 35)
            .attr("y", 0)
            .attr("width", 8)
            .attr("height", 4)
            .attr("fill", "#FF6B35");
            
        legend.append("text")
            .attr("x", 45)
            .attr("y", 3)
            .style("font-size", "6px")
            .style("fill", "#666")
            .text("Patch");
    }
    
    calculateParticipantTimes(fixations, participant_scores = {}) {
        const participantTimes = {};
        
        // Calcular tiempos de participantes que tienen fijaciones en este patch
        fixations.forEach(fix => {
            const participant = fix.participante;
            const duration = isNaN(fix.duration) ? 0.1 : fix.duration; // Duración mínima por defecto
            
            if (!participantTimes[participant]) {
                participantTimes[participant] = 0;
            }
            participantTimes[participant] += duration;
        });
        
        console.log("👥 Participantes con fijaciones en patch:", Object.keys(participantTimes));
        console.log("👥 Todos los scores disponibles:", Object.keys(participant_scores));
        
        // INCLUIR todos los participantes, pero marcar cuáles no tienen score
        return Object.entries(participantTimes)
            .map(([p, time]) => {
                const participantId = parseInt(p);
                const scoreInfo = participant_scores[participantId];
                const hasScore = scoreInfo && scoreInfo.score !== null && scoreInfo.score !== undefined;
                
                if (!hasScore) {
                    console.log(`⚠️ Participante ${participantId} no evaluó esta imagen`);
                }
                
                return { 
                    participant: participantId, 
                    time: isNaN(time) ? 0.1 : time,
                    score: hasScore ? scoreInfo.score : null,
                    age: hasScore ? scoreInfo.age : null,
                    gender: hasScore ? scoreInfo.gender : null,
                    state: hasScore ? scoreInfo.state : null,
                    hasScore: hasScore
                };
            })
            .sort((a, b) => a.participant - b.participant);
    }
    
    renderCenter(scoresData) {
        console.log("🎨 renderCenter called with:", scoresData);
        
        const { totalScore, participantScores, distribution } = scoresData;
        
        // Validar datos
        const validTotalScore = isNaN(totalScore) ? 5.0 : totalScore;
        const validDistribution = (distribution || []).filter(x => !isNaN(x) && isFinite(x));
        
        if (validDistribution.length === 0) {
            console.warn("⚠️ No valid distribution data, using default");
            validDistribution.push(5.0); // Valor por defecto
        }
        
        console.log("✅ Validated data:", { validTotalScore, validDistribution: validDistribution.slice(0, 3) });
        
        // Crear escala de colores para densidad
        this.colors.density.domain(d3.extent(validDistribution));
        
        // Crear bins para histograma circular
        const bins = d3.histogram()
            .domain([1, 10])
            .thresholds(20)(validDistribution);
        
        const angleScale = d3.scaleLinear()
            .domain([0, bins.length])
            .range([0, 2 * Math.PI]);
            
        const radiusScale = d3.scaleLinear()
            .domain([0, d3.max(bins, d => d.length)])
            .range([10, this.config.centerRadius]);
        
        // Dibujar segmentos de densidad
        const arc = d3.arc()
            .innerRadius(10)
            .outerRadius(d => radiusScale(d.length))
            .startAngle((d, i) => angleScale(i))
            .endAngle((d, i) => angleScale(i + 1));
        
        this.centerGroup.selectAll(".density-segment")
            .data(bins)
            .join("path")
            .attr("class", "density-segment")
            .attr("d", arc)
            .attr("fill", d => this.colors.density(d.x0))
            .attr("stroke", "white")
            .attr("stroke-width", 1)
            .attr("opacity", 0.8);
        
        // Añadir texto del score total
        this.centerGroup.selectAll(".center-text").remove();
        this.centerGroup.append("text")
            .attr("class", "center-text")
            .attr("text-anchor", "middle")
            .attr("dy", "0.3em")
            .style("font-size", "14px")
            .style("font-weight", "bold")
            .style("fill", "#333")
            .text(`${validTotalScore.toFixed(1)}`);
    }
    
    renderRing1(directionsData) {
        // Crear cuadrantes fijos en orden: Arriba, Derecha, Abajo, Izquierda
        const directions = ['Arriba', 'Derecha', 'Abajo', 'Izquierda'];
        
        // Crear 4 cuadrantes de 90 grados cada uno
        const quadrantWidth = (2 * Math.PI) / 4; // 90 grados en radianes
        
        // Calcular ángulos para cada cuadrante (rotado para que apunten correctamente)
        const startAngles = {
            'Arriba': -Math.PI * 3/4,                 // -135° (apunta hacia arriba)
            'Derecha': -Math.PI / 4,                  // -45° (apunta hacia derecha)
            'Abajo': Math.PI / 4,                     // 45° (apunta hacia abajo)
            'Izquierda': Math.PI * 3/4                // 135° (apunta hacia izquierda)
        };
        
        const arc = d3.arc()
            .innerRadius(this.config.ring1InnerRadius)
            .outerRadius(this.config.ring1OuterRadius)
            .startAngle(d => startAngles[d])
            .endAngle(d => startAngles[d] + quadrantWidth);
        
        // Dibujar cuadrantes
        this.ring1Group.selectAll(".direction-segment")
            .data(directions)
            .join("path")
            .attr("class", "direction-segment")
            .attr("d", arc)
            .attr("fill", (d, i) => this.colors.directions[i])
            .attr("stroke", "white")
            .attr("stroke-width", 2)
            .attr("opacity", 0.8);
        
        // Añadir números de fijaciones en el centro de cada cuadrante
        this.ring1Group.selectAll(".direction-count")
            .data(directions)
            .join("text")
            .attr("class", "direction-count")
            .attr("transform", d => {
                const angle = startAngles[d] + quadrantWidth / 2; // Centro del cuadrante
                const radius = (this.config.ring1InnerRadius + this.config.ring1OuterRadius) / 2; // Centro del anillo
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                return `translate(${x}, ${y})`;
            })
            .attr("text-anchor", "middle")
            .attr("dy", "0.3em")
            .style("font-size", "16px")
            .style("font-weight", "bold")
            .style("fill", "white")
            .style("text-shadow", "1px 1px 2px rgba(0,0,0,0.7)")
            .text(d => directionsData[d] || 0);
        
        // Etiquetas de dirección eliminadas
    }
    
    renderRing2(participantsData, fixations = []) {
        console.log("🔄 NUEVA VERSIÓN - Rendering Ring2 con orientación corregida y bloques uniformes");
        console.log("🕒 Rendering Ring2 as 15-second timeline histogram with individual participant bars");
        console.log("📊 Fixations data:", fixations);
        console.log("👥 Participants data:", participantsData);
        
        // Crear histograma de 15 segundos (0-14 segundos)
        const timeHistogram = new Array(15).fill(0);
        
        // Crear histograma por participante: timeHistogramByParticipant[second][participantId] = {count, duration, fixations}
        const timeHistogramByParticipant = {};
        for (let sec = 0; sec < 15; sec++) {
            timeHistogramByParticipant[sec] = {};
        }
        
        // Obtener participantes únicos y crear escala de colores
        const participants = [...new Set(fixations.map(fix => fix.participante))].sort();
        const participantColorScale = d3.scaleOrdinal(d3.schemeCategory10)
            .domain(participants);
        
        console.log("👥 Unique participants:", participants);
        
        // ANÁLISIS COMPLETO DE DATOS
        console.log("🔍 ANÁLISIS DEBUG: Procesando fijaciones, total:", fixations.length);
        if (fixations.length > 0) {
            console.log("🔍 Primera fijación completa:", fixations[0]);
            console.log("🔍 Campos disponibles:", Object.keys(fixations[0]));
            console.log("🔍 Valores clave:");
            console.log("  - start:", fixations[0].start);
            console.log("  - end:", fixations[0].end);
            console.log("  - duration:", fixations[0].duration);
            console.log("  - participante:", fixations[0].participante);
            console.log("  - ImageName:", fixations[0].ImageName);
            console.log("  - ImageIndex:", fixations[0].ImageIndex);
        }
        
        // Mostrar todas las fijaciones para análisis
        console.log("🔍 TODAS LAS FIJACIONES:");
        fixations.forEach((fix, i) => {
            console.log(`  ${i}: start=${fix.start}, end=${fix.end}, duration=${fix.duration}, participante=${fix.participante}, ImageName=${fix.ImageName}`);
        });
        
        // Calcular tiempo relativo por imagen (0-15 segundos)
        // Los datos usan 'start' y 'end' en lugar de 'Time'
        const timesByParticipant = {};
        fixations.forEach(fix => {
            const participantId = fix.participante;
            const startTime = fix.start;
            const endTime = fix.end;
            
            if (startTime !== undefined && startTime !== null) {
                if (!timesByParticipant[participantId]) {
                    timesByParticipant[participantId] = [];
                }
                timesByParticipant[participantId].push(startTime);
                if (endTime !== undefined && endTime !== null) {
                    timesByParticipant[participantId].push(endTime);
                }
            }
        });
        
        // Calcular tiempo mínimo por participante para esta imagen
        const minTimeByParticipant = {};
        Object.keys(timesByParticipant).forEach(participantId => {
            const times = timesByParticipant[participantId];
            minTimeByParticipant[participantId] = Math.min(...times);
            console.log(`👤 Participante ${participantId}: tiempo mín=${minTimeByParticipant[participantId]}, máx=${Math.max(...times)}, rango=${Math.max(...times) - Math.min(...times)}s`);
        });
        
        let processedCount = 0;
        fixations.forEach((fix, index) => {
            const startTime = fix.start;
            const endTime = fix.end;
            const participantId = fix.participante;
            
            if (startTime !== undefined && startTime !== null && minTimeByParticipant[participantId] !== undefined) {
                // Usar el tiempo de inicio para la clasificación temporal
                const relativeTime = startTime - minTimeByParticipant[participantId];
                const timeInSeconds = Math.floor(relativeTime);
                
                if (index < 3) { // Debug para las primeras fijaciones
                    console.log(`🔧 Fijación ${index}: start=${startTime}, end=${endTime}, minTime=${minTimeByParticipant[participantId]}, relativeTime=${relativeTime}s, bucket=${timeInSeconds}s`);
                }
                
                // Solo procesar si está dentro del rango de 0-14 segundos
                if (timeInSeconds >= 0 && timeInSeconds < 15) {
                    timeHistogram[timeInSeconds]++;
                    
                    // Guardar información detallada por participante
                    if (!timeHistogramByParticipant[timeInSeconds][participantId]) {
                        timeHistogramByParticipant[timeInSeconds][participantId] = {
                            count: 0,
                            totalDuration: 0,
                            fixationTimes: []
                        };
                    }
                    
                    const duration = fix.duration || 0;
                    timeHistogramByParticipant[timeInSeconds][participantId].count++;
                    timeHistogramByParticipant[timeInSeconds][participantId].totalDuration += duration;
                    timeHistogramByParticipant[timeInSeconds][participantId].fixationTimes.push({
                        start: relativeTime.toFixed(2),
                        end: endTime ? (endTime - minTimeByParticipant[participantId]).toFixed(2) : 'N/A',
                        duration: duration.toFixed(3)
                    });
                    
                    processedCount++;
                    
                    if (index < 3) { // Solo mostrar las primeras 3 para debug
                        console.log(`✅ Fijación ${index}: segundo ${timeInSeconds}, participante ${participantId}, relativeTime=${relativeTime.toFixed(2)}s`);
                    }
                } else if (index < 3) {
                    console.log(`❌ Tiempo fuera de rango: ${timeInSeconds} segundos (relativeTime=${relativeTime.toFixed(2)}s)`);
                }
            } else if (index < 3) {
                console.log(`❌ Tiempo no válido para fijación ${index}: start=${startTime}, participante=${participantId}`);
            }
        });
        
        console.log(`📊 Procesadas ${processedCount} de ${fixations.length} fijaciones`);
        
        console.log("📊 Time histogram total:", timeHistogram);
        console.log("📊 Time histogram by participant:", timeHistogramByParticipant);
        
        // Configurar la escala angular (15 segmentos, empezando arriba y en sentido horario)
        const angleScale = d3.scaleBand()
            .domain(d3.range(15)) // 0 a 14 segundos
            .range([-Math.PI/2, -Math.PI/2 + 2*Math.PI]) // Empezar arriba (-90°) y completar círculo
            .paddingInner(0.02);
        
        // Escala radial basada en el máximo de fijaciones
        const maxFixations = Math.max(...timeHistogram, 1); // Mínimo 1 para evitar división por 0
        const radiusScale = d3.scaleLinear()
            .domain([0, maxFixations])
            .range([this.config.ring2InnerRadius, this.config.ring2OuterRadius]);
        
        // Crear tooltip
        const tooltip = d3.select("body").selectAll(".glyph-tooltip")
            .data([0])
            .join("div")
            .attr("class", "glyph-tooltip")
            .style("position", "absolute")
            .style("background", "rgba(0, 0, 0, 0.9)")
            .style("color", "white")
            .style("padding", "12px")
            .style("border-radius", "6px")
            .style("font-size", "12px")
            .style("line-height", "1.4")
            .style("pointer-events", "none")
            .style("opacity", 0)
            .style("z-index", 1000)
            .style("max-width", "300px")
            .style("box-shadow", "0 4px 12px rgba(0,0,0,0.4)");
        
        // Dibujar segmentos de fondo (grises) - solo si no hay datos
        this.ring2Group.selectAll(".time-segment-bg")
            .data(d3.range(15))
            .join("path")
            .attr("class", "time-segment-bg")
            .attr("d", (d, i) => {
                // Solo mostrar fondo si no hay datos en este segundo
                if (timeHistogram[i] === 0) {
                    const arc = d3.arc()
                        .innerRadius(this.config.ring2InnerRadius)
                        .outerRadius(this.config.ring2InnerRadius + 10) // Altura mínima
                        .startAngle(angleScale(i))
                        .endAngle(angleScale(i) + angleScale.bandwidth());
                    return arc();
                }
                return null;
            })
            .attr("fill", "#f0f0f0")
            .attr("stroke", "white")
            .attr("stroke-width", 1)
            .attr("opacity", 0.3);
        
        // ANÁLISIS DE HISTOGRAMA ANTES DE DIBUJAR
        console.log("🎨 ANÁLISIS PRE-RENDERIZADO:");
        console.log("📊 timeHistogram completo:", timeHistogram);
        console.log("📊 timeHistogramByParticipant completo:", timeHistogramByParticipant);
        
        let totalBarsToCreate = 0;
        for (let sec = 0; sec < 15; sec++) {
            const participantsInSecond = Object.keys(timeHistogramByParticipant[sec]);
            if (participantsInSecond.length > 0) {
                console.log(`📍 Segundo ${sec}: ${participantsInSecond.length} participantes con datos:`, participantsInSecond);
                totalBarsToCreate += participantsInSecond.length;
            }
        }
        console.log(`🎯 Total de barras a crear: ${totalBarsToCreate}`);
        
        // Dibujar barras individuales por participante
        let barsCreated = 0;
        for (let sec = 0; sec < 15; sec++) {
            const participantsInSecond = Object.keys(timeHistogramByParticipant[sec]);
            if (participantsInSecond.length === 0) continue;
            
            console.log(`🔧 RENDERIZANDO segundo ${sec} con participantes:`, participantsInSecond);
            
            // Calcular la altura acumulativa para apilar las barras
            let cumulativeHeight = 0;
            const totalFixationsInSecond = Object.values(timeHistogramByParticipant[sec]).reduce((a, b) => a + b.count, 0);
            
            console.log(`📊 Second ${sec}: Total fixations = ${totalFixationsInSecond}`);
            
            participantsInSecond.forEach(participantId => {
                const fixationData = timeHistogramByParticipant[sec][participantId];
                const fixationCount = fixationData.count;
                const participantInfo = participantsData.find(p => p.participant == participantId) || {};
                
                // Hacer que todas las barras tengan el mismo tamaño (distribución uniforme)
                const availableHeight = this.config.ring2OuterRadius - this.config.ring2InnerRadius;
                const participantsInThisSecond = participantsInSecond.length;
                const uniformBarHeight = availableHeight / participantsInThisSecond;
                const innerRadius = this.config.ring2InnerRadius + (cumulativeHeight * uniformBarHeight);
                const outerRadius = innerRadius + uniformBarHeight;
                
                console.log(`👤 Participant ${participantId} in second ${sec}: count=${fixationCount}, innerR=${innerRadius}, outerR=${outerRadius}, barHeight=${uniformBarHeight}`);
                
                // Crear el arco para esta barra
                const participantArc = d3.arc()
                    .innerRadius(innerRadius)
                    .outerRadius(outerRadius)
                    .startAngle(angleScale(sec))
                    .endAngle(angleScale(sec) + angleScale.bandwidth());
                
                // Dibujar la barra del participante
                const barElement = this.ring2Group.append("path")
                    .attr("class", `participant-bar participant-${participantId}`)
                    .attr("d", participantArc())
                    .attr("fill", participantColorScale(participantId))
                    .attr("stroke", "#333")
                    .attr("stroke-width", 1)
                    .attr("opacity", 0.9)
                    .style("cursor", "pointer")
                    .on("mouseover", function(event) {
                        // Resaltar la barra
                        d3.select(this).attr("opacity", 1).attr("stroke-width", 1);
                        
                        // Crear lista de tiempos de fijación
                        const fixationTimesList = fixationData.fixationTimes.map(ft => 
                            `${ft.start}s - ${ft.end}s (${ft.duration}s)`
                        ).join('<br/>                            ');
                        
                        // Mostrar tooltip con información detallada
                        const tooltipContent = `
                            <strong>Participante ${participantId}</strong><br/>
                            <strong>Segundo:</strong> ${sec}s<br/>
                            <strong>Fijaciones:</strong> ${fixationCount}<br/>
                            <strong>Duración total:</strong> ${fixationData.totalDuration.toFixed(3)}s<br/>
                            <strong>Tiempos de fijación:</strong><br/>
                            <div style="margin-left: 10px; font-size: 10px; color: #ccc;">
                                ${fixationTimesList}
                            </div>
                            <hr style="margin: 5px 0; border-color: #555;">
                            <strong>Score:</strong> ${participantInfo.score !== null ? participantInfo.score : 'N/A'}<br/>
                            <strong>Edad:</strong> ${participantInfo.age || 'N/A'}<br/>
                            <strong>Género:</strong> ${participantInfo.gender || 'N/A'}<br/>
                            <strong>Estado:</strong> ${participantInfo.state || 'N/A'}
                        `;
                        
                        tooltip.html(tooltipContent)
                            .style("left", (event.pageX + 10) + "px")
                            .style("top", (event.pageY - 10) + "px")
                            .transition()
                            .duration(200)
                            .style("opacity", 1);
                    })
                    .on("mouseout", function() {
                        // Quitar resaltado
                        d3.select(this).attr("opacity", 0.8).attr("stroke-width", 0.5);
                        
                        // Ocultar tooltip
                        tooltip.transition()
                            .duration(200)
                            .style("opacity", 0);
                    });
                
                console.log(`✅ BARRA CREADA: participante ${participantId}, segundo ${sec}, altura ${uniformBarHeight.toFixed(1)}px, color: ${participantColorScale(participantId)}`);
                barsCreated++;
                
                cumulativeHeight++; // Incrementar contador para la próxima barra
            });
        }
        
        console.log(`🎯 RESUMEN FINAL: Se crearon ${barsCreated} barras de ${totalBarsToCreate} esperadas`);
        
        // Agregar circunferencias de referencia en el anillo 2
        this.ring2Group.selectAll(".reference-circle").remove();
        
        // Circunferencia interior
        this.ring2Group.append("circle")
            .attr("class", "reference-circle")
            .attr("cx", 0)
            .attr("cy", 0)
            .attr("r", this.config.ring2InnerRadius)
            .attr("fill", "none")
            .attr("stroke", "#333")
            .attr("stroke-width", 1)
            .attr("opacity", 0.3);
        
        // Circunferencia exterior
        this.ring2Group.append("circle")
            .attr("class", "reference-circle")
            .attr("cx", 0)
            .attr("cy", 0)
            .attr("r", this.config.ring2OuterRadius)
            .attr("fill", "none")
            .attr("stroke", "#333")
            .attr("stroke-width", 1)
            .attr("opacity", 0.3);
        
        // Añadir etiquetas de segundos en el exterior del anillo
        this.ring2Group.selectAll(".time-label")
            .data(d3.range(15))
            .join("text")
            .attr("class", "time-label")
            .attr("transform", (d, i) => {
                const angle = angleScale(i) + angleScale.bandwidth() / 2;
                const radius = this.config.ring2OuterRadius + 15;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                return `translate(${x}, ${y})`;
            })
            .attr("text-anchor", "middle")
            .attr("dy", "0.3em")
            .style("font-size", "10px")
            .style("font-weight", "bold")
            .style("fill", "#333")
            .text(d => `${d}s`);
        
        // Añadir números de fijaciones totales en el centro de cada segmento (solo si > 0)
        this.ring2Group.selectAll(".fixation-count")
            .data(d3.range(15))
            .join("text")
            .attr("class", "fixation-count")
            .attr("transform", (d, i) => {
                const angle = angleScale(i) + angleScale.bandwidth() / 2;
                const radius = (this.config.ring2InnerRadius + radiusScale(timeHistogram[i])) / 2;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                return `translate(${x}, ${y})`;
            })
            .attr("text-anchor", "middle")
            .attr("dy", "0.3em")
            .style("font-size", "8px")
            .style("font-weight", "bold")
            .style("fill", "white")
            .style("text-shadow", "1px 1px 1px rgba(0,0,0,0.8)")
            .style("display", (d, i) => timeHistogram[i] > 0 ? "block" : "none")
            .text((d, i) => timeHistogram[i] > 0 ? timeHistogram[i] : "");
        
        // Añadir marcador del segundo 0 (inicio) - ahora está arriba
        this.ring2Group.selectAll(".start-marker").remove();
        this.ring2Group.append("line")
            .attr("class", "start-marker")
            .attr("x1", 0)
            .attr("y1", -this.config.ring2OuterRadius - 5)
            .attr("x2", 0)
            .attr("y2", -this.config.ring2OuterRadius - 20)
            .attr("stroke", "#ff4444")
            .attr("stroke-width", 3);
            
        this.ring2Group.append("text")
            .attr("class", "start-marker")
            .attr("x", 0)
            .attr("y", -this.config.ring2OuterRadius - 25)
            .attr("text-anchor", "middle")
            .style("font-size", "12px")
            .style("font-weight", "bold")
            .style("fill", "#ff4444")
            .text("0s START");
        
        // Añadir leyenda de participantes
        this.addParticipantLegend(participants, participantColorScale, participantsData);
        
        // VERIFICACIÓN FINAL DE ELEMENTOS EN EL DOM
        setTimeout(() => {
            const participantBars = this.ring2Group.selectAll(".participant-bar");
            const timeSegmentsBg = this.ring2Group.selectAll(".time-segment-bg");
            console.log("🔍 VERIFICACIÓN DOM:");
            console.log(`  - Barras de participantes en DOM: ${participantBars.size()}`);
            console.log(`  - Segmentos de fondo en DOM: ${timeSegmentsBg.size()}`);
            console.log(`  - Ring2Group existe: ${this.ring2Group.node() !== null}`);
            console.log(`  - Ring2Group visible: ${this.ring2Group.style('display') !== 'none'}`);
            
            if (participantBars.size() > 0) {
                console.log("🎯 Primera barra encontrada:", participantBars.node());
                console.log("🎯 Estilo de primera barra:", {
                    fill: participantBars.attr('fill'),
                    opacity: participantBars.attr('opacity'),
                    d: participantBars.attr('d')
                });
            }
        }, 100);
        
        console.log("✅ Ring2 timeline histogram with participant bars rendered");
        console.log(`📊 Total fixations: ${timeHistogram.reduce((a, b) => a + b, 0)}`);
        console.log(`👥 Participants represented: ${participants.length}`);
    }
    
    addParticipantLegend(participants, colorScale, participantsData) {
        console.log("🎨 Adding participant legend");
        
        // Remover leyenda anterior
        this.container.selectAll(".participant-legend").remove();
        
        // Crear contenedor de leyenda
        const legendContainer = this.container.append("div")
            .attr("class", "participant-legend")
            .style("position", "absolute")
            .style("top", "10px")
            .style("right", "10px")
            .style("background", "rgba(255, 255, 255, 0.9)")
            .style("border", "1px solid #ccc")
            .style("border-radius", "4px")
            .style("padding", "8px")
            .style("font-size", "12px")
            .style("max-height", "200px")
            .style("overflow-y", "auto")
            .style("box-shadow", "0 2px 4px rgba(0,0,0,0.1)");
        
        // Título de la leyenda
        legendContainer.append("div")
            .style("font-weight", "bold")
            .style("margin-bottom", "5px")
            .text("Participantes");
        
        // Crear elementos de leyenda para cada participante
        participants.forEach(participantId => {
            const participantInfo = participantsData.find(p => p.participant == participantId) || {};
            
            const legendItem = legendContainer.append("div")
                .style("display", "flex")
                .style("align-items", "center")
                .style("margin-bottom", "3px")
                .style("cursor", "pointer")
                .on("mouseover", function() {
                    // Resaltar todas las barras de este participante
                    d3.selectAll(`.participant-${participantId}`)
                        .attr("opacity", 1)
                        .attr("stroke-width", 2);
                })
                .on("mouseout", function() {
                    // Quitar resaltado
                    d3.selectAll(`.participant-${participantId}`)
                        .attr("opacity", 0.8)
                        .attr("stroke-width", 0.5);
                });
            
            // Cuadrado de color
            legendItem.append("div")
                .style("width", "12px")
                .style("height", "12px")
                .style("background-color", colorScale(participantId))
                .style("margin-right", "5px")
                .style("border", "1px solid white");
            
            // Texto del participante
            const participantText = `P${participantId}`;
            const scoreText = participantInfo.score !== null ? ` (${participantInfo.score})` : ' (N/A)';
            
            legendItem.append("span")
                .text(participantText + scoreText)
                .style("font-size", "11px");
        });
        
        console.log("✅ Participant legend added with", participants.length, "participants");
    }
    
    // Método para limpiar el glyph
    clear() {
        try {
            if (this.centerGroup) {
                this.centerGroup.selectAll("*").remove();
                // Limpiar específicamente el histograma
                this.centerGroup.selectAll(".histogram-group").remove();
            }
            if (this.ring1Group) this.ring1Group.selectAll("*").remove();
            if (this.ring2Group) {
                this.ring2Group.selectAll("*").remove();
                // Limpiar específicamente las etiquetas adicionales y barras de participantes
                this.ring2Group.selectAll(".participant-time-label").remove();
                this.ring2Group.selectAll(".participant-score-label").remove();
                this.ring2Group.selectAll(".participant-bar").remove();
                this.ring2Group.selectAll(".time-segment-bg").remove();
                this.ring2Group.selectAll(".reference-circle").remove();
            }
            // Limpiar leyenda de participantes
            this.container.selectAll(".participant-legend").remove();
            // Limpiar tooltip
            d3.select("body").selectAll(".glyph-tooltip").remove();
            console.log("🧹 RadialGlyph cleared successfully");
        } catch (error) {
            console.warn("⚠️ Error clearing RadialGlyph:", error);
            // Force clear the container
            if (this.container) {
                this.container.selectAll("*").remove();
            }
        }
    }
    
    // Método para forzar la reinicialización completa
    forceReset() {
        try {
            console.log("🔄 Force reset RadialGlyph");
            this.clear();
            this.initializeSVG();
        } catch (error) {
            console.error("❌ Error in force reset:", error);
        }
    }
}

// Función global para crear/actualizar el glyph radial
window.RadialGlyph = RadialGlyph;