"""Image basics shared by every measurement. Ports of measure_qa.rel_lum, contrast and crop (reference agent, read only)."""
from __future__ import annotations

import numpy as np
from PIL import Image

Box = list[float]  # [x, y, w, h] in pixels


def load_rgb(path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"))


def rel_lum(rgb) -> np.ndarray:
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def contrast(l1: float, l2: float) -> float:
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def crop(arr: np.ndarray, box: Box):
    x, y, w, h = [round(v) for v in box]
    H, W = arr.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return None
    return arr[y0:y1, x0:x1]
