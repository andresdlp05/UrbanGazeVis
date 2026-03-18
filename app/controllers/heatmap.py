"""
Controller para Heatmap de Densidad Ponderada por Clase y Participante
Visualiza la atención (densidad de gaze) de cada participante por clase visual
"""

import pandas as pd
import numpy as np
from flask import Blueprint, jsonify, request
import os
import json
import joblib
from app.services.fixation_detection_ivt import get_fixations_ivt

# Importar servicio compartido de datos
try:
    from app.shared.data_service import get_data_service
    print("OK: Heatmap: Servicio compartido de datos HABILITADO")
except ImportError as e:
    print("ADVERTENCIA: Heatmap: Servicio compartido no disponible:", str(e))
    get_data_service = None

# Importar servicio de fixations pre-calculadas
try:
    from app.shared.precomputed_fixation_service import get_precomputed_service
    print("OK: Heatmap: Servicio de fixations pre-calculadas HABILITADO")
except ImportError as e:
    print("ADVERTENCIA: Heatmap: Servicio de fixations pre-calculadas no disponible:", str(e))
    get_precomputed_service = None

heatmap_bp = Blueprint('heatmap', __name__)

class HeatmapController:
    def __init__(self, csv_path='static/data/df_final1.csv'):
        self.csv_path = csv_path
        self.data = None
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
                    print(f"OK: HeatmapController: Datos cargados desde DataService ({len(self.data)} puntos de gaze)")
                if self.scores_data is not None:
                    print(f"OK: HeatmapController: Scores cargados desde DataService ({len(self.scores_data)} imagenes)")
            else:
                # Fallback: cargar manualmente si DataService no está disponible
                full_path = os.path.join(os.path.dirname(__file__), '..', '..', self.csv_path)
                self.data = pd.read_csv(full_path)
                print(f"ADVERTENCIA: HeatmapController: Datos cargados localmente ({len(self.data)} puntos de gaze)")

                scores_path = os.path.join(os.path.dirname(__file__), '..', '..', 'static', 'data', 'data_hololens.json')
                if os.path.exists(scores_path):
                    with open(scores_path, 'r') as f:
                        self.scores_data = json.load(f)
                    print(f"ADVERTENCIA: HeatmapController: Scores cargados localmente ({len(self.scores_data)} imagenes)")

        except Exception as e:
            print(f"Error cargando datos heatmap: {e}")

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

    def get_heatmap_data(self, image_id, top_n_clases=15, data_type='gaze', dataset_select='main_class', image_name=None, mode='attention'):
        """
        Calcula la matriz de densidad ponderada o tiempo total para una imagen

        Args:
            image_id: ImageName de la imagen (usado para filtrar datos del CSV)
            top_n_clases: Número de clases principales a mostrar
            data_type: Tipo de datos a usar ('gaze' o 'fixations')
            dataset_select: Columna a usar para clasificación ('main_class' o 'grupo')
            image_name: ImageName de la imagen (usado para buscar en scores/JSON) - DEPRECATED, use image_id
            mode: 'attention' para densidad, 'time' para tiempo total por clase

        Returns:
            Dict con la matriz de densidad/tiempo y metadatos
        """
        # image_id ahora es ImageName directamente (0-149)
        print(f"HeatmapController.get_heatmap_data(image_id={image_id}, data_type={data_type}, dataset_select={dataset_select})")

        # Obtener el DataFrame correcto según dataset_select
        if hasattr(self, 'data_service') and self.data_service:
            current_data = self.data_service.get_data_by_dataset(dataset_select)
        else:
            current_data = self.data  # Fallback a datos por defecto

        if current_data is None:
            return {'error': 'No data available'}

        # Mapear dataset_select a las columnas correctas del CSV # REVISAR
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
            # Obtener los 10 participantes oficiales
            valid_participants = self.get_valid_participants_for_image(image_id)
            if not valid_participants:
                return {'error': f'No valid participants found for image {image_id}'}

            # Filtrar datos por ImageName y participantes válidos
            df_filtered = current_data[
                (current_data['ImageName'] == image_id) &
                (current_data['participante'].isin(valid_participants))
            ].copy()

            if len(df_filtered) == 0:
                return {'error': f'No data for image {image_id}'}

            # Eliminar puntos sin clasificación
            df_filtered = df_filtered[
                (df_filtered[class_column].notna()) &
                (df_filtered[class_column].astype(str).str.strip() != '')
            ].copy()

            if len(df_filtered) == 0:
                return {'error': f'No classified data for image {image_id}'}

            print(f"DEBUG: df_filtered has {len(df_filtered)} points after classification filter")
            print(f"DEBUG: Sample {class_column} values: {df_filtered[class_column].unique()[:5]}")

            # Si se solicita procesar fixations, detectarlas primero
            if data_type == 'fixations':
                print(f"Processing heatmap data as FIXATIONS")

                # PRIORIDAD 1: Intentar usar fijaciones pre-calculadas
                fixations_list = []
                use_precomputed = False

                if get_precomputed_service:
                    try:
                        service = get_precomputed_service()
                        if service and service.fixations_df is not None:
                            # Filtrar fijaciones pre-calculadas para esta imagen y participantes válidos
                            precomputed_fixations = service.fixations_df[
                                (service.fixations_df['ImageName'] == image_id) &
                                (service.fixations_df['participante'].isin(valid_participants))
                            ].copy()

                            if len(precomputed_fixations) > 0:
                                print(f"✓ Usando {len(precomputed_fixations)} fijaciones PRE-CALCULADAS")
                                # Convertir a formato esperado
                                fixations_list = precomputed_fixations.to_dict('records')
                                use_precomputed = True
                    except Exception as e:
                        print(f" Error usando fixations pre-calculadas: {e}")

                # FALLBACK: Si no hay pre-calculadas, usar I-VT en tiempo real
                if not use_precomputed:
                    print(f" Calculando fijaciones en TIEMPO REAL con I-VT")
                    fixations_result = get_fixations_ivt(
                        data=df_filtered,
                        participant_id=None,
                        image_id=None,
                        velocity_threshold=1.15,
                        min_duration=0.0,
                        image_width=800,
                        image_height=600
                    )
                    fixations_list = fixations_result.get('fixations', [])

                print(f"Total fixations para heatmap: {len(fixations_list)}")

                if not fixations_list:
                    return {'error': f'No fixations detected for image {image_id}'}

                # Convertir fixations a formato compatible
                # Para cada fixation, asignar el main_class más común de los puntos que caen dentro del radio de fijación
                data_to_process = []
                fixation_radius = 50  # radio en pixels para buscar puntos cercanos

                for fix in fixations_list:
                    # Encontrar gaze points que caen en este fixation
                    participant_id = fix.get('participante')
                    x_centroid = fix.get('x_centroid', 0)
                    y_centroid = fix.get('y_centroid', 0)
                    duration = fix.get('duration', 0)
                    start_time = fix.get('start', 0)

                    # Buscar main_class más común en los puntos CERCANOS a esta fixation
                    participant_points = df_filtered[df_filtered['participante'] == participant_id]

                    if len(participant_points) > 0:
                        # Calcular distancia a cada punto
                        distances = np.sqrt(
                            (participant_points['pixelX'] - x_centroid)**2 +
                            (participant_points['pixelY'] - y_centroid)**2
                        )

                        # Filtrar puntos dentro del radio de fixation
                        nearby_mask = distances <= fixation_radius
                        nearby_points = participant_points[nearby_mask]

                        if len(nearby_points) > 0:
                            # Usar la clase más común de los puntos cercanos
                            class_value = nearby_points[class_column].mode()
                            class_value = class_value[0] if len(class_value) > 0 else 'unknown'
                        else:
                            # Si no hay puntos cercanos, usar el punto más cercano
                            closest_idx = distances.idxmin()
                            class_value = participant_points.loc[closest_idx, class_column]
                    else:
                        class_value = 'unknown'

                    # Obtener ratio promedio para esta clase
                    class_points = df_filtered[df_filtered[class_column] == class_value]
                    ratio_value = class_points['ratio'].mean() if len(class_points) > 0 else 1.0

                    # Construir data_to_process con la columna correcta
                    data_row = {
                        'participante': participant_id,
                        class_column: class_value,
                        'delta_t': duration,  # duration ya es el tiempo de la fixation
                        'ratio': ratio_value
                    }
                    data_to_process.append(data_row)

                    print(f"Fixation P{participant_id}: ({x_centroid:.1f}, {y_centroid:.1f}) -> {class_column}={class_value}, duration={duration:.3f}s")

                # Crear dataframe con los datos para procesar
                df_sorted = pd.DataFrame(data_to_process)
                print(f"Converted {len(df_sorted)} fixations to processable format")
            else:
                # Procesar como gaze points (código original)
                # Ordenar por participante, imagen y tiempo
                df_sorted = df_filtered.sort_values(
                    by=['participante', 'ImageIndex', 'Time']
                ).reset_index(drop=True)

            # Calcular delta_t (duración de cada punto) - solo para gaze, fixations ya lo tienen
            if data_type != 'fixations':
                df_sorted['_bloque'] = df_sorted['participante'].astype(str) + '||' + \
                                       df_sorted['ImageIndex'].astype(str)
                df_sorted['Time_next'] = df_sorted.groupby('_bloque')['Time'].shift(-1)
                df_sorted['delta_t'] = df_sorted['Time_next'] - df_sorted['Time']
                df_sorted['delta_t'] = df_sorted['delta_t'].fillna(0.0)
            else:
                # Para fixations, delta_t ya existe como 'duration'
                if 'delta_t' not in df_sorted.columns:
                    df_sorted['delta_t'] = 0.0

            # Agrupar por (participante, class_column) y sumar delta_t
            print(f"DEBUG: df_sorted has {len(df_sorted)} rows before groupby")
            print(f"DEBUG: df_sorted columns: {list(df_sorted.columns)}")
            print(f"DEBUG: df_sorted has {class_column}: {class_column in df_sorted.columns}")
            if len(df_sorted) > 0:
                print(f"DEBUG: Sample delta_t values: {df_sorted['delta_t'].head()}")
                print(f"DEBUG: Sample {class_column} values in df_sorted: {df_sorted[class_column].unique()[:5]}")

            por_participante_clase = (
                df_sorted
                .groupby(['participante', class_column], dropna=False)['delta_t']
                .sum()
                .reset_index()
                .rename(columns={'delta_t': 'time_por_clase'})
            )

            print(f"DEBUG: por_participante_clase has {len(por_participante_clase)} rows after groupby")

            # Obtener ratio de cada class en la imagen
            # Si la columna ratio no tiene datos válidos, usar 1.0 como default
            if 'ratio' in df_filtered.columns:
                ratio_por_clase = (
                    df_filtered[[class_column, 'ratio']]
                    .dropna(subset=[class_column, 'ratio'])
                    .groupby(class_column)['ratio']
                    .mean()
                    .to_dict()
                )
            else:
                ratio_por_clase = {}

            print(f"DEBUG: ratio_por_clase has {len(ratio_por_clase)} entries")

            # Decidir las clases a mostrar BASADO EN TIEMPO TOTAL (consistente entre modos)
            # Obtener top N clases por tiempo total en la imagen
            suma_total_tiempo = (
                por_participante_clase
                .groupby(class_column)['time_por_clase']
                .sum()
                .reset_index()
                .rename(columns={'time_por_clase': 'total_time_global'})
                .sort_values(by='total_time_global', ascending=False)
            )
            top_clases = [str(c).strip() for c in suma_total_tiempo.head(top_n_clases)[class_column].tolist()]

            # --- CÁLCULO DE RATIO DINÁMICO ---
            if mode == 'attention':
                # Cargar el pkl solo si es necesario
                segmentation_array = None
                pkl_path = os.path.join(os.path.dirname(__file__), '..', '..', 'static', 'images', 'images', 'datos_seg', f"{image_id}.pkl")

                for clase in top_clases:
                    if clase not in ratio_por_clase:
                        print(f"ADVERTENCIA: Ratio no encontrado para la clase '{clase}'. Calculando dinámicamente...")
                        if segmentation_array is None:
                            if os.path.exists(pkl_path):
                                try:
                                    segmentation_array = joblib.load(pkl_path)
                                except Exception as e:
                                    print(f"ERROR: No se pudo cargar {pkl_path}: {e}")
                                    break
                            else:
                                print(f"ERROR: No se encontró el archivo de segmentación: {pkl_path}")
                                break
                        
                        # Encontrar el class_id para esta `clase` (que puede ser un group_name)
                        class_id_rows = df_filtered[df_filtered[class_column] == clase][class_id_column]
                        if not class_id_rows.empty:
                            cid = class_id_rows.iloc[0]
                            class_pixels = np.sum(segmentation_array == cid)
                            total_pixels = segmentation_array.size
                            calculated_ratio = class_pixels / total_pixels if total_pixels > 0 else 0
                            ratio_por_clase[clase] = calculated_ratio
                            print(f"✓ Ratio calculado para '{clase}' (ID: {cid}): {calculated_ratio:.4f}")
                        else:
                            print(f"ERROR: No se pudo encontrar un class_id para la clase '{clase}'")


            # Calcular densidad ponderada
            def obtener_ratio(row):
                # Si no hay ratio, usar 1.0 por defecto para que densidad = tiempo
                return ratio_por_clase.get(row[class_column], 1.0)

            por_participante_clase['class_ratio'] = \
                por_participante_clase.apply(obtener_ratio, axis=1)

            def calcular_densidad(row):
                r = row['class_ratio']
                if pd.isna(r) or r == 0:
                    return row['time_por_clase']  # Si ratio es inválido, usar tiempo directamente
                return row['time_por_clase'] / r

            por_participante_clase['density'] = \
                por_participante_clase.apply(calcular_densidad, axis=1)

            # Filtrar para obtener solo las clases top
            por_participante_clase_top = por_participante_clase[
                por_participante_clase[class_column].isin(top_clases)
            ].copy()

            # Crear matriz: filas=class_column, columnas=participantes
            # Usar 'density' para modo 'attention' o 'time_por_clase' para modo 'time'
            print('POR IMAGEN CLASE HEATMAP')
            print(por_participante_clase_top.loc[por_participante_clase_top['participante'] == 16])

            matrix_values = 'density' if mode == 'attention' else 'time_por_clase'
            matriz = por_participante_clase_top.pivot_table(
                index=class_column,
                columns='participante',
                values=matrix_values,
                aggfunc='first',
                fill_value=0.0
            )

            # Asegurar que todas las clases top estén presentes
            matriz = matriz.reindex(top_clases, fill_value=0.0)

            # Asegurar que todos los participantes válidos estén presentes
            for p in valid_participants:
                if p not in matriz.columns:
                    matriz[p] = 0.0
            matriz = matriz[sorted(valid_participants)]

            print(f"[HEATMAP DEBUG] mode={mode}, top_clases count={len(top_clases)}, top_clases={top_clases}")
            print(f"[HEATMAP DEBUG] matriz shape={matriz.shape}")
            print(f"[HEATMAP DEBUG] matrix_raw will have {len(top_clases)} rows")

            # Normalizar matriz para visualización (0-1)
            matriz_norm = matriz.copy()
            max_val = matriz_norm.max().max()
            if max_val > 0:
                matriz_norm = matriz_norm / max_val

            # Obtener colores para cada clase según el dataset_select
            class_colors = {}
            for clase in top_clases:
                color_rows = df_filtered[df_filtered[class_column] == clase][color_column].dropna()
                if len(color_rows) > 0:
                    class_colors[clase] = color_rows.iloc[0]
                else:
                    class_colors[clase] = '#999999'  # Color por defecto

            return {
                'status': 'success',
                'image_id': int(image_id),
                'participants': sorted(valid_participants),
                'classes': top_clases,
                'matrix_raw': matriz.values.tolist(),
                'matrix_normalized': matriz_norm.values.tolist(),
                'min_value': float(matriz.min().min()),
                'max_value': float(matriz.max().max()),
                'total_data_points': len(df_filtered),
                'class_colors': class_colors
            }

        except Exception as e:
            import traceback
            traceback.print_exc()
            return {'error': f'Error processing heatmap data: {str(e)}'}

# Instancia global
heatmap_controller = HeatmapController()

# Endpoints
@heatmap_bp.route('/api/heatmap/<int:image_id>', methods=['GET'])
def get_heatmap(image_id):
    """Obtiene datos de heatmap para una imagen"""
    top_n = request.args.get('top_n', 15, type=int)
    data_type = request.args.get('data_type', 'gaze').lower()
    dataset_select = request.args.get('dataset_select', 'main_class').lower()
    print(f"[DEBUG API] get_heatmap called: image_id={image_id}, data_type={data_type}, dataset_select={dataset_select}")
    print(f"[DEBUG API] request.args = {dict(request.args)}")
    data = heatmap_controller.get_heatmap_data(image_id, top_n, data_type, dataset_select)
    return jsonify(data)
