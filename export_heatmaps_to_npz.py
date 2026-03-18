"""
Script para exportar las matrices matemáticas crudas de los heatmaps (HoloLens) en formato .npz.
Genera una matriz binaria (fijaciones exactas, = 1.0) y una matriz continua (difuminada y normalizada, sumando a los 10 participantes).
Ideal para comparar con salidas de modelos de IA (ej. Grad-CAM) usando métricas como SIM, CC, NSS, IoU.

Uso:
    python export_heatmaps_to_npz.py
"""

import os
import json
import argparse
import numpy as np
import pandas as pd
from scipy.ndimage import gaussian_filter

# --- Rutas ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE_DIR, 'static', 'data', 'df_final1.csv')
JSON_PATH = os.path.join(BASE_DIR, 'static', 'data', 'data_hololens.json')

# Ruta de salida para los NPZ
OUTPUT_DIR = os.path.join(BASE_DIR, 'static', 'data', 'matriz_npz')

# --- Parámetros por defecto ---
DATA_SPACE_W = 800
DATA_SPACE_H = 600
DEFAULT_SIGMA = 24  


def load_valid_participants(json_path):
    """Carga los participantes válidos por imagen desde data_hololens.json."""
    with open(json_path, 'r') as f:
        data = json.load(f)
    valid = {}
    for img_id, info in data.items():
        participants = [p['participant'] for p in info.get('score_participant', [])]
        valid[int(img_id)] = participants
    return valid


def generate_and_save_npz(image_id, df, valid_participants, sigma, output_dir, width=DATA_SPACE_W, height=DATA_SPACE_H):
    """Filtra los datos, genera los mapas 2D (binario y continuo) y los guarda en un archivo .npz."""
    
    # Filtrar participantes válidos para esta imagen
    valid_p = valid_participants.get(image_id, [])
    if not valid_p:
        print(f"  [SKIP] Imagen {image_id}: sin participantes válidos")
        return False

    # Filtrar el dataframe por imagen y participantes
    df_img = df[(df['ImageName'] == image_id) & (df['participante'].isin(valid_p))]
    if df_img.empty:
        print(f"  [SKIP] Imagen {image_id}: sin datos de gaze")
        return False

    # Filtrar puntos válidos
    mask = df_img['pixelX'].notna() & df_img['pixelY'].notna()
    points_x = df_img.loc[mask, 'pixelX'].values
    points_y = df_img.loc[mask, 'pixelY'].values

    if len(points_x) == 0:
        print(f"  [SKIP] Imagen {image_id}: sin puntos válidos")
        return False

    # 1. Crear matrices base de ceros
    heatmap_raw = np.zeros((height, width), dtype=np.float64)     # Para sumar (densidad)
    heatmap_binary = np.zeros((height, width), dtype=np.float64)  # Para binario estricto

    # 2. Poblar con los puntos exactos
    for x, y in zip(points_x, points_y):
        py = int(height - y)  # Invertir Y para igualar sistema de coordenadas de imagen digital
        px = int(x)
        if 0 <= px < width and 0 <= py < height:
            # ACUMULACIÓN: Sumamos +1 por cada persona que miró este píxel exacto
            heatmap_raw[py, px] += 1.0  
            
            # BINARIO: Solo marcamos que "alguien" miró aquí (sin importar cuántos)
            heatmap_binary[py, px] = 1.0

    # 3. Aplicar el suavizado al mapa sumado (Mapa Continuo)
    heatmap_smooth = gaussian_filter(heatmap_raw, sigma=sigma)

    # 4. Normalizar el mapa continuo a rango [0, 1]
    max_val = heatmap_smooth.max()
    if max_val > 0:
        heatmap_smooth /= max_val

    # 5. Guardar en formato comprimido de NumPy (.npz)
    npz_path = os.path.join(output_dir, f'mapas_hololens_img_{image_id}.npz')
    np.savez_compressed(npz_path, binario=heatmap_binary, continuo=heatmap_smooth)

    return True


def main():
    parser = argparse.ArgumentParser(description='Exportar matrices crudas de heatmaps en formato .npz')
    parser.add_argument('--sigma', type=float, default=DEFAULT_SIGMA,
                        help=f'Sigma del blur gaussiano (default: {DEFAULT_SIGMA})')
    args = parser.parse_args()

    # Crear carpeta de salida si no existe
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("Cargando datos crudos...")
    df = pd.read_csv(CSV_PATH)
    valid_participants = load_valid_participants(JSON_PATH)

    image_ids = list(range(150)) # Procesar las 150 imágenes

    print(f"Parámetros: sigma={args.sigma}, dimensión={DATA_SPACE_W}x{DATA_SPACE_H}")
    print(f"Directorio de salida: {OUTPUT_DIR}")
    print("-" * 60)

    success = 0
    for i, img_id in enumerate(image_ids):
        print(f"  [{i+1}/{len(image_ids)}] Generando NPZ para Imagen {img_id}...", end=' ')
        ok = generate_and_save_npz(img_id, df, valid_participants, args.sigma, OUTPUT_DIR)
        if ok:
            success += 1
            print("OK")

    print("-" * 60)
    print(f"Listo: {success}/{len(image_ids)} matrices NPZ exportadas exitosamente en la carpeta {OUTPUT_DIR}.")


if __name__ == '__main__':
    main()