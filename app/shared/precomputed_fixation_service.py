"""
Servicio optimizado de fijaciones usando CSV pre-calculado.
Reemplaza get_fixations_ivt() con lookups ultra-rápidos.
"""

import pandas as pd
import numpy as np
import os
import time
from functools import lru_cache

def _safe_json_value(value, default_value='unknown'):
    """Función auxiliar para asegurar que los valores sean serializables a JSON."""
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
    """Servicio de fijaciones usando datos pre-calculados."""
    
    def __init__(self, csv_path=None):
        self.csv_path = csv_path or os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            'static', 'data', 'fixation.csv'
        )
        self.fixations_df = None
        self._load_fixations()
    
    def _load_fixations(self):
        """Cargar fijaciones pre-calculadas."""
        try:
            print(f"Cargando fijaciones pre-calculadas desde {self.csv_path}")
            self.fixations_df = pd.read_csv(self.csv_path)
            print(f"Cargadas {len(self.fixations_df)} fijaciones pre-calculadas")

            # MAPEAR COLUMNAS: El CSV tiene 'participante' e 'ImageName', no 'participant_id' e 'image_id'
            self.fixations_df.rename(columns={
                'participante': 'participant_id',
                'ImageName': 'image_id',
                'patch_10_index': 'patch_10',
                'patch_20_index': 'patch_20',
                'patch_40_index': 'patch_40'
            }, inplace=True)

            # Asegurar que existan columnas requeridas
            if 'main_class' not in self.fixations_df.columns:
                self.fixations_df['main_class'] = 'unknown'

            # Crear índices para búsqueda rápida y optimizar memoria
            self.fixations_df.set_index(['image_id', 'participant_id'], inplace=True)
            self.fixations_df.sort_index(inplace=True)  # Optimizar para lookups rapidos

            # Optimización de memoria: convertir a tipos más eficientes
            for col in ['start_time', 'end_time', 'duration', 'x_centroid', 'y_centroid']:
                if col in self.fixations_df.columns:
                    self.fixations_df[col] = self.fixations_df[col].astype('float32')

            for col in ['point_count', 'patch_10', 'patch_20', 'patch_40']:
                if col in self.fixations_df.columns:
                    self.fixations_df[col] = self.fixations_df[col].astype('int16')

        except FileNotFoundError:
            print(f"Archivo fixation.csv no encontrado: {self.csv_path}")
            print("Ejecute 'python precompute_fixations.py' para generar fixation.csv")
            self.fixations_df = None
        except Exception as e:
            print(f"Error cargando fijaciones pre-calculadas: {e}")
            self.fixations_df = None
    
    @lru_cache(maxsize=500)  # Reducir cache para ahorrar memoria
    def get_fixations_fast(self, image_id, participant_id=None, patch_size=40):
        """
        Obtener fijaciones pre-calculadas ultra-rápido.
        
        Parameters:
        -----------
        image_id : int
            ID de la imagen
        participant_id : int, optional
            ID del participante (None para todos)
        patch_size : int
            Tamaño de patch (10, 20, 40)
            
        Returns:
        --------
        dict : Fijaciones en formato compatible con I-VT original
        """
        start_time = time.time()
        
        if self.fixations_df is None:
            return {'error': 'Fijaciones pre-calculadas no disponibles'}
        
        try:
            # Filtrar por imagen
            if participant_id is not None:
                # Filtro específico: imagen + participante
                try:
                    fixations_subset = self.fixations_df.loc[(image_id, participant_id)]
                    # Si es una sola fila, convertir a DataFrame
                    if isinstance(fixations_subset, pd.Series):
                        fixations_subset = fixations_subset.to_frame().T
                    # If it's already a DataFrame, it's fine
                except KeyError:
                    fixations_subset = pd.DataFrame()
            else:
                # Filtro por imagen (todos los participantes)
                fixations_subset = self.fixations_df.loc[
                    self.fixations_df.index.get_level_values('image_id') == image_id
                ]
            
            # Convertir a lista de diccionarios (formato compatible)
            fixations_list = []
            
            if len(fixations_subset) > 0:
                for index, fixation in fixations_subset.iterrows():
                    # Get participant_id and image_id from index
                    if participant_id is not None:
                        # Single participant query - get from parameters
                        fixation_participant_id = participant_id
                        fixation_image_id = image_id
                    else:
                        # Multi-participant query - get from index
                        fixation_image_id, fixation_participant_id = index
                    
                    patch_col_name = f'patch_{patch_size}'
                    patch_index = fixation[patch_col_name] if patch_col_name in fixation.index else 0

                    fixation_dict = {
                        'participante': fixation_participant_id,
                        'ImageName': fixation_image_id,
                        'start_time': float(fixation['start_time']),
                        'end_time': float(fixation['end_time']),
                        'duration': float(fixation['duration']),
                        'x_centroid': float(fixation['x_centroid']),
                        'y_centroid': float(fixation['y_centroid']),
                        'pointCount': int(fixation['point_count']),
                        'patch_index': int(patch_index),
                        'main_class': _safe_json_value(fixation['main_class'], 'unknown')
                    }
                    fixations_list.append(fixation_dict)
            
            # Calcular estadísticas rápidas
            if participant_id is not None:
                participants = [participant_id]
            else:
                participants = fixations_subset.index.get_level_values('participant_id').unique() if len(fixations_subset) > 0 else []
            
            end_time = time.time()
            query_time = end_time - start_time
            
            result = {
                'fixations': fixations_list,
                'stats': {
                    'total_fixations': len(fixations_list),
                    'participants': len(participants),
                    'avg_duration': np.mean([f['duration'] for f in fixations_list]) if fixations_list else 0,
                    'query_time': query_time,
                    'source': 'precomputed_csv'
                },
                'image_id': image_id,
                'participant_id': participant_id,
                'patch_size': patch_size
            }
            
            print(f" ULTRA-FAST: {len(fixations_list)} fijaciones en {query_time:.4f}s (vs ~5-10s I-VT)")
            return result
            
        except KeyError as e:
            # No hay datos para esta combinación
            print(f" KeyError in service: {e}")
            return {
                'fixations': [],
                'stats': {
                    'total_fixations': 0,
                    'participants': 0,
                    'avg_duration': 0,
                    'query_time': time.time() - start_time,
                    'source': 'precomputed_csv'
                },
                'image_id': image_id,
                'participant_id': participant_id,
                'error': f'No fixations found for image {image_id}, participant {participant_id}'
            }
        
        except Exception as e:
            return {'error': f'Error retrieving precomputed fixations: {str(e)}'}
    
    def get_patch_fixations_fast(self, image_id, pixel_bounds, patch_size=40):
        """
        Filtrar fijaciones por región de patch ultra-rápido.
        
        Parameters:
        -----------
        image_id : int
            ID de la imagen
        pixel_bounds : dict
            {'x_start': int, 'y_start': int, 'x_end': int, 'y_end': int}
        patch_size : int
            Tamaño de patch
            
        Returns:
        --------
        dict : Fijaciones filtradas por región
        """
        start_time = time.time()
        
        # Obtener todas las fijaciones de la imagen
        all_fixations = self.get_fixations_fast(image_id, patch_size=patch_size)
        
        if 'error' in all_fixations:
            return all_fixations
        
        # Filtrar por región espacial
        filtered_fixations = []
        for fixation in all_fixations['fixations']:
            x, y = fixation['x_centroid'], fixation['y_centroid']
            
            if (pixel_bounds['x_start'] <= x < pixel_bounds['x_end'] and
                pixel_bounds['y_start'] <= y < pixel_bounds['y_end']):
                filtered_fixations.append(fixation)
        
        end_time = time.time()
        
        result = {
            'fixations': filtered_fixations,
            'stats': {
                'total_fixations': len(filtered_fixations),
                'filtered_from': len(all_fixations['fixations']),
                'filter_time': end_time - start_time,
                'source': 'precomputed_csv_filtered'
            },
            'image_id': image_id,
            'pixel_bounds': pixel_bounds
        }
        
        print(f" FILTERED: {len(filtered_fixations)} fijaciones en región en {end_time - start_time:.4f}s")
        return result
    
    def get_semantic_transitions_fast(self, image_id, participant_id, min_duration=0.2, max_duration=5.0):
        """
        Generar transiciones semánticas ultra-rápido usando datos pre-calculados.

        Parameters:
        -----------
        image_id : int
            ID de la imagen
        participant_id : int
            ID del participante
        min_duration : float
            Duración mínima entre transiciones
        max_duration : float
            Duración máxima entre transiciones

        Returns:
        --------
        dict : Secuencias de transición semánticas con timeline
        """
        start_time = time.time()

        # Obtener fijaciones del participante ordenadas por tiempo
        fixations_result = self.get_fixations_fast(image_id, participant_id)

        if 'error' in fixations_result or not fixations_result['fixations']:
            return {'sequence': [], 'region_stats': {}, 'timeline': [], 'error': 'No fixations available'}

        fixations = sorted(fixations_result['fixations'], key=lambda x: x['start_time'])

        # Agrupar por región semántica consecutiva
        regions = []
        current_region = None
        region_start = None
        region_fixations = []

        for fixation in fixations:
            region = _safe_json_value(fixation['main_class'], 'unknown')

            if region != current_region:
                # Terminar región anterior
                if current_region is not None:
                    duration = fixation['start_time'] - region_start
                    if min_duration <= duration <= max_duration:
                        # Calcular centroide promedio y contar fijaciones
                        avg_x = sum(f['x_centroid'] for f in region_fixations) / len(region_fixations) if region_fixations else 0
                        avg_y = sum(f['y_centroid'] for f in region_fixations) / len(region_fixations) if region_fixations else 0
                        regions.append({
                            'region': current_region,
                            'start_time': region_start,
                            'end_time': fixation['start_time'],
                            'duration': duration,
                            'fixation_count': len(region_fixations),
                            'centroid_x': avg_x,
                            'centroid_y': avg_y
                        })

                # Iniciar nueva región
                current_region = region
                region_start = fixation['start_time']
                region_fixations = [fixation]
            else:
                region_fixations.append(fixation)

        # Agregar la última región
        if current_region is not None and region_fixations:
            duration = fixations[-1]['end_time'] - region_start
            if min_duration <= duration <= max_duration:
                avg_x = sum(f['x_centroid'] for f in region_fixations) / len(region_fixations)
                avg_y = sum(f['y_centroid'] for f in region_fixations) / len(region_fixations)
                regions.append({
                    'region': current_region,
                    'start_time': region_start,
                    'end_time': fixations[-1]['end_time'],
                    'duration': duration,
                    'fixation_count': len(region_fixations),
                    'centroid_x': avg_x,
                    'centroid_y': avg_y
                })

        # Crear transiciones
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

        # Estadísticas por región
        region_stats = {}
        for region in regions:
            region_name = region['region']
            if region_name not in region_stats:
                region_stats[region_name] = {
                    'total_duration': 0,
                    'visit_count': 0,
                    'first_visit': None,
                    'last_visit': None,
                    'centroid_x': 0,
                    'centroid_y': 0
                }

            stats = region_stats[region_name]
            stats['total_duration'] += region['duration']
            stats['visit_count'] += 1
            stats['centroid_x'] = region['centroid_x']
            stats['centroid_y'] = region['centroid_y']

            if stats['first_visit'] is None or region['start_time'] < stats['first_visit']:
                stats['first_visit'] = region['start_time']
            if stats['last_visit'] is None or region['end_time'] > stats['last_visit']:
                stats['last_visit'] = region['end_time']

        # Serializar timeline completo (compatible con renderScarfPlot)
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

        end_time = time.time()

        result = {
            'sequence': sequence,
            'region_stats': region_stats,
            'timeline': timeline_serialized,
            'processing_time': end_time - start_time,
            'total_transitions': len(sequence),
            'unique_regions': len(region_stats),
            'source': 'precomputed_semantic_transitions'
        }

        print(f"TRANSITIONS: {len(sequence)} transiciones, {len(timeline_serialized)} segmentos en {end_time - start_time:.4f}s")
        return result

# Instancia global del servicio
_precomputed_service = None

def get_precomputed_service():
    """Obtener instancia singleton del servicio pre-calculado."""
    global _precomputed_service
    if _precomputed_service is None:
        _precomputed_service = PrecomputedFixationService()
    return _precomputed_service

# Funciones de compatibilidad con API existente
def get_fixations_ivt_fast(data, participant_id=None, image_id=None, **kwargs):
    """Función de compatibilidad que usa datos pre-calculados."""
    service = get_precomputed_service()
    return service.get_fixations_fast(image_id, participant_id)

def get_patch_fixations_fast(data, image_id, pixel_bounds, **kwargs):
    """Función de compatibilidad para filtrado por patch."""
    service = get_precomputed_service()
    return service.get_patch_fixations_fast(image_id, pixel_bounds)