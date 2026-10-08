"""Ports of measure_qa.ink_vs_ground and measure_qa.busy_ground (reference agent, read only)."""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter

from .image import contrast, rel_lum


def ink_vs_ground(region: np.ndarray) -> float | None:
    """Port of measure_qa.ink_vs_ground: contrast between the marks and their ground, measured inside the padding."""
    lum_full = rel_lum(region)
    if lum_full.size < 50:
        return None
    med = float(np.median(lum_full))
    diff = np.abs(lum_full - med) > 0.08
    ys, xs = np.where(diff)
    lum = lum_full[ys.min():ys.max() + 1, xs.min():xs.max() + 1].ravel() if ys.size >= 20 else lum_full.ravel()
    if lum.size < 50:
        return None
    lo, hi = np.percentile(lum, 12), np.percentile(lum, 88)
    return contrast(hi, lo)


def busy_ground(region: np.ndarray) -> float:
    """Port of measure_qa.busy_ground: luminance spread of the ground once the type itself is blurred away."""
    im = Image.fromarray(region.astype(np.uint8)).filter(ImageFilter.MedianFilter(9)).filter(ImageFilter.GaussianBlur(6))
    lum = rel_lum(np.asarray(im)).ravel()
    if lum.size < 50:
        return float(lum.std())
    dev = np.abs(lum - np.median(lum))
    return float(lum[dev <= np.percentile(dev, 70)].std())
