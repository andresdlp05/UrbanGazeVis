"""
Controller para la página By Participant
"""

from flask import Blueprint, render_template, jsonify
import pandas as pd
import numpy as np
import json
import os
import cv2
import umap
from scipy.ndimage import gaussian_filter
from sklearn.manifold import TSNE
import umap
from sklearn.manifold import MDS

# Importar servicio de caché para t-SNE
try:
    from app.shared.tsne_cache_service import get_tsne_cache
    print("OK: ByParticipant: Servicio de cache t-SNE HABILITADO")
except ImportError as e:
    print("ADVERTENCIA: ByParticipant: Servicio de cache t-SNE no disponible:", str(e))
    get_tsne_cache = None

by_participant_bp = Blueprint('by_participant', __name__)

class ByParticipantController:
    def __init__(self, csv_path='static/data/df_final1.csv', scores_path='static/data/data_hololens_vectors.json',
                 vectors_path='static/data/data_hololens_vectors.json', segmentations_path='static/data/upd_segmentations.csv',
                 saliency_cache_path='static/data/precalculated_saliency_coverage.csv'):
        self.csv_path = csv_path
        self.scores_path = scores_path
        self.vectors_path = vectors_path
        self.segmentations_path = segmentations_path
        self.saliency_cache_path = saliency_cache_path
        self.data = None
        self.scores_data = None
        self.vectors_data = None
        self.segmentations_data = None
        self.saliency_cache = None
        self.load_data()

    def load_data(self):
        """Carga datos de gaze tracking, scores, vectors y segmentaciones"""
        try:
            # Cargar CSV de gaze tracking
            full_path = os.path.join(os.path.dirname(__file__), '..', '..', self.csv_path)
            self.data = pd.read_csv(full_path)
            print(f"By Participant data loaded: {len(self.data)} rows")

            # Cargar JSON con información de imágenes y participantes
            scores_full_path = os.path.join(os.path.dirname(__file__), '..', '..', self.scores_path)
            if os.path.exists(scores_full_path):
                with open(scores_full_path, 'r') as f:
                    self.scores_data = json.load(f)
                print(f"Scores data loaded: {len(self.scores_data)} images")
            else:
                print(f"Scores file not found at: {scores_full_path}")

            # Cargar vectores/embeddings de imágenes
            vectors_full_path = os.path.join(os.path.dirname(__file__), '..', '..', self.vectors_path)
            if os.path.exists(vectors_full_path):
                with open(vectors_full_path, 'r') as f:
                    self.vectors_data = json.load(f)
                print(f"Vectors data loaded: {len(self.vectors_data)} images")
            else:
                print(f"Vectors file not found at: {vectors_full_path}")

            # Cargar datos de segmentación
            segmentations_full_path = os.path.join(os.path.dirname(__file__), '..', '..', self.segmentations_path)
            if os.path.exists(segmentations_full_path):
                self.segmentations_data = pd.read_csv(segmentations_full_path, sep=';')
                print(f"Segmentations data loaded: {len(self.segmentations_data)} rows")
                # Limpiar columnas con todos los valores < 20.0 después de la fila 4 (menos agresivo)
                exclude_cols = ["image_id", "seg_image_path", "seg_overlay_image_path", "mask_path"]
                candidate_cols = self.segmentations_data.columns.difference(exclude_cols)
                cols_all_zero = [
                    col for col in candidate_cols
                    if (self.segmentations_data[col].iloc[4:] < 20.0).all()
                ]
                if cols_all_zero:
                    self.segmentations_data = self.segmentations_data.drop(columns=cols_all_zero)
                    print(f"Removed {len(cols_all_zero)} sparse segmentation columns")
            else:
                print(f"Segmentations file not found at: {segmentations_full_path}")

            # Cargar caché de saliency coverage pre-calculado
            saliency_cache_full_path = os.path.join(os.path.dirname(__file__), '..', '..', self.saliency_cache_path)
            if os.path.exists(saliency_cache_full_path):
                self.saliency_cache = pd.read_csv(saliency_cache_full_path)
                print(f" Saliency coverage cache loaded: {len(self.saliency_cache)} records")
            else:
                print(f" Saliency coverage cache not found at: {saliency_cache_full_path}")
                print("   Run 'python precalculate_saliency_coverage.py' to generate it")
        except Exception as e:
            print(f"Error loading by_participant data: {e}")

    def get_participants(self):
        """Obtiene lista de participantes únicos de data_hololens.json"""
        if self.scores_data is None:
            return []

        # Recopilar todos los participantes únicos de todas las imágenes
        participants = set()
        for image_id, image_data in self.scores_data.items():
            if 'score_participant' in image_data:
                for score_entry in image_data['score_participant']:
                    participants.add(score_entry['participant'])

        return sorted(list(participants))

    def get_images_for_participant(self, participant_id):
        """Obtiene todas las imágenes que vio un participante según el CSV"""
        if self.data is None:
            return []

        # Obtener imágenes únicas para este participante del CSV
        participant_data = self.data[self.data['participante'] == participant_id]
        if len(participant_data) == 0:
            return []

        images = sorted(participant_data['ImageName'].unique().tolist())
        return images

    def get_heatmap_data_for_participant(self, participant_id, top_n_clases=15):
        """
        Calcula matriz de densidad ponderada para un participante
        - Filas: clases (top N por tiempo total)
        - Columnas: imágenes que vio el participante (50)
        - Valores: densidad = time_en_clase / ratio_de_clase
        """
        if self.data is None or self.scores_data is None:
            return {'error': 'No data available'}

        try:
            # Obtener imágenes que vio este participante
            images_for_participant = self.get_images_for_participant(participant_id)
            if not images_for_participant:
                return {'error': f'No images found for participant {participant_id}'}

            # Filtrar datos para este participante en sus imágenes
            df_filtered = self.data[
                (self.data['participante'] == participant_id) &
                (self.data['ImageName'].isin(images_for_participant))
            ].copy()

            if len(df_filtered) == 0:
                return {'error': f'No gaze data for participant {participant_id}'}

            # Eliminar puntos sin clasificación
            df_filtered = df_filtered[
                (df_filtered['main_class'].notna()) &
                (df_filtered['main_class'].astype(str).str.strip() != '')
            ].copy()

            if len(df_filtered) == 0:
                return {'error': f'No classified data for participant {participant_id}'}

            # Ordenar por participante, imagen y tiempo
            df_sorted = df_filtered.sort_values(
                by=['participante', 'ImageName', 'Time']
            ).reset_index(drop=True)

            # Calcular delta_t (duración de cada punto)
            df_sorted['_bloque'] = df_sorted['participante'].astype(str) + '||' + \
                                   df_sorted['ImageName'].astype(str)
            df_sorted['Time_next'] = df_sorted.groupby('_bloque')['Time'].shift(-1)
            df_sorted['delta_t'] = df_sorted['Time_next'] - df_sorted['Time']
            df_sorted['delta_t'] = df_sorted['delta_t'].fillna(0.0)

            # Agrupar por (imagen, main_class) y sumar delta_t
            por_imagen_clase = (
                df_sorted
                .groupby(['ImageName', 'main_class'], dropna=False)['delta_t']
                .sum()
                .reset_index()
                .rename(columns={'delta_t': 'time_por_imagen_clase'})
            )

            # Obtener top N clases por tiempo total
            suma_total_clase = (
                por_imagen_clase
                .groupby('main_class')['time_por_imagen_clase']
                .sum()
                .reset_index()
                .rename(columns={'time_por_imagen_clase': 'total_time_global'})
                .sort_values(by='total_time_global', ascending=False)
            )



            top_clases = suma_total_clase.head(top_n_clases)['main_class'].tolist()
            por_imagen_clase_top = por_imagen_clase[
                por_imagen_clase['main_class'].isin(top_clases)
            ].copy()

            # Obtener ratio de cada main_class en cada imagen
            ratio_por_imagen_clase = (
                df_filtered[['ImageName', 'main_class', 'ratio']]
                .dropna(subset=['main_class', 'ratio'])
                .drop_duplicates(subset=['ImageName', 'main_class'])
                .set_index(['ImageName', 'main_class'])['ratio']
                .to_dict()
            )

            # Calcular densidad ponderada
            def obtener_ratio(row):
                return ratio_por_imagen_clase.get((row['ImageName'], row['main_class']), np.nan)

            por_imagen_clase_top['class_ratio'] = por_imagen_clase_top.apply(obtener_ratio, axis=1)

            def calcular_densidad(row):
                r = row['class_ratio']
                if pd.isna(r) or r == 0:
                    return 0.0
                return row['time_por_imagen_clase'] / r

            por_imagen_clase_top['density'] = por_imagen_clase_top.apply(calcular_densidad, axis=1)

            # Crear matriz: filas=main_class, columnas=ImageName
            matriz = por_imagen_clase_top.pivot_table(
                index='main_class',
                columns='ImageName',
                values='density',
                aggfunc='first',
                fill_value=0.0
            )

            # Asegurar que todas las clases top estén presentes
            matriz = matriz.reindex(top_clases, fill_value=0.0)

            # Asegurar que TODAS las 50 imágenes estén en las columnas (rellenar con ceros)
            all_images_sorted = sorted(images_for_participant)
            matriz = matriz.reindex(columns=all_images_sorted, fill_value=0.0)

            # Normalizar para visualización (0-1)
            min_val = matriz.min().min() if len(matriz) > 0 else 0
            max_val = matriz.max().max() if len(matriz) > 0 else 1

            if max_val > min_val:
                matriz_normalized = (matriz - min_val) / (max_val - min_val)
            else:
                matriz_normalized = matriz.copy()


            image_names = {}  # Mapeo ImageIndex -> ImageName (para frontend)
            image_indexes = []  # Lista de ImageIndexes ordenados (para data.images)
            image_scores = {}  # Mapeo ImageName -> score del participante específico (1-10)

            for img_name in all_images_sorted:
                # Buscar el ImageIndex correspondiente a este ImageName
                img_data = df_filtered[df_filtered['ImageName'] == img_name]

            image_scores = []
            images = [int(img) for img in matriz.columns.tolist()]
            for img_id in images:
                img_participants = self.scores_data[str(img_id)]['score_participant']
                idx = [x['participant'] for x in img_participants].index(participant_id)
                image_scores.append([img_id, img_participants[idx]['score']])

            # image_scores = sorted(image_scores, key = lambda x:x[1], reverse=True)
            
            # matriz.to_csv('RESULTADO_PARTICIPANT.csv', index=False)
            # matriz_normalized.to_csv('RESULTADO_PARTICIPANT_NORMALIZED.csv', index=False)
            # Preparar datos para retornar
            return {
                'classes': matriz.index.tolist(),
                'images': images,
                'image_scores': image_scores,  # Mapeo de ImageName -> score
                'matrix_raw': matriz.values.tolist(),
                'matrix_normalized': matriz_normalized.values.tolist(),
                'min_value': float(min_val),
                'max_value': float(max_val),
                'participant_id': participant_id
            }

        except Exception as e:
            print(f"Error calculating heatmap for participant {participant_id}: {e}")
            return {'error': str(e)}

    def generate_heatmap(self, fixations, img_width=800, img_height=600, sigma=24):
        """
        Genera un mapa de densidad continuo usando suavizado Gaussiano.

        Args:
            fixations: lista de tuplas (x, y) con coordenadas de puntos de gaze
            img_width: ancho de la imagen (píxeles)
            img_height: alto de la imagen (píxeles)
            sigma: desviación estándar del kernel Gaussiano (≈1° visual = ~24 píxeles a 800x600)

        Returns:
            heatmap normalizado entre 0 y 1
        """
        # 1. Crear matriz de ceros (histograma 2D)
        heatmap = np.zeros((img_height, img_width), dtype=np.float32)

        # 2. Marcar fixations
        for x, y in fixations:
            if 0 <= x < img_width and 0 <= y < img_height:
                heatmap[int(y), int(x)] += 1

        # 3. Aplicar suavizado Gaussiano
        heatmap = gaussian_filter(heatmap, sigma=sigma)

        # 4. Normalizar entre 0 y 1
        if np.max(heatmap) > 0:
            heatmap = heatmap / np.max(heatmap)

        return heatmap

    def calculate_saliency_coverage(self, heatmap):
        """
        Calcula el % de área cubierta (Saliency Coverage) usando Otsu Binarization.

        Fórmula del paper: porcentaje de píxeles activados en el mapa binario
        determinados mediante el algoritmo de Otsu (umbral automático).
        """
        try:
            # Convertir a formato uint8 (0-255) necesario para OpenCV Otsu
            heatmap_uint8 = (heatmap * 255).astype(np.uint8)

            # Aplicar umbralización de Otsu para encontrar el umbral óptimo
            # que minimiza la varianza intra-clase
            threshold_val, binary_map = cv2.threshold(
                heatmap_uint8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
            )

            # Calcular porcentaje de píxeles activados (blancos)
            total_pixels = binary_map.size
            activated_pixels = np.count_nonzero(binary_map)

            saliency_coverage = (activated_pixels / total_pixels) * 100

            return saliency_coverage, binary_map
        except Exception as e:
            print(f"Error calculating saliency coverage: {e}")
            return 0.0, None

    def calculate_stationary_entropy(self, heatmap):
        """
        Calcula la entropía de Shannon de la distribución de la mirada.

        Fórmula: H = -sum(p * log2(p)) donde p es la distribución de probabilidad
        del heatmap normalizado.

        Rango: 0 = atención completamente concentrada, max = atención distribuida uniformemente
        """
        try:
            # 1. Convertir el heatmap en una distribución de probabilidad (suma = 1)
            heatmap_sum = np.sum(heatmap)
            if heatmap_sum == 0:
                return 0.0

            prob_dist = heatmap / heatmap_sum

            # 2. Aplicar fórmula de Shannon: H = -sum(p * log2(p))
            # Usamos una máscara para evitar log(0) que daría -inf
            mask = prob_dist > 0
            entropy = -np.sum(prob_dist[mask] * np.log2(prob_dist[mask]))

            return float(entropy)
        except Exception as e:
            print(f"Error calculating entropy: {e}")
            return 0.0

    def get_saliency_coverage_data(self, participant_id):
        """
        Obtiene saliency coverage pre-calculado para cada imagen del participante.
        Retorna datos para el scatter plot ordenados por score.
        """
        if self.saliency_cache is None:
            return {'error': 'Saliency coverage cache not available. Run precalculate_saliency_coverage.py'}

        try:
            # Filtrar datos del caché para este participante
            participant_data = self.saliency_cache[
                self.saliency_cache['participante'] == participant_id
            ].copy()

            if len(participant_data) == 0:
                return {'error': f'No saliency data found for participant {participant_id}'}

            # Convertir a lista de diccionarios
            saliency_data = participant_data.to_dict('records')

            # Ordenar por score de menor a mayor (primario), y cuando son iguales, por saliency_coverage de menor a mayor (secundario)
            saliency_data.sort(key=lambda x: (x['score'], x['saliency_coverage']))

            # Asegurar que los valores sean del tipo correcto para JSON
            for item in saliency_data:
                item['participante'] = int(item['participante'])
                item['ImageName'] = int(item['ImageName'])
                item['score'] = float(item['score'])
                item['saliency_coverage'] = float(item['saliency_coverage'])
                item['stationary_entropy'] = float(item['stationary_entropy'])
                item['gaze_points_count'] = int(item['gaze_points_count'])
                # Agregar image_index e image_name para compatibilidad
                item['image_index'] = int(item['ImageName'])
                item['image_name'] = int(item['ImageName'])

            return {
                'status': 'success',
                'participant_id': participant_id,
                'data': saliency_data
            }

        except Exception as e:
            import traceback
            print(f"Error loading saliency coverage for participant {participant_id}: {e}")
            traceback.print_exc()
            return {'error': str(e)}

    def get_embedding_projection_data(self, participant_id):
        """
        Calcula proyección t-SNE de embeddings segmentarios para las imágenes de un participante.
        Retorna puntos proyectados con scores.
        """
        if self.vectors_data is None or self.segmentations_data is None:
            return {'error': 'Embedding data not available'}

        try:
            # Obtener imágenes que vio este participante
            images_for_participant = self.get_images_for_participant(participant_id)
            if not images_for_participant:
                return {'error': f'No images found for participant {participant_id}'}

            # Extraer embeddings segmentarios para las imágenes de este participante
            embeddings = []
            image_names = []
            scores = []

            for img_name in images_for_participant:
                # img_name ya es ImageName (no ImageIndex)

                img_name_str = str(int(img_name))

                # Obtener vector/embedding
                if img_name_str not in self.vectors_data:
                    continue

                vector_info = self.vectors_data[img_name_str]
                if 'ID' not in vector_info:
                    continue

                embeddings.append(vector_info['placesnet_embedding'])
                image_names.append(int(img_name))

                score_entries = vector_info['score_participant']
                idx = [x['participant'] for x in score_entries].index(participant_id)
                scores.append(score_entries[idx]['score'])
                print(img_name, vector_info['placesnet_embedding'][0], len(vector_info['placesnet_embedding']))

            if len(embeddings) == 0:
                return {'error': f'No embedding data for participant {participant_id}'}

            embeddings = np.array(embeddings, dtype=float)
            scores = np.array(scores, dtype=float)

            # Intentar obtener resultado de t-SNE del caché
            """
            tsne_cache = get_tsne_cache() if get_tsne_cache else None
            cached_result = None
            if tsne_cache:
                cached_result = tsne_cache.get(participant_id, embeddings)

            if cached_result:
                # Usar resultado cacheado
                projection = np.column_stack([cached_result['x'], cached_result['y']])
                print(f"[t-SNE LOGGING] ✅ Usando caché para participante {participant_id}")
            else:
                # Calcular t-SNE
                print(f"[t-SNE LOGGING] Computing t-SNE projection for participant {participant_id} with {len(embeddings)} images...")
                tsne = TSNE(n_components=2, init='pca', random_state=42)#, perplexity=min(30, len(embeddings) - 1))
                projection = tsne.fit_transform(embeddings)

                # Cachear el resultado
                if tsne_cache:
                    tsne_cache.set(participant_id, embeddings, {
                        'x': projection[:, 0],
                        'y': projection[:, 1]
                    })
            """
            tsne = TSNE(n_components=2, init='pca', random_state=42)#, perplexity=min(30, len(embeddings) - 1))
            # tsne = umap.UMAP(random_state=42)
            # tsne = MDS(n_components=2,dissimilarity="euclidean",random_state=42,metric=True)

            projection = tsne.fit_transform(embeddings)
            print('RESULTADO TSNE')
            print(projection)
            # Preparar datos para retornar
            projection_data = []
            for i, (x, y) in enumerate(projection):
                projection_data.append({
                    'image_name': int(image_names[i]),
                    'tsne_x': float(x),
                    'tsne_y': float(y),
                    'score': float(scores[i])
                })

            return {
                'status': 'success',
                'participant_id': participant_id,
                'data': projection_data
            }

        except Exception as e:
            import traceback
            print(f"Error calculating embedding projection for participant {participant_id}: {e}")
            traceback.print_exc()
            return {'error': str(e)}


by_participant_controller = ByParticipantController()


@by_participant_bp.route('/by-participant', methods=['GET'])
def by_participant():
    """Renderiza la página By Participant"""
    return render_template('by_participant.html')


@by_participant_bp.route('/by-participant/api/participants', methods=['GET'])
def get_participants():
    """Obtiene lista de participantes"""
    participants = by_participant_controller.get_participants()
    return jsonify({'participants': participants})


@by_participant_bp.route('/by-participant/api/images/<int:participant_id>', methods=['GET'])
def get_images_for_participant(participant_id):
    """Obtiene imágenes que vio un participante"""
    images = by_participant_controller.get_images_for_participant(participant_id)
    return jsonify({'images': images})


@by_participant_bp.route('/by-participant/api/heatmap/<int:participant_id>', methods=['GET'])
def get_heatmap_for_participant(participant_id):
    """Obtiene datos de heatmap para un participante"""
    data = by_participant_controller.get_heatmap_data_for_participant(participant_id)
    return jsonify(data)


@by_participant_bp.route('/by-participant/api/embedding-projection/<int:participant_id>', methods=['GET'])
def get_embedding_projection_for_participant(participant_id):
    """Obtiene datos de proyección t-SNE de embeddings para un participante"""
    data = by_participant_controller.get_embedding_projection_data(participant_id)
    return jsonify(data)


@by_participant_bp.route('/by-participant/api/saliency-coverage/<int:participant_id>', methods=['GET'])
def get_saliency_coverage_for_participant(participant_id):
    """Obtiene datos de saliency coverage para un participante"""
    data = by_participant_controller.get_saliency_coverage_data(participant_id)
    return jsonify(data)
