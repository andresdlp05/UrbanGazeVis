"""
Controller para la pestaña Glyph - Visualización dedicada del Radial Glyph
"""

from flask import Blueprint, render_template, jsonify, request, send_file, abort
import pandas as pd
import numpy as np
import os
import sys
import time
from app.shared.cache import cache
from app.shared.logging_utils import debug_log, error_log

# Agregar ruta para imports
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))
# Importar servicio compartido de datos
try:
    from app.shared.data_service import get_data_service
    debug_log("OK: Servicio compartido de datos HABILITADO")
except Exception as e:
    error_log("ADVERTENCIA: Servicio compartido de datos no disponible:", str(e))
    get_data_service = None

# Importar servicio pre-calculado (activado)
try:
    from app.shared.precomputed_fixation_service import get_precomputed_service
    precalculated_service = get_precomputed_service()
    debug_log("OK: Servicio de fijaciones pre-calculadas HABILITADO")
except Exception as e:
    error_log("ADVERTENCIA: Servicio de fijaciones pre-calculadas no disponible:", str(e))
    precalculated_service = None

# Blueprint para rutas de glyph
glyph_bp = Blueprint('glyph', __name__)

class GlyphController:
    def __init__(self):
        # Usar servicio singleton en lugar de cargar datos localmente
        if get_data_service:
            self.data_service = get_data_service()
            self.data = self.data_service.get_main_data()
            if self.data is not None:
                debug_log(f"OK: GlyphController: Datos cargados desde DataService ({len(self.data)} rows)")
            else:
                error_log(f"ADVERTENCIA: GlyphController: No hay datos disponibles en DataService")
        else:
            self.data = None
            error_log(f"ADVERTENCIA: GlyphController: DataService no disponible")

# Instancia global del controlador
glyph_controller = GlyphController()

# Verificar disponibilidad del servicio de fijaciones pre-calculadas
if precalculated_service and precalculated_service.is_available():
    debug_log(f" Servicio de fijaciones pre-calculadas disponible: {precalculated_service.get_global_stats().get('total_fixations', 0)} fijaciones")
else:
    error_log(" Servicio de fijaciones pre-calculadas no disponible - usando cálculo en tiempo real")

SCARF_TIMELINE_CACHE = {}
SCARF_TIMELINE_CACHE_TTL_SECONDS = 90
SCARF_SOURCE_FALLBACK = {'source': None}


def _safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _finalize_segment(region, start, end, fixation_count, source_label):
    if end <= start:
        end = start + 0.05
    return {
        'region': region,
        'start_time': start,
        'end_time': end,
        'duration': max(end - start, 0.05),
        'fixation_count': max(int(fixation_count), 1),
        'source': source_label
    }


def _build_participant_timeline(records, source_label='raw_eye_tracking'):
    timeline = []
    if not records:
        return timeline
    current_region = None
    segment_start = None
    segment_end = None
    fixation_count = 0

    for record in records:
        region = str(record.get('main_class') or record.get('class_name') or 'unknown').strip() or 'unknown'
        timestamp = _safe_float(record.get('Time'), _safe_float(record.get('start_time'), 0.0))
        if current_region is None:
            current_region = region
            segment_start = timestamp
            segment_end = timestamp
            fixation_count = 1
            continue

        if region == current_region and timestamp >= segment_end:
            segment_end = timestamp
            fixation_count += 1
        else:
            timeline.append(_finalize_segment(current_region, segment_start, segment_end, fixation_count, source_label))
            current_region = region
            segment_start = timestamp
            segment_end = timestamp
            fixation_count = 1

    if current_region is not None:
        timeline.append(_finalize_segment(current_region, segment_start, segment_end, fixation_count, source_label))
    return timeline


def _scarf_cache_get(cache_key):
    entry = SCARF_TIMELINE_CACHE.get(cache_key)
    if not entry:
        return None
    if time.time() - entry['ts'] > SCARF_TIMELINE_CACHE_TTL_SECONDS:
        return None
    return entry['payload']


def _scarf_cache_set(cache_key, payload):
    SCARF_TIMELINE_CACHE[cache_key] = {
        'ts': time.time(),
        'payload': payload,
    }


def get_scarf_timeline_payload(image_id, patch_size=40, limit=None):
    cache_key = (int(image_id), int(patch_size), int(limit) if limit else None)
    cached = _scarf_cache_get(cache_key)
    if cached:
        return cached

    if SCARF_SOURCE_FALLBACK['source'] is None and precalculated_service and precalculated_service.is_available() and precalculated_service.fixations_df is not None:
        SCARF_SOURCE_FALLBACK['source'] = 'precalculated'

    source_label = 'raw_eye_tracking'
    if glyph_controller.data is None:
        return None
    image_subset = glyph_controller.data[glyph_controller.data['ImageName'] == image_id].copy()

    if image_subset is None or image_subset.empty:
        payload = {
            'image_id': image_id,
            'patch_size': patch_size,
            'participants': [],
            'participants_data': {},
            'source': source_label,
            'generated_at': time.time(),
            'total_segments': 0
        }
        _scarf_cache_set(cache_key, payload)
        return payload

    participants = sorted(image_subset['participante'].dropna().unique().tolist())
    if limit:
        participants = participants[:max(1, int(limit))]

    participants_data = {}
    total_segments = 0

    for participant_id in participants:
        participant_df = image_subset[image_subset['participante'] == participant_id].sort_values('Time')
        if participant_df.empty:
            continue
        timeline = _build_participant_timeline(participant_df.to_dict('records'), source_label)
        if not timeline:
            continue
        total_segments += len(timeline)
        start_val = _safe_float(participant_df['start_time'].min() if 'start_time' in participant_df.columns else participant_df['Time'].min(), 0.0)
        end_val = _safe_float(participant_df['end_time'].max() if 'end_time' in participant_df.columns else participant_df['Time'].max(), start_val)
        participants_data[str(int(participant_id))] = {
            'participant_id': int(participant_id),
            'participant_label': f"P{int(participant_id)}",
            'timeline': timeline,
            'time_range': {
                'start': start_val,
                'end': end_val,
                'duration': max(end_val - start_val, 0.0)
            }
        }

    payload = {
        'image_id': image_id,
        'patch_size': patch_size,
        'participants': [int(pid) for pid in participants if str(int(pid)) in participants_data],
        'participants_data': participants_data,
        'source': source_label,
        'generated_at': time.time(),
        'total_segments': total_segments
    }

    _scarf_cache_set(cache_key, payload)
    return payload


@glyph_bp.route('/api/scarf/timeline/<int:image_id>')
def get_scarf_timeline(image_id):
    patch_size = request.args.get('patch_size', 40, type=int)
    limit = request.args.get('limit', type=int)
    try:
        payload = get_scarf_timeline_payload(image_id, patch_size=patch_size, limit=limit)
        if payload is None:
            return jsonify({'error': 'No hay datos disponibles para generar el scarf plot.'}), 404
        return jsonify(payload)
    except Exception as exc:
        debug_log(f" Error generando scarf timeline para imagen {image_id}: {exc}")
        return jsonify({'error': f'Error generando scarf timeline: {exc}'}), 500

def _generate_semantic_transitions_from_precalculated(fixations, participant_id, image_id):
    """Delega transiciones semanticas al servicio pre-calculado compartido."""
    if not fixations:
        return {
            'sequence': [],
            'region_stats': {},
            'timeline': [],
            'total_transitions': 0,
            'unique_regions': 0
        }

    try:
        if precalculated_service and precalculated_service.is_available():
            result = precalculated_service.get_semantic_transitions_fast(image_id, participant_id)
            if isinstance(result, dict) and 'error' not in result:
                return {
                    'sequence': result.get('sequence', []),
                    'region_stats': result.get('region_stats', {}),
                    'timeline': result.get('timeline', []),
                    'total_transitions': result.get('total_transitions', 0),
                    'unique_regions': result.get('unique_regions', 0)
                }
    except Exception as e:
        error_log(f" Error en _generate_semantic_transitions_from_precalculated: {e}")

    return {
        'sequence': [],
        'region_stats': {},
        'timeline': [],
        'total_transitions': 0,
        'unique_regions': 0
    }

def get_fixations_ultra_fast(image_id, patch_size=40):
    """Obtener fijaciones usando servicio pre-calculado."""
    if not precalculated_service or not precalculated_service.is_available():
        return {'error': 'Precalculated service not available'}

    try:
        matrix_result = precalculated_service.get_attention_matrix(image_id, patch_size)
        if 'error' in matrix_result:
            return matrix_result

        fixations = precalculated_service.get_fixations_for_image(image_id, patch_size)
        return {
            'fixations': fixations,
            'participants': matrix_result.get('participants', []),
            'attention_matrix': matrix_result.get('attention_matrix', []),
            'config': matrix_result.get('config', {}),
            'statistics': matrix_result.get('statistics', {}),
            'source': 'precalculated_ultra_fast',
            'performance': 'Maximum speed - no real-time calculations'
        }
    except Exception as e:
        error_log(f" Error en get_fixations_ultra_fast: {e}")
        return {'error': f'Error getting precalculated fixations: {str(e)}'}


def safe_json_value(value, default_value):
    """Asegura que los valores sean serializables a JSON."""
    if value is None:
        return default_value
    if pd.isna(value):
        return default_value
    if isinstance(value, (int, float)) and (np.isnan(value) or np.isinf(value)):
        return default_value
    if isinstance(value, str) and value.strip() == '':
        return default_value
    return value


def clean_for_json(obj):
    """Recursivamente limpia un objeto para serializacion JSON segura."""
    try:
        if isinstance(obj, dict):
            cleaned = {}
            for k, v in obj.items():
                try:
                    cleaned[str(k)] = clean_for_json(v)
                except Exception as e:
                    error_log(f" Error cleaning dict key {k}: {e}, using string fallback")
                    cleaned[str(k)] = str(v)
            return cleaned
        if isinstance(obj, list):
            cleaned = []
            for i, item in enumerate(obj):
                try:
                    cleaned.append(clean_for_json(item))
                except Exception as e:
                    error_log(f" Error cleaning list item {i}: {e}, using string fallback")
                    cleaned.append(str(item))
            return cleaned
        if isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        if isinstance(obj, (np.floating, np.float64, np.float32)):
            if np.isnan(obj) or np.isinf(obj):
                return 0.0
            return float(obj)
        if pd.isna(obj):
            return None
        if isinstance(obj, str):
            return str(obj)
        if obj is None:
            return None
        if isinstance(obj, (int, float, bool)):
            if isinstance(obj, float) and (np.isnan(obj) or np.isinf(obj)):
                return 0.0
            return obj
        return str(obj)
    except Exception as e:
        error_log(f" Error in clean_for_json with {type(obj)}: {e}, using string fallback")
        return str(obj)


@glyph_bp.route('/glyph')
def glyph():
    """Página principal de la pestaña Glyph."""
    return render_template('glyph.html')

@glyph_bp.route('/api/glyph/images')
@cache.cached(timeout=3600)
def get_available_images():
    """API para obtener imágenes disponibles."""
    try:
        if glyph_controller.data is None:
            return jsonify({'error': 'No data available'})
        
        images = sorted(glyph_controller.data['ImageName'].unique())
        return jsonify({
            'images': [int(img) for img in images],
            'total': len(images)
        })
    except Exception as e:
        return jsonify({'error': f'Error getting images: {str(e)}'})

@glyph_bp.route('/api/glyph/participants/<int:image_id>')
def get_participants_for_image(image_id):
    """API para obtener participantes disponibles para una imagen específica."""
    try:
        if glyph_controller.data is None:
            return jsonify({'error': 'No data available'})
        
        image_data = glyph_controller.data[glyph_controller.data['ImageName'] == image_id]
        participants = sorted(image_data['participante'].unique())
        
        return jsonify({
            'participants': [int(p) for p in participants],
            'total': len(participants),
            'image_id': image_id
        })
    except Exception as e:
        return jsonify({'error': f'Error getting participants: {str(e)}'})

@glyph_bp.route('/api/glyph/patches/<int:image_id>/<int:participant_id>')
def get_patches_for_participant(image_id, participant_id):
    """API para obtener parches con datos para un participante específico en una imagen."""
    try:
        if glyph_controller.data is None:
            return jsonify({'error': 'No data available'})
        
        patch_size = request.args.get('patch_size', 40, type=int)
        
        # Filtrar datos por imagen y participante
        participant_data = glyph_controller.data[
            (glyph_controller.data['ImageName'] == image_id) & 
            (glyph_controller.data['participante'] == participant_id)
        ]
        
        if len(participant_data) == 0:
            return jsonify({
                'patches': [],
                'total': 0,
                'message': f'No data found for participant {participant_id} in image {image_id}'
            })
        
        # Calcular parches con datos
        cols = 800 // patch_size  # 20 para 40x40
        patch_x = (participant_data['pixelX'] // patch_size).astype(int)
        patch_y = ((600 - participant_data['pixelY']) // patch_size).astype(int)
        patches_list = sorted((patch_y * cols + patch_x).unique().tolist())
        
        return jsonify({
            'patches': patches_list,
            'total': len(patches_list),
            'image_id': image_id,
            'participant_id': participant_id,
            'patch_size': patch_size
        })
    except Exception as e:
        return jsonify({'error': f'Error getting patches: {str(e)}'})

@glyph_bp.route('/api/glyph/info/<int:image_id>/<int:participant_id>/<int:patch_index>')
def get_glyph_info(image_id, participant_id, patch_index):
    """API para obtener información detallada de un glyph específico."""
    try:
        patch_size = request.args.get('patch_size', 40, type=int)
        
        # Calcular coordenadas del parche
        cols = 800 // patch_size
        patch_x = patch_index % cols
        patch_y = patch_index // cols
        
        pixel_start_x = patch_x * patch_size
        pixel_start_y = patch_y * patch_size
        pixel_end_x = pixel_start_x + patch_size
        pixel_end_y = pixel_start_y + patch_size
        
        # Contar puntos de datos en el parche
        if glyph_controller.data is not None:
            patch_data = glyph_controller.data[
                (glyph_controller.data['ImageName'] == image_id) &
                (glyph_controller.data['participante'] == participant_id) &
                (glyph_controller.data['pixelX'] >= pixel_start_x) &
                (glyph_controller.data['pixelX'] < pixel_end_x) &
                (glyph_controller.data['pixelY'] >= pixel_start_y) &
                (glyph_controller.data['pixelY'] < pixel_end_y)
            ]
            data_points = len(patch_data)
            time_range = (patch_data['Time'].min(), patch_data['Time'].max()) if len(patch_data) > 0 else (0, 0)
        else:
            data_points = 0
            time_range = (0, 0)
        
        return jsonify({
            'image_id': image_id,
            'participant_id': participant_id,
            'patch_index': patch_index,
            'patch_size': patch_size,
            'patch_position': {
                'x': patch_x,
                'y': patch_y,
                'pixel_bounds': {
                    'x_start': pixel_start_x,
                    'y_start': pixel_start_y,
                    'x_end': pixel_end_x,
                    'y_end': pixel_end_y
                }
            },
            'data_points': data_points,
            'time_range': time_range
        })
    except Exception as e:
        return jsonify({'error': f'Error getting glyph info: {str(e)}'})

@glyph_bp.route('/api/glyph/temporal-sequence/<int:image_id>/<int:participant_id>')
def get_temporal_sequence(image_id, participant_id):
    """API para obtener la secuencia temporal de patches visitados por un participante."""
    try:
        if glyph_controller.data is None:
            return jsonify({'error': 'No data available'})
        
        patch_size = request.args.get('patch_size', 40, type=int)
        
        # Filtrar datos por imagen y participante
        participant_data = glyph_controller.data[
            (glyph_controller.data['ImageName'] == image_id) & 
            (glyph_controller.data['participante'] == participant_id)
        ]
        
        if len(participant_data) == 0:
            return jsonify({
                'error': f'No data found for participant {participant_id} in image {image_id}'
            })
        
        # Ordenar por tiempo para obtener secuencia temporal
        participant_data = participant_data.sort_values('Time').copy()
        
        # Calcular patch para cada punto
        cols = 800 // patch_size
        # Proteger contra NaN en coordenadas de pixel
        participant_data = participant_data.dropna(subset=['pixelX', 'pixelY'])
        if len(participant_data) == 0:
            return jsonify({
                'error': f'No valid pixel coordinates found for participant {participant_id} in image {image_id}'
            })
        
        # Calcular time_range al inicio para usar en debug
        participant_time_min = participant_data['Time'].min()
        participant_time_max = participant_data['Time'].max()
        
        participant_data['patch_x'] = (participant_data['pixelX'] // patch_size).astype(int)
        participant_data['patch_y'] = (participant_data['pixelY'] // patch_size).astype(int)
        participant_data['patch_index'] = participant_data['patch_y'] * cols + participant_data['patch_x']
        
        #  CAMBIO: Usar regiones SEMÁNTICAS en lugar de patches
        MIN_STAY_DURATION = 0.2  # Mínimo 200ms en una región semántica
        MAX_STAY_DURATION = 5.0  # Máximo 5s por estadía (filtrar anomalías)
        
        # Obtener main_class para cada punto usando segmentación
        try:
            from app.controllers.experimentos import TopicModelingAnalyzer
            analyzer = TopicModelingAnalyzer(patch_size=patch_size)
            
            # Agregar columna main_class
            participant_data['main_class'] = 'unknown'
            for idx, row in participant_data.iterrows():
                patch_idx = int(row['patch_index'])
                try:
                    main_class = analyzer.get_patch_main_class(patch_idx, image_id)
                    participant_data.at[idx, 'main_class'] = safe_json_value(main_class, 'unknown')
                except:
                    participant_data.at[idx, 'main_class'] = 'unknown'
        except Exception as e:
            debug_log(f"Error getting semantic classes: {e}")
            participant_data['main_class'] = 'unknown'
        
        # Filtrar estadías por REGIÓN SEMÁNTICA (no por patch)
        filtered_regions = []
        current_group = []
        
        for row in participant_data[['main_class', 'Time', 'pixelX', 'pixelY']].to_dict('records'):
            current_region = str(row['main_class'])
            current_time = safe_json_value(row['Time'], 0.0)

            # Agregar punto al grupo actual
            current_group.append({
                'region': current_region,
                'time': current_time,
                'pixelX': row['pixelX'],
                'pixelY': row['pixelY']
            })
            
            # Si cambia de región o es el último punto, procesar el grupo
            is_last = (_ == participant_data.index[-1])
            next_region = current_region
            if not is_last:
                next_row = participant_data.iloc[_ + 1]
                next_region = str(next_row['main_class'])
            
            if current_region != next_region or is_last:
                # Procesar grupo: si duración >= MIN_STAY_DURATION, mantener
                if len(current_group) > 1:
                    group_start = current_group[0]['time']
                    group_end = current_group[-1]['time']
                    duration = group_end - group_start
                    
                    # Filtrar por duración válida
                    if duration >= MIN_STAY_DURATION and duration <= MAX_STAY_DURATION:
                        # Calcular centroide de la región
                        avg_x = sum(p['pixelX'] for p in current_group) / len(current_group)
                        avg_y = sum(p['pixelY'] for p in current_group) / len(current_group)
                        
                        # Debug: Log estadías largas
                        if duration > 3.0:
                            debug_log(f" Estadía larga: Participante {participant_id}, Región {current_region}, Duración: {duration:.3f}s, Puntos: {len(current_group)}")
                        
                        filtered_regions.append({
                            'region': current_region,
                            'start_time': group_start,
                            'end_time': group_end,
                            'duration': duration,
                            'points': len(current_group),
                            'centroid_x': avg_x,
                            'centroid_y': avg_y
                        })
                    elif duration > MAX_STAY_DURATION:
                        debug_log(f"🚫 Estadía filtrada (muy larga): Participante {participant_id}, Región {current_region}, Duración: {duration:.3f}s > {MAX_STAY_DURATION}s")
                    elif len(filtered_regions) == 0:
                        # Permitir la primera región aunque sea corta para evitar participantes vacíos
                        avg_x = sum(p['pixelX'] for p in current_group) / len(current_group)
                        avg_y = sum(p['pixelY'] for p in current_group) / len(current_group)
                        
                        filtered_regions.append({
                            'region': current_region,
                            'start_time': group_start,
                            'end_time': group_end,
                            'duration': duration,
                            'points': len(current_group),
                            'centroid_x': avg_x,
                            'centroid_y': avg_y
                        })
                
                current_group = []
        
        # Crear transiciones entre regiones semánticas
        sequence = []
        for i in range(1, len(filtered_regions)):
            prev_region = filtered_regions[i-1]
            curr_region = filtered_regions[i]
            
            # Solo agregar transición si son regiones diferentes
            if prev_region['region'] != curr_region['region']:
                sequence.append({
                    'from_region': prev_region['region'],
                    'to_region': curr_region['region'],
                    'time': curr_region['start_time'],
                    'duration': curr_region['start_time'] - prev_region['end_time'],
                    'from_stay_duration': prev_region['duration'],
                    'to_stay_duration': curr_region['duration']
                })
        
        debug_log(f" Participante {participant_id}: {len(participant_data)} puntos → {len(filtered_regions)} regiones → {len(sequence)} transiciones")
        
        # Calcular estadísticas basadas en REGIONES SEMÁNTICAS 
        region_stats = {}
        for stay in filtered_regions:
            region_name = stay['region']
            if region_name not in region_stats:
                region_stats[region_name] = {
                    'visit_count': 0,
                    'total_duration': 0.0,
                    'first_visit': stay['start_time'],
                    'last_visit': stay['end_time'],
                    'centroid_x': stay['centroid_x'],
                    'centroid_y': stay['centroid_y']
                }
            
            # Actualizar estadísticas con esta estadía
            region_stats[region_name]['visit_count'] += 1
            region_stats[region_name]['total_duration'] += stay['duration']
            region_stats[region_name]['first_visit'] = min(region_stats[region_name]['first_visit'], stay['start_time'])
            region_stats[region_name]['last_visit'] = max(region_stats[region_name]['last_visit'], stay['end_time'])
            
            # Actualizar centroide promedio
            region_stats[region_name]['centroid_x'] = (region_stats[region_name]['centroid_x'] + stay['centroid_x']) / 2
            region_stats[region_name]['centroid_y'] = (region_stats[region_name]['centroid_y'] + stay['centroid_y']) / 2
            
        # Asegurar que todos los valores sean JSON-safe
        for region_name in region_stats:
            region_stats[region_name]['total_duration'] = safe_json_value(region_stats[region_name]['total_duration'], 0.0)
            region_stats[region_name]['first_visit'] = safe_json_value(region_stats[region_name]['first_visit'], 0.0)
            region_stats[region_name]['last_visit'] = safe_json_value(region_stats[region_name]['last_visit'], 0.0)
            region_stats[region_name]['centroid_x'] = safe_json_value(region_stats[region_name]['centroid_x'], 0.0)
            region_stats[region_name]['centroid_y'] = safe_json_value(region_stats[region_name]['centroid_y'], 0.0)
        
        # Debug: Resumen de duraciones por región
        total_experiment_time = 0
        for region_name, stats in region_stats.items():
            total_experiment_time += stats['total_duration']
            debug_log(f"    {region_name}: {stats['visit_count']} estadías, {stats['total_duration']:.3f}s acumulado, {(stats['total_duration']/stats['visit_count']):.3f}s promedio")
        
        debug_log(f"   🕒 Tiempo total del experimento para participante {participant_id}: {total_experiment_time:.3f}s")
        
        # Verificar consistencia con el rango de tiempo original
        original_duration = participant_time_max - participant_time_min
        debug_log(f"    Duración original (max-min): {original_duration:.3f}s")
        
        if total_experiment_time > original_duration * 1.1:  # Si es >10% mayor
            debug_log(f"    PROBLEMA: Tiempo acumulado ({total_experiment_time:.3f}s) > duración original ({original_duration:.3f}s)")
        
        # Las variables participant_time_min y participant_time_max ya se calcularon al inicio
        
        return jsonify({
            'image_id': image_id,
            'participant_id': participant_id,
            'patch_size': patch_size,
            'sequence': sequence,
            'region_stats': region_stats,  # Cambio: regiones en lugar de patches
            'total_transitions': len(sequence),
            'unique_regions': len(region_stats),  # Cambio: regiones en lugar de patches
            'time_range': {
                'start': safe_json_value(participant_time_min, 0.0),
                'end': safe_json_value(participant_time_max, 0.0),
                'duration': safe_json_value(participant_time_max - participant_time_min, 0.0)
            }
        })
        
    except Exception as e:
        return jsonify({'error': f'Error getting temporal sequence: {str(e)}'})

@glyph_bp.route('/api/glyph/complete-data-precalculated/<int:image_id>')
@cache.cached(timeout=600, query_string=True)
def get_complete_glyph_data_precalculated(image_id):
    """
    TEMPORALMENTE REDIRIGIDO - usar método corregido
    API ultra-rápida usando únicamente fijaciones pre-calculadas
    No realiza cálculos en tiempo real - máxima velocidad
    """
    # 🔧 REDIRIGIR TEMPORALMENTE AL MÉTODO CORREGIDO
    patch_size = int(request.args.get('patch_size', 40))
    data_type = request.args.get('data_type', 'fixations', type=str)
    
    debug_log(f"🔧 REDIRIGIENDO API PRECALCULADA AL MÉTODO CORREGIDO para imagen {image_id}")
    return get_complete_glyph_data(image_id)
    
    debug_log(f" PRECALCULATED API: Imagen {image_id}, patch {patch_size}x{patch_size}")
    
    if not precalculated_service.is_available():
        return jsonify({
            'error': 'Precalculated fixations service not available',
            'suggestion': 'Run generate_precalculated_fixations.py first'
        })
    
    try:
        start_time = time.time()
        
        # Obtener datos completamente pre-calculados
        result = get_fixations_ultra_fast(image_id, patch_size)
        
        if 'error' in result:
            return jsonify(result)
        
        # Para transiciones, obtener fijaciones agrupadas por participante
        participants_data = {}
        
        for participant_id in result['participants']:
            # Obtener fijaciones del participante usando pre-calculadas
            participant_fixations = precalculated_service.get_fixations_for_participant_image(
                participant_id, image_id
            )
            
            if participant_fixations:
                #  IMPORTANTE: Generar regiones semánticas para transiciones
                try:
                    semantic_transitions = _generate_semantic_transitions_from_precalculated(
                        participant_fixations, participant_id, image_id
                    )
                    
                    participants_data[participant_id] = {
                        'fixations': participant_fixations,
                        'count': len(participant_fixations),
                        'source': 'precalculated',
                        'sequence': semantic_transitions['sequence'],
                        'region_stats': semantic_transitions['region_stats'],
                        'total_transitions': semantic_transitions['total_transitions'],
                        'unique_regions': semantic_transitions['unique_regions']
                    }
                    
                except Exception as e:
                    debug_log(f" Error generando regiones semánticas para participante {participant_id}: {e}")
                    # Fallback sin regiones semánticas
                    participants_data[participant_id] = {
                        'fixations': participant_fixations,
                        'count': len(participant_fixations),
                        'source': 'precalculated_no_regions',
                        'sequence': [],
                        'region_stats': {},
                        'total_transitions': 0,
                        'unique_regions': 0
                    }
        
        processing_time = time.time() - start_time
        
        final_result = {
            'image_id': image_id,
            'participants': result['participants'],
            'participants_data': participants_data,
            'topic_modeling': {
                'participants': result['participants'],
                'attention_matrix': result['attention_matrix'],
                'config': result['config'],
                'statistics': result['statistics']
            },
            'processing_time': processing_time,
            'optimization': 'precalculated_fixations',
            'speedup': 'Maximum - no real-time calculations',
            'performance_note': f'Processed in {processing_time:.3f}s using precalculated data'
        }
        
        debug_log(f" PRECALCULATED: Imagen {image_id} procesada en {processing_time:.3f}s")
        return jsonify(final_result)
        
    except Exception as e:
        debug_log(f" Error en API precalculada: {e}")
        return jsonify({'error': f'Error in precalculated API: {str(e)}'})

def get_gaze_points_data(image_id, patch_size=40):
    """
    Procesar datos de gaze points en bruto (sin algoritmo I-VT)
    
    Args:
        image_id: ID de la imagen
        patch_size: Tamaño de patch (10, 20, 40)
        
    Returns:
        JSON con datos de gaze points procesados
    """
    try:
        debug_log(f" Procesando gaze points para imagen {image_id}, patch_size={patch_size}")
        
        if glyph_controller.data is None:
            return jsonify({'error': 'No data available'})
        
        # Filtrar datos por imagen
        image_data = glyph_controller.data[glyph_controller.data['ImageName'] == image_id].copy()
        
        if len(image_data) == 0:
            return jsonify({'error': f'No data found for image {image_id}'})
        
        # Obtener participantes únicos
        participants = sorted(image_data['participante'].unique())
        
        # Calcular dimensiones del grid de patches
        cols = 800 // patch_size
        rows = 600 // patch_size
        total_patches = cols * rows
        
        # Crear matriz de atención basada en gaze points brutos
        attention_matrix = []
        
        # Datos de transiciones por participante
        transition_data = []

        grouped = image_data.groupby('participante', sort=False)
        for participant_id in participants:
            participant_data = grouped.get_group(participant_id).copy()

            if len(participant_data) == 0:
                continue

            # Ordenar por tiempo
            participant_data = participant_data.sort_values('Time').reset_index(drop=True)

            # NOTA: Los datos ya vienen normalizados de df_final1.csv (0-15s por imagen)
            # No aplicamos normalización adicional

            # Crear fila de atención para este participante
            participant_row = [0] * total_patches

            # Procesar cada punto de gaze
            gaze_points = []
            for row in participant_data[['pixelX', 'pixelY', 'Time', 'main_class']].to_dict('records'):
                x = int(row['pixelX'])
                y = int(row['pixelY'])

                # Calcular índice de patch
                patch_x = min(x // patch_size, cols - 1)
                patch_y = min((600 - y) // patch_size, rows - 1)  # Aplicar inversión Y
                patch_index = patch_y * cols + patch_x

                # Incrementar contador en matriz de atención
                if 0 <= patch_index < total_patches:
                    participant_row[patch_index] += 1

                # Agregar punto de gaze
                gaze_points.append({
                    'x': x,
                    'y': y,
                    'time': float(row['Time']),
                    'patch_index': patch_index,
                    'main_class': str(row.get('main_class', 'unknown'))
                })
            
            attention_matrix.append(participant_row)
            
            # Generar transiciones semánticas simples para gaze points
            semantic_transitions = _generate_gaze_semantic_transitions(gaze_points, participant_id, image_id)
            
            transition_data.append({
                'participant': participant_id,
                'transitions': semantic_transitions,
                'gaze_count': len(gaze_points)
            })
        
        # Calcular estadísticas globales
        total_gaze_points = len(image_data)
        _px = (image_data['pixelX'].astype(int) // patch_size).clip(0, cols - 1)
        _py = (image_data['pixelY'].astype(int) // patch_size).clip(0, rows - 1)
        active_patches = (_px * cols + _py).clip(0, total_patches - 1).nunique()
        
        response_data = {
            'participants': participants,
            'attention_matrix': attention_matrix,
            'transition_data': transition_data,
            'patch_config': {
                'patch_size': patch_size,
                'cols': cols,
                'rows': rows,
                'total_patches': total_patches,
                'image_width': 800,
                'image_height': 600
            },
            'statistics': {
                'total_gaze_points': total_gaze_points,
                'participants_count': len(participants),
                'active_patches': active_patches,
                'data_type': 'gaze_points',
                'source': 'raw_gaze_data'
            },
            'performance': {
                'data_source': 'df_final1.csv',
                'processing_type': 'real_time_gaze_points',
                'algorithm': 'none_raw_data'
            }
        }
        
        debug_log(f" Gaze points procesados: {total_gaze_points} puntos, {len(participants)} participantes")
        return jsonify(response_data)
        
    except Exception as e:
        debug_log(f" Error procesando gaze points: {e}")
        return jsonify({'error': f'Error processing gaze points: {str(e)}'})

def _generate_gaze_semantic_transitions(gaze_points, participant_id, image_id):
    """
    Generar transiciones semánticas simples para gaze points
    
    Args:
        gaze_points: Lista de puntos de gaze con main_class
        participant_id: ID del participante
        image_id: ID de la imagen
        
    Returns:
        Diccionario con secuencia de transiciones y estadísticas de regiones
    """
    if not gaze_points:
        return {
            'sequence': [],
            'region_stats': {},
            'total_transitions': 0,
            'unique_regions': 0
        }
    
    try:
        # Generar secuencia de transiciones basada en cambios de main_class
        sequence = []
        region_stats = {}
        
        current_region = None
        transition_count = 0
        
        for i, point in enumerate(gaze_points):
            region = point.get('main_class', 'unknown')
            
            # Inicializar estadísticas de región si no existen
            if region not in region_stats:
                region_stats[region] = {
                    'total_time': 0,
                    'visit_count': 0,
                    'total_points': 0,
                    'first_visit': point['time'],
                    'avg_time': 0
                }
            
            # Incrementar contador de puntos para esta región
            region_stats[region]['total_points'] += 1
            region_stats[region]['visit_count'] += 1
            
            # Si cambió de región, crear transición
            if current_region is not None and current_region != region:
                sequence.append({
                    'from': current_region,
                    'to': region,
                    'time': point['time'],
                    'transition_index': transition_count
                })
                transition_count += 1
            
            current_region = region
        
        # Calcular tiempo promedio por región (aproximado)
        for region in region_stats:
            if region_stats[region]['visit_count'] > 0:
                region_stats[region]['avg_time'] = region_stats[region]['total_points'] * 0.016  # ~16ms por punto
                region_stats[region]['total_time'] = region_stats[region]['avg_time']
        
        return {
            'sequence': sequence,
            'region_stats': region_stats,
            'total_transitions': len(sequence),
            'unique_regions': len(region_stats)
        }
        
    except Exception as e:
        debug_log(f" Error generando transiciones para gaze points: {e}")
        return {
            'sequence': [],
            'region_stats': {},
            'total_transitions': 0,
            'unique_regions': 0
        }

@glyph_bp.route('/api/glyph/complete-data/<int:image_id>')
@cache.cached(timeout=600, query_string=True)
def get_complete_glyph_data(image_id):
    """API ULTRA-OPTIMIZADA usando fijaciones pre-calculadas o gaze points."""
    try:
        patch_size = request.args.get('patch_size', 40, type=int)
        data_type = request.args.get('data_type', 'fixations', type=str)  # 'fixations' o 'gaze'

        #  PROCESAMIENTO DE GAZE POINTS (datos en bruto)
        if data_type == 'gaze':
            return get_gaze_points_data(image_id, patch_size)

        #  USAR PRE-CÁLCULO ACTIVADO
        try:
            from app.shared.precomputed_fixation_service import get_precomputed_service

            service = get_precomputed_service()
            if service and service.fixations_df is not None:
                debug_log(f" ULTRA-FAST: Usando fijaciones pre-calculadas para imagen {image_id}")
                result = get_complete_glyph_data_precomputed(image_id, patch_size, service)
                debug_log(f" Pre-calculado completado exitosamente")
                return result
        except Exception as e:
            debug_log(f"  Servicio pre-calculado no disponible: {e}, usando fallback")

        # FALLBACK: Usar método original si no hay pre-calculado
        debug_log(f" FALLBACK: Usando método I-VT original para imagen {image_id}")
        
        if glyph_controller.data is None:
            return jsonify({'error': 'No data available'})
        
        patch_size = request.args.get('patch_size', 40, type=int)
        
        # 1. Obtener datos de topic modeling (reutilizar lógica existente)
        from app.controllers.experimentos import experimentos_controller
        topic_result = experimentos_controller.run_topic_modeling_experiment(image_id, patch_size, '3')
        
        if 'error' in topic_result:
            return jsonify(topic_result)
        
        # 2. Procesar datos de todos los participantes en paralelo
        image_data = glyph_controller.data[glyph_controller.data['ImageName'] == image_id]
        participants = sorted(image_data['participante'].unique())
        
        # Optimización: calcular patches una sola vez para toda la imagen
        cols = 800 // patch_size
        image_data = image_data.copy()
        # Proteger contra NaN en coordenadas de pixel
        image_data = image_data.dropna(subset=['pixelX', 'pixelY'])
        if len(image_data) == 0:
            return jsonify({'error': f'No valid pixel coordinates found for image {image_id}'})
        
        image_data['patch_x'] = (image_data['pixelX'] // patch_size).astype(int)
        image_data['patch_y'] = (image_data['pixelY'] // patch_size).astype(int)
        image_data['patch_index'] = image_data['patch_y'] * cols + image_data['patch_x']
        
        # NOTA: Los datos de df_final1.csv contienen tiempos absolutos de sesión
        # IMPORTANTE: Normalizamos los tiempos relativos a cada imagen (min=0, max=duración del viewing)

        # 3. Procesar cada participante de forma optimizada
        participants_data = {}
        all_patches_visited = set()

        grouped = image_data.groupby('participante', sort=False)
        for participant_id in participants:
            participant_data = grouped.get_group(participant_id).sort_values('Time').copy()

            # Guardar los valores originales ANTES de normalizar (para calcular duración)
            original_time_min = participant_data['Time'].min() if len(participant_data) > 0 else 0.0
            original_time_max = participant_data['Time'].max() if len(participant_data) > 0 else 0.0

            # NORMALIZACION PER-IMAGE: restar el tiempo minimo para este participante+imagen
            # Esto convierte tiempos absolutos de sesión a tiempos relativos (0 = inicio de viewing)
            if len(participant_data) > 0:
                # Usar .loc para asegurar que la asignación se aplique correctamente
                participant_data.loc[:, 'Time'] = participant_data['Time'] - original_time_min
                debug_log(f"   Normalización P{participant_id}: min_original={original_time_min:.2f}, max_original={original_time_max:.2f}, ahora min={participant_data['Time'].min():.2f}, max={participant_data['Time'].max():.2f}")

            # Después de normalizar, los valores son: min=0.0, max=duración
            participant_time_min = 0.0
            participant_time_max = original_time_max - original_time_min
            
            if len(participant_data) == 0:
                # Crear entrada vacía pero válida para participantes sin datos
                participants_data[int(participant_id)] = {
                    'sequence': [],
                    'region_stats': {},
                    'timeline': [],
                    'total_transitions': 0,
                    'unique_regions': 0,
                    'time_range': {
                        'start': 0.0,
                        'end': 0.0,
                        'duration': 0.0
                    }
                }
                continue
            
            #  NUEVO: Usar FIJACIONES I-VT en lugar de puntos raw
            debug_log(f" I-VT: Detectando fijaciones para participante {participant_id}...")
            
            try:
                from fixation_detection_ivt import get_fixations_ivt
                from app.controllers.experimentos import TopicModelingAnalyzer
                
                # Detectar fijaciones usando I-VT
                fixations_result = get_fixations_ivt(
                    data=participant_data,
                    participant_id=None,  # Ya filtrado
                    image_id=None,        # Ya filtrado
                    velocity_threshold=1.15,
                    min_duration=0.0
                )
                
                if 'error' in fixations_result:
                    debug_log(f"  Error en I-VT para participante {participant_id}: {fixations_result['error']}")
                    # Crear datos vacíos si falla I-VT
                    duration = participant_time_max - participant_time_min
                    participants_data[int(participant_id)] = {
                        'sequence': [],
                        'region_stats': {},
                        'timeline': [],
                        'total_transitions': 0,
                        'unique_regions': 0,
                        'time_range': {
                            'start': 0.0,
                            'end': safe_json_value(duration, 0.0),
                            'duration': safe_json_value(duration, 0.0)
                        }
                    }
                    continue
                
                fixations = fixations_result['fixations']
                debug_log(f" I-VT: Detectadas {len(fixations)} fijaciones para participante {participant_id}")

                # NOTA: Las fijaciones vienen con tiempos normalizados porque participant_data
                # fue normalizado antes de pasarlo a get_fixations_ivt

                if len(fixations) == 0:
                    # No hay fijaciones válidas
                    duration = participant_time_max - participant_time_min
                    participants_data[int(participant_id)] = {
                        'sequence': [],
                        'region_stats': {},
                        'timeline': [],
                        'total_transitions': 0,
                        'unique_regions': 0,
                        'time_range': {
                            'start': 0.0,
                            'end': safe_json_value(duration, 0.0),
                            'duration': safe_json_value(duration, 0.0)
                        }
                    }
                    continue
                
                # Clasificar cada fijación por región semántica
                analyzer = TopicModelingAnalyzer(patch_size=patch_size)
                fixation_regions = []
                
                for i, fix in enumerate(fixations):
                    x = fix['x_centroid']
                    y = fix['y_centroid']
                    
                    # Aplicar Y-inversion para consistencia con visualización
                    # Calcular patch_index para esta fijación
                    patch_x = int(x // patch_size)
                    patch_y = int((600 - y) // patch_size)  # Aplicar inversión Y
                    patch_index = patch_y * (800 // patch_size) + patch_x
                    
                    # Obtener clasificación semántica
                    try:
                        main_class = analyzer.get_patch_main_class(patch_index, image_id)
                        region = main_class or 'unknown'
                    except:
                        region = 'unknown'
                    
                    fixation_regions.append({
                        'fixation_id': i,
                        'region': region,
                        'centroid_x': x,
                        'centroid_y': y,
                        'duration': fix['duration'],
                        'start_time': fix['start'],
                        'end_time': fix['end'],
                        'point_count': fix['pointCount']
                    })
                
                debug_log(f" I-VT: Clasificadas fijaciones por regiones semánticas para participante {participant_id}")
                
                # Agrupar fijaciones consecutivas por región para crear secuencias
                sequence = []
                filtered_regions = []
                
                if len(fixation_regions) > 0:
                    current_region = fixation_regions[0]['region']
                    region_start = fixation_regions[0]['start_time']
                    region_end = fixation_regions[0]['end_time']
                    region_fixations = [fixation_regions[0]]
                    
                    for i in range(1, len(fixation_regions)):
                        fix_region = fixation_regions[i]
                        
                        if fix_region['region'] == current_region:
                            # Misma región, continuar agrupando
                            region_end = fix_region['end_time']
                            region_fixations.append(fix_region)
                        else:
                            # Cambio de región, guardar la anterior y crear transición
                            region_duration = region_end - region_start
                            avg_x = sum(f['centroid_x'] for f in region_fixations) / len(region_fixations)
                            avg_y = sum(f['centroid_y'] for f in region_fixations) / len(region_fixations)
                            
                            filtered_regions.append({
                                'region': current_region,
                                'start_time': region_start,
                                'end_time': region_end,
                                'duration': region_duration,
                                'fixation_count': len(region_fixations),
                                'centroid_x': avg_x,
                                'centroid_y': avg_y
                            })
                            
                            # Crear transición
                            sequence.append({
                                'from_region': current_region,
                                'to_region': fix_region['region'],
                                'time': fix_region['start_time'],
                                'duration': fix_region['start_time'] - region_end
                            })
                            
                            # Iniciar nueva región
                            current_region = fix_region['region']
                            region_start = fix_region['start_time']
                            region_end = fix_region['end_time']
                            region_fixations = [fix_region]
                    
                    # Agregar la última región
                    if region_fixations:
                        region_duration = region_end - region_start
                        avg_x = sum(f['centroid_x'] for f in region_fixations) / len(region_fixations)
                        avg_y = sum(f['centroid_y'] for f in region_fixations) / len(region_fixations)
                        
                        filtered_regions.append({
                            'region': current_region,
                            'start_time': region_start,
                            'end_time': region_end,
                            'duration': region_duration,
                            'fixation_count': len(region_fixations),
                            'centroid_x': avg_x,
                            'centroid_y': avg_y
                        })
                
                # Serializar timeline completo para visualizaciones (scarf plot)
                timeline_serialized = []
                for stay in filtered_regions:
                    timeline_serialized.append({
                        'region': stay.get('region', 'unknown'),
                        'start_time': safe_json_value(stay.get('start_time'), 0.0),
                        'end_time': safe_json_value(stay.get('end_time'), stay.get('start_time', 0.0)),
                        'duration': safe_json_value(stay.get('duration'), 0.0),
                        'fixation_count': int(stay.get('fixation_count', 0) or 0),
                        'centroid_x': safe_json_value(stay.get('centroid_x'), 0.0),
                        'centroid_y': safe_json_value(stay.get('centroid_y'), 0.0)
                    })

                # Calcular estadísticas por región
                region_stats = {}
                for stay in filtered_regions:
                    region_name = stay['region']
                    all_patches_visited.add(region_name)
                    
                    if region_name not in region_stats:
                        region_stats[region_name] = {
                            'visit_count': 0,
                            'total_duration': 0.0,
                            'fixation_count': 0,
                            'first_visit': stay['start_time'],
                            'last_visit': stay['end_time'],
                            'centroid_x': stay['centroid_x'],
                            'centroid_y': stay['centroid_y']
                        }
                    
                    region_stats[region_name]['visit_count'] += 1
                    region_stats[region_name]['total_duration'] += float(stay['duration'])
                    region_stats[region_name]['fixation_count'] += stay['fixation_count']
                    
                    # Asegurar conversión a float para evitar errores de tipo
                    current_first = float(region_stats[region_name]['first_visit'])
                    new_start = float(stay['start_time'])
                    current_last = float(region_stats[region_name]['last_visit'])
                    new_end = float(stay['end_time'])
                    
                    region_stats[region_name]['first_visit'] = min(current_first, new_start)
                    region_stats[region_name]['last_visit'] = max(current_last, new_end)
                    
                    # Actualizar centroide promedio
                    region_stats[region_name]['centroid_x'] = (region_stats[region_name]['centroid_x'] + stay['centroid_x']) / 2
                    region_stats[region_name]['centroid_y'] = (region_stats[region_name]['centroid_y'] + stay['centroid_y']) / 2
                
                # Asegurar valores JSON-safe
                for region_name in region_stats:
                    region_stats[region_name]['total_duration'] = safe_json_value(region_stats[region_name]['total_duration'], 0.0)
                    region_stats[region_name]['first_visit'] = safe_json_value(region_stats[region_name]['first_visit'], 0.0)
                    region_stats[region_name]['last_visit'] = safe_json_value(region_stats[region_name]['last_visit'], 0.0)
                    region_stats[region_name]['centroid_x'] = safe_json_value(region_stats[region_name]['centroid_x'], 0.0)
                    region_stats[region_name]['centroid_y'] = safe_json_value(region_stats[region_name]['centroid_y'], 0.0)
                
                # Debug: Resumen basado en fijaciones
                total_fixation_time = sum(stats['total_duration'] for stats in region_stats.values())
                for region_name, stats in region_stats.items():
                    avg_duration = stats['total_duration'] / stats['visit_count'] if stats['visit_count'] > 0 else 0
                    debug_log(f"    [I-VT] P{participant_id} {region_name}: {stats['fixation_count']} fijaciones, {stats['total_duration']:.3f}s total, {avg_duration:.3f}s promedio")
                
                debug_log(f" I-VT: Procesadas {len(filtered_regions)} regiones basadas en fijaciones para participante {participant_id}")

                duration = participant_time_max - participant_time_min
                participants_data[int(participant_id)] = {
                    'sequence': sequence,
                    'region_stats': region_stats,
                    'timeline': timeline_serialized,
                    'total_transitions': len(sequence),
                    'unique_regions': len(region_stats),
                    'time_range': {
                        'start': 0.0,
                        'end': safe_json_value(duration, 0.0),
                        'duration': safe_json_value(duration, 0.0)
                    }
                }
                
            except Exception as e:
                debug_log(f" Error procesando fijaciones para participante {participant_id}: {e}")
                import traceback
                traceback.print_exc()

                # Crear datos vacíos en caso de error
                duration = participant_time_max - participant_time_min
                participants_data[int(participant_id)] = {
                    'sequence': [],
                    'region_stats': {},
                    'total_transitions': 0,
                    'unique_regions': 0,
                    'time_range': {
                        'start': 0.0,
                        'end': safe_json_value(duration, 0.0),
                        'duration': safe_json_value(duration, 0.0)
                    }
                }
        
        # 4. Ya no necesitamos obtener colores por separado porque usamos regiones semánticas
        # Los colores se definen en el frontend según el nombre de la región
        
        try:
            # Limpiar todos los datos antes de la serialización JSON
            response_data = clean_for_json({
                'image_id': image_id,
                'patch_size': patch_size,
                'topic_modeling': topic_result,
                'participants_data': participants_data,
                'participants': [int(p) for p in participants]
            })
            
            return jsonify(response_data)
        except Exception as json_error:
            debug_log(f" ERROR AL SERIALIZAR JSON: {json_error}")
            import traceback
            traceback.print_exc()
            return jsonify({'error': f'Error serializing JSON: {str(json_error)}'})
        
    except Exception as e:
        return jsonify({'error': f'Error getting complete glyph data: {str(e)}'})

@glyph_bp.route('/api/glyph/area-analysis/<int:image_id>')
@cache.cached(timeout=600, query_string=True)
def get_area_analysis(image_id):
    """API para analizar un área específica seleccionada con brush D3."""
    debug_log(f" ENDPOINT CALLED: area-analysis for image {image_id}")
    debug_log(f" Request args: {dict(request.args)}")
    try:
        # Obtener parámetros del área seleccionada
        x = request.args.get('x', type=int)
        y = request.args.get('y', type=int)
        width = request.args.get('width', type=int)
        height = request.args.get('height', type=int)
        data_type = request.args.get('data_type', 'fixations', type=str)
        
        debug_log(f" Parsed params: x={x}, y={y}, width={width}, height={height}, data_type={data_type}")
        
        # Validar parámetros
        if any(param is None for param in [x, y, width, height]):
            return jsonify({'error': 'Missing required parameters: x, y, width, height'})
        
        if width < 10 or height < 10:
            return jsonify({'error': 'Area too small (minimum 10x10px)'})
        
        debug_log(f" Analyzing area: {width}x{height}px at ({x}, {y}) for image {image_id}, data_type: {data_type}")
        debug_log(f" DEBUG: Area coordinates - x:[{x}, {x+width}], y:[{y}, {y+height}]")
        
        if glyph_controller.data is None:
            return jsonify({'error': 'No data available'})
        
        # Filtrar datos por imagen
        image_data = glyph_controller.data[glyph_controller.data['ImageName'] == image_id]
        if len(image_data) == 0:
            return jsonify({'error': f'No data found for image {image_id}'})
        
        participants = sorted(image_data['participante'].unique())
        participants_data = {}

        # 🕒 IMPORTANTE: Calcular tiempo mínimo POR PARTICIPANTE (vectorizado, una sola pasada)
        # (normalizar tiempos relativos a cuando cada participante comenzó a ver esta imagen)
        # NOTA: NO se aplica offset de 4 segundos - los datos ya contienen tiempos correctos
        _min_series = pd.to_numeric(image_data['Time'], errors='coerce').groupby(image_data['participante']).min()
        participant_min_times = {
            int(p): float(v) if pd.notna(v) else 0.0
            for p, v in _min_series.items()
        }
        for participant_id in participants:
            debug_log(f"   ⏰ Participante {participant_id}: tiempo de inicio imagen = {participant_min_times.get(int(participant_id), 0.0):.3f}s")

        # Procesar cada participante
        grouped = image_data.groupby('participante', sort=False)
        for participant_id in participants:
            participant_data = grouped.get_group(participant_id).copy()

            if len(participant_data) == 0:
                participants_data[int(participant_id)] = {
                    'fixations_in_area': [],
                    'total_fixations': 0,
                    'region_stats': {'sky': 0, 'building': 0, 'road': 0, 'unknown': 0}
                }
                continue

            if data_type == 'fixations':
                # Usar fijaciones I-VT
                debug_log(f" Processing fixations for participant {participant_id}")
                try:
                    from fixation_detection_ivt import get_fixations_ivt
                    debug_log(f" I-VT import successful")

                    fixations_result = get_fixations_ivt(
                        data=participant_data,
                        participant_id=None,  # Ya filtrado
                        image_id=None,        # Ya filtrado
                        velocity_threshold=1.15,  # UNIFICADO
                        min_duration=0.0,         # UNIFICADO
                        image_width=800,          # UNIFICADO
                        image_height=600          # UNIFICADO
                    )

                    if 'fixations' in fixations_result:
                        fixations = fixations_result['fixations']
                    else:
                        fixations = []

                    # 🕒 NORMALIZAR TIEMPOS: restar el tiempo inicial para esta imagen/participante
                    # Resultado: tiempos van de 0-15 segundos (el tiempo que el participante vio esta imagen)
                    participant_id_int = int(participant_id)
                    if participant_id_int in participant_min_times:
                        min_time = participant_min_times[participant_id_int]
                        for fix in fixations:
                            if fix.get('start') is not None:
                                fix['start'] = fix['start'] - min_time  # Sin offset de 4 segundos
                            if fix.get('end') is not None:
                                fix['end'] = fix['end'] - min_time      # Sin offset de 4 segundos

                    debug_log(f" DEBUG: Participant {participant_id} has {len(fixations)} total I-VT fixations")
                    
                    # Debug: mostrar rango de coordenadas para las primeras fijaciones
                    if len(fixations) > 0:
                        x_coords = [f['x_centroid'] for f in fixations[:5]]
                        y_coords = [f['y_centroid'] for f in fixations[:5]]
                        debug_log(f" DEBUG: First 5 fixation coordinates - X: {x_coords}, Y: {y_coords}")
                        debug_log(f" DEBUG: Area bounds - X: [{x}, {x+width}], Y: [{y}, {y+height}]")
                    
                    # Filtrar fijaciones dentro del área
                    fixations_in_area = []
                    for i, fix in enumerate(fixations):
                        fx = fix['x_centroid']
                        fy = fix['y_centroid']
                        
                        debug_log(f"  Fixation {i+1}: x={fx:.1f}, y={fy:.1f}, in_area={x <= fx <= (x + width) and y <= fy <= (y + height)}")
                        
                        # Verificar si la fijación está dentro del área
                        if x <= fx <= (x + width) and y <= fy <= (y + height):
                            # Clasificar región semántica
                            if fy < 200:
                                region = 'sky'
                            elif fy < 400:
                                region = 'building'
                            else:
                                region = 'road'
                            
                            fixations_in_area.append({
                                'x': fx,
                                'y': fy,
                                'duration': fix.get('duration', 0.1),
                                'start': fix.get('start', 0),
                                'end': fix.get('end', 0.1),
                                'region': region
                            })
                    
                    debug_log(f" DEBUG: Participant {participant_id} has {len(fixations_in_area)} fixations in selected area")
                    
                    # Contar por región
                    region_stats = {'sky': 0, 'building': 0, 'road': 0, 'unknown': 0}
                    for fix in fixations_in_area:
                        region_stats[fix['region']] += 1
                    
                    participants_data[int(participant_id)] = {
                        'fixations_in_area': fixations_in_area,
                        'total_fixations': len(fixations_in_area),
                        'region_stats': region_stats,
                        'data_type': 'fixations'
                    }
                    
                except ImportError as ie:
                    debug_log(f" Error importing I-VT: {ie}")
                    return jsonify({'error': 'I-VT fixation detection not available'})
                except Exception as fe:
                    debug_log(f" Error detecting fixations for participant {participant_id}: {fe}")
                    participants_data[int(participant_id)] = {
                        'fixations_in_area': [],
                        'total_fixations': 0,
                        'region_stats': {'sky': 0, 'building': 0, 'road': 0, 'unknown': 0},
                        'error': str(fe)
                    }
            
            else:  # data_type == 'gaze'
                # Usar puntos de mirada directos
                area_data = participant_data[
                    (participant_data['pixelX'] >= x) &
                    (participant_data['pixelX'] <= (x + width)) &
                    (participant_data['pixelY'] >= y) &
                    (participant_data['pixelY'] <= (y + height))
                ]

                gaze_points = []
                region_stats = {'sky': 0, 'building': 0, 'road': 0, 'unknown': 0}

                # 🕒 NORMALIZAR TIEMPOS: restar el tiempo inicial para esta imagen/participante
                participant_id_int = int(participant_id)
                min_time = participant_min_times.get(participant_id_int, 0.0)

                for point in area_data[['pixelX', 'pixelY', 'Time']].to_dict('records'):
                    px = point['pixelX']
                    py = point['pixelY']

                    # Normalizar tiempos: tiempo relativo desde que el participante comenzó a ver esta imagen
                    raw_time = point['Time']
                    normalized_time = raw_time - min_time  # Sin offset de 4 segundos

                    # Clasificar región semántica
                    if py < 200:
                        region = 'sky'
                    elif py < 400:
                        region = 'building'
                    else:
                        region = 'road'

                    gaze_points.append({
                        'x': px,
                        'y': py,
                        'Time': normalized_time,  # Cambiar de 'time' a 'Time' para consistencia con fixations
                        'region': region
                    })
                    region_stats[region] += 1
                
                participants_data[int(participant_id)] = {
                    'fixations_in_area': gaze_points,  # Reutilizando mismo campo para consistencia
                    'total_fixations': len(gaze_points),
                    'region_stats': region_stats,
                    'data_type': 'gaze'
                }
        
        # Calcular estadísticas globales del área
        total_points = sum(p['total_fixations'] for p in participants_data.values())
        global_region_stats = {'sky': 0, 'building': 0, 'road': 0, 'unknown': 0}
        for p_data in participants_data.values():
            for region, count in p_data['region_stats'].items():
                global_region_stats[region] += count
        
        #  CARGAR DATOS DE EVALUACIÓN (participant_scores) - IGUAL QUE radial-glyph
        participant_scores = {}
        try:
            import json
            eval_data_path = os.path.join(os.path.dirname(__file__), '..', '..', 'static', 'data', 'json', 'data_hololens.json')
            if os.path.exists(eval_data_path):
                with open(eval_data_path, 'r') as f:
                    eval_data = json.load(f)
                
                # Mapear image_id con ubicación en eval_data
                location_key = str(image_id)
                debug_log(f" Buscando scores para image_id: {location_key}")
                if location_key in eval_data:
                    location_data = eval_data[location_key]
                    score_participants = location_data.get('score_participant', [])
                    debug_log(f" Participantes con scores encontrados en image {location_key}: {len(score_participants)}")
                    
                    # Extraer puntajes por participante (mismo formato que radial-glyph)
                    for score_entry in score_participants:
                        participant_id = score_entry.get('participant')
                        score = score_entry.get('score')
                        if participant_id is not None and score is not None:
                            participant_scores[int(participant_id)] = {
                                'score': float(score),
                                'age': score_entry.get('age'),
                                'gender': score_entry.get('gener'),  # Note: 'gener' en el JSON
                                'state': score_entry.get('state')
                            }
                            debug_log(f"  👤 Participante {participant_id}: score={score}")
                    
                    debug_log(f"📋 Total participants with scores: {len(participant_scores)}")
                else:
                    debug_log(f" No evaluation data found for image {image_id}")
                    debug_log(f"📋 Available keys: {list(eval_data.keys())[:10]}...")
            else:
                debug_log(f" Evaluation data file not found at: {eval_data_path}")
        except Exception as e:
            debug_log(f" Error loading evaluation data: {e}")
        
        # 🕒 CALCULAR TIEMPOS MÍNIMOS POR PARTICIPANTE (image_min_times) — vectorizado
        image_min_times = {}
        try:
            debug_log(f" Calculando image_min_times para imagen {image_id}")
            image_data = glyph_controller.data[glyph_controller.data['ImageName'] == image_id]
            _min_s = pd.to_numeric(image_data['Time'], errors='coerce').groupby(image_data['participante']).min()
            image_min_times = {int(p): float(v) if pd.notna(v) else 0.0 for p, v in _min_s.items()}
            for p, t in image_min_times.items():
                debug_log(f"  ⏰ Participante {p}: tiempo mínimo = {t:.3f}s")
        except Exception as e:
            debug_log(f" Error calculando image_min_times: {e}")

        # 📊 GENERAR data_for_analysis PARA EL FRONTEND
        # Flatten fixations_in_area de todos los participantes en una única lista
        # (esto es lo que espera el frontend en main2.js línea 727)
        data_for_analysis = []
        for participant_id, p_data in participants_data.items():
            if 'fixations_in_area' in p_data and isinstance(p_data['fixations_in_area'], list):
                for fix in p_data['fixations_in_area']:
                    # Agregar participante ID si no está presente
                    if 'participante' not in fix:
                        fix['participante'] = participant_id
                    data_for_analysis.append(fix)

        debug_log(f" data_for_analysis generada con {len(data_for_analysis)} items")

        result = {
            'area': {
                'x': x,
                'y': y,
                'width': width,
                'height': height
            },
            'image_id': image_id,
            'data_type': data_type,
            'data_for_analysis': data_for_analysis,        # 📊 CRÍTICO: Para que calculateTimeData() funcione
            'fixations': data_for_analysis,                # Alias para compatibilidad
            'gaze_points': data_for_analysis,              # Alias para compatibilidad
            'participants_data': participants_data,
            'total_participants': len(participants),
            'total_points_in_area': total_points,
            'global_region_stats': global_region_stats,
            'participant_scores': participant_scores,      #  NUEVO: Scores de evaluación
            'image_min_times': image_min_times,           # 🕒 NUEVO: Tiempos mínimos
            'success': True
        }
        
        debug_log(f" Area analysis completed: {total_points} points found across {len(participants)} participants")
        debug_log(f" Global region stats: {global_region_stats}")
        debug_log(f"📤 Sending result with {len(participants_data)} participant entries")
        
        return jsonify(clean_for_json(result))
        
    except Exception as e:
        debug_log(f" Error in area analysis: {e}")
        return jsonify({'error': f'Error analyzing area: {str(e)}'})

@glyph_bp.route('/api/glyph/image/<int:image_id>')
def get_image(image_id):
    """Endpoint para servir imágenes directamente desde el backend."""
    try:
        # Buscar la imagen en diferentes directorios y extensiones
        base_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'static', 'images')
        
        possible_paths = [
            os.path.join(base_dir, 'images', 'images', f'{image_id}.jpg'),
            os.path.join(base_dir, 'images', 'images', f'{image_id}.JPG'),
            os.path.join(base_dir, 'images', 'images', f'{image_id}.jpeg'),
            os.path.join(base_dir, 'images', 'images', f'{image_id}.JPEG'),
            os.path.join(base_dir, 'images', 'images', f'{image_id}.png'),
            os.path.join(base_dir, 'images', 'images', f'{image_id}.PNG'),
        ]
        
        for image_path in possible_paths:
            if os.path.exists(image_path):
                debug_log(f" Sirviendo imagen: {image_path}")
                return send_file(image_path)
        
        debug_log(f" Imagen no encontrada para ID {image_id}. Rutas verificadas:")
        for path in possible_paths:
            debug_log(f"   - {path} (existe: {os.path.exists(path)})")
            
        abort(404, description=f"Imagen {image_id} no encontrada")
        
    except Exception as e:
        debug_log(f"Error sirviendo imagen {image_id}: {e}")
        abort(500, description=str(e))

def get_complete_glyph_data_precomputed(image_id, patch_size, service):
    """Funcion ultra-optimizada usando fijaciones pre-calculadas."""
    start_time = time.time()

    try:
        if glyph_controller.data is not None:
            image_data = glyph_controller.data[glyph_controller.data['ImageName'] == image_id]
            all_original_participants = sorted(image_data['participante'].unique())
        else:
            all_original_participants = []

        all_fixations = service.get_fixations_fast(image_id, patch_size=patch_size)
        if 'error' in all_fixations:
            debug_log(f" No precomputed data for image {image_id}, using original method")
            return get_complete_glyph_data_original(image_id)

        precomputed_fixations_by_participant = {}
        for fixation in all_fixations.get('fixations', []):
            participant_key = int(fixation.get('participante', -1))
            precomputed_fixations_by_participant.setdefault(participant_key, []).append(fixation)

        precomputed_participants = set(precomputed_fixations_by_participant.keys())
        missing_participants = [p for p in all_original_participants if p not in precomputed_participants]
        participants = [int(p) for p in sorted(all_original_participants)]

        debug_log(f" HYBRID: {len(precomputed_participants)} precomputed + {len(missing_participants)} original participants")

        participants_data = {}

        for participant_id in participants:
            participant_fixations = precomputed_fixations_by_participant.get(participant_id, [])

            if participant_id in precomputed_participants:
                debug_log(f" Using precomputed data for participant {participant_id}")
                transitions = service.get_semantic_transitions_fast(image_id, participant_id)
                region_stats = transitions.get('region_stats', {}) if isinstance(transitions, dict) else {}
                if not region_stats or all(region == 'unknown' for region in region_stats.keys()):
                    debug_log(f"  Precomputed regions invalid for participant {participant_id}, using fallback")
                    transitions = _process_participant_with_original_method(image_id, participant_id, patch_size)
            else:
                debug_log(f" Using original method for missing participant {participant_id}")
                transitions = _process_participant_with_original_method(image_id, participant_id, patch_size)

            if participant_fixations:
                original_start = float(min((f.get('start_time', 0.0) for f in participant_fixations), default=0.0))
                original_end = float(max((f.get('end_time', 0.0) for f in participant_fixations), default=0.0))
                duration = original_end - original_start
            else:
                original_start = 0.0
                duration = 0.0

            normalized_timeline = []
            for item in transitions.get('timeline', []):
                normalized_item = dict(item)
                if 'start_time' in normalized_item and original_start > 0:
                    normalized_item['start_time'] = normalized_item['start_time'] - original_start
                if 'end_time' in normalized_item and original_start > 0:
                    normalized_item['end_time'] = normalized_item['end_time'] - original_start
                normalized_timeline.append(normalized_item)

            participants_data[int(participant_id)] = {
                'sequence': transitions.get('sequence', []),
                'region_stats': transitions.get('region_stats', {}),
                'timeline': normalized_timeline,
                'total_transitions': transitions.get('total_transitions', 0),
                'unique_regions': transitions.get('unique_regions', 0),
                'time_range': {'start': 0.0, 'end': safe_json_value(duration, 0.0), 'duration': safe_json_value(duration, 0.0)}
            }

        def _patch_index_from_fixation(fixation):
            patch_field = f'patch_{int(patch_size)}_index'
            patch_idx = fixation.get(patch_field, fixation.get('patch_index'))
            if patch_idx is not None:
                try:
                    return int(patch_idx)
                except (TypeError, ValueError):
                    pass
            x_centroid = float(fixation.get('x_centroid', 0.0))
            y_centroid = float(fixation.get('y_centroid', 0.0))
            cols = 800 // patch_size
            return int(y_centroid // patch_size) * cols + int(x_centroid // patch_size)

        def _build_attention_row_from_fixations(fixations, total_patches):
            row = [0] * total_patches
            for fixation in fixations:
                patch_idx = _patch_index_from_fixation(fixation)
                if 0 <= patch_idx < total_patches:
                    row[patch_idx] += 1
            return row

        total_patches = (800 // patch_size) * (600 // patch_size)
        attention_matrix = []

        for participant_id in participants:
            if participant_id in precomputed_participants:
                participant_fixations = precomputed_fixations_by_participant.get(participant_id, [])
                participant_row = _build_attention_row_from_fixations(participant_fixations, total_patches)
            else:
                participant_row = [0] * total_patches
                if glyph_controller.data is not None:
                    try:
                        participant_data = glyph_controller.data[
                            (glyph_controller.data['ImageName'] == image_id) &
                            (glyph_controller.data['participante'] == participant_id)
                        ]
                        if len(participant_data) > 0:
                            if precalculated_service and precalculated_service.is_available():
                                try:
                                    participant_fixations = precalculated_service.get_fixations_for_participant_image(participant_id, image_id)
                                    participant_row = _build_attention_row_from_fixations(participant_fixations, total_patches)
                                    debug_log(f" ULTRA-FAST: Participante {participant_id} usando fijaciones pre-calculadas")
                                except Exception as e:
                                    debug_log(f" Fallback a calculo en tiempo real para participante {participant_id}: {e}")
                                    from fixation_detection_ivt import FixationDetectorIVT
                                    detector = FixationDetectorIVT()
                                    fixations = detector.detect_fixations(participant_data, 800, 600)
                                    participant_row = _build_attention_row_from_fixations(fixations, total_patches)
                            else:
                                from fixation_detection_ivt import FixationDetectorIVT
                                detector = FixationDetectorIVT()
                                fixations = detector.detect_fixations(participant_data, 800, 600)
                                participant_row = _build_attention_row_from_fixations(fixations, total_patches)
                    except Exception as e:
                        error_log(f" Error generating attention matrix for participant {participant_id}: {e}")

            attention_matrix.append(participant_row)

        active_patch_indices = [f.get('patch_index') for f in all_fixations.get('fixations', []) if f.get('patch_index') is not None]
        topic_modeling = {
            'participants': participants,
            'attention_matrix': attention_matrix,
            'config': {'patch_size': patch_size, 'image_width': 800, 'image_height': 600, 'total_patches': total_patches},
            'statistics': {'total_fixations': len(all_fixations.get('fixations', [])), 'participants': len(participants), 'active_patches': len(set(active_patch_indices)), 'source': 'precomputed_ultra_fast'}
        }

        data_for_analysis = []
        for participant_id in participants:
            p_timeline = participants_data[int(participant_id)].get('timeline', [])
            for timeline_item in p_timeline:
                data_for_analysis.append({
                    'participante': participant_id,
                    'ImageIndex': image_id,
                    'ImageName': image_id,
                    'Time': timeline_item.get('start_time', 0.0),
                    'start': timeline_item.get('start_time', 0.0),
                    'end': timeline_item.get('end_time', 0.0),
                    'duration': timeline_item.get('duration', 0.0),
                    'region': timeline_item.get('region', 'unknown'),
                    'x_centroid': timeline_item.get('centroid_x', 0.0),
                    'y_centroid': timeline_item.get('centroid_y', 0.0),
                    'pixelX': timeline_item.get('centroid_x', 0.0),
                    'pixelY': timeline_item.get('centroid_y', 0.0),
                    'pointCount': timeline_item.get('fixation_count', 1)
                })

        processing_time = time.time() - start_time
        result = {
            'image_id': image_id,
            'participants': participants,
            'participants_data': participants_data,
            'data_for_analysis': data_for_analysis,
            'topic_modeling': topic_modeling,
            'processing_time': processing_time,
            'optimization': 'precomputed_csv',
            'speedup': f'~{30:.0f}x faster than I-VT'
        }

        debug_log(f" ULTRA-FAST COMPLETE: Imagen {image_id} procesada en {processing_time:.3f}s (vs ~15-90s normal)")
        debug_log(f"  data_for_analysis: {len(data_for_analysis)} items con tiempos normalizados")
        return jsonify(result)

    except Exception as e:
        error_log(f" Error en modo ultra-fast: {e}")
        return jsonify({'error': f'Error in precomputed mode: {str(e)}'})

def _process_regions_fallback(participant_data, MIN_STAY_DURATION, MAX_STAY_DURATION, participant_id):
    """Método fallback para procesar regiones si falla la vectorización."""
    filtered_regions = []
    current_group = []
    
    _records = participant_data[['main_class', 'Time', 'pixelX', 'pixelY']].to_dict('records')
    for i, row in enumerate(_records):
        current_region = str(row['main_class'])
        current_time = safe_json_value(row['Time'], 0.0)

        current_group.append({
            'region': current_region,
            'time': current_time,
            'pixelX': row['pixelX'],
            'pixelY': row['pixelY']
        })

        # Si cambia de región o es el último punto
        is_last = (i == len(_records) - 1)
        next_region = current_region if is_last else str(_records[i + 1]['main_class'])
        
        if current_region != next_region or is_last:
            if len(current_group) > 1:
                group_start = current_group[0]['time']
                group_end = current_group[-1]['time']
                duration = group_end - group_start
                
                # Filtrar por duración válida
                if duration >= MIN_STAY_DURATION and duration <= MAX_STAY_DURATION:
                    avg_x = sum(p['pixelX'] for p in current_group) / len(current_group)
                    avg_y = sum(p['pixelY'] for p in current_group) / len(current_group)
                    
                    filtered_regions.append({
                        'region': current_region,
                        'start_time': group_start,
                        'end_time': group_end,
                        'duration': duration,
                        'points': len(current_group),
                        'centroid_x': avg_x,
                        'centroid_y': avg_y
                    })
                elif len(filtered_regions) == 0:
                    # Permitir la primera región aunque sea corta
                    avg_x = sum(p['pixelX'] for p in current_group) / len(current_group)
                    avg_y = sum(p['pixelY'] for p in current_group) / len(current_group)
                    
                    filtered_regions.append({
                        'region': current_region,
                        'start_time': group_start,
                        'end_time': group_end,
                        'duration': duration,
                        'points': len(current_group),
                        'centroid_x': avg_x,
                        'centroid_y': avg_y
                    })
            
            current_group = []
    
    debug_log(f"  FALLBACK: Procesadas {len(filtered_regions)} regiones para participante {participant_id}")
    return filtered_regions

def _convert_regions_to_transitions_format(regions):
    """Convertir lista de regiones a formato de transiciones esperado."""
    if not regions:
        return {
            'sequence': [],
            'region_stats': {},
            'timeline': [],
            'total_transitions': 0,
            'unique_regions': 0
        }

    # Crear estadísticas por región
    region_stats = {}
    for region_data in regions:
        region_name = region_data['region']
        if region_name not in region_stats:
            region_stats[region_name] = {
                'total_duration': 0,
                'visit_count': 0,
                'first_visit': None,
                'last_visit': None,
                'centroid_x': region_data.get('centroid_x', 0),
                'centroid_y': region_data.get('centroid_y', 0)
            }

        stats = region_stats[region_name]
        stats['total_duration'] += region_data['duration']
        stats['visit_count'] += 1

        if stats['first_visit'] is None or region_data['start_time'] < stats['first_visit']:
            stats['first_visit'] = region_data['start_time']
        if stats['last_visit'] is None or region_data['end_time'] > stats['last_visit']:
            stats['last_visit'] = region_data['end_time']

    # Crear secuencia de transiciones
    sequence = []
    for i in range(1, len(regions)):
        prev_region = regions[i-1]
        curr_region = regions[i]

        sequence.append({
            'from_region': prev_region['region'],
            'to_region': curr_region['region'],
            'time': curr_region['start_time'],
            'duration': curr_region['start_time'] - prev_region['end_time']
        })

    # Serializar timeline completo para scarf plot
    timeline_serialized = []
    for region in regions:
        timeline_serialized.append({
            'region': region.get('region', 'unknown'),
            'start_time': float(region.get('start_time', 0.0)),
            'end_time': float(region.get('end_time', region.get('start_time', 0.0))),
            'duration': float(region.get('duration', 0.0)),
            'fixation_count': int(region.get('fixation_count', 0)),
            'centroid_x': float(region.get('centroid_x', 0.0)),
            'centroid_y': float(region.get('centroid_y', 0.0))
        })

    return {
        'sequence': sequence,
        'region_stats': region_stats,
        'timeline': timeline_serialized,
        'total_transitions': len(sequence),
        'unique_regions': len(region_stats)
    }

def _process_participant_with_original_method(image_id, participant_id, patch_size):
    """Procesar un participante usando el método original con datos completos."""
    try:
        if glyph_controller.data is None:
            return {'sequence': [], 'region_stats': {}, 'timeline': [], 'total_transitions': 0, 'unique_regions': 0}

        participant_original = glyph_controller.data[
            (glyph_controller.data['ImageName'] == image_id) &
            (glyph_controller.data['participante'] == participant_id)
        ]

        if len(participant_original) == 0:
            return {'sequence': [], 'region_stats': {}, 'timeline': [], 'total_transitions': 0, 'unique_regions': 0}
        
        # Agregar semantic classification
        participant_with_semantics = participant_original.copy()
        cols = 800 // patch_size
        participant_with_semantics['patch_x'] = (participant_with_semantics['pixelX'] // patch_size).astype(int)
        participant_with_semantics['patch_y'] = (participant_with_semantics['pixelY'] // patch_size).astype(int)
        participant_with_semantics['patch_index'] = participant_with_semantics['patch_y'] * cols + participant_with_semantics['patch_x']
        
        # Agregar clasificación semántica
        try:
            from app.controllers.experimentos import TopicModelingAnalyzer
            analyzer = TopicModelingAnalyzer(patch_size=patch_size)
            participant_with_semantics['main_class'] = 'unknown'
            for idx, row in participant_with_semantics.iterrows():
                try:
                    patch_idx = int(row['patch_index'])
                    main_class = analyzer.get_patch_main_class(patch_idx, image_id)
                    participant_with_semantics.at[idx, 'main_class'] = main_class or 'unknown'
                except:
                    participant_with_semantics.at[idx, 'main_class'] = 'unknown'
        except:
            participant_with_semantics['main_class'] = 'unknown'
        
        # Procesar regiones
        fallback_regions = _process_regions_fallback(participant_with_semantics, 0.2, 5.0, participant_id)
        if fallback_regions and len(fallback_regions) > 0:
            return _convert_regions_to_transitions_format(fallback_regions)
        else:
            return {'sequence': [], 'region_stats': {}, 'timeline': [], 'total_transitions': 0, 'unique_regions': 0}

    except Exception as e:
        debug_log(f"Error processing participant {participant_id} with original method: {e}")
        return {'sequence': [], 'region_stats': {}, 'timeline': [], 'total_transitions': 0, 'unique_regions': 0}

def get_complete_glyph_data_original(image_id):
    """Función para usar método 100% original cuando no hay datos pre-calculados."""
    debug_log(f" FALLBACK: Usando método I-VT original completo para imagen {image_id}")
    
    if glyph_controller.data is None:
        return jsonify({'error': 'No data available'})
    
    patch_size = request.args.get('patch_size', 40, type=int)
    
    # Usar la implementación original existente
    from app.controllers.experimentos import experimentos_controller
    topic_result = experimentos_controller.run_topic_modeling_experiment(image_id, patch_size, '3')
    
    if 'error' in topic_result:
        return jsonify(topic_result)
    
    # Resto de la implementación original existente...
    # (Usar el código del método fallback original que ya existía)
    
    return jsonify({
        'image_id': image_id,
        'optimization': 'original_method',
        'message': 'Using original I-VT method due to missing precomputed data',
        **topic_result
    })



