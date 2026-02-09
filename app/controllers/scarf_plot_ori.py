"""
Controller para Scarf Plot Visualization
Maneja la visualización de la distribución temporal de gaze por elementos visuales
"""

import pandas as pd
import json
import numpy as np
from flask import Blueprint, jsonify, request
import os
from app.services.fixation_detection_ivt import get_fixations_ivt

# Importar servicio compartido de datos
try:
    from app.shared.data_service import get_data_service
    print("OK: ScarfPlot: Servicio compartido de datos HABILITADO")
except ImportError as e:
    print("ADVERTENCIA: ScarfPlot: Servicio compartido no disponible:", str(e))
    get_data_service = None

scarf_bp = Blueprint('scarf_plot', __name__)

class ScarfPlotController:
    def __init__(self, csv_path='static/data/df_final1.csv'):
        self.csv_path = csv_path
        self.data = None
        self.color_mapping = {}
        self.grupo_color_mapping = {}
        self.scores_data = None
        self.load_data()

    def load_data(self):
        """Carga datos de gaze tracking y scores"""
        try:
            # Usar servicio singleton en lugar de cargar CSV localmente
            if get_data_service:
                self.data_service = get_data_service()
                self.data = self.data_service.get_main_data()
                self.scores_data = self.data_service.get_scores_data()
                if self.data is not None:
                    print(f"OK: ScarfPlotController: Datos cargados desde DataService ({len(self.data)} puntos de gaze)")
            else:
                # Fallback: cargar manualmente
                full_path = os.path.join(os.path.dirname(__file__), '..', '..', self.csv_path)
                self.data = pd.read_csv(full_path)
                print(f"ADVERTENCIA: ScarfPlotController: Datos cargados localmente ({len(self.data)} puntos de gaze)")

            if self.data is None:
                return

            # Crear mapeo de colores para main_class (si existe hex_color en CSV)
            if 'hex_color' in self.data.columns and 'main_class' in self.data.columns:
                color_df = self.data[['main_class', 'hex_color']].drop_duplicates()
                for idx, row in color_df.iterrows():
                    if pd.notna(row['main_class']) and pd.notna(row['hex_color']):
                        self.color_mapping[str(row['main_class'])] = str(row['hex_color'])

            print(f"Mapeo de colores (main_class): {len(self.color_mapping)} clases")

            # Crear mapeo de colores para grupo (generar automáticamente)
            if 'grupo' in self.data.columns:
                unique_grupos = self.data['grupo'].dropna().unique()
                # Paleta de colores predefinida para grupo
                grupo_colors = {
                    'Building': '#8B7355',      # Marrón
                    'Vegetacion': '#228B22',   # Verde forestale
                    'Car': '#DC143C',          # Rojo
                    'Sidewalk': '#D3D3D3',     # Gris claro
                    'Person': '#FF8C00',       # Naranja oscuro
                    'Trash': '#2F4F4F'         # Gris oscuro
                }
                for grupo in unique_grupos:
                    grupo_str = str(grupo).strip()
                    if grupo_str:
                        self.grupo_color_mapping[grupo_str] = grupo_colors.get(grupo_str, '#999999')

            print(f"Mapeo de colores (grupo): {len(self.grupo_color_mapping)} grupos")

            # Cargar datos de scores (para obtener los 10 participantes oficiales por imagen)
            scores_path = os.path.join(os.path.dirname(__file__), '..', '..', 'static', 'data', 'data_hololens.json')
            if os.path.exists(scores_path):
                with open(scores_path, 'r') as f:
                    self.scores_data = json.load(f)
                print(f"Datos de scores cargados: {len(self.scores_data)} imagenes")
            else:
                print(f"Scores file not found at: {scores_path}")

        except Exception as e:
            print(f"Error cargando datos scarf: {e}")

    def get_valid_participants_for_image(self, image_id):
        """Obtiene los 10 participantes oficiales para una imagen"""
        if self.scores_data is None:
            return []

        image_key = str(image_id)
        if image_key in self.scores_data:
            score_entries = self.scores_data[image_key].get('score_participant', [])
            participants = [entry['participant'] for entry in score_entries]
            return sorted(set(participants))
        return []

    def get_scarf_plot_data(self, image_id, participant_id=None, data_type='gaze', dataset_select='main_class', image_name=None):
        """
        Retorna datos procesados para el scarf plot

        Args:
            image_id: ImageName de la imagen (usado para filtrar datos del CSV)
            participant_id: ID del participante (opcional, si None trae todos)
            data_type: Tipo de datos a usar ('gaze' o 'fixations')
            dataset_select: Columna a usar para clasificación ('main_class' o 'grupo')
            image_name: DEPRECATED, use image_id which is now ImageName

        Returns:
            Dict con datos listos para visualizar
        """
        # image_id ahora es ImageName directamente (0-149)
        print(f"ScarfPlotController.get_scarf_plot_data(image_id={image_id}, participant_id={participant_id}, data_type={data_type}, dataset_select={dataset_select})")

        # Obtener el DataFrame correcto según dataset_select
        if hasattr(self, 'data_service') and self.data_service:
            current_data = self.data_service.get_data_by_dataset(dataset_select)
        else:
            current_data = self.data  # Fallback a datos por defecto

        if current_data is None:
            return {'error': 'No data available'}

        # Mapear dataset_select a las columnas correctas del CSV
        if dataset_select == 'disorder':
            class_column = 'main_class'
            class_id_column = 'class_id' # Asumiendo que 'class_id' es el ID para main_class
            color_column = 'hex_color'
 
        elif dataset_select == 'grouped':
            class_column = 'group'
            class_id_column = 'group_class_id' # Asumiendo que 'class_id' es el ID para main_class
            color_column = 'hex_color'

        elif dataset_select == 'grouped_disorder':
            class_column = 'group_name'
            class_id_column = 'group_class_id' # Asumiendo que 'class_id' es el ID para main_class
            color_column = 'hex_color'

        else:
            class_column = 'main_class'
            #class_id_column = 'group_class_id' # Asumiendo que 'group_class_id' es el ID para grupos
            class_id_column = 'class_id' # Asumiendo que 'group_class_id' es el ID para grupos
            color_column = 'hex_color'

        print(f"  Using columns: class={class_column}, id={class_id_column}, color={color_column}")

        try:
            # Filtrar por ImageName
            filtered = current_data[current_data['ImageName'] == image_id].copy()

            if len(filtered) == 0:
                return {'error': f'No data for image {image_id}'}

            # Obtener los 10 participantes oficiales para esta imagen
            valid_participants = self.get_valid_participants_for_image(image_id)

            if not valid_participants:
                return {'error': f'No valid participants found for image {image_id}'}

            # Filtrar solo para participantes válidos
            filtered = filtered[filtered['participante'].isin(valid_participants)].copy()

            # Filtrar por participante específico si se especifica
            if participant_id is not None:
                if participant_id not in valid_participants:
                    return {'error': f'Participant {participant_id} not valid for image {image_id}'}
                filtered = filtered[filtered['participante'] == participant_id]

            if len(filtered) == 0:
                return {'error': f'No data for image {image_id} and participants {valid_participants}'}

            # Eliminar puntos sin clasificación
            before = len(filtered)
            filtered = filtered[
                (filtered[class_column].notna()) &
                (filtered[class_column].astype(str).str.strip() != '')
            ]
            after = len(filtered)

            if after > 0:
                print(f"Filtered: {before} -> {after} points (removed {before-after} unclassified)")

            # Si se solicita procesar fixations, detectarlas primero
            if data_type == 'fixations':
                print(f"Processing scarf plot data as FIXATIONS")
                # Detectar fixations usando I-VT
                fixations_result = get_fixations_ivt(
                    data=filtered,
                    participant_id=None,
                    image_id=None,
                    velocity_threshold=1.15,
                    min_duration=0.0,
                    image_width=800,
                    image_height=600
                )

                fixations_list = fixations_result.get('fixations', [])
                print(f"Detected {len(fixations_list)} fixations for scarf plot")

                if not fixations_list:
                    return {'error': f'No fixations detected for image {image_id}'}

                # Convertir fixations a formato para scarf plot
                # Agrupar por participante
                fixations_by_participant = {}
                for fix in fixations_list:
                    p_id = fix.get('participante')
                    if p_id not in fixations_by_participant:
                        fixations_by_participant[p_id] = []
                    fixations_by_participant[p_id].append(fix)

                participants = sorted([p for p in fixations_by_participant.keys() if p in valid_participants])
            else:
                # Procesar como gaze points (código original)
                # Obtener participantes únicos (solo los válidos)
                participants = sorted([p for p in filtered['participante'].unique() if p in valid_participants])
                fixations_by_participant = None

            # Procesar datos por participante
            scarf_data = []
            for p_id in participants:
                if data_type == 'fixations':
                    # Usar fixations para este participante
                    p_fixations = fixations_by_participant.get(p_id, [])
                    if not p_fixations:
                        continue

                    # Obtener tiempo min/max de las fixations
                    times = [f.get('start', 0) for f in p_fixations]
                    min_time = min(times) if times else 0
                    max_time = max(times) if times else 1

                    # Agrupar fixations por clase
                    # Asignar clase basándome en los puntos gaze cercanos espacialmente
                    segments = []
                    fixation_radius = 50  # radio en pixels para buscar puntos cercanos

                    for fix_idx, fix in enumerate(sorted(p_fixations, key=lambda f: f.get('start', 0))):
                        # Obtener clase más común en esta región espacial
                        x_centroid = fix.get('x_centroid', 0)
                        y_centroid = fix.get('y_centroid', 0)

                        # Buscar puntos cercanos del participante
                        p_gaze = filtered[filtered['participante'] == p_id]
                        if len(p_gaze) > 0:
                            # Calcular distancia a cada punto
                            distances = np.sqrt(
                                (p_gaze['pixelX'] - x_centroid)**2 +
                                (p_gaze['pixelY'] - y_centroid)**2
                            )

                            # Filtrar puntos dentro del radio de fijación
                            nearby_mask = distances <= fixation_radius
                            nearby_points = p_gaze[nearby_mask]

                            if len(nearby_points) > 0:
                                # Usar la clase más común de los puntos cercanos
                                class_value = nearby_points[class_column].mode()
                                class_value = class_value[0] if len(class_value) > 0 else 'unknown'
                            else:
                                # Si no hay puntos cercanos, usar el punto más cercano
                                closest_idx = distances.idxmin()
                                class_value = p_gaze.loc[closest_idx, class_column]
                        else:
                            class_value = 'unknown'

                        # Obtener color para esta clase
                        color_rows = filtered[filtered[class_column] == class_value][color_column].dropna()
                        class_color = color_rows.iloc[0] if len(color_rows) > 0 else '#999999'

                        # Normalizar tiempo a 0-15000ms
                        time_range = max_time - min_time if max_time > min_time else 1
                        start_norm = ((fix.get('start', 0) - min_time) / time_range) * 15000
                        end_norm = start_norm + (fix.get('duration', 0) * 1000)  # duration en segundos

                        # Clamp times to ensure they don't exceed 15000ms
                        start_norm = min(max(start_norm, 0.0), 15000.0)
                        end_norm = min(max(end_norm, 0.0), 15000.0)

                        segments.append({
                            'class': str(class_value),
                            'start_time': float(start_norm),
                            'end_time': float(end_norm),
                            'points': fix.get('pointCount', 1),
                            'color': class_color
                        })

                    # Calcular tiempo total de este participante (para mantener consistencia)
                    total_points = sum([s['points'] for s in segments])

                    scarf_data.append({
                        'participant': int(p_id),
                        'segments': segments,
                        'total_points': total_points,
                        'time_range_ms': float(max_time - min_time)
                    })
                else:
                    # Procesar como gaze points (código original)
                    p_data = filtered[filtered['participante'] == p_id].copy()
                    p_data = p_data.sort_values('Time')

                    if len(p_data) == 0:
                        continue

                    # Normalizar tiempo a rango 0-15000 (15 segundos)
                    min_time = p_data['Time'].min()
                    max_time = p_data['Time'].max()
                    time_range = max_time - min_time if max_time > min_time else 1

                    # Crear segmentos (agrupar puntos consecutivos de misma clase)
                    segments = []
                    current_segment = None

                    # Crear mapeo de colores desde los datos filtrados
                    color_map = {}
                    for class_val in p_data[class_column].dropna().unique():
                        color_rows = p_data[p_data[class_column] == class_val][color_column].dropna()
                        if len(color_rows) > 0:
                            color_map[str(class_val).strip()] = color_rows.iloc[0]

                    for idx, row in p_data.iterrows():
                        normalized_time = ((row['Time'] - min_time) / time_range) * 15000
                        class_name = str(row[class_column]).strip()

                        if current_segment is None or current_segment['class'] != class_name:
                            # Guardar segmento anterior
                            if current_segment:
                                segments.append(current_segment)
                            # Iniciar nuevo segmento
                            current_segment = {
                                'class': class_name,
                                'start_time': float(normalized_time),
                                'end_time': float(normalized_time),
                                'points': 1,
                                'color': color_map.get(class_name, '#999999')
                            }
                        else:
                            # Extender segmento actual
                            current_segment['end_time'] = float(normalized_time)
                            current_segment['points'] += 1

                    # Guardar último segmento
                    if current_segment:
                        # Clamp end_time to not exceed 15000ms
                        current_segment['end_time'] = min(current_segment['end_time'], 15000.0)
                        segments.append(current_segment)

                    scarf_data.append({
                        'participant': int(p_id),
                        'segments': segments,
                        'total_points': len(p_data),
                        'time_range_ms': float(time_range)
                    })

            return {
                'image_id': int(image_id),
                'participant_id': participant_id,
                'total_participants': len(participants),
                'scarf_data': scarf_data,
                'color_mapping': self.color_mapping,
                'status': 'success'
            }

        except Exception as e:
            import traceback
            traceback.print_exc()
            return {'error': f'Error processing scarf data: {str(e)}'}

# Instancia global
scarf_controller = ScarfPlotController()

# Endpoints
@scarf_bp.route('/api/scarf-plot/<int:image_id>', methods=['GET'])
def get_scarf_plot(image_id):
    """Obtiene datos del scarf plot para una imagen"""
    participant_id = request.args.get('participant_id', type=int)
    data_type = request.args.get('data_type', 'gaze').lower()
    dataset_select = request.args.get('dataset_select', 'main_class').lower()
    data = scarf_controller.get_scarf_plot_data(image_id, participant_id, data_type, dataset_select)
    return jsonify(data)

@scarf_bp.route('/api/scarf-plot-colors', methods=['GET'])
def get_color_mapping():
    """Obtiene mapeo de colores"""
    return jsonify(scarf_controller.color_mapping)
