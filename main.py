from flask import Flask, render_template, request, jsonify, redirect, url_for

from app.controllers.heatmap import *
from app.controllers.scarf_plot import *
from app.controllers.by_participant import *
from app.controllers.glyph import glyph_bp
from app.services.fixation_detection_ivt import get_fixations_ivt
import random
import json
import os
import pandas as pd
import numpy as np

app = Flask(__name__)

# Registrar blueprints
app.register_blueprint(glyph_bp)
app.register_blueprint(by_participant_bp)

# Cargar datos de gaze tracking
def load_gaze_data():
    try:
        data_path = os.path.join(os.path.dirname(__file__), 'static', 'data', 'df_final1.csv')
        return pd.read_csv(data_path)
    except Exception as e:
        print(f"Error loading gaze data: {e}")
        return None

# Crear mapeo de ImageName a ImageIndex
def create_imagename_to_index_mapping():
    """Crea un mapeo de ImageName a ImageIndex para búsquedas rápidas"""
    if gaze_data is None:
        return {}
    mapping = gaze_data[['ImageName', 'ImageIndex']].drop_duplicates().set_index('ImageName')['ImageIndex'].to_dict()
    return mapping

def get_image_index_from_name(image_name):
    """Convierte ImageName a ImageIndex"""
    if image_name in imagename_to_index:
        return imagename_to_index[image_name]
    # Si no está en el mapeo, intentar convertir directamente
    if gaze_data is not None:
        result = gaze_data[gaze_data['ImageName'] == image_name]['ImageIndex']
        if len(result) > 0:
            return int(result.iloc[0])
    return None

# Cargar I-VT precalculados
def load_ivt_cache():
    try:
        data_path = os.path.join(os.path.dirname(__file__), 'static', 'data', 'ivt_precalculated.csv')
        if os.path.exists(data_path):
            return pd.read_csv(data_path)
        else:
            print(f"Warning: IVT cache file not found at {data_path}")
            return None
    except Exception as e:
        print(f"Error loading IVT cache: {e}")
        return None

gaze_data = load_gaze_data()
ivt_cache = load_ivt_cache()
imagename_to_index = create_imagename_to_index_mapping()

@app.route('/api/heatmap/<int:image_id>', methods=['GET'])
def get_heatmap(image_id):
    """Obtiene datos de heatmap para una imagen (image_id es ImageName 0-149)"""
    top_n = request.args.get('top_n', 15, type=int)
    data_type = request.args.get('data_type', 'gaze').lower()
    dataset_select = request.args.get('dataset_select', 'main_class').lower()
    mode = request.args.get('mode', 'attention').lower()

    # Validar data_type
    if data_type not in ['fixations', 'gaze']:
        data_type = 'gaze'

    # Validar dataset_select
    if dataset_select not in ['main_class', 'grouped', 'disorder', 'grouped_disorder']:
        dataset_select = 'main_class'

    # Validar mode
    if mode not in ['attention', 'time']:
        mode = 'attention'

    # image_id es ImageName directamente (0-149)
    print(f"GET /api/heatmap/{image_id} - data_type: {data_type}, dataset_select: {dataset_select}, mode: {mode}")
    data = heatmap_controller.get_heatmap_data(image_id, top_n, data_type, dataset_select, mode=mode)
    return jsonify(data)

@app.route('/api/heatmap/participant/<int:participant_id>', methods=['GET'])
def get_attention_heatmap(participant_id):
    """Obtiene datos de heatmap para una imagen"""
    data = by_participant_controller.get_heatmap_data_for_participant(participant_id)
    return jsonify(data)

@app.route('/api/saliency-coverage/<int:participant_id>', methods=['GET'])
def get_saliency_coverage(participant_id):
    """Obtiene datos de saliency coverage para cada imagen de un participante"""
    data = by_participant_controller.get_saliency_coverage_data(participant_id)
    return jsonify(data)

@app.route('/api/participants/<int:image_id>', methods=['GET'])
def get_image_participants(image_id):
    """Obtiene los participantes válidos para una imagen (same source as heatmap/scarf plot)"""
    try:
        image_key = str(image_id)
        if image_key in heatmap_controller.scores_data:
            score_entries = heatmap_controller.scores_data[image_key].get('score_participant', [])
            participants = sorted(set([entry['participant'] for entry in score_entries]))
            return jsonify({'participants': participants, 'image_id': image_id})
        else:
            return jsonify({'participants': [], 'image_id': image_id, 'error': f'No data for image {image_id}'})
    except Exception as e:
        print(f"Error getting participants for image {image_id}: {e}")
        return jsonify({'participants': [], 'error': str(e)}), 400

@app.route('/api/scarf-plot/<int:image_id>', methods=['GET'])
def get_scarf_plot(image_id):
    """Obtiene datos del scarf plot para una imagen (image_id es ImageName 0-149)"""
    participant_id = request.args.get('participant_id', type=int)
    data_type = request.args.get('data_type', 'gaze').lower()
    dataset_select = request.args.get('dataset_select', 'main_class').lower()

    # Validar data_type
    if data_type not in ['fixations', 'gaze']:
        data_type = 'gaze'

    # Validar dataset_select
    if dataset_select not in ['main_class', 'grouped', 'disorder', 'grouped_disorder']:
        dataset_select = 'main_class'

    # image_id es ImageName directamente (0-149)
    print(f"GET /api/scarf-plot/{image_id} - data_type: {data_type}, dataset_select: {dataset_select}")
    data = scarf_controller.get_scarf_plot_data(image_id, participant_id, data_type, dataset_select)
    return jsonify(data)

@app.route('/', methods=['GET'])
def main():
    with open('static/data/data_hololens.json', 'r') as f:
        full_data = json.loads(f.read())

    # Obtener imágenes únicas de ImageName (en lugar de ImageIndex)
    unique_image_names = sorted(gaze_data['ImageName'].unique()) if gaze_data is not None else []

    # Crear data solo con las imágenes que tienen datos
    data = []
    for img_name in unique_image_names:
        key = str(int(img_name))
        if key in full_data:
            data.append({
                'id': key,
                'avg_hololens': full_data[key].get('avg_hololens', 0),
                'avg_pp2': full_data[key].get('avg_pp2', 0),
                'participants': sorted(full_data[key]['score_participant'], key=lambda x:x['score'], reverse=True)
            })

    data = sorted(data, key=lambda x: x['avg_hololens'], reverse=True)
    unique_images = [str(int(img_name)) for img_name in unique_image_names]

    unique_participants = {
        p["participant"]
        for img_name in unique_image_names
        for obj in [full_data.get(str(int(img_name)), {})]
        for p in obj.get("score_participant", [])
    }
    unique_participants = list(unique_participants)

    img_part_index = dict()
    for img_name in unique_image_names:
        key = str(int(img_name))
        if key in full_data:
            img_part_index[key] = sorted([x['participant'] for x in full_data[key]['score_participant']])

    return render_template('index2.html',
        data=data,
        all_images=unique_images,
        all_participants=unique_participants,
        img_part_index=img_part_index
    )

@app.route('/api/gaze-data/<int:image_id>', methods=['GET'])
def get_gaze_data(image_id):
    """Obtiene todos los puntos de gaze para una imagen (por ImageName)"""
    if gaze_data is None:
        return jsonify({'error': 'Gaze data not loaded'}), 400

    try:
        # Filtrar datos de gaze por ImageName (image_id es el ImageName)
        image_gaze_data = gaze_data[gaze_data['ImageName'] == image_id].copy()

        if len(image_gaze_data) == 0:
            return jsonify({'points': []})

        # Extraer coordenadas de píxeles
        points = []
        for _, row in image_gaze_data.iterrows():
            x = float(row.get('pixelX', 0))
            y = float(row.get('pixelY', 0))

            # Validar que sean números válidos y no cero (muchos ceros son inválidos)
            if not np.isnan(x) and not np.isnan(y) and (x > 0 or y > 0):
                points.append({'x': float(x), 'y': float(y)})

        return jsonify({'points': points})

    except Exception as e:
        import traceback
        print(f"Error getting gaze data: {e}")
        print(f"Full traceback:\n{traceback.format_exc()}")
        return jsonify({'error': str(e)}), 400

@app.route('/api/analyze-area/<int:image_id>', methods=['POST'])
def analyze_area(image_id):
    """Analiza las fijaciones IVT o puntos de gaze en un área específica de una imagen"""
    import time
    t_total_start = time.time()
    timings = {}

    if gaze_data is None:
        return jsonify({'error': 'Gaze data not loaded'}), 400

    try:
        t_step = time.time()

        # Obtener coordenadas del área desde el request
        area_data = request.get_json()
        x = area_data.get('x', 0)
        y = area_data.get('y', 0)
        width = area_data.get('width', 50)
        height = area_data.get('height', 50)

        # Obtener tipo de datos desde query parameter (fixations o gaze)
        data_type = request.args.get('data_type', 'fixations').lower()

        # Validar que sea uno de los tipos soportados
        if data_type not in ['fixations', 'gaze']:
            data_type = 'fixations'

        # Obtener participante seleccionado (opcional)
        participant_id = request.args.get('participant_id', None)
        if participant_id is not None:
            try:
                participant_id = int(participant_id)
            except (ValueError, TypeError):
                participant_id = None

        timings['request_parsing'] = (time.time() - t_step) * 1000

        print(f"\n=== /api/analyze-area/{image_id} ===")
        print(f"data_type parameter: {data_type}")
        print(f"participant_id parameter: {participant_id}")

        # Obtener TODOS los gaze data para esta imagen
        # IMPORTANTE: image_id es el ImageName (de la URL)
        t_step = time.time()
        image_gaze_data = gaze_data[gaze_data['ImageName'] == image_id].copy()

        # Filtrar por participante si se especificó
        if participant_id is not None:
            image_gaze_data = image_gaze_data[image_gaze_data['participante'] == participant_id].copy()
            print(f"Filtering by participant: {participant_id}")

        timings['filter_gaze_data'] = (time.time() - t_step) * 1000

        print(f"Image gaze data rows: {len(image_gaze_data)}")
        print(f"[TIMING] Filter gaze data: {timings['filter_gaze_data']:.1f}ms")

        if len(image_gaze_data) == 0:
            return jsonify({
                'fixations': [],
                'count': 0,
                'total_fixations_in_image': 0,
                'area': {'x': x, 'y': y, 'width': width, 'height': height},
                'participant_scores': {},
                'algorithm': 'I-VT',
                'parameters': {'velocity_threshold': 1.15, 'min_duration': 0.0},
                'error': f'No gaze data found for image {image_id}'
            })

        # SIEMPRE procesar AMBOS tipos de datos para poder usarlos en overlay independientemente
        # Obtener gaze points (VECTORIZADO - mucho más rápido que iterrows)
        t_step = time.time()
        print(f"Processing GAZE POINTS (vectorized)...")

        # Convertir a diccionarios de manera vectorizada
        # Solo incluir campos esenciales para gaze points (sin 'start' que confunde con fixations)
        gaze_records = image_gaze_data[[
            'participante', 'ImageIndex', 'ImageName', 'pixelX', 'pixelY', 'Time'
        ]].copy()

        # Renombrar columnas para que coincidan con el formato esperado
        gaze_records = gaze_records.rename(columns={
            'pixelX': 'x_centroid',
            'pixelY': 'y_centroid'
        })

        # Asignar campos necesarios
        gaze_records['pointCount'] = 1
        gaze_records['ImageName'] = gaze_records['ImageName'].astype('int')
        gaze_records['participante'] = gaze_records['participante'].fillna(0).astype('int')
        gaze_records['ImageIndex'] = gaze_records['ImageIndex'].astype('int')

        # Convertir a lista de diccionarios (vectorizado)
        all_gaze_points = gaze_records.to_dict('records')

        # Filtrar por área rectangular usando operaciones de Pandas (mucho más rápido)
        area_mask = (
            (gaze_records['x_centroid'] >= x) &
            (gaze_records['x_centroid'] <= x + width) &
            (gaze_records['y_centroid'] >= y) &
            (gaze_records['y_centroid'] <= y + height)
        )
        area_gaze_records = gaze_records[area_mask]
        area_gaze_points = area_gaze_records.to_dict('records')

        timings['gaze_processing'] = (time.time() - t_step) * 1000

        print(f"Total gaze points in image: {len(all_gaze_points)}")
        print(f"Gaze points in area: {len(area_gaze_points)}")
        print(f"[TIMING] Gaze processing: {timings['gaze_processing']:.1f}ms")

        # Obtener fixations desde cache precalculado (VECTORIZADO)
        t_step = time.time()
        print(f"Processing FIXATIONS (from precalculated cache - vectorized)...")
        all_fixations = []
        area_fixations = []

        if ivt_cache is not None:
            # CORRECCIÓN: Filtrar fixations por ImageName (no ImageIndex)
            # ImageIndex en raw_gaze es secuencial por participante, pero ImageName es el ID real
            image_fixations = ivt_cache[ivt_cache['ImageName'] == image_id].copy()

            # Filtrar por participante si se especificó
            if participant_id is not None:
                image_fixations = image_fixations[image_fixations['participante'] == participant_id].copy()
                print(f"Filtering fixations by participant: {participant_id}")

            if len(image_fixations) > 0:
                # Asegurar tipos de datos correctos
                image_fixations['participante'] = image_fixations['participante'].astype('int')
                image_fixations['ImageIndex'] = image_fixations['ImageIndex'].astype('int')
                image_fixations['start'] = image_fixations['start'].astype('float')
                image_fixations['end'] = image_fixations['end'].astype('float')
                image_fixations['duration'] = image_fixations['duration'].astype('float')
                image_fixations['x_centroid'] = image_fixations['x_centroid'].astype('float')
                image_fixations['y_centroid'] = image_fixations['y_centroid'].astype('float')
                image_fixations['pointCount'] = image_fixations['pointCount'].astype('int')
                image_fixations['class_names'] = [[]] * len(image_fixations)

                # Convertir a lista de diccionarios (vectorizado)
                all_fixations = image_fixations.to_dict('records')

                # Filtrar por área rectangular usando Pandas (mucho más rápido)
                fix_area_mask = (
                    (image_fixations['x_centroid'] >= x) &
                    (image_fixations['x_centroid'] <= x + width) &
                    (image_fixations['y_centroid'] >= y) &
                    (image_fixations['y_centroid'] <= y + height)
                )
                area_fixations = image_fixations[fix_area_mask].to_dict('records')
        else:
            print("Warning: IVT cache not available, returning empty fixations")
            all_fixations = []
            area_fixations = []

        timings['fixations_processing'] = (time.time() - t_step) * 1000

        print(f"Total fixations in image: {len(all_fixations)}")
        print(f"Fixations in area: {len(area_fixations)}")
        print(f"[TIMING] Fixations processing: {timings['fixations_processing']:.1f}ms")

        # Normalizar tiempos para que comiencen en 0 (PER PARTICIPANTE, PER IMAGE)
        # IMPORTANTE: Cada participante ve cada imagen durante exactamente 15 segundos
        # Cuando ImageIndex cambia, el tiempo debe reiniciar en 0 para ese participante
        # Los datos ya están filtrados por ImageName, así que participant_min_times
        # representa el momento cuando cada participante comenzó a ver ESTA imagen
        t_step = time.time()

        # NOTA: NO se aplica offset de 4 segundos - los tiempos son correctos
        # normalized_time = raw_time - min_time_para_esta_imagen
        # Resultado: 0-15 segundos (el tiempo que el participante vio esta imagen)

        # Calcular el tiempo mínimo POR PARTICIPANTE (para esta imagen específica)
        # IMPORTANTE: Incluir datos de TODA la imagen, no solo del área seleccionada
        # Esto asegura que los tiempos se normalicen correctamente
        participant_min_times = {}

        # Para ALL gaze points (no solo area_gaze_points)
        if all_gaze_points:
            for p in all_gaze_points:
                participant = p.get('participante')
                time_val = p.get('Time')
                if participant is not None and time_val is not None:
                    if participant not in participant_min_times:
                        participant_min_times[participant] = time_val
                    else:
                        participant_min_times[participant] = min(participant_min_times[participant], time_val)

        # Para ALL fixations (no solo area_fixations)
        if all_fixations:
            for f in all_fixations:
                participant = f.get('participante')
                start_time = f.get('start')
                if participant is not None and start_time is not None:
                    if participant not in participant_min_times:
                        participant_min_times[participant] = start_time
                    else:
                        participant_min_times[participant] = min(participant_min_times[participant], start_time)

        print(f"Normalization offsets per participant: {participant_min_times}")

        # DEBUG: Log sample time values before normalization
        if all_gaze_points:
            sample_gaze_before = [p.get('Time') for p in all_gaze_points[:5]]
            print(f"DEBUG: Sample gaze times BEFORE normalization: {sample_gaze_before}")
        if all_fixations:
            sample_fix_before = [f.get('start') for f in all_fixations[:5]]
            print(f"DEBUG: Sample fixation starts BEFORE normalization: {sample_fix_before}")

        # Aplicar normalización POR PARTICIPANTE
        def normalize_times_per_participant(data_list, time_field, participant_field='participante'):
            """Subtract participant's min_time from time field (per-image normalization)"""
            for item in data_list:
                participant = item.get(participant_field)
                time_val = item.get(time_field)

                # Si no hay participante, no podemos normalizar
                if participant is None or time_val is None:
                    continue

                # Si el participante no está en min_times, saltar (pero imprimir warning)
                if participant not in participant_min_times:
                    print(f"Warning: Participant {participant} not in participant_min_times, skipping normalization for {time_field}")
                    continue

                try:
                    # Normalizar: restar el tiempo mínimo para este participante en esta imagen
                    # Resultado: tiempos de 0-15 segundos (duración de visualización de imagen)
                    normalized_time = float(item[time_field]) - float(participant_min_times[participant])
                    item[time_field] = float(normalized_time)  # Asegurar que es un float válido
                except (TypeError, ValueError) as e:
                    print(f"Warning: Could not normalize time for {time_field}: {e}, keeping original value")
                    # Si hay error, dejar el valor original
            return data_list

        # Normalizar gaze points (POR PARTICIPANTE)
        all_gaze_points = normalize_times_per_participant(all_gaze_points, 'Time')
        area_gaze_points = normalize_times_per_participant(area_gaze_points, 'Time')

        # DEBUG: Verificar que la normalización se aplicó
        if area_gaze_points:
            sample_times_after = [p.get('Time') for p in area_gaze_points[:5]]
            print(f"DEBUG: Sample gaze times AFTER normalization: {sample_times_after}")

        # Normalizar fixations (POR PARTICIPANTE - start, end)
        def normalize_fixations_per_participant(fix_list):
            for fix in fix_list:
                participant = fix.get('participante')
                if participant in participant_min_times:
                    try:
                        if fix.get('start') is not None:
                            # Normalizar: restar tiempo mínimo para este participante en esta imagen
                            normalized_start = float(fix['start']) - float(participant_min_times[participant])
                            fix['start'] = float(normalized_start)
                        if fix.get('end') is not None:
                            # Normalizar: restar tiempo mínimo para este participante en esta imagen
                            normalized_end = float(fix['end']) - float(participant_min_times[participant])
                            fix['end'] = float(normalized_end)
                    except (TypeError, ValueError) as e:
                        print(f"Warning: Could not normalize fixation times: {e}, keeping original values")
            return fix_list

        all_fixations = normalize_fixations_per_participant(all_fixations)
        area_fixations = normalize_fixations_per_participant(area_fixations)

        # DEBUG: Log sample time values after normalization
        if all_gaze_points:
            sample_gaze_after = [p.get('Time') for p in all_gaze_points[:5]]
            print(f"DEBUG: Sample gaze times AFTER normalization (per-participant): {sample_gaze_after}")
        if all_fixations:
            sample_fix_after = [f.get('start') for f in all_fixations[:5]]
            print(f"DEBUG: Sample fixation starts AFTER normalization (per-participant): {sample_fix_after}")

        timings['time_normalization'] = (time.time() - t_step) * 1000

        # Seleccionar qué datos usar para el análisis principal según data_type
        if data_type == 'fixations':
            area_data_points = area_fixations
            total_data_points = len(all_fixations)
        else:  # data_type == 'gaze'
            area_data_points = area_gaze_points
            total_data_points = len(all_gaze_points)

        # Vectorized NaN cleaning usando Pandas (mucho más rápido que list comprehension)
        t_step = time.time()

        def clean_data_vectorized(data_list):
            """Vectorized NaN cleaning - 20-30x más rápido que list comprehension"""
            if not data_list:
                return data_list

            # Convertir a DataFrame para operaciones vectorizadas
            df = pd.DataFrame(data_list)

            # Rellenar NaN con None para todos los campos
            df = df.where(pd.notna(df), None)

            # Asegurar que 'score' siempre existe y tiene un valor por defecto
            if 'score' in df.columns:
                df['score'] = df['score'].fillna(5.0)
            else:
                df['score'] = 5.0

            # Convertir back a lista de diccionarios
            return df.to_dict('records')

        # Procesar todos los datos con vectorización
        area_gaze_points = clean_data_vectorized(area_gaze_points)
        area_fixations = clean_data_vectorized(area_fixations)
        area_data_points = clean_data_vectorized(area_data_points)

        timings['data_cleanup'] = (time.time() - t_step) * 1000

        # NUEVO: Cargar scores de TODOS los participantes para esta imagen
        # desde data_hololens.json
        t_step = time.time()
        participant_scores = {}
        try:
            with open('static/data/data_hololens.json', 'r') as f:
                full_data = json.loads(f.read())

            # Buscar la imagen en el JSON por ImageName (que es el image_id de la URL)
            image_name = str(image_id)
            if image_name in full_data:
                image_data = full_data[image_name]
                score_participant = image_data.get('score_participant', [])

                # Crear diccionario de scores por participante
                for score_info in score_participant:
                    participant_id = score_info.get('participant')
                    score = score_info.get('score')
                    if participant_id is not None:
                        participant_scores[int(participant_id)] = {
                            'score': score,
                            'age': score_info.get('age'),
                            'gender': score_info.get('gender'),
                            'state': score_info.get('state')
                        }
        except Exception as e:
            print(f"Warning: Could not load participant scores: {e}")

        timings['participant_scores'] = (time.time() - t_step) * 1000
        timings['total'] = (time.time() - t_total_start) * 1000

        print(f"DEBUG: Returning with {len(area_gaze_points)} gaze_points and {len(area_fixations)} fixations")
        print(f"[TIMING] Data cleanup: {timings['data_cleanup']:.1f}ms")
        print(f"[TIMING] Participant scores: {timings['participant_scores']:.1f}ms")
        print(f"[TIMING] TOTAL API TIME: {timings['total']:.1f}ms")
        print(f"[TIMING] Breakdown: parse={timings['request_parsing']:.1f}ms, filter_gaze={timings['filter_gaze_data']:.1f}ms, gaze_proc={timings['gaze_processing']:.1f}ms, fix_proc={timings['fixations_processing']:.1f}ms, norm_time={timings['time_normalization']:.1f}ms, cleanup={timings['data_cleanup']:.1f}ms, scores={timings['participant_scores']:.1f}ms")

        t_step = time.time()
        response = jsonify({
            'gaze_points': area_gaze_points,  # Puntos de gaze para overlay
            'fixations': area_fixations,      # Fixations para overlay
            'data_for_analysis': area_data_points,  # Datos para análisis (gaze o fixations según data_type)
            'count': len(area_data_points),
            'total_fixations_in_image': total_data_points,
            'area': {
                'x': x,
                'y': y,
                'width': width,
                'height': height
            },
            'participant_scores': participant_scores,
            'data_type': data_type,  # Retornar el tipo de datos usado
            'algorithm': 'I-VT' if data_type == 'fixations' else 'Raw Gaze',
            'parameters': {
                'velocity_threshold': 1.15 if data_type == 'fixations' else None,
                'min_duration': 0.0 if data_type == 'fixations' else None
            }
        })
        timings['json_serialization'] = (time.time() - t_step) * 1000
        print(f"[TIMING] JSON serialization: {timings['json_serialization']:.1f}ms")
        return response
    except Exception as e:
        import traceback
        print(f"Error analyzing area: {e}")
        print(f"Full traceback:\n{traceback.format_exc()}")
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 400

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8081)
