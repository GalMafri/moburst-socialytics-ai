"""Logo finder. Port of find_logo_height (reference agent, read only), extended to keep the best window and return its box."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

from .image import Box, rel_lum

SCALES = (0.03, 0.04, 0.05, 0.06, 0.075, 0.09, 0.11, 0.13, 0.16)


def logo_gray_from_file(path, ground: int = 255) -> np.ndarray:
    """Alpha composited on a flat ground (white by default, as the reference does), trimmed to ink."""
    lg = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", lg.size, (ground, ground, ground, 255))
    bg.alpha_composite(lg)
    # the same luminance mapping the frame search uses (rel_lum), so a coloured mark keeps the same tone in both
    g = (rel_lum(np.asarray(bg.convert("RGB"))) * 255).astype(np.uint8)
    ground_l = int(round(float(rel_lum(np.array([ground, ground, ground])) * 255)))
    ink = np.abs(g.astype(np.int16) - ground_l) > 8
    ys, xs = np.where(ink)
    if ys.size == 0:
        return g
    return g[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def logo_templates_from_file(path) -> list[tuple[str, np.ndarray]]:
    """The lockup composited on a light and on a dark ground. Normalised correlation is polarity-sensitive: a white wordmark
    vanishes on white and a red mark reads darker than white but lighter than navy, so one template cannot serve both grounds."""
    return [("on_light", logo_gray_from_file(path, 255)), ("on_dark", logo_gray_from_file(path, 0))]


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
    if best_box is None:
        return None
    # Coarse-to-fine: the nine rungs are up to 12% apart in height, which alone costs a tenth of the score on an exact lockup.
    # Refine around the best rung over local scales and a one-stride neighbourhood before judging against the floor.
    x0, y0, tw0, th0 = best_box
    stride0 = max(2, th0 // 4)
    for f in (0.86, 0.9, 0.94, 0.97, 1.0, 1.03, 1.06, 1.1, 1.14):
        th_ = max(6, int(round(th0 * f)))
        tw_ = max(6, int(lw0 * th_ / lh0))
        if th_ >= H or tw_ >= W:
            continue
        t = np.asarray(Image.fromarray(logo_gray.astype(np.uint8)).resize((tw_, th_))).astype(np.float32)
        t = t - t.mean()
        tn = np.linalg.norm(t) or 1.0
        for y in range(max(0, y0 - stride0), min(H - th_, y0 + stride0) + 1):
            for x in range(max(0, x0 - stride0), min(W - tw_, x0 + stride0) + 1):
                w = lum[y : y + th_, x : x + tw_]
                w = w - w.mean()
                wn = np.linalg.norm(w) or 1.0
                c = float((w * t).sum() / (wn * tn))
                if c > best:
                    best, best_box = c, (x, y, tw_, th_)
    if best < min_score:
        return None
    x, y, tw_, th_ = best_box
    return LogoMatch(best, [x / scale_img, y / scale_img, tw_ / scale_img, th_ / scale_img], (th_ / scale_img) / short_edge)


def find_logo_any(arr: np.ndarray, templates: list[tuple[str, np.ndarray]], short_edge: int, min_score: float = 0.62) -> LogoMatch | None:
    """Best match across the light-ground and dark-ground templates; `variant` names the ground the lockup was found on."""
    best: LogoMatch | None = None
    for name, gray in templates:
        if gray.std() < 1.0:
            continue
        m = find_logo(arr, gray, short_edge, min_score)
        if m and (best is None or m.score > best.score):
            best = LogoMatch(m.score, m.box, m.height_share, name)
    return best
