import os
from typing import Dict, Any, Tuple

import cv2
import numpy as np
import pandas as pd
from scipy.ndimage import gaussian_filter

from app.shared.logging_utils import debug_log, error_log


class OverlayPrecomputeService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self.gaze_data_by_image = {}
        self.ivt_cache_by_image = {}
        self.base_dir = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..",
            "..",
            "static",
            "cache",
            "overlays",
        )
        self.width = 800
        self.height = 600

    def configure_sources(self, gaze_data_by_image, ivt_cache_by_image):
        self.gaze_data_by_image = gaze_data_by_image or {}
        self.ivt_cache_by_image = ivt_cache_by_image or {}

    def _paths(self, image_id: int, data_type: str) -> Tuple[str, str]:
        data_type = "fixations" if data_type == "fixations" else "gaze"
        heatmap_dir = os.path.join(self.base_dir, "heatmap", data_type)
        contour_dir = os.path.join(self.base_dir, "contour", data_type)
        os.makedirs(heatmap_dir, exist_ok=True)
        os.makedirs(contour_dir, exist_ok=True)
        heatmap_path = os.path.join(heatmap_dir, f"image_{int(image_id)}.png")
        contour_path = os.path.join(contour_dir, f"image_{int(image_id)}.png")
        return heatmap_path, contour_path

    def _urls(self, image_id: int, data_type: str, heatmap_path: str, contour_path: str) -> Dict[str, str]:
        data_type = "fixations" if data_type == "fixations" else "gaze"
        heatmap_rel = f"/static/cache/overlays/heatmap/{data_type}/image_{int(image_id)}.png?v={int(os.path.getmtime(heatmap_path))}"
        contour_rel = f"/static/cache/overlays/contour/{data_type}/image_{int(image_id)}.png?v={int(os.path.getmtime(contour_path))}"
        return {"heatmap_url": heatmap_rel, "contour_url": contour_rel}

    def _extract_points(self, image_id: int, data_type: str) -> np.ndarray:
        if data_type == "fixations":
            df = self.ivt_cache_by_image.get(int(image_id))
            if df is None or len(df) == 0:
                return np.empty((0, 2), dtype=np.float32)
            x = pd.to_numeric(df.get("x_centroid"), errors="coerce")
            y = pd.to_numeric(df.get("y_centroid"), errors="coerce")
        else:
            df = self.gaze_data_by_image.get(int(image_id))
            if df is None or len(df) == 0:
                return np.empty((0, 2), dtype=np.float32)
            x = pd.to_numeric(df.get("pixelX"), errors="coerce")
            y = pd.to_numeric(df.get("pixelY"), errors="coerce")

        valid = x.notna() & y.notna()
        if not valid.any():
            return np.empty((0, 2), dtype=np.float32)

        x_vals = x[valid].to_numpy(dtype=np.float32)
        y_vals = y[valid].to_numpy(dtype=np.float32)

        # Data space uses Y origin at bottom; convert to image coords (top origin)
        y_vals = self.height - y_vals
        in_bounds = (
            (x_vals >= 0)
            & (x_vals < self.width)
            & (y_vals >= 0)
            & (y_vals < self.height)
        )
        if not np.any(in_bounds):
            return np.empty((0, 2), dtype=np.float32)

        return np.column_stack([x_vals[in_bounds], y_vals[in_bounds]]).astype(np.float32)

    def _build_density(self, points: np.ndarray) -> np.ndarray:
        heat = np.zeros((self.height, self.width), dtype=np.float32)
        if points.size == 0:
            return heat
        xi = np.clip(np.round(points[:, 0]).astype(np.int32), 0, self.width - 1)
        yi = np.clip(np.round(points[:, 1]).astype(np.int32), 0, self.height - 1)
        np.add.at(heat, (yi, xi), 1.0)
        return gaussian_filter(heat, sigma=24)

    def _heatmap_rgba(self, density: np.ndarray) -> np.ndarray:
        max_value = float(np.max(density)) if density.size else 0.0
        rgba = np.zeros((self.height, self.width, 4), dtype=np.uint8)
        if max_value <= 0:
            return rgba

        values = np.clip(density / max_value, 0.0, 1.0)
        threshold = 0.08
        active = values >= threshold
        if not np.any(active):
            return rgba

        remapped = np.zeros_like(values, dtype=np.float32)
        remapped[active] = (values[active] - threshold) / (1.0 - threshold)
        v = remapped

        r = np.zeros_like(v, dtype=np.float32)
        g = np.zeros_like(v, dtype=np.float32)
        b = np.zeros_like(v, dtype=np.float32)

        m1 = v < 0.125
        b[m1] = 0.5 + (v[m1] / 0.125) * 0.5

        m2 = (v >= 0.125) & (v < 0.375)
        g[m2] = (v[m2] - 0.125) / 0.25
        b[m2] = 1.0

        m3 = (v >= 0.375) & (v < 0.625)
        r[m3] = (v[m3] - 0.375) / 0.25
        g[m3] = 1.0
        b[m3] = 1.0 - ((v[m3] - 0.375) / 0.25)

        m4 = (v >= 0.625) & (v < 0.875)
        r[m4] = 1.0
        g[m4] = 1.0 - ((v[m4] - 0.625) / 0.25)

        m5 = v >= 0.875
        r[m5] = 1.0 - ((v[m5] - 0.875) / 0.125) * 0.5

        alpha = np.zeros_like(v, dtype=np.float32)
        alpha[active] = 0.3 + (v[active] * 0.4)

        rgba[..., 0] = np.round(r * 255.0).astype(np.uint8)
        rgba[..., 1] = np.round(g * 255.0).astype(np.uint8)
        rgba[..., 2] = np.round(b * 255.0).astype(np.uint8)
        rgba[..., 3] = np.round(alpha * 255.0).astype(np.uint8)
        return rgba

    def _contour_rgba(self, density: np.ndarray, data_type: str) -> np.ndarray:
        canvas_rgb = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        canvas_alpha = np.zeros((self.height, self.width), dtype=np.uint8)
        max_value = float(np.max(density)) if density.size else 0.0
        if max_value <= 0:
            return np.dstack([canvas_rgb, canvas_alpha])

        norm = np.clip(density / max_value, 0.0, 1.0)
        levels = np.linspace(0.12, 0.92, 10)
        color = (255, 0, 0) if data_type == "gaze" else (255, 165, 0)
        alpha = int(0.8 * 255)

        for level in levels:
            binary = (norm >= level).astype(np.uint8) * 255
            contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
            if not contours:
                continue
            cv2.polylines(canvas_rgb, contours, True, color, 2, lineType=cv2.LINE_AA)
            cv2.polylines(canvas_alpha, contours, True, alpha, 2, lineType=cv2.LINE_AA)

        return np.dstack([canvas_rgb, canvas_alpha])

    @staticmethod
    def _write_rgba_png(path: str, rgba: np.ndarray):
        bgra = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA)
        cv2.imwrite(path, bgra)

    def generate_for_image(self, image_id: int, data_type: str = "gaze", force: bool = False) -> Dict[str, Any]:
        data_type = "fixations" if data_type == "fixations" else "gaze"
        heatmap_path, contour_path = self._paths(image_id, data_type)

        if (not force) and os.path.exists(heatmap_path) and os.path.exists(contour_path):
            return {"generated": False, **self._urls(image_id, data_type, heatmap_path, contour_path)}

        points = self._extract_points(image_id, data_type)
        density = self._build_density(points)
        heatmap_rgba = self._heatmap_rgba(density)
        contour_rgba = self._contour_rgba(density, data_type)

        self._write_rgba_png(heatmap_path, heatmap_rgba)
        self._write_rgba_png(contour_path, contour_rgba)
        debug_log(f"OverlayPrecompute: generated overlays image={image_id}, data_type={data_type}, points={len(points)}")
        return {"generated": True, **self._urls(image_id, data_type, heatmap_path, contour_path)}


_overlay_precompute_service = None


def get_overlay_precompute_service() -> OverlayPrecomputeService:
    global _overlay_precompute_service
    if _overlay_precompute_service is None:
        _overlay_precompute_service = OverlayPrecomputeService()
    return _overlay_precompute_service
