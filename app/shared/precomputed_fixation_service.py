"""
Servicio unificado de fijaciones pre-calculadas.
Adaptador sobre `precalculated_fixations_service` para evitar duplicacion de logica.
"""

import time
import numpy as np
import pandas as pd

try:
    from precalculated_fixations_service import precalculated_service as _delegate_service
except Exception:
    _delegate_service = None


def _safe_json_value(value, default_value='unknown'):
    if value is None:
        return default_value
    if pd.isna(value):
        return default_value
    if isinstance(value, (int, float)) and (np.isnan(value) or np.isinf(value)):
        return default_value
    if isinstance(value, str) and value.strip() == '':
        return default_value
    return value


class PrecomputedFixationService:
    """API estable para obtener fijaciones pre-calculadas."""

    def __init__(self, csv_path=None):
        self.csv_path = csv_path
        self._delegate = _delegate_service if _delegate_service is not None and _delegate_service.is_available() else None
        self.fixations_df = getattr(self._delegate, 'fixations_df', None)

    def is_available(self):
        return self._delegate is not None

    def get_global_stats(self):
        if self._delegate is None:
            return {}
        try:
            return self._delegate.get_global_stats()
        except Exception:
            return {}

    def get_attention_matrix(self, image_id, patch_size=40):
        if self._delegate is None:
            return {'error': 'Fijaciones pre-calculadas no disponibles'}
        return self._delegate.get_attention_matrix(int(image_id), int(patch_size))

    def get_fixations_for_image(self, image_id, patch_size=40):
        if self._delegate is None:
            return []
        return self._delegate.get_fixations_for_image(int(image_id), int(patch_size))

    def get_fixations_for_participant_image(self, participant_id, image_id):
        if self._delegate is None:
            return []
        return self._delegate.get_fixations_for_participant_image(int(participant_id), int(image_id))

    def _build_stats(self, fixations_list, participant_id, image_id, start_time):
        participants = [participant_id] if participant_id is not None else sorted(list({int(f.get('participante')) for f in fixations_list if f.get('participante') is not None}))
        query_time = time.time() - start_time
        return {
            'fixations': fixations_list,
            'stats': {
                'total_fixations': len(fixations_list),
                'participants': len(participants),
                'avg_duration': float(np.mean([f.get('duration', 0.0) for f in fixations_list])) if fixations_list else 0.0,
                'query_time': query_time,
                'source': 'precalculated_service_delegate'
            },
            'image_id': image_id,
            'participant_id': participant_id
        }

    def get_fixations_fast(self, image_id, participant_id=None, patch_size=40):
        start_time = time.time()

        if self._delegate is None:
            return {'error': 'Fijaciones pre-calculadas no disponibles'}

        try:
            if participant_id is None:
                fixations_list = self._delegate.get_fixations_for_image(int(image_id), int(patch_size))
                # Normalizar campos para compatibilidad con consumidores existentes
                for f in fixations_list:
                    if 'start' not in f and 'start_time' in f:
                        f['start'] = f['start_time']
                    if 'end' not in f and 'end_time' in f:
                        f['end'] = f['end_time']
                    if 'pointCount' not in f and 'point_count' in f:
                        f['pointCount'] = int(f['point_count'])
                    f['main_class'] = _safe_json_value(f.get('main_class'), 'unknown')
            else:
                raw_fix = self._delegate.get_fixations_for_participant_image(int(participant_id), int(image_id))
                patch_field = f'patch_{int(patch_size)}_index'
                fixations_list = []
                for rec in raw_fix:
                    patch_index = rec.get(patch_field)
                    if patch_index is None:
                        patch_index = rec.get('patch_40_index', 0)
                    fixations_list.append({
                        'participante': int(rec.get('participante', participant_id)),
                        'ImageName': int(rec.get('ImageName', image_id)),
                        'start_time': float(rec.get('start_time', rec.get('start', 0.0))),
                        'end_time': float(rec.get('end_time', rec.get('end', 0.0))),
                        'start': float(rec.get('start_time', rec.get('start', 0.0))),
                        'end': float(rec.get('end_time', rec.get('end', 0.0))),
                        'duration': float(rec.get('duration', 0.0)),
                        'x_centroid': float(rec.get('x_centroid', 0.0)),
                        'y_centroid': float(rec.get('y_centroid', 0.0)),
                        'pointCount': int(rec.get('pointCount', rec.get('point_count', 1))),
                        'patch_index': int(patch_index),
                        'main_class': _safe_json_value(rec.get('main_class'), 'unknown')
                    })

            return self._build_stats(fixations_list, participant_id, image_id, start_time)

        except Exception as e:
            return {'error': f'Error retrieving precomputed fixations: {str(e)}'}

    def get_patch_fixations_fast(self, image_id, pixel_bounds, patch_size=40):
        start_time = time.time()
        all_fixations = self.get_fixations_fast(image_id, participant_id=None, patch_size=patch_size)
        if 'error' in all_fixations:
            return all_fixations

        x_start = pixel_bounds.get('x_start', pixel_bounds.get('x_min', 0))
        y_start = pixel_bounds.get('y_start', pixel_bounds.get('y_min', 0))
        x_end = pixel_bounds.get('x_end', pixel_bounds.get('x_max', 0))
        y_end = pixel_bounds.get('y_end', pixel_bounds.get('y_max', 0))

        filtered_fixations = []
        for fixation in all_fixations.get('fixations', []):
            x, y = fixation.get('x_centroid', 0), fixation.get('y_centroid', 0)
            if x_start <= x < x_end and y_start <= y < y_end:
                filtered_fixations.append(fixation)

        return {
            'fixations': filtered_fixations,
            'stats': {
                'total_fixations': len(filtered_fixations),
                'filtered_from': len(all_fixations.get('fixations', [])),
                'filter_time': time.time() - start_time,
                'source': 'precalculated_service_delegate_filtered'
            },
            'image_id': image_id,
            'pixel_bounds': pixel_bounds
        }

    def get_semantic_transitions_fast(self, image_id, participant_id, min_duration=0.2, max_duration=5.0):
        fixations_result = self.get_fixations_fast(image_id, participant_id=participant_id)
        fixations = fixations_result.get('fixations', []) if isinstance(fixations_result, dict) else []
        if not fixations:
            return {'sequence': [], 'region_stats': {}, 'timeline': [], 'error': 'No fixations available'}

        fixations = sorted(fixations, key=lambda x: float(x.get('start_time', x.get('start', 0.0))))

        regions = []
        current_region = None
        region_start = None
        region_fixations = []

        for fixation in fixations:
            region = _safe_json_value(fixation.get('main_class'), 'unknown')
            start_val = float(fixation.get('start_time', fixation.get('start', 0.0)))
            end_val = float(fixation.get('end_time', fixation.get('end', start_val)))

            if region != current_region:
                if current_region is not None and region_fixations:
                    duration = float(start_val - region_start)
                    if min_duration <= duration <= max_duration:
                        avg_x = sum(f.get('x_centroid', 0.0) for f in region_fixations) / len(region_fixations)
                        avg_y = sum(f.get('y_centroid', 0.0) for f in region_fixations) / len(region_fixations)
                        regions.append({
                            'region': current_region,
                            'start_time': region_start,
                            'end_time': start_val,
                            'duration': duration,
                            'fixation_count': len(region_fixations),
                            'centroid_x': avg_x,
                            'centroid_y': avg_y
                        })
                current_region = region
                region_start = start_val
                region_fixations = [{**fixation, '_end': end_val}]
            else:
                region_fixations.append({**fixation, '_end': end_val})

        if current_region is not None and region_fixations:
            last_end = float(region_fixations[-1].get('_end', region_start))
            duration = last_end - region_start
            if min_duration <= duration <= max_duration:
                avg_x = sum(f.get('x_centroid', 0.0) for f in region_fixations) / len(region_fixations)
                avg_y = sum(f.get('y_centroid', 0.0) for f in region_fixations) / len(region_fixations)
                regions.append({
                    'region': current_region,
                    'start_time': region_start,
                    'end_time': last_end,
                    'duration': duration,
                    'fixation_count': len(region_fixations),
                    'centroid_x': avg_x,
                    'centroid_y': avg_y
                })

        sequence = []
        for i in range(1, len(regions)):
            prev_region = regions[i - 1]
            curr_region = regions[i]
            sequence.append({
                'from_region': prev_region['region'],
                'to_region': curr_region['region'],
                'time': curr_region['start_time'],
                'duration': curr_region['start_time'] - prev_region['end_time']
            })

        region_stats = {}
        for region in regions:
            name = region['region']
            if name not in region_stats:
                region_stats[name] = {
                    'total_duration': 0.0,
                    'visit_count': 0,
                    'first_visit': None,
                    'last_visit': None,
                    'centroid_x': 0.0,
                    'centroid_y': 0.0
                }
            stats = region_stats[name]
            stats['total_duration'] += region['duration']
            stats['visit_count'] += 1
            stats['centroid_x'] = region['centroid_x']
            stats['centroid_y'] = region['centroid_y']
            if stats['first_visit'] is None or region['start_time'] < stats['first_visit']:
                stats['first_visit'] = region['start_time']
            if stats['last_visit'] is None or region['end_time'] > stats['last_visit']:
                stats['last_visit'] = region['end_time']

        timeline = [{
            'region': r.get('region', 'unknown'),
            'start_time': float(r.get('start_time', 0.0)),
            'end_time': float(r.get('end_time', r.get('start_time', 0.0))),
            'duration': float(r.get('duration', 0.0)),
            'fixation_count': int(r.get('fixation_count', 0)),
            'centroid_x': float(r.get('centroid_x', 0.0)),
            'centroid_y': float(r.get('centroid_y', 0.0))
        } for r in regions]

        return {
            'sequence': sequence,
            'region_stats': region_stats,
            'timeline': timeline,
            'total_transitions': len(sequence),
            'unique_regions': len(region_stats),
            'source': 'precomputed_semantic_transitions'
        }


_precomputed_service = None


def get_precomputed_service():
    global _precomputed_service
    if _precomputed_service is None:
        _precomputed_service = PrecomputedFixationService()
    return _precomputed_service


def get_fixations_ivt_fast(data, participant_id=None, image_id=None, **kwargs):
    service = get_precomputed_service()
    return service.get_fixations_fast(image_id, participant_id)


def get_patch_fixations_fast(data, image_id, pixel_bounds, **kwargs):
    service = get_precomputed_service()
    return service.get_patch_fixations_fast(image_id, pixel_bounds)
