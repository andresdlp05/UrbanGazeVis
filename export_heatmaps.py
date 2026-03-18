"""
Script para exportar heatmaps overlay (JET colormap) de todas las imágenes.
Replica el comportamiento del frontend (drawHeatmapOverlay en main2.js).

Uso:
    python export_heatmaps.py                  # Exporta las 150 imágenes
    python export_heatmaps.py --images 0 5 10  # Solo imágenes específicas
    python export_heatmaps.py --sigma 35       # Cambiar sigma del blur
    python export_heatmaps.py --data-type fixations  # Usar fijaciones en vez de gaze
"""

import os
import json
import argparse
import numpy as np
import pandas as pd
from scipy.ndimage import gaussian_filter
from PIL import Image
import matplotlib.cm as cm
import matplotlib.colors as mcolors

# --- Rutas ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE_DIR, 'static', 'data', 'df_final1.csv')
JSON_PATH = os.path.join(BASE_DIR, 'static', 'data', 'data_hololens.json')
IMAGES_DIR = os.path.join(BASE_DIR, 'static', 'images', 'images', 'images')
OUTPUT_DIR = os.path.join(BASE_DIR, 'static', 'data', 'heatmaps_export')

# --- Parámetros por defecto (mismos que main2.js) ---
DATA_SPACE_W = 800
DATA_SPACE_H = 600
DEFAULT_SIGMA = 24        # Mismo que el frontend
THRESHOLD = 0.08          # 8% — valores menores son transparentes
ALPHA_MIN = 0.3
ALPHA_MAX = 0.7


def load_valid_participants(json_path):
    """Carga los participantes válidos por imagen desde data_hololens.json."""
    with open(json_path, 'r') as f:
        data = json.load(f)
    valid = {}
    for img_id, info in data.items():
        participants = [p['participant'] for p in info.get('score_participant', [])]
        valid[int(img_id)] = participants
    return valid


def jet_colormap_rgba(value, threshold=THRESHOLD, alpha_min=ALPHA_MIN, alpha_max=ALPHA_MAX):
    """Replica exacta de getJetColor() del frontend (main2.js:378)."""
    value = max(0.0, min(1.0, value))
    if value < threshold:
        return (0, 0, 0, 0)

    v = (value - threshold) / (1 - threshold)

    if v < 0.125:
        r, g, b = 0, 0, 0.5 + v / 0.125 * 0.5
    elif v < 0.375:
        r, g, b = 0, (v - 0.125) / 0.25, 1
    elif v < 0.625:
        r, g, b = (v - 0.375) / 0.25, 1, 1 - (v - 0.375) / 0.25
    elif v < 0.875:
        r, g, b = 1, 1 - (v - 0.625) / 0.25, 0
    else:
        r, g, b = 1 - (v - 0.875) / 0.125 * 0.5, 0, 0

    alpha = alpha_min + v * (alpha_max - alpha_min)
    return (int(r * 255), int(g * 255), int(b * 255), int(alpha * 255))


def build_jet_lut(threshold=THRESHOLD):
    """Construye una lookup table de 256 entradas para el colormap JET."""
    lut = np.zeros((256, 4), dtype=np.uint8)
    for i in range(256):
        lut[i] = jet_colormap_rgba(i / 255.0, threshold)
    return lut


def generate_heatmap_matrix(points_x, points_y, sigma, width=DATA_SPACE_W, height=DATA_SPACE_H):
    """
    Genera la matriz de heatmap gaussiano a partir de puntos.
    Replica el proceso del frontend: acumular + gaussian blur + normalizar.
    """
    heatmap = np.zeros((height, width), dtype=np.float64)

    # Acumular puntos (con Y invertido, igual que el frontend)
    for x, y in zip(points_x, points_y):
        py = int(height - y)  # Invertir Y como en main2.js
        px = int(x)
        if 0 <= px < width and 0 <= py < height:
            heatmap[py, px] += 1

    # Blur gaussiano
    heatmap = gaussian_filter(heatmap, sigma=sigma)

    # Normalizar a [0, 1]
    max_val = heatmap.max()
    if max_val > 0:
        heatmap /= max_val

    return heatmap


def heatmap_to_rgba(heatmap, lut):
    """Convierte matriz normalizada [0,1] a imagen RGBA usando la LUT JET."""
    indices = (heatmap * 255).astype(np.uint8)
    return lut[indices]


def export_heatmap(image_id, df, valid_participants, sigma, output_dir, lut):
    """Genera y guarda el heatmap overlay para una imagen."""
    # Filtrar participantes válidos
    valid_p = valid_participants.get(image_id, [])
    if not valid_p:
        print(f"  [SKIP] Imagen {image_id}: sin participantes válidos")
        return False

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

    # Generar heatmap
    heatmap = generate_heatmap_matrix(points_x, points_y, sigma)

    # Convertir a RGBA
    rgba_array = heatmap_to_rgba(heatmap, lut)
    heatmap_img = Image.fromarray(rgba_array, 'RGBA')

    # Cargar imagen base
    img_path = os.path.join(IMAGES_DIR, f'{image_id}.jpg')
    if not os.path.exists(img_path):
        print(f"  [SKIP] Imagen {image_id}: archivo no encontrado ({img_path})")
        return False

    base_img = Image.open(img_path).convert('RGBA')
    base_w, base_h = base_img.size

    # Redimensionar heatmap al tamaño de la imagen real
    heatmap_img = heatmap_img.resize((base_w, base_h), Image.LANCZOS)

    # Componer: imagen base + heatmap overlay
    combined = Image.alpha_composite(base_img, heatmap_img)

    # Guardar
    out_path = os.path.join(output_dir, f'heatmap_{image_id}.png')
    combined.save(out_path)

    # También guardar solo el heatmap (sin imagen de fondo)
    out_path_only = os.path.join(output_dir, 'solo_heatmap', f'heatmap_{image_id}.png')
    heatmap_img.save(out_path_only)

    return True


def main():
    parser = argparse.ArgumentParser(description='Exportar heatmaps overlay en lote')
    parser.add_argument('--images', nargs='+', type=int, default=None,
                        help='IDs de imágenes específicas (default: todas 0-149)')
    parser.add_argument('--sigma', type=float, default=DEFAULT_SIGMA,
                        help=f'Sigma del blur gaussiano (default: {DEFAULT_SIGMA})')
    parser.add_argument('--threshold', type=float, default=THRESHOLD,
                        help=f'Umbral de transparencia 0-1 (default: {THRESHOLD})')
    parser.add_argument('--output', type=str, default=OUTPUT_DIR,
                        help=f'Carpeta de salida (default: {OUTPUT_DIR})')
    parser.add_argument('--data-type', choices=['gaze', 'fixations'], default='gaze',
                        help='Tipo de datos: gaze o fixations (default: gaze)')
    args = parser.parse_args()

    # Crear carpetas de salida
    os.makedirs(args.output, exist_ok=True)
    os.makedirs(os.path.join(args.output, 'solo_heatmap'), exist_ok=True)

    print(f"Cargando datos...")
    df = pd.read_csv(CSV_PATH)
    valid_participants = load_valid_participants(JSON_PATH)

    # Determinar imágenes a procesar
    image_ids = args.images if args.images else list(range(150))

    # Construir LUT del colormap JET
    lut = build_jet_lut(args.threshold)

    print(f"Parámetros: sigma={args.sigma}, threshold={args.threshold}, data_type={args.data_type}")
    print(f"Exportando {len(image_ids)} imágenes a: {args.output}")
    print("-" * 60)

    success = 0
    for i, img_id in enumerate(image_ids):
        print(f"  [{i+1}/{len(image_ids)}] Imagen {img_id}...", end=' ')
        ok = export_heatmap(img_id, df, valid_participants, args.sigma, args.output, lut)
        if ok:
            success += 1
            print("OK")

    print("-" * 60)
    print(f"Listo: {success}/{len(image_ids)} imágenes exportadas en {args.output}")


if __name__ == '__main__':
    main()