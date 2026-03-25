"""
Script para precalcular todas las proyecciones t-SNE para todos los participantes.
Evita el calculo en tiempo real por request.

Uso: python precalculate_tsne.py
"""

import os
import sys
import json
import numpy as np
from datetime import datetime
from sklearn.manifold import TSNE

# Agregar ruta para imports
sys.path.append(os.path.dirname(__file__))


def load_vectors_data():
    """Carga embeddings y score_participant desde data_hololens_vectors.json."""
    vectors_path = os.path.join(os.path.dirname(__file__), 'static', 'data', 'json', 'data_hololens_vectors.json')
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


def get_participants_from_vectors(vectors_data):
    """Obtiene lista unica de participantes desde score_participant."""
    participants = set()
    for _, image_data in vectors_data.items():
        for entry in image_data.get('score_participant', []):
            participant = entry.get('participant')
            if participant is not None:
                participants.add(participant)
    return sorted(list(participants))


def calculate_tsne_for_participant(participant_id, vectors_data):
    """Calcula t-SNE para un participante especifico."""
    try:
        embeddings = []
        image_names = []
        scores = []

        for image_id_str, image_data in vectors_data.items():
            # Ignorar claves de metadata (ej: "classes")
            if not str(image_id_str).isdigit():
                continue
            image_id = int(image_id_str)

            score_value = None
            for entry in image_data.get('score_participant', []):
                if entry.get('participant') == participant_id:
                    score_value = entry.get('score', 0)
                    break

            # Saltar si el participante no vio esta imagen
            if score_value is None:
                continue

            if not isinstance(image_data, dict):
                continue

            vector = image_data.get('placesnet_embedding') or image_data.get('embedding')
            if vector and isinstance(vector, list):
                embeddings.append(vector)
                image_names.append(image_id)
                scores.append(score_value)

        if len(embeddings) == 0:
            print(f"ADVERTENCIA: Participante {participant_id}: sin imagenes con embeddings")
            return None

        embeddings_np = np.array(embeddings, dtype=float)
        scores_np = np.array(scores, dtype=float)

        print(f"Participante {participant_id}: Calculando t-SNE para {len(embeddings_np)} imagenes...", end=" ", flush=True)
        start_time = datetime.now()

        tsne = TSNE(n_components=2, init='pca', random_state=42, verbose=0)
        projection = tsne.fit_transform(embeddings_np)

        elapsed = (datetime.now() - start_time).total_seconds()
        print(f"OK ({elapsed:.1f}s)")

        return {
            'x': projection[:, 0].tolist(),
            'y': projection[:, 1].tolist(),
            'image_names': image_names,
            'scores': scores_np.tolist(),
            'timestamp': datetime.now().isoformat()
        }

    except Exception as e:
        print(f"ERROR calculando t-SNE para participante {participant_id}: {e}")
        import traceback
        traceback.print_exc()
        return None


def save_tsne_cache(participant_id, tsne_result):
    """Guarda resultado de t-SNE en static/cache/tsne."""
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
    """Precalcula t-SNE para todos los participantes."""
    print("PRECALCULANDO t-SNE PARA TODOS LOS PARTICIPANTES")

    print("\nCargando datos...")
    vectors_data = load_vectors_data()
    if not vectors_data:
        print("Error: No se pudieron cargar los datos necesarios")
        return False

    participants = get_participants_from_vectors(vectors_data)
    print(f"Participantes encontrados: {participants}")
    print(f"Total: {len(participants)} participantes\n")

    print("Precalculando t-SNE...")

    successful = 0
    failed = 0

    for participant_id in participants:
        tsne_result = calculate_tsne_for_participant(participant_id, vectors_data)
        if tsne_result:
            if save_tsne_cache(participant_id, tsne_result):
                successful += 1
            else:
                failed += 1
        else:
            failed += 1

    print("-" * 70)
    print("\nPRECALCULACION COMPLETADA")
    print(f"   Exitosos: {successful}/{len(participants)}")
    print(f"   Fallidos: {failed}/{len(participants)}")
    print("\nAhora t-SNE se cargara desde cache en <1 segundo por participante")
    print("=" * 70)

    return successful > 0


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)

