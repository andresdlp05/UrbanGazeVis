"""
Precalcula overlays base globales (heatmap + contour) por imagen.

Uso:
    python precalculate_overlays.py
"""

import os
import sys
from datetime import datetime

sys.path.append(os.path.dirname(__file__))

from app.services.overlay_precompute_service import get_overlay_precompute_service
from app.shared.ivt_cache_service import get_ivt_cache_service


def main():
    print("PRECALCULANDO OVERLAYS GLOBALES (HEATMAP + CONTOUR)")
    print("=" * 70)

    cache_svc = get_ivt_cache_service()
    overlay_svc = get_overlay_precompute_service()
    overlay_svc.configure_sources(cache_svc.gaze_data_by_image, cache_svc.ivt_cache_by_image)

    image_ids = sorted(
        set(cache_svc.gaze_data_by_image.keys()) | set(cache_svc.ivt_cache_by_image.keys())
    )
    if not image_ids:
        print("ERROR: No se encontraron imagenes para precalcular.")
        return 1

    print(f"Imagenes detectadas: {len(image_ids)}")
    print(f"Rango: {image_ids[0]} - {image_ids[-1]}")
    print()

    started_at = datetime.now()
    generated = 0
    reused = 0
    failed = 0
    total_jobs = len(image_ids) * 2
    processed = 0

    for data_type in ("gaze", "fixations"):
        print(f"[{data_type}]")
        for image_id in image_ids:
            processed += 1
            try:
                result = overlay_svc.generate_for_image(image_id, data_type=data_type, force=False)
                if result.get("generated"):
                    generated += 1
                    status = "GEN"
                else:
                    reused += 1
                    status = "CACHE"
                print(f"  {processed:4d}/{total_jobs}: image={image_id:3d} [{status}]")
            except Exception as exc:
                failed += 1
                print(f"  {processed:4d}/{total_jobs}: image={image_id:3d} [ERROR] {exc}")
        print()

    elapsed = (datetime.now() - started_at).total_seconds()
    print("=" * 70)
    print("PRECALCULO COMPLETADO")
    print(f"  Jobs totales : {total_jobs}")
    print(f"  Generados    : {generated}")
    print(f"  En cache     : {reused}")
    print(f"  Fallidos     : {failed}")
    print(f"  Tiempo total : {elapsed:.1f}s")
    print("=" * 70)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
