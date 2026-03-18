"""
Script para pre-calcular saliency coverage y entropy para todos los participantes e imágenes.
Esto evita tener que calcularlos en tiempo real, mejorando significativamente el rendimiento.
"""

import pandas as pd
import numpy as np
from scipy.ndimage import gaussian_filter
from skimage.filters import threshold_otsu
import json
from pathlib import Path

def generate_heatmap(fixations, img_width=800, img_height=600, sigma=24):
    """
    Genera un heatmap continuo a partir de puntos de fijación con suavizado Gaussiano.
    """
    if not fixations or len(fixations) == 0:
        return np.zeros((img_height, img_width))

    # Crear matriz de acumulación
    heatmap = np.zeros((img_height, img_width))

    # Acumular puntos en el heatmap
    for x, y in fixations:
        # Convertir coordenadas a enteros y validar límites
        x_int = int(round(x))
        y_int = int(round(y))

        if 0 <= x_int < img_width and 0 <= y_int < img_height:
            heatmap[y_int, x_int] += 1

    # Aplicar suavizado Gaussiano
    heatmap_smooth = gaussian_filter(heatmap, sigma=sigma)

    return heatmap_smooth

def calculate_saliency_coverage(heatmap):
    """
    Calcula el % de área cubierta (Saliency Coverage) usando Otsu Binarization.
    """
    try:
        # Normalizar heatmap a rango [0, 255]
        if heatmap.max() > 0:
            heatmap_normalized = (heatmap / heatmap.max() * 255).astype(np.uint8)
        else:
            return 0.0, np.zeros_like(heatmap)

        # Calcular umbral de Otsu
        threshold = threshold_otsu(heatmap_normalized)

        # Binarizar: píxeles por encima del umbral = activados (1), por debajo = no activados (0)
        binary_map = heatmap_normalized > threshold

        # Calcular % de área cubierta
        activated_pixels = np.sum(binary_map)
        total_pixels = binary_map.size
        saliency_coverage = (activated_pixels / total_pixels) * 100

        return saliency_coverage, binary_map

    except Exception as e:
        print(f"Error calculating saliency coverage: {e}")
        return 0.0, np.zeros_like(heatmap)

def calculate_stationary_entropy(heatmap):
    """
    Calcula la entropía de Shannon de la distribución de mirada (Stationary Entropy).
    """
    try:
        # Normalizar el heatmap para que sume 1 (distribución de probabilidad)
        heatmap_sum = np.sum(heatmap)
        if heatmap_sum == 0:
            return 0.0

        prob_distribution = heatmap / heatmap_sum

        # Calcular entropía de Shannon: H = -Σ(p * log2(p))
        # Evitar log(0) usando un valor mínimo
        prob_distribution = prob_distribution[prob_distribution > 0]
        entropy = -np.sum(prob_distribution * np.log2(prob_distribution))

        return entropy

    except Exception as e:
        print(f"Error calculating stationary entropy: {e}")
        return 0.0

def main():
    print("=" * 80)
    print("PRE-CÁLCULO DE SALIENCY COVERAGE Y ENTROPY")
    print("=" * 80)

    # Cargar datos
    print("\n1. Cargando datos...")
    data_path = Path(__file__).parent / 'static' / 'data' / 'df_final1.csv'
    scores_path = Path(__file__).parent / 'static' / 'data' / 'data_hololens.json'
    output_path = Path(__file__).parent / 'static' / 'data' / 'precalculated_saliency_coverage.csv'

    df = pd.read_csv(data_path)
    print(f"  Cargado dataset: {len(df)} filas")

    with open(scores_path, 'r') as f:
        scores_data = json.load(f)
    print(f"  Cargado scores: {len(scores_data)} imágenes")

    # Obtener combinaciones únicas de participante e imagen
    print("\n2. Identificando combinaciones únicas...")
    combinations = df[['participante', 'ImageName']].drop_duplicates()
    total_combinations = len(combinations)
    print(f"  Total de combinaciones participante-imagen: {total_combinations}")

    # Pre-calcular saliency coverage y entropy
    print("\n3. Calculando saliency coverage y entropy...")
    results = []

    for idx, (_, row) in enumerate(combinations.iterrows(), 1):
        participant_id = row['participante']
        image_name = row['ImageName']

        if idx % 50 == 0 or idx == 1:
            print(f"   Progreso: {idx}/{total_combinations} ({idx/total_combinations*100:.1f}%)")

        # Filtrar datos para esta combinación
        mask = (df['participante'] == participant_id) & (df['ImageName'] == image_name)
        image_data = df[mask]

        if len(image_data) == 0:
            continue

        # Extraer puntos de gaze
        fixations = list(zip(image_data['pixelX'].values, image_data['pixelY'].values))

        # Generar heatmap
        heatmap = generate_heatmap(fixations, img_width=800, img_height=600, sigma=24)

        # Calcular métricas
        saliency_coverage, _ = calculate_saliency_coverage(heatmap)
        stationary_entropy = calculate_stationary_entropy(heatmap)

        # Obtener score de la imagen
        score = 0.0
        if str(image_name) in scores_data:
            score_entries = scores_data[str(image_name)].get('score_participant', [])
            for entry in score_entries:
                if entry['participant'] == participant_id:
                    score = entry.get('score', 0.0)
                    break

        # Guardar resultado
        results.append({
            'participante': int(participant_id),
            'ImageName': int(image_name),
            'score': float(score),
            'saliency_coverage': float(saliency_coverage),
            'stationary_entropy': float(stationary_entropy),
            'gaze_points_count': len(image_data)
        })

    print(f"  Completado: {len(results)} combinaciones procesadas")

    # Guardar resultados
    print(f"\n4. Guardando resultados en {output_path}...")
    results_df = pd.DataFrame(results)
    results_df.to_csv(output_path, index=False)
    print(f"  Archivo guardado exitosamente")

    # Estadísticas
    print("\n5. Estadísticas:")
    print(f"   - Total de registros: {len(results_df)}")
    print(f"   - Participantes únicos: {results_df['participante'].nunique()}")
    print(f"   - Imágenes únicas: {results_df['ImageName'].nunique()}")
    print(f"   - Coverage promedio: {results_df['saliency_coverage'].mean():.2f}%")
    print(f"   - Entropy promedio: {results_df['stationary_entropy'].mean():.2f}")

    print("\n" + "=" * 80)
    print("PRE-CÁLCULO COMPLETADO EXITOSAMENTE")
    print("=" * 80)

if __name__ == '__main__':
    main()
