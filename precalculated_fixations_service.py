#!/usr/bin/env python3
"""
Servicio para cargar y usar fijaciones pre-calculadas
Reemplaza el cálculo en tiempo real para mayor velocidad
"""

import pandas as pd
import numpy as np
import os
import json
from typing import List, Dict, Any, Optional

class PrecalculatedFixationsService:
    """Servicio para manejar fijaciones pre-calculadas"""
    
    def __init__(self):
        self.fixations_df = None
        self.stats = None
        self.loaded = False
        self.load_data()
    
    def load_data(self):
        """Cargar datos de fijaciones pre-calculadas"""
        try:
            # Cargar CSV de fijaciones
            fixations_path = os.path.join('static', 'data', 'precalculated_fixations.csv')
            if not os.path.exists(fixations_path):
                print(f" No se encontró archivo de fijaciones pre-calculadas: {fixations_path}")
                print(f" Ejecuta 'python generate_precalculated_fixations.py' para generarlo")
                return False
            
            print(f" Cargando fijaciones pre-calculadas desde: {fixations_path}")
            self.fixations_df = pd.read_csv(fixations_path)
            
            # Cargar estadísticas
            stats_path = os.path.join('static', 'data', 'fixation_stats.json')
            if os.path.exists(stats_path):
                with open(stats_path, 'r') as f:
                    self.stats = json.load(f)
            
            self.loaded = True
            print(f" Fijaciones pre-calculadas cargadas: {len(self.fixations_df)} fijaciones")
            return True
            
        except Exception as e:
            print(f" Error cargando fijaciones pre-calculadas: {e}")
            return False
    
    def get_fixations_for_participant_image(self, participant_id: int, image_id: int) -> List[Dict[str, Any]]:
        """
        Obtener fijaciones para un participante e imagen específicos
        
        Args:
            participant_id: ID del participante
            image_id: ID de la imagen
            
        Returns:
            Lista de fijaciones en formato compatible con el sistema existente
        """
        if not self.loaded:
            return []
        
        # Filtrar fijaciones
        mask = (self.fixations_df['participante'] == participant_id) & \
               (self.fixations_df['ImageName'] == image_id)
        
        participant_fixations = self.fixations_df[mask]
        
        # Convertir a formato esperado por el sistema
        fixations = []
        for _, row in participant_fixations.iterrows():
            fixation = {
                'participante': int(row['participante']),
                'ImageIndex': int(row['ImageIndex']),
                'ImageName': int(row['ImageName']),
                'start': float(row['start_time']),
                'end': float(row['end_time']),
                'start_time': float(row['start_time']),  # Para compatibilidad
                'end_time': float(row['end_time']),      # Para compatibilidad
                'duration': float(row['duration']),
                'x_centroid': float(row['x_centroid']),
                'y_centroid': float(row['y_centroid']),
                'pointCount': int(row['point_count']),
                'point_count': int(row['point_count']),  # Para compatibilidad
                'class_names': [],
                
                # Información de patches pre-calculada
                'patch_10_index': int(row['patch_10_index']),
                'patch_20_index': int(row['patch_20_index']),
                'patch_40_index': int(row['patch_40_index']),
                
                # Metadata
                'source': 'precalculated',
                'algorithm': row['algorithm'],
                'velocity_threshold': row['velocity_threshold'],
                'min_duration': row['min_duration']
            }
            fixations.append(fixation)
        
        return fixations
    
    def get_fixations_for_image(self, image_id: int, patch_size: int = 40) -> List[Dict[str, Any]]:
        """
        Obtener todas las fijaciones para una imagen (todos los participantes)
        
        Args:
            image_id: ID de la imagen
            patch_size: Tamaño de patch (10, 20, 40)
            
        Returns:
            Lista de fijaciones con información de patch según el tamaño especificado
        """
        if not self.loaded:
            return []
        
        # Filtrar por imagen
        mask = self.fixations_df['ImageName'] == image_id
        image_fixations = self.fixations_df[mask]
        
        # Determinar campo de patch según tamaño
        patch_field = f'patch_{patch_size}_index'
        
        fixations = []
        for _, row in image_fixations.iterrows():
            fixation = {
                'participante': int(row['participante']),
                'ImageIndex': int(row['ImageIndex']),
                'ImageName': int(row['ImageName']),
                'start_time': float(row['start_time']),
                'end_time': float(row['end_time']),
                'duration': float(row['duration']),
                'x_centroid': float(row['x_centroid']),
                'y_centroid': float(row['y_centroid']),
                'point_count': int(row['point_count']),
                
                # Información de patch específica para el tamaño solicitado
                'patch_index': int(row[patch_field]),
                'patch_size': patch_size,
                
                # Información adicional
                'source': 'precalculated',
                'algorithm': row['algorithm']
            }
            fixations.append(fixation)
        
        return fixations
    
    def get_attention_matrix(self, image_id: int, patch_size: int = 40) -> Dict[str, Any]:
        """
        Generar matriz de atención pre-calculada para una imagen
        
        Args:
            image_id: ID de la imagen
            patch_size: Tamaño de patch (10, 20, 40)
            
        Returns:
            Diccionario con matriz de atención y configuración
        """
        if not self.loaded:
            return {'error': 'Fixations not loaded'}
        
        # Obtener fijaciones para la imagen
        fixations = self.get_fixations_for_image(image_id, patch_size)
        
        if not fixations:
            return {'error': f'No fixations found for image {image_id}'}
        
        # Calcular dimensiones
        cols = 800 // patch_size
        rows = 600 // patch_size
        total_patches = cols * rows
        
        # Obtener participantes únicos
        participants = sorted(list(set([f['participante'] for f in fixations])))
        
        # Crear matriz de atención
        attention_matrix = []
        
        for participant_id in participants:
            participant_row = [0] * total_patches
            
            # Contar fijaciones por patch para este participante
            participant_fixations = [f for f in fixations if f['participante'] == participant_id]
            
            for fixation in participant_fixations:
                patch_idx = fixation['patch_index']
                if 0 <= patch_idx < total_patches:
                    participant_row[patch_idx] += 1
            
            attention_matrix.append(participant_row)
        
        return {
            'participants': participants,
            'attention_matrix': attention_matrix,
            'config': {
                'patch_size': patch_size,
                'image_width': 800,
                'image_height': 600,
                'total_patches': total_patches,
                'cols': cols,
                'rows': rows
            },
            'statistics': {
                'total_fixations': len(fixations),
                'participants_count': len(participants),
                'active_patches': len(set([f['patch_index'] for f in fixations])),
                'source': 'precalculated'
            }
        }
    
    def get_participant_stats(self, participant_id: int) -> Dict[str, Any]:
        """Obtener estadísticas de un participante"""
        if not self.loaded:
            return {}
        
        participant_fixations = self.fixations_df[
            self.fixations_df['participante'] == participant_id
        ]
        
        if len(participant_fixations) == 0:
            return {'error': f'No fixations found for participant {participant_id}'}
        
        return {
            'total_fixations': len(participant_fixations),
            'images_viewed': participant_fixations['ImageName'].nunique(),
            'avg_duration': float(participant_fixations['duration'].mean()),
            'median_duration': float(participant_fixations['duration'].median()),
            'total_duration': float(participant_fixations['duration'].sum()),
            'avg_points_per_fixation': float(participant_fixations['point_count'].mean())
        }
    
    def get_image_stats(self, image_id: int) -> Dict[str, Any]:
        """Obtener estadísticas de una imagen"""
        if not self.loaded:
            return {}
        
        image_fixations = self.fixations_df[
            self.fixations_df['ImageName'] == image_id
        ]
        
        if len(image_fixations) == 0:
            return {'error': f'No fixations found for image {image_id}'}
        
        return {
            'total_fixations': len(image_fixations),
            'participants_count': image_fixations['participante'].nunique(),
            'avg_duration': float(image_fixations['duration'].mean()),
            'median_duration': float(image_fixations['duration'].median()),
            'avg_points_per_fixation': float(image_fixations['point_count'].mean()),
            
            # Estadísticas por patch size
            'patches_10x10_used': image_fixations['patch_10_index'].nunique(),
            'patches_20x20_used': image_fixations['patch_20_index'].nunique(),
            'patches_40x40_used': image_fixations['patch_40_index'].nunique()
        }
    
    def get_global_stats(self) -> Dict[str, Any]:
        """Obtener estadísticas globales"""
        if not self.loaded or self.stats is None:
            return {}
        
        return self.stats
    
    def is_available(self) -> bool:
        """Verificar si el servicio está disponible"""
        return self.loaded
    
    def get_compatible_result(self, participant_id: int = None, image_id: int = None, 
                            velocity_threshold: float = 1.15, min_duration: float = 0.0,
                            image_width: int = 640, image_height: int = 480) -> Dict[str, Any]:
        """
        Función compatible con get_fixations_ivt() del sistema existente
        
        Returns:
            Diccionario en formato compatible con fixation_detection_ivt.get_fixations_ivt()
        """
        if not self.loaded:
            return {
                'error': 'Precalculated fixations not available',
                'fixations': [],
                'stats': {},
                'raw_gaze_points': 0
            }
        
        # Filtrar según parámetros
        mask = pd.Series([True] * len(self.fixations_df))
        
        if participant_id is not None:
            mask &= (self.fixations_df['participante'] == participant_id)
        
        if image_id is not None:
            mask &= (self.fixations_df['ImageName'] == image_id)
        
        filtered_fixations = self.fixations_df[mask]
        
        if len(filtered_fixations) == 0:
            return {
                'error': f'No data found for participant {participant_id}, image {image_id}',
                'fixations': [],
                'stats': {},
                'raw_gaze_points': 0
            }
        
        # Convertir a formato de lista
        fixations = []
        total_raw_points = 0
        
        for _, row in filtered_fixations.iterrows():
            fixation = {
                'participante': int(row['participante']),
                'ImageIndex': int(row['ImageIndex']),
                'ImageName': int(row['ImageName']),
                'start': float(row['start_time']),
                'end': float(row['end_time']),
                'duration': float(row['duration']),
                'x_centroid': float(row['x_centroid']),
                'y_centroid': float(row['y_centroid']),
                'pointCount': int(row['point_count']),
                'class_names': []
            }
            fixations.append(fixation)
            total_raw_points += int(row['raw_gaze_points'])
        
        # Calcular estadísticas
        durations = [f['duration'] for f in fixations]
        participants = list(set([f['participante'] for f in fixations]))
        
        # Contar fijaciones por participante
        fixations_per_participant = {}
        for participant in participants:
            count = len([f for f in fixations if f['participante'] == participant])
            fixations_per_participant[participant] = count
        
        stats = {
            'total_fixations': len(fixations),
            'participants': len(participants),
            'avg_duration': float(np.mean(durations)) if durations else 0,
            'median_duration': float(np.median(durations)) if durations else 0,
            'min_duration': float(min(durations)) if durations else 0,
            'max_duration': float(max(durations)) if durations else 0,
            'duration_std': float(np.std(durations)) if durations else 0,
            'fixations_per_participant': fixations_per_participant
        }
        
        return {
            'fixations': fixations,
            'stats': stats,
            'raw_gaze_points': total_raw_points,
            'participant_id': participant_id,
            'image_id': image_id,
            'data_source': 'precalculated_fixations.csv',
            'algorithm': 'I-VT',
            'parameters': {
                'velocity_threshold': velocity_threshold,
                'min_duration': min_duration,
                'image_width': image_width,
                'image_height': image_height
            },
            'function_source': 'precalculated_fixations_service.get_compatible_result()',
            'performance_note': 'Using precalculated fixations for maximum speed'
        }

# Instancia global del servicio
precalculated_service = PrecalculatedFixationsService()

# Funciones de compatibilidad para reemplazar las existentes
def get_fixations_ivt_fast(data=None, participant_id=None, image_id=None, 
                          velocity_threshold=1.15, min_duration=0.0,
                          image_width=640, image_height=480):
    """
    Versión rápida de get_fixations_ivt usando fijaciones pre-calculadas
    
    Compatible con la función original pero mucho más rápida
    """
    return precalculated_service.get_compatible_result(
        participant_id=participant_id,
        image_id=image_id,
        velocity_threshold=velocity_threshold,
        min_duration=min_duration,
        image_width=image_width,
        image_height=image_height
    )

def get_attention_matrix_fast(image_id, patch_size=40):
    """Versión rápida para obtener matriz de atención"""
    return precalculated_service.get_attention_matrix(image_id, patch_size)

def get_participant_fixations_fast(participant_id, image_id):
    """Versión rápida para obtener fijaciones de participante"""
    return precalculated_service.get_compatible_result(
        participant_id=participant_id,
        image_id=image_id
    )

if __name__ == "__main__":
    # Test del servicio
    service = PrecalculatedFixationsService()
    
    if service.is_available():
        print(" Servicio de fijaciones pre-calculadas disponible")
        
        # Test con participante 1, imagen 0
        result = service.get_compatible_result(participant_id=1, image_id=0)
        if 'error' not in result:
            print(f" Test participante 1, imagen 0: {result['stats']['total_fixations']} fijaciones")
        else:
            print(f" Test error: {result['error']}")
        
        # Test matriz de atención
        matrix = service.get_attention_matrix(image_id=0, patch_size=40)
        if 'error' not in matrix:
            print(f" Test matriz atención imagen 0: {matrix['statistics']['total_fixations']} fijaciones")
        else:
            print(f" Matrix error: {matrix['error']}")
        
        # Mostrar estadísticas generales
        global_stats = service.get_global_stats()
        if global_stats:
            print(f" Total fijaciones: {global_stats.get('total_fixations', 0)}")
        
        print(" Servicio listo para usar!")
    else:
        print(" Servicio no disponible - ejecuta generate_precalculated_fixations.py")