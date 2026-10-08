"""Logo finder. Port of find_logo_height (reference agent, read only), extended to keep the best window and return its box."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

from .image import Box, rel_lum

SCALES = (0.03, 0.04, 0.05, 0.06, 0.075, 0.09, 0.11, 0.13, 0.16)


def logo_gray_from_file(path) -> np.ndarray:
    """Alpha composited on white, trimmed to ink."""
    lg = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", lg.size, (255, 255, 255, 255))
    bg.alpha_composite(lg)
    g = np.asarray(bg.convert("L"))
    bbox = Image.fromarray(255 - g).getbbox()
    return g[bbox[1] : bbox[3], bbox[0] : bbox[2]] if bbox else g


@dataclass(frozen=True)
class LogoMatch:
    score: float
    box: Box  # full-resolution pixels [x, y, w, h]
    height_share: float
    variant: str = "unknown"


def find_logo(arr: np.ndarray, logo_gray: np.ndarray, short_edge: int, min_score: float = 0.62) -> LogoMatch | None:
    lum = (rel_lum(arr) * 255).astype(np.float32)
    H, W = lum.shape
    scale_img = 480 / max(H, W)
    if scale_img < 1:
        lum = np.asarray(Image.fromarray(lum.astype(np.uint8)).resize((int(W * scale_img), int(H * scale_img)))).astype(np.float32)
        H, W = lum.shape
    else:
        scale_img = 1.0
    lh0, lw0 = logo_gray.shape
    best, best_box = 0.0, None
    for share in SCALES:
        th_ = max(6, int(short_edge * scale_img * share))
        tw_ = max(6, int(lw0 * th_ / lh0))
        if th_ >= H or tw_ >= W:
            continue
        t = np.asarray(Image.fromarray(logo_gray.astype(np.uint8)).resize((tw_, th_))).astype(np.float32)
        t = t - t.mean()
        tn = np.linalg.norm(t) or 1.0
        stride = max(2, th_ // 4)
        for y in range(0, H - th_, stride):
            for x in range(0, W - tw_, stride):
                w = lum[y : y + th_, x : x + tw_]
                w = w - w.mean()
                wn = np.linalg.norm(w) or 1.0
                c = float((w * t).sum() / (wn * tn))
                if c > best:
                    best, best_box = c, (x, y, tw_, th_)
    if best < min_score or best_box is None:
        return None
    x, y, tw_, th_ = best_box
    return LogoMatch(best, [x / scale_img, y / scale_img, tw_ / scale_img, th_ / scale_img], (th_ / scale_img) / short_edge)
