import numpy as np
import pandas as pd
from typing import List, Dict, Any

class FixationDetectorIVT:
    """
    Detector de fijaciones usando algoritmo I-VT (Identification by Velocity Threshold)
    Implementación fiel al código del notebook
    """
    
    def __init__(self, velocity_threshold: float = 1.15, min_duration: float = 0.0):
        """
        Inicializar detector de fijaciones
        
        Args:
            velocity_threshold: Umbral de velocidad en px/s (default: 1.15)
            min_duration: Duración mínima de fijación en segundos (default: 0.0)
        """
        self.VEL_THRESH = velocity_threshold
        self.MIN_DURATION = min_duration
    
    def detect_fixations(self, gaze_data: pd.DataFrame, image_width: int = 800, 
                        image_height: int = 600) -> List[Dict[str, Any]]:
        """
        Detectar fijaciones usando algoritmo I-VT
        Implementación exacta del notebook
        
        Args:
            gaze_data: DataFrame con datos de gaze
            image_width: Ancho de imagen (no usado, mantenido por compatibilidad)
            image_height: Alto de imagen (no usado, mantenido por compatibilidad)
            
        Returns:
            Lista de diccionarios con información de fijaciones detectadas
        """
        if len(gaze_data) == 0:
            return []
        
        # Llamar a la función principal que replica el notebook
        fix_df = self._detect_fixations_notebook_style(gaze_data)
        
        # Convertir a formato compatible con el sistema existente
        fixations = []
        for _, row in fix_df.iterrows():
            fixation = {
                'participante': int(row['participante']),
                'ImageIndex': int(row['ImageName']),
                'ImageName': int(row['ImageName']),
                'start': float(row['start']),
                'end': float(row['end']),
                'duration': float(row['duration']),
                'x_centroid': float(row['x_centroid']),
                'y_centroid': float(row['y_centroid']),
                'pointCount': int(row.get('point_count', 1)),
                'class_names': []
            }
            fixations.append(fixation)
        
        return fixations
    
    def _detect_fixations_notebook_style(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Implementa I-VT exactamente como en el notebook:
          - calcula velocidad entre muestras consecutivas (px/s),
          - marca como 'is_fix' las que están por debajo de vel_thresh,
          - agrupa valores consecutivos de is_fix en clusters,
          - filtra clusters cuya duración >= min_duration.

        Parámetros:
        -----------
        df : DataFrame con columnas ['participante','ImageName','Time','pixelX','pixelY']

        Retorna:
        --------
        fix_df : DataFrame con columnas
          ['participante','ImageName','start','end','duration','x_centroid','y_centroid']
        """
        # 1) ordenar y copiar
        df0 = df.sort_values(['participante','ImageName','Time']).copy()
        
        # 2) diferencias temporales y espaciales
        df0['dt'] = df0.groupby(['participante','ImageName'])['Time'].diff().fillna(0)
        df0['dx'] = df0.groupby(['participante','ImageName'])['pixelX'].diff().fillna(0)
        df0['dy'] = df0.groupby(['participante','ImageName'])['pixelY'].diff().fillna(0)
        
        # 3) velocidad en px/s
        df0['velocity'] = np.sqrt(df0['dx']**2 + df0['dy']**2) / df0['dt'].replace(0, np.nan)
        df0['velocity'] = df0['velocity'].fillna(0)
        
        # 4) marca si es potencial fijación
        df0['is_fix'] = df0['velocity'] < self.VEL_THRESH
        
        # 5) agrupo secuencias idénticas de is_fix POR PARTICIPANTE E IMAGEN
        df0['group_id'] = df0.groupby(['participante','ImageName']).ngroup()
        df0['cluster'] = df0.groupby('group_id')['is_fix'].apply(
            lambda x: (x != x.shift()).cumsum()
        ).values
        
        # 6) por cada cluster de fijación, calculo duración y centroides
        fix_events = []
        for (part, img, clust), grp in df0.groupby(['participante','ImageName','cluster']):
            # Solo procesar clusters de fijación
            if not grp['is_fix'].iloc[0]:
                continue
            
            t_start = grp['Time'].iloc[0]
            t_end   = grp['Time'].iloc[-1]
            duration = t_end - t_start
            
            # Filtrar por duración mínima
            if duration >= self.MIN_DURATION:
                x_cent = grp['pixelX'].mean()
                y_cent = grp['pixelY'].mean()
                point_count = len(grp)
                
                fix_events.append({
                    'participante': part,
                    'ImageName':    img,
                    'start':        t_start,
                    'end':          t_end,
                    'duration':     duration,
                    'x_centroid':   x_cent,
                    'y_centroid':   y_cent,
                    'point_count':  point_count
                })
        
        return pd.DataFrame(fix_events)
    
    def get_fixation_stats(self, fixations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Obtener estadísticas de las fijaciones detectadas"""
        if not fixations:
            return {
                'total_fixations': 0,
                'participants': 0,
                'avg_duration': 0,
                'median_duration': 0,
                'min_duration': 0,
                'max_duration': 0,
                'fixations_per_participant': {}
            }
        
        durations = [f['duration'] for f in fixations]
        participants = list(set([f['participante'] for f in fixations]))
        
        # Contar fijaciones por participante
        fixations_per_participant = {}
        for participant in participants:
            count = len([f for f in fixations if f['participante'] == participant])
            fixations_per_participant[participant] = count
        
        return {
            'total_fixations': len(fixations),
            'participants': len(participants),
            'avg_duration': float(np.mean(durations)),
            'median_duration': float(np.median(durations)),
            'min_duration': float(min(durations)),
            'max_duration': float(max(durations)),
            'duration_std': float(np.std(durations)),
            'fixations_per_participant': fixations_per_participant
        }


# Función de utilidad para usar el detector
def detect_fixations_for_image(csv_data: pd.DataFrame, image_index: int, 
                             velocity_threshold: float = 1.15, 
                             min_duration: float = 0.0,
                             image_width: int = 600,
                             image_height: int = 450) -> Dict[str, Any]:
    """
    Función de conveniencia para detectar fijaciones de una imagen específica
    
    Args:
        csv_data: DataFrame con todos los datos
        image_index: Índice de la imagen (0-149) - usa ImageIndex, no ImageName
        velocity_threshold: Umbral de velocidad en px/s (default: 1.15)
        min_duration: Duración mínima en segundos (default: 0.0)
        image_width: Ancho para escalado
        image_height: Alto para escalado
        
    Returns:
        Diccionario con fijaciones y estadísticas
    """
    # Filtrar datos para la imagen específica usando ImageIndex (como en GitHub)
    image_data = csv_data[csv_data['ImageIndex'] == image_index].copy()
    
    # Crear detector
    detector = FixationDetectorIVT(velocity_threshold, min_duration)
    
    # Detectar fijaciones
    fixations = detector.detect_fixations(image_data, image_width, image_height)
    
    # Obtener estadísticas
    stats = detector.get_fixation_stats(fixations)
    
    return {
        'fixations': fixations,
        'stats': stats,
        'gaze_points_count': len(image_data),
        'image_index': image_index
    }


# Ejemplo de uso
# Funciones de compatibilidad para reemplazar fixation_service.py
def get_fixations_ivt(data, participant_id=None, image_id=None, 
                     velocity_threshold=1.15, min_duration=0.0,
                     image_width=640, image_height=480):
    """
    Función compartida para detectar fijaciones usando I-VT.
    Reemplaza a fixation_service.get_fixations_ivt()
    
    Parameters:
    -----------
    data : pd.DataFrame
        DataFrame con datos de eye tracking
    participant_id : int, optional
        ID del participante (None para todos)
    image_id : int, optional  
        ID de la imagen (None para todas)
    velocity_threshold : float
        Umbral de velocidad en px/s (default: 1.15)
    min_duration : float
        Duración mínima de fijación en segundos (default: 0.0)
    image_width : int
        Ancho para escalado (default: 640)
    image_height : int
        Alto para escalado (default: 480)
    
    Returns:
    --------
    dict : Diccionario con fijaciones y estadísticas
    """
    
    # Filtrar datos si se especifican parámetros
    filtered_data = data.copy()
    
    if participant_id is not None:
        filtered_data = filtered_data[filtered_data['participante'] == participant_id]
    
    if image_id is not None:
        filtered_data = filtered_data[filtered_data['ImageName'] == image_id]
    
    if len(filtered_data) == 0:
        return {
            'error': f'No data found for participant {participant_id}, image {image_id}',
            'fixations': [],
            'stats': {},
            'raw_gaze_points': 0
        }
    
    # Crear detector con parámetros especificados
    detector = FixationDetectorIVT(velocity_threshold=velocity_threshold, 
                                  min_duration=min_duration)
    
    # Detectar fijaciones
    fixations = detector.detect_fixations(filtered_data, image_width, image_height)
    
    # Calcular estadísticas
    stats = detector.get_fixation_stats(fixations)
    
    return {
        'fixations': fixations,
        'stats': stats,
        'raw_gaze_points': len(filtered_data),
        'participant_id': participant_id,
        'image_id': image_id,
        'data_source': 'df_final1.csv',
        'algorithm': 'I-VT',
        'parameters': {
            'velocity_threshold': velocity_threshold,
            'min_duration': min_duration,
            'image_width': image_width,
            'image_height': image_height
        },
        'function_source': 'fixation_detection_ivt.get_fixations_ivt()'
    }


def get_participant_fixations(data, participant_id, image_id):
    """
    Función específica para Per Participant Analysis.
    Reemplaza a fixation_service.get_participant_fixations()
    
    UNIFICADO: Usa los mismos parámetros que Glyph Radial y Gráficos de Transiciones
    """
    return get_fixations_ivt(
        data=data,
        participant_id=participant_id,
        image_id=image_id,
        velocity_threshold=1.15,    # UNIFICADO: Mismo que otros sistemas
        min_duration=0.0,           # UNIFICADO: Mismo que otros sistemas  
        image_width=800,            # UNIFICADO: Mismo que otros sistemas
        image_height=600            # UNIFICADO: Mismo que otros sistemas
    )


def _get_image_data_for_id(data, image_id):
    """Return DataFrame filtered for the requested image, reusing pre-filtered data when possible."""
    if data is None:
        return pd.DataFrame()

    if 'ImageName' not in data.columns:
        return data

    # Si ya viene filtrado para una sola imagen, úsalo directamente
    unique_images = data['ImageName'].dropna().unique()
    if len(unique_images) == 1 and int(unique_images[0]) == int(image_id):
        return data

    return data[data['ImageName'] == image_id]


def get_patch_fixations(data, image_id, pixel_bounds):
    """
    Detectar fijaciones dentro de un área específica (patch).
    
    MÉTODO CORRECTO: Aplica I-VT a toda la imagen primero, luego filtra por patch.
    Esto preserva la secuencia temporal necesaria para el cálculo correcto de velocidades.
    
    Parameters:
    -----------
    data : pd.DataFrame
        DataFrame con datos de eye tracking
    image_id : int
        ID de la imagen
    pixel_bounds : dict
        Diccionario con coordenadas del patch. Acepta dos formatos:
        - Formato 1: 'x_min', 'x_max', 'y_min', 'y_max'
        - Formato 2: 'x_start', 'y_start', 'x_end', 'y_end' (compatibilidad)
    
    Returns:
    --------
    dict : Diccionario con fijaciones en el área específica
    """
    
    # Filtrar por imagen solo una vez (o reutilizar si ya venía filtrado)
    image_data = _get_image_data_for_id(data, image_id)
    
    if len(image_data) == 0:
        return {
            'error': f'No data found for image {image_id}',
            'fixations': [],
            'stats': {},
            'raw_gaze_points': 0
        }
    
    # Normalizar pixel_bounds para compatibilidad con ambos formatos
    if 'x_start' in pixel_bounds:
        # Formato experimentos: x_start, y_start, x_end, y_end
        x_min = pixel_bounds['x_start']
        x_max = pixel_bounds['x_end']
        y_min = pixel_bounds['y_start']
        y_max = pixel_bounds['y_end']
    else:
        # Formato original: x_min, x_max, y_min, y_max
        x_min = pixel_bounds['x_min']
        x_max = pixel_bounds['x_max']
        y_min = pixel_bounds['y_min']
        y_max = pixel_bounds['y_max']
    
    cache_key = f"img_{image_id}"
    cached = _fixation_cache.get(cache_key)

    if cached is None:
        print(f" PATCH FIXATIONS: Calculando fijaciones globales para imagen {image_id} (cache miss)")
        full_result = get_fixations_ivt(
            data=image_data,
            participant_id=None,
            image_id=None,  # Ya filtrado
            velocity_threshold=1.15,
            min_duration=0.0,
            image_width=800,
            image_height=600
        )
        
        if 'error' in full_result:
            return full_result
        
        cached = {
            'fixations': full_result['fixations'],
            'stats': full_result.get('stats', {}),
            'raw_gaze_points': len(image_data)
        }
        _fixation_cache[cache_key] = cached
    else:
        pass  # Cache hit; no necesidad de recalcular

    # 2. Filtrar fijaciones que caen dentro del patch
    patch_fixations = []
    for fixation in cached['fixations']:
        x = fixation['x_centroid']
        y = fixation['y_centroid']
        if x_min <= x < x_max and y_min <= y < y_max:
            patch_fixations.append(fixation)
    
    # 3. Contar puntos de gaze raw en el patch (solo para estadísticas)
    patch_gaze_count = 0
    if {'pixelX', 'pixelY'}.issubset(image_data.columns):
        patch_gaze_count = len(image_data[
            (image_data['pixelX'] >= x_min) &
            (image_data['pixelX'] < x_max) &
            (image_data['pixelY'] >= y_min) &
            (image_data['pixelY'] < y_max)
        ])
    
    # Solo loggear en modo detallado para no saturar la consola cuando hay cientos de patches
    # print(f"🔧 PATCH FIXATIONS: {len(patch_fixations)} fijaciones encontradas en patch")
    
    # 4. Calcular estadísticas específicas del patch
    detector = FixationDetectorIVT(velocity_threshold=1.15, min_duration=0.0)
    patch_stats = detector.get_fixation_stats(patch_fixations)
    
    return {
        'fixations': patch_fixations,
        'stats': patch_stats,
    'raw_gaze_points': patch_gaze_count,
    'total_image_fixations': len(cached['fixations']),
        'patch_bounds': pixel_bounds,
        'method': 'ivt_global_then_filter',
        'parameters': {
            'velocity_threshold': 1.15,
            'min_duration': 0.0,
            'image_width': 800,
            'image_height': 600
        }
    }


# Cache para evitar recalcular fijaciones de la misma imagen
_fixation_cache = {}

def clear_fixation_cache(image_id=None):
    """
    Limpiar caché de fijaciones.
    Reemplaza a fixation_service.clear_fixation_cache()
    """
    global _fixation_cache
    if image_id is None:
        _fixation_cache.clear()
        print(" Cache de fijaciones completamente limpiado")
    else:
        keys_to_remove = [k for k in _fixation_cache.keys() if f"img_{image_id}" in k]
        for key in keys_to_remove:
            del _fixation_cache[key]
        print(f" Cache limpiado para imagen {image_id}")


def compare_fixation_results(result1, result2):
    """
    Comparar dos resultados de detección de fijaciones.
    Reemplaza a fixation_service.compare_fixation_results()
    """
    if 'error' in result1 or 'error' in result2:
        return {'error': 'Cannot compare results with errors'}
    
    stats1 = result1.get('stats', {})
    stats2 = result2.get('stats', {})
    
    comparison = {
        'fixations_diff': stats1.get('total_fixations', 0) - stats2.get('total_fixations', 0),
        'duration_diff': stats1.get('avg_duration', 0) - stats2.get('avg_duration', 0),
        'participants_diff': stats1.get('participants', 0) - stats2.get('participants', 0),
        'method1': result1.get('function_source', 'unknown'),
        'method2': result2.get('function_source', 'unknown'),
        'params1': result1.get('parameters', {}),
        'params2': result2.get('parameters', {})
    }
    
    return comparison


if __name__ == "__main__":
    # Cargar datos
    df = pd.read_csv("static/data/df_final1.csv")
    
    # Detectar fijaciones para imagen 0
    result = detect_fixations_for_image(df, image_index=0)
    
    print(f"Imagen 0:")
    print(f"- Fijaciones detectadas: {result['stats']['total_fixations']}")
    print(f"- Participantes: {result['stats']['participants']}")
    print(f"- Puntos de gaze: {result['gaze_points_count']}")
    print(f"- Duración promedio: {result['stats']['avg_duration']:.3f}s")
    
    # Mostrar fijaciones por participante
    for participant, count in result['stats']['fixations_per_participant'].items():
        print(f"- Participante {participant}: {count} fijaciones")
    
    # Probar funciones de compatibilidad
    print(f"\n Probando funciones de compatibilidad:")
    
    # Probar get_participant_fixations
    participant_result = get_participant_fixations(df, participant_id=2, image_id=0)
    if 'error' not in participant_result:
        print(f"- get_participant_fixations: {participant_result['stats']['total_fixations']} fijaciones")
    
    # Probar get_patch_fixations
    patch_bounds = {'x_min': 0, 'x_max': 400, 'y_min': 0, 'y_max': 300}
    patch_result = get_patch_fixations(df, image_id=0, pixel_bounds=patch_bounds)
    if 'error' not in patch_result:
        print(f"- get_patch_fixations: {patch_result['stats']['total_fixations']} fijaciones en patch")