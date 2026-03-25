from flask import Flask, render_template, request, jsonify, redirect, url_for
from app.shared.cache import cache

from app.controllers.heatmap import *
from app.controllers.scarf_plot import *
from app.controllers.by_participant import *
from app.controllers.glyph import glyph_bp
from app.services.fixation_detection_ivt import get_fixations_ivt
from app.services.overlay_precompute_service import get_overlay_precompute_service
from app.shared.ivt_cache_service import get_ivt_cache_service
import random
import json
import os
import math
import pandas as pd
import numpy as np

BACKEND_DEBUG_LOGS = str(os.environ.get('BACKEND_DEBUG_LOGS', '0')).lower() in ['1', 'true', 'yes']


def backend_log(*args, **kwargs):
    if BACKEND_DEBUG_LOGS:
        print(*args, **kwargs)

app = Flask(__name__)
cache.init_app(app, config={
    'CACHE_TYPE': 'SimpleCache',
    'CACHE_DEFAULT_TIMEOUT': 300
})

# Registrar blueprints
app.register_blueprint(glyph_bp)
app.register_blueprint(by_participant_bp)


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

def get_combined_min_times(image_id, participant_id=None):
    combined = {}

    for src in (gaze_min_time_cache.get(image_id, {}), ivt_min_time_cache.get(image_id, {})):
        for pid, min_time in src.items():
            if participant_id is not None and int(pid) != int(participant_id):
                continue
            if pid not in combined:
                combined[pid] = float(min_time)
            else:
                combined[pid] = min(combined[pid], float(min_time))

    return combined

def safe_clean_records(records):
    if not records:
        return records

    for row in records:
        for key, value in list(row.items()):
            if isinstance(value, float):
                if math.isnan(value) or math.isinf(value):
                    row[key] = None
            elif value is None:
                continue
            else:
                try:
                    if pd.isna(value):
                        row[key] = None
                except Exception:
                    pass

        if row.get('score') is None:
            row['score'] = 5.0

    return records

_ASSET_FILES = [
    os.path.join('static', 'styles.css'),
    os.path.join('static', 'main2.js'),
    os.path.join('static', 'js', 'overlay.js'),
    os.path.join('static', 'js', 'segmentation.js'),
    os.path.join('static', 'js', 'scarf.js'),
    os.path.join('static', 'js', 'heatmap-viz.js'),
    os.path.join('static', 'js', 'charts.js'),
    os.path.join('static', 'js', 'brush.js'),
    os.path.join('static', 'js', 'controls.js'),
    os.path.join('static', 'js', 'init.js')
]

def get_assets_version():
    """Version token for static assets based on latest mtime."""
    mtimes = []
    base_dir = os.path.dirname(os.path.abspath(__file__))
    for rel_path in _ASSET_FILES:
        abs_path = os.path.join(base_dir, rel_path)
        if os.path.exists(abs_path):
            mtimes.append(int(os.path.getmtime(abs_path)))
    return max(mtimes) if mtimes else 1

_svc = get_ivt_cache_service()
gaze_data                = _svc.gaze_data
ivt_cache                = _svc.ivt_cache
hololens_data_cache      = _svc.hololens_data
gaze_data_by_image       = _svc.gaze_data_by_image
ivt_cache_by_image       = _svc.ivt_cache_by_image
gaze_min_time_cache      = _svc.gaze_min_time_cache
ivt_min_time_cache       = _svc.ivt_min_time_cache
participant_scores_cache = _svc.participant_scores
imagename_to_index       = _svc.imagename_to_index
overlay_precompute_service = get_overlay_precompute_service()
overlay_precompute_service.configure_sources(gaze_data_by_image, ivt_cache_by_image)

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
    backend_log(f"GET /api/heatmap/{image_id} - data_type: {data_type}, dataset_select: {dataset_select}, mode: {mode}")
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
    backend_log(f"GET /api/scarf-plot/{image_id} - data_type: {data_type}, dataset_select: {dataset_select}")
    data = scarf_controller.get_scarf_plot_data(image_id, participant_id, data_type, dataset_select)
    return jsonify(data)

@app.route('/', methods=['GET'])
def main():
    full_data = hololens_data_cache

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
                'participants': sorted(full_data[key]['score_participant'], key=lambda x:x['participant'], reverse=True)
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
        img_part_index=img_part_index,
        asset_version=get_assets_version()
    )

@app.route('/api/gaze-data/<int:image_id>', methods=['GET'])
def get_gaze_data(image_id):
    """Obtiene todos los puntos de gaze para una imagen (por ImageName)"""
    if gaze_data is None:
        return jsonify({'error': 'Gaze data not loaded'}), 400

    try:
        # Filtrar datos de gaze por ImageName (image_id es el ImageName)
        if image_id in gaze_data_by_image:
            image_gaze_data = gaze_data_by_image[image_id]
        else:
            image_gaze_data = gaze_data[gaze_data['ImageName'] == image_id]

        if len(image_gaze_data) == 0:
            return jsonify({'points': []})

        # Extraer coordenadas de píxeles (vectorizado)
        coords = image_gaze_data[['pixelX', 'pixelY']].copy()
        coords['pixelX'] = pd.to_numeric(coords['pixelX'], errors='coerce')
        coords['pixelY'] = pd.to_numeric(coords['pixelY'], errors='coerce')
        valid_mask = coords['pixelX'].notna() & coords['pixelY'].notna() & (
            (coords['pixelX'] > 0) | (coords['pixelY'] > 0)
        )
        points = (
            coords.loc[valid_mask, ['pixelX', 'pixelY']]
            .rename(columns={'pixelX': 'x', 'pixelY': 'y'})
            .astype(float)
            .to_dict('records')
        )

        return jsonify({'points': points})

    except Exception as e:
        import traceback
        print(f"Error getting gaze data: {e}")
        print(f"Full traceback:\n{traceback.format_exc()}")
        return jsonify({'error': str(e)}), 400


@app.route('/api/precomputed-overlays/<int:image_id>', methods=['GET'])
def get_precomputed_overlays(image_id):
    """Devuelve URLs de overlays precomputados (heatmap y contour)."""
    data_type = request.args.get('data_type', 'gaze').lower()
    if data_type not in ['gaze', 'fixations']:
        data_type = 'gaze'

    force = str(request.args.get('force', 'false')).lower() in ['1', 'true', 'yes']
    try:
        result = overlay_precompute_service.generate_for_image(image_id, data_type=data_type, force=force)
        return jsonify({
            'image_id': image_id,
            'data_type': data_type,
            'heatmap_url': result.get('heatmap_url'),
            'contour_url': result.get('contour_url'),
            'generated': bool(result.get('generated', False)),
            'status': 'success'
        })
    except Exception as e:
        import traceback
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 500

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
        area_data = request.get_json() or {}

        def to_float(value, default=0.0):
            try:
                return float(value)
            except (TypeError, ValueError):
                return float(default)

        x = to_float(area_data.get('x', 0), 0)
        y = to_float(area_data.get('y', 0), 0)
        width = to_float(area_data.get('width', 50), 50)
        height = to_float(area_data.get('height', 50), 50)

        # Soporte para selección circular (centro+radio)
        shape = str(area_data.get('shape', 'rectangle')).lower()
        if shape in ['rect', 'box']:
            shape = 'rectangle'
        if shape not in ['rectangle', 'circle']:
            shape = 'rectangle'

        center_x = None
        center_y = None
        radius = None
        if shape == 'circle':
            center_x = to_float(area_data.get('center_x', x + (width / 2.0)), x + (width / 2.0))
            center_y = to_float(area_data.get('center_y', y + (height / 2.0)), y + (height / 2.0))
            radius = max(1.0, to_float(area_data.get('radius', min(width, height) / 2.0), min(width, height) / 2.0))
            x = center_x - radius
            y = center_y - radius
            width = radius * 2.0
            height = radius * 2.0

        # Obtener tipo de datos desde query parameter (fixations o gaze)
        data_type = request.args.get('data_type', 'fixations').lower()

        # Validar que sea uno de los tipos soportados
        if data_type not in ['fixations', 'gaze']:
            data_type = 'fixations'

        include_all_data = str(request.args.get('include_all_data', 'false')).lower() in ['1', 'true', 'yes']
        need_gaze_points = include_all_data or data_type == 'gaze'
        need_fixations = include_all_data or data_type == 'fixations'

        # Obtener participante seleccionado (opcional)
        participant_id = request.args.get('participant_id', None)
        if participant_id is not None:
            try:
                participant_id = int(participant_id)
            except (ValueError, TypeError):
                participant_id = None

        timings['request_parsing'] = (time.time() - t_step) * 1000

        backend_log(f"\n=== /api/analyze-area/{image_id} ===")
        backend_log(f"data_type parameter: {data_type}")
        backend_log(f"participant_id parameter: {participant_id}")
        backend_log(f"selection shape: {shape}")

        # Obtener TODOS los gaze data para esta imagen
        # IMPORTANTE: image_id es el ImageName (de la URL)
        t_step = time.time()
        if image_id in gaze_data_by_image:
            image_gaze_data = gaze_data_by_image[image_id]
        else:
            image_gaze_data = gaze_data[gaze_data['ImageName'] == image_id]

        # Filtrar por participante si se especificó
        if participant_id is not None:
            image_gaze_data = image_gaze_data[image_gaze_data['participante'] == participant_id]
            backend_log(f"Filtering by participant: {participant_id}")

        image_gaze_data = image_gaze_data.copy()

        timings['filter_gaze_data'] = (time.time() - t_step) * 1000

        backend_log(f"Image gaze data rows: {len(image_gaze_data)}")
        backend_log(f"[TIMING] Filter gaze data: {timings['filter_gaze_data']:.1f}ms")

        if len(image_gaze_data) == 0:
            area_response = {
                'shape': shape,
                'x': x,
                'y': y,
                'width': width,
                'height': height
            }
            if shape == 'circle':
                area_response.update({
                    'center_x': center_x,
                    'center_y': center_y,
                    'radius': radius
                })
            return jsonify({
                'fixations': [],
                'count': 0,
                'total_fixations_in_image': 0,
                'area': area_response,
                'participant_scores': {},
                'algorithm': 'I-VT',
                'parameters': {'velocity_threshold': 1.15, 'min_duration': 0.0},
                'error': f'No gaze data found for image {image_id}'
            })

        # Procesar solo lo necesario (o ambos si include_all_data=true)
        total_gaze_points = 0
        area_gaze_points = []
        area_gaze_df = None
        gaze_records = None

        if need_gaze_points:
            t_step = time.time()
            backend_log(f"Processing GAZE POINTS (vectorized)...")

            base_gaze_columns = ['participante', 'ImageIndex', 'ImageName', 'pixelX', 'pixelY', 'Time']
            optional_semantic_columns = [
                col for col in ['main_class', 'group', 'group_name', 'class_id', 'group_class_id']
                if col in image_gaze_data.columns
            ]
            gaze_records = image_gaze_data[base_gaze_columns + optional_semantic_columns].copy()
            gaze_records = gaze_records.rename(columns={
                'pixelX': 'x_centroid',
                'pixelY': 'y_centroid'
            })

            gaze_records['pointCount'] = 1
            gaze_records['ImageName'] = gaze_records['ImageName'].astype('int')
            gaze_records['participante'] = gaze_records['participante'].fillna(0).astype('int')
            gaze_records['ImageIndex'] = gaze_records['ImageIndex'].astype('int')
            total_gaze_points = len(gaze_records)

            if shape == 'circle':
                gaze_dx = gaze_records['x_centroid'] - center_x
                gaze_dy = gaze_records['y_centroid'] - center_y
                area_mask = (gaze_dx * gaze_dx + gaze_dy * gaze_dy) <= (radius * radius)
            else:
                area_mask = (
                    (gaze_records['x_centroid'] >= x) &
                    (gaze_records['x_centroid'] <= x + width) &
                    (gaze_records['y_centroid'] >= y) &
                    (gaze_records['y_centroid'] <= y + height)
                )
            area_gaze_df = gaze_records[area_mask].copy()
            area_gaze_points = area_gaze_df.to_dict('records')

            timings['gaze_processing'] = (time.time() - t_step) * 1000
            backend_log(f"Total gaze points in image: {total_gaze_points}")
            backend_log(f"Gaze points in area: {len(area_gaze_points)}")
            backend_log(f"[TIMING] Gaze processing: {timings['gaze_processing']:.1f}ms")
        else:
            timings['gaze_processing'] = 0.0

        total_fixations = 0
        area_fixations = []
        area_fixations_df = None

        if need_fixations:
            t_step = time.time()
            backend_log(f"Processing FIXATIONS (from precalculated cache - vectorized)...")

            if ivt_cache is not None:
                if image_id in ivt_cache_by_image:
                    image_fixations = ivt_cache_by_image[image_id]
                else:
                    image_fixations = ivt_cache[ivt_cache['ImageName'] == image_id]

                if participant_id is not None:
                    image_fixations = image_fixations[image_fixations['participante'] == participant_id]
                    backend_log(f"Filtering fixations by participant: {participant_id}")

                image_fixations = image_fixations.copy()
                total_fixations = len(image_fixations)

                if total_fixations > 0:
                    if 'class_names' not in image_fixations.columns:
                        image_fixations['class_names'] = [[] for _ in range(total_fixations)]

                    if shape == 'circle':
                        fix_dx = image_fixations['x_centroid'] - center_x
                        fix_dy = image_fixations['y_centroid'] - center_y
                        fix_area_mask = (fix_dx * fix_dx + fix_dy * fix_dy) <= (radius * radius)
                    else:
                        fix_area_mask = (
                            (image_fixations['x_centroid'] >= x) &
                            (image_fixations['x_centroid'] <= x + width) &
                            (image_fixations['y_centroid'] >= y) &
                            (image_fixations['y_centroid'] <= y + height)
                        )
                    area_fixations_df = image_fixations[fix_area_mask].copy()
                    area_fixations = area_fixations_df.to_dict('records')
            else:
                backend_log("Warning: IVT cache not available, returning empty fixations")

            timings['fixations_processing'] = (time.time() - t_step) * 1000
            backend_log(f"Total fixations in image: {total_fixations}")
            backend_log(f"Fixations in area: {len(area_fixations)}")
            backend_log(f"[TIMING] Fixations processing: {timings['fixations_processing']:.1f}ms")
        else:
            timings['fixations_processing'] = 0.0

        # Normalizar tiempos para que comiencen en 0 (PER PARTICIPANTE, PER IMAGE)
        # IMPORTANTE: Cada participante ve cada imagen durante exactamente 15 segundos
        # Cuando ImageIndex cambia, el tiempo debe reiniciar en 0 para ese participante
        t_step = time.time()
        participant_min_times = get_combined_min_times(image_id, participant_id=participant_id)

        # Fallback defensivo si algún participante no estuviera en caché
        if not participant_min_times and gaze_records is not None and len(gaze_records) > 0:
            fallback_series = gaze_records.groupby('participante')['Time'].min()
            participant_min_times = {int(pid): float(val) for pid, val in fallback_series.items()}

        # Aplicar normalización POR PARTICIPANTE (vectorizado)
        if need_gaze_points and area_gaze_df is not None and not area_gaze_df.empty:
            participant_numeric = pd.to_numeric(area_gaze_df['participante'], errors='coerce')
            offsets = participant_numeric.map(participant_min_times)
            time_values = pd.to_numeric(area_gaze_df['Time'], errors='coerce')
            valid_norm = offsets.notna() & time_values.notna()
            area_gaze_df.loc[valid_norm, 'Time'] = (time_values[valid_norm] - offsets[valid_norm]).astype(float)
            area_gaze_points = area_gaze_df.to_dict('records')

        if need_fixations and area_fixations_df is not None and not area_fixations_df.empty:
            participant_numeric = pd.to_numeric(area_fixations_df['participante'], errors='coerce')
            offsets = participant_numeric.map(participant_min_times)
            valid_offsets = offsets.notna()

            for time_col in ['start', 'end']:
                if time_col in area_fixations_df.columns:
                    time_vals = pd.to_numeric(area_fixations_df[time_col], errors='coerce')
                    valid_norm = valid_offsets & time_vals.notna()
                    area_fixations_df.loc[valid_norm, time_col] = (time_vals[valid_norm] - offsets[valid_norm]).astype(float)

            area_fixations = area_fixations_df.to_dict('records')

        timings['time_normalization'] = (time.time() - t_step) * 1000

        # Seleccionar qué datos usar para el análisis principal según data_type
        if data_type == 'fixations':
            area_data_points = area_fixations
            total_data_points = total_fixations
        else:  # data_type == 'gaze'
            area_data_points = area_gaze_points
            total_data_points = total_gaze_points

        # Limpieza de NaN/inf para serialización JSON
        t_step = time.time()
        area_gaze_points = safe_clean_records(area_gaze_points)
        area_fixations = safe_clean_records(area_fixations)
        area_data_points = safe_clean_records(area_data_points)

        timings['data_cleanup'] = (time.time() - t_step) * 1000

        # NUEVO: Cargar scores de TODOS los participantes para esta imagen
        # desde data_hololens.json
        t_step = time.time()
        participant_scores = dict(participant_scores_cache.get(image_id, {}))

        timings['participant_scores'] = (time.time() - t_step) * 1000
        timings['total'] = (time.time() - t_total_start) * 1000

        backend_log(f"DEBUG: Returning with {len(area_gaze_points)} gaze_points and {len(area_fixations)} fixations")
        backend_log(f"[TIMING] Data cleanup: {timings['data_cleanup']:.1f}ms")
        backend_log(f"[TIMING] Participant scores: {timings['participant_scores']:.1f}ms")
        backend_log(f"[TIMING] TOTAL API TIME: {timings['total']:.1f}ms")
        backend_log(f"[TIMING] Breakdown: parse={timings['request_parsing']:.1f}ms, filter_gaze={timings['filter_gaze_data']:.1f}ms, gaze_proc={timings['gaze_processing']:.1f}ms, fix_proc={timings['fixations_processing']:.1f}ms, norm_time={timings['time_normalization']:.1f}ms, cleanup={timings['data_cleanup']:.1f}ms, scores={timings['participant_scores']:.1f}ms")

        area_response = {
            'shape': shape,
            'x': x,
            'y': y,
            'width': width,
            'height': height
        }
        if shape == 'circle':
            area_response.update({
                'center_x': center_x,
                'center_y': center_y,
                'radius': radius
            })

        t_step = time.time()
        response = jsonify({
            'gaze_points': area_gaze_points,  # Puntos de gaze para overlay
            'fixations': area_fixations,      # Fixations para overlay
            'data_for_analysis': area_data_points,  # Datos para análisis (gaze o fixations según data_type)
            'count': len(area_data_points),
            'total_fixations_in_image': total_data_points,
            'area': area_response,
            'participant_scores': participant_scores,
            'data_type': data_type,  # Retornar el tipo de datos usado
            'algorithm': 'I-VT' if data_type == 'fixations' else 'Raw Gaze',
            'parameters': {
                'velocity_threshold': 1.15 if data_type == 'fixations' else None,
                'min_duration': 0.0 if data_type == 'fixations' else None
            }
        })
        timings['json_serialization'] = (time.time() - t_step) * 1000
        backend_log(f"[TIMING] JSON serialization: {timings['json_serialization']:.1f}ms")
        return response
    except Exception as e:
        import traceback
        print(f"Error analyzing area: {e}")
        print(f"Full traceback:\n{traceback.format_exc()}")
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 400

if __name__ == '__main__':
    debug_mode = str(os.environ.get('FLASK_DEBUG', '0')).lower() in ['1', 'true', 'yes']
    app.run(debug=debug_mode, host='0.0.0.0', port=8081)
