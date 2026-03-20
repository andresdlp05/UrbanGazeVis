"""
Controller para Scarf Plot Visualization
Maneja la visualización de la distribución temporal de gaze y fixations
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
        # Mapeo fijo para grupos para consistencia visual
        self.grupo_color_mapping = {
            'Building': '#8B7355',      # Marrón
            'Vegetation': '#228B22',    # Verde
            'Car': '#DC143C',           # Rojo
            'Sidewalk': '#D3D3D3',      # Gris claro
            'Person': '#FF8C00',        # Naranja
            'Sky': '#87CEEB',           # Azul Cielo
            'Trash': '#2F4F4F',         # Gris oscuro
            'Road': '#808080',          # Gris medio
            'Obstacle': '#000000'
        }
        self.scores_data = None
        self.load_data()

    def load_data(self):
        """Carga datos de gaze tracking y scores SIN MODIFICAR EL GLOBAL"""
        try:
            if get_data_service:
                self.data_service = get_data_service()
                # Obtenemos la REFERENCIA al dataframe global
                self.data = self.data_service.get_main_data()
                self.scores_data = self.data_service.get_scores_data()
            else:
                full_path = os.path.join(os.path.dirname(__file__), '..', '..', self.csv_path)
                if os.path.exists(full_path):
                    self.data = pd.read_csv(full_path)
                else:
                    return

            if self.data is None: return


            # Cargar mapeo de colores base (solo lectura)
            if 'hex_color' in self.data.columns and 'main_class' in self.data.columns:
                color_df = self.data[['main_class', 'hex_color']].dropna().drop_duplicates()
                self.color_mapping = dict(zip(color_df['main_class'], color_df['hex_color']))

        except Exception as e:
            print(f"Error cargando datos scarf: {e}")

    def get_valid_participants_for_image(self, image_id):
        if self.scores_data is None: return []
        image_key = str(image_id)
        if image_key in self.scores_data:
            score_entries = self.scores_data[image_key].get('score_participant', [])
            return sorted(list(set(entry['participant'] for entry in score_entries)))
        return []

    def get_scarf_plot_data(self, image_id, participant_id=None, data_type='gaze', dataset_select='main_class', image_name=None):
        # image_id viene como int desde la URL
        
        if self.data is None: return {'error': 'No data available'}

        # Configurar columnas según la selección
        if dataset_select == 'disorder':
            class_column = 'main_class'
            color_column = 'hex_color'
        elif dataset_select == 'grouped':
            class_column = 'main_class_grouped'      
            class_id_column = 'main_class_grouped'
            ratio_column = 'class_ratio_grouped'
            color_column = 'hex_color_grouped'

        elif dataset_select == 'grouped_disorder':
            class_column = 'group_name'
            color_column = 'hex_color'
        else:
            class_column = 'main_class'
            color_column = 'hex_color'

        try:
            # --- FILTRADO SEGURO (Sin tocar el global) ---
            # Usamos .astype(str) en la comparación, no en la asignación
            # Esto crea una máscara booleana temporal sin cambiar los datos originales
            mask = self.data['ImageName'].astype(str) == str(image_id)
            filtered = self.data[mask].copy() # .copy() crea un nuevo DF independiente

            if len(filtered) == 0: return {'error': f'No data for image {image_id}'}
            
         

            # 2. Filtrar participantes
            valid_participants = self.get_valid_participants_for_image(image_id)
            if not valid_participants: return {'error': f'No valid participants found'}
            
            filtered = filtered[filtered['participante'].isin(valid_participants)]

            if participant_id is not None:
                filtered = filtered[filtered['participante'] == participant_id]

            if len(filtered) == 0: return {'error': 'No data after filtering'}

            # --- LÓGICA DE FIXATIONS / GAZE ---
            if data_type == 'fixations':
                # Detectar fixations
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
                if not fixations_list: return {'error': 'No fixations detected'}

                # Agrupar fixations
                fixations_by_participant = {}
                for fix in fixations_list:
                    p_id = fix.get('participante')
                    if p_id not in fixations_by_participant:
                        fixations_by_participant[p_id] = []
                    fixations_by_participant[p_id].append(fix)
                participants = sorted(fixations_by_participant.keys())
            else:
                participants = sorted(filtered['participante'].unique())
                fixations_by_participant = None

            # --- CONSTRUCCIÓN DEL JSON DE RESPUESTA ---
            scarf_data = []
            
            for p_id in participants:
                # RAMA FIXATIONS
                if data_type == 'fixations':
                    p_fixations = fixations_by_participant.get(p_id, [])
                    if not p_fixations: continue

                    times = [f.get('start', 0) for f in p_fixations]
                    min_time, max_time = (min(times), max(times)) if times else (0, 1)
                    
                    segments = []
                    fixation_radius = 50 

                    for fix in sorted(p_fixations, key=lambda f: f.get('start', 0)):
                        # Lógica espacial para determinar clase
                        x, y = fix.get('x_centroid', 0), fix.get('y_centroid', 0)
                        p_gaze = filtered[filtered['participante'] == p_id]
                        
                        class_value = 'unknown'
                        if len(p_gaze) > 0:
                            dists = np.sqrt((p_gaze['pixelX'] - x)**2 + (p_gaze['pixelY'] - y)**2)
                            nearby = p_gaze[dists <= fixation_radius]
                            
                            if len(nearby) > 0:
                                modes = nearby[class_column].mode()
                                if not modes.empty: class_value = modes[0]
                            elif not dists.empty:
                                class_value = p_gaze.loc[dists.idxmin(), class_column]

                        # Color
                        if dataset_select == 'grouped':
                            color = self.grupo_color_mapping.get(str(class_value), '#999999')
                        else:
                            color = self.color_mapping.get(str(class_value), '#999999')

                        # Tiempos
                        tr = max(max_time - min_time, 1)
                        s_norm = ((fix.get('start', 0) - min_time) / tr) * 15000
                        e_norm = s_norm + (fix.get('duration', 0) * 1000)

                        segments.append({
                            'class': str(class_value),
                            'start_time': float(np.clip(s_norm, 0, 15000)),
                            'end_time': float(np.clip(e_norm, 0, 15000)),
                            'points': fix.get('pointCount', 1),
                            'color': color
                        })

                    scarf_data.append({
                        'participant': int(p_id),
                        'segments': segments,
                        'total_points': sum(s['points'] for s in segments),
                        'time_range_ms': float(max_time - min_time)
                    })

                # RAMA GAZE
                else:
                    p_data = filtered[filtered['participante'] == p_id].sort_values('Time')
                    if len(p_data) == 0: continue

                    min_time, max_time = p_data['Time'].min(), p_data['Time'].max()
                    tr = max(max_time - min_time, 1)

                    segments = []
                    curr = None

                    for _, row in p_data.iterrows():
                        norm_time = ((row['Time'] - min_time) / tr) * 15000
                        cls = str(row[class_column]).strip() if pd.notna(row[class_column]) else "unknown"

                        # Color
                        if dataset_select == 'grouped':
                            color = self.grupo_color_mapping.get(cls, '#999999')
                        else:
                            # Intentamos sacar el color del row, si no del mapa
                            color = row.get(color_column, self.color_mapping.get(cls, '#999999'))
                            if pd.isna(color): color = '#999999'

                        if curr is None or curr['class'] != cls:
                            if curr: segments.append(curr)
                            curr = {'class': cls, 'start_time': float(norm_time), 'end_time': float(norm_time), 'points': 1, 'color': color}
                        else:
                            curr['end_time'] = float(norm_time)
                            curr['points'] += 1

                    if curr: segments.append(curr)

                    scarf_data.append({
                        'participant': int(p_id),
                        'segments': segments,
                        'total_points': len(p_data),
                        'time_range_ms': float(tr)
                    })

            return {
                'image_id': int(image_id),
                'participant_id': participant_id,
                'total_participants': len(participants),
                'scarf_data': scarf_data,
                #'color_mapping': self.grupo_color_mapping if dataset_select == 'grouped' else self.color_mapping,
                'color_mapping': self.color_mapping,
                'status': 'success'
            }

        except Exception as e:
            import traceback
            traceback.print_exc()
            return {'error': f'Error processing scarf data: {str(e)}'}

# Instancia y endpoints
scarf_controller = ScarfPlotController()

@scarf_bp.route('/api/scarf-plot/<int:image_id>', methods=['GET'])
def get_scarf_plot(image_id):
    participant_id = request.args.get('participant_id', type=int)
    data_type = request.args.get('data_type', 'gaze').lower()
    dataset_select = request.args.get('dataset_select', 'main_class').lower()
    return jsonify(scarf_controller.get_scarf_plot_data(image_id, participant_id, data_type, dataset_select))

@scarf_bp.route('/api/scarf-plot-colors', methods=['GET'])
def get_color_mapping():
    return jsonify(scarf_controller.color_mapping)