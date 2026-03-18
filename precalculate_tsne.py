"""
Script para precalcular todas las proyecciones t-SNE para todos los participantes
Esto evita que t-SNE se calcule en tiempo real (que tarda 30-60 segundos por participante)

Uso: python precalculate_tsne.py
"""

import os
import sys
import json
import numpy as np
from sklearn.manifold import TSNE
import pandas as pd
from datetime import datetime

# Agregar ruta para imports
sys.path.append(os.path.dirname(__file__))

def load_vectors_data():
    """Carga los vectores de embeddings de imágenes"""
    vectors_path = os.path.join(os.path.dirname(__file__), 'static', 'data', 'data_hololens_vectors.json')
    if not os.path.exists(vectors_path):
        print(f"ERROR: Archivo no encontrado: {vectors_path}")
        return None

    try:
        with open(vectors_path, 'r') as f:
            vectors_data = json.load(f)
        print(f"OK: Vectores cargados: {len(vectors_data)} imagenes")
        return vectors_data
    except Exception as e:
        print(f"ERROR: Cargando vectores: {e}")
        return None

def load_scores_data():
    """Carga los scores de imágenes por participante"""
    scores_path = os.path.join(os.path.dirname(__file__), 'static', 'data', 'data_hololens.json')
    if not os.path.exists(scores_path):
        print(f"ERROR: Archivo no encontrado: {scores_path}")
        return None

    try:
        with open(scores_path, 'r') as f:
            scores_data = json.load(f)
        print(f"OK: Scores cargados: {len(scores_data)} imagenes")
        return scores_data
    except Exception as e:
        print(f"ERROR: Cargando scores: {e}")
        return None

def get_participants_from_scores(scores_data):
    """Obtiene lista única de participantes de los scores"""
    participants = set()
    for image_id, image_data in scores_data.items():
        if 'score_participant' in image_data:
            for entry in image_data['score_participant']:
                participants.add(entry['participant'])
    return sorted(list(participants))

def calculate_tsne_for_participant(participant_id, vectors_data, scores_data):
    """Calcula t-SNE para un participante específico"""
    try:
        embeddings = []
        image_names = []
        scores = []

        # Recopilar embeddings de imágenes que el participante vio
        for image_id_str, image_data in scores_data.items():
            image_id = int(image_id_str)

            # Verificar si este participante vio esta imagen
            participant_saw_image = False
            score_value = None

            if 'score_participant' in image_data:
                for entry in image_data['score_participant']:
                    if entry['participant'] == participant_id:
                        participant_saw_image = True
                        score_value = entry.get('score', 0)
                        break

            # Si vio la imagen, obtener su embedding
            if participant_saw_image and str(image_id) in vectors_data:
                vector = vectors_data[str(image_id)].get('embedding')
                if vector and isinstance(vector, list):
                    embeddings.append(vector)
                    image_names.append(image_id)
                    scores.append(score_value if score_value is not None else 0)

        if len(embeddings) == 0:
            print(f"ADVERTENCIA: Participante {participant_id}: sin imagenes con embeddings")
            return None

        # Convertir a numpy arrays
        embeddings = np.array(embeddings, dtype=float)
        scores = np.array(scores, dtype=float)

        # Calcular t-SNE
        print(f"Participante {participant_id}: Calculando t-SNE para {len(embeddings)} imagenes...", end=" ", flush=True)
        start_time = datetime.now()

        tsne = TSNE(n_components=2, init='pca', random_state=42, verbose=0)
        projection = tsne.fit_transform(embeddings)

        elapsed = (datetime.now() - start_time).total_seconds()
        print(f"OK ({elapsed:.1f}s)")

        # Preparar resultado
        result = {
            'x': projection[:, 0].tolist(),
            'y': projection[:, 1].tolist(),
            'image_names': image_names,
            'scores': scores.tolist(),
            'timestamp': datetime.now().isoformat()
        }

        return result

    except Exception as e:
        print(f"❌ Error calculando t-SNE para participante {participant_id}: {e}")
        import traceback
        traceback.print_exc()
        return None

def save_tsne_cache(participant_id, tsne_result):
    """Guarda resultado de t-SNE en caché"""
    try:
        cache_dir = os.path.join(os.path.dirname(__file__), 'static', 'cache', 'tsne')
        os.makedirs(cache_dir, exist_ok=True)

        cache_file = os.path.join(cache_dir, f'tsne_{participant_id}.json')

        cache_entry = {
            'hash': 'precalculated',
            'result': tsne_result,
            'timestamp': datetime.now().isoformat()
        }

        with open(cache_file, 'w') as f:
            json.dump(cache_entry, f, indent=2)

        print(f"   Cache guardado en: {cache_file}")
        return True
    except Exception as e:
        print(f"ERROR: Guardando cache para participante {participant_id}: {e}")
        return False

def main():
    """Precalcula t-SNE para todos los participantes"""
    print("=" * 70)
    print("PRECALCULANDO t-SNE PARA TODOS LOS PARTICIPANTES")
    print("=" * 70)

    # Cargar datos
    print("\nCargando datos...")
    vectors_data = load_vectors_data()
    scores_data = load_scores_data()

    if not vectors_data or not scores_data:
        print("Error: No se pudieron cargar los datos necesarios")
        return False

    # Obtener lista de participantes
    participants = get_participants_from_scores(scores_data)
    print(f"Participantes encontrados: {participants}")
    print(f"Total: {len(participants)} participantes\n")

    # Precalcular t-SNE para cada participante
    print("Precalculando t-SNE...")
    print("-" * 70)

    successful = 0
    failed = 0

    for participant_id in participants:
        tsne_result = calculate_tsne_for_participant(participant_id, vectors_data, scores_data)

        if tsne_result:
            if save_tsne_cache(participant_id, tsne_result):
                successful += 1
            else:
                failed += 1
        else:
            failed += 1

    # Resumen
    print("-" * 70)
    print(f"\nPRECALCULACION COMPLETADA")
    print(f"   Exitosos: {successful}/{len(participants)}")
    print(f"   Fallidos: {failed}/{len(participants)}")
    print(f"\nAhora t-SNE se cargara desde cache en <1 segundo por participante")
    print("=" * 70)

    return successful > 0

if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
