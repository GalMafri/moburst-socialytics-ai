"""Logo finder. Port of find_logo_height (reference agent, read only), extended to keep the best window and return its box."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from .image import Box, rel_lum

NEAR_EQUAL_SCORE = 0.05  # two templates within this score both match; the one covering more of the post is the evidence
SCALES = (0.03, 0.04, 0.05, 0.06, 0.075, 0.09, 0.11, 0.13, 0.16)


def _ink_bbox(path, ground: int) -> tuple[np.ndarray, tuple[int, int, int, int] | None]:
    """The file's luminance composited on a flat ground, and the bbox (x, y, w, h) of what reads as ink on that ground."""
    lg = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", lg.size, (ground, ground, ground, 255))
    bg.alpha_composite(lg)
    # the same luminance mapping the frame search uses (rel_lum), so a coloured mark keeps the same tone in both
    g = (rel_lum(np.asarray(bg.convert("RGB"))) * 255).astype(np.uint8)
    ground_l = int(round(float(rel_lum(np.array([ground, ground, ground])) * 255)))
    ink = np.abs(g.astype(np.int16) - ground_l) > 8
    ys, xs = np.where(ink)
    if ys.size == 0:
        return g, None
    return g, (int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))


def logo_gray_from_file(path, ground: int = 255) -> np.ndarray:
    """Alpha composited on a flat ground (white by default, as the reference does), trimmed to ink."""
    g, bb = _ink_bbox(path, ground)
    if bb is None:
        return g
    x, y, w, h = bb
    return g[y : y + h, x : x + w]


@dataclass(frozen=True)
class LogoTemplate:
    """One polarity of a logo file: the ink that survives on that ground, and where that ink sits inside the file's whole lockup.
    A wordmark in white vanishes on a white ground and leaves the mark alone; a match of the mark alone still names the whole
    lockup's footprint, because that is what the composer draws and what the posts carry around the mark."""

    name: str  # on_light | on_dark
    gray: np.ndarray
    dx: int = 0  # offset of this template's ink inside the full lockup extent, file pixels
    dy: int = 0
    full_w: int = 0  # the full lockup extent (union of both polarities' ink), file pixels; 0 = this template is the whole lockup
    full_h: int = 0


def file_ground(path) -> str | None:
    """The ground a logo file is drawn for, from its own ink: the polarity on which more of its ink survives. A file whose wordmark is
    white loses it on white, so it reads on dark. None when both polarities keep the same ink (a single-colour mark)."""
    _, on_light = _ink_bbox(path, 255)
    _, on_dark = _ink_bbox(path, 0)
    if on_light is None or on_dark is None:
        return "dark" if on_light is None and on_dark else "light" if on_dark is None and on_light else None
    a_light, a_dark = on_light[2] * on_light[3], on_dark[2] * on_dark[3]
    if abs(a_light - a_dark) <= 0.05 * max(a_light, a_dark):
        return None
    return "light" if a_light > a_dark else "dark"


def ink_extent(path) -> tuple[int, int, int, int] | None:
    """The file's full ink extent (x, y, w, h): the union of what reads on white and on black, so a white wordmark counts."""
    _, on_light = _ink_bbox(path, 255)
    _, on_dark = _ink_bbox(path, 0)
    boxes = [b for b in (on_light, on_dark) if b is not None]
    if not boxes:
        return None
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[0] + b[2] for b in boxes), max(b[1] + b[3] for b in boxes)
    return x0, y0, x1 - x0, y1 - y0


def ink_aspect(path) -> float | None:
    ext = ink_extent(path)
    return (ext[2] / ext[3]) if ext and ext[3] > 0 else None


def trim_to_ink(path, out, pad: int = 0, min_change: float = 0.05) -> Path | None:
    """The file cropped to its ink extent, written to `out`: the client's own pixels without the transparent padding a site export
    carries (one lockup arrived 1600 px wide with 267 px of ink, and drawn as-is it fills a slot with nothing). None when the file is
    already within `min_change` of its ink extent; then the original is the asset."""
    ext = ink_extent(path)
    if ext is None:
        return None
    lg = Image.open(path).convert("RGBA")
    x, y, w, h = ext
    if w * h >= (1 - min_change) * lg.width * lg.height:
        return None
    box = (max(0, x - pad), max(0, y - pad), min(lg.width, x + w + pad), min(lg.height, y + h + pad))
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    lg.crop(box).save(out)
    return out


def logo_templates_from_file(path) -> list[LogoTemplate]:
    """The lockup composited on a light and on a dark ground. Normalised correlation is polarity-sensitive: a white wordmark
    vanishes on white and a red mark reads darker than white but lighter than navy, so one template cannot serve both grounds.
    Each template records where its ink sits inside the full lockup extent, so a mark-only match reports the lockup's footprint."""
    g_l, bb_l = _ink_bbox(path, 255)
    g_d, bb_d = _ink_bbox(path, 0)
    boxes = [b for b in (bb_l, bb_d) if b is not None]
    if not boxes:
        return [LogoTemplate("on_light", g_l), LogoTemplate("on_dark", g_d)]
    fx0, fy0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    fx1, fy1 = max(b[0] + b[2] for b in boxes), max(b[1] + b[3] for b in boxes)
    out = []
    for name, g, bb in (("on_light", g_l, bb_l), ("on_dark", g_d, bb_d)):
        if bb is None:
            out.append(LogoTemplate(name, g))
            continue
        x, y, w, h = bb
        out.append(LogoTemplate(name, g[y : y + h, x : x + w], x - fx0, y - fy0, fx1 - fx0, fy1 - fy0))
    return out


@dataclass(frozen=True)
class LogoMatch:
    score: float
    box: Box  # full-resolution pixels [x, y, w, h]
    height_share: float
    variant: str = "unknown"
    match_box: Box | None = None  # the region the template itself matched when `box` was extended to the lockup's footprint


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
    from skimage.feature import match_template

    lum64 = lum.astype(np.float64)  # match_template must run in float64: float32 returns scores above 1
    for share in SCALES:
        th_ = max(6, int(short_edge * scale_img * share))
        tw_ = max(6, int(lw0 * th_ / lh0))
        if th_ >= H or tw_ >= W:
            continue
        t = np.asarray(Image.fromarray(logo_gray.astype(np.uint8)).resize((tw_, th_))).astype(np.float64)
        if t.std() < 1e-6:
            continue
        # the same normalised cross-correlation as the reference's window loop, over every position instead of a stride
        corr = match_template(lum64, t)
        if corr.size == 0:
            continue
        idx = int(np.argmax(corr))
        c = float(corr.flat[idx])
        if c > best:
            y, x = np.unravel_index(idx, corr.shape)
            best, best_box = c, (int(x), int(y), tw_, th_)
    if best_box is None or not np.isfinite(best):
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


def _as_template(t) -> LogoTemplate:
    return t if isinstance(t, LogoTemplate) else LogoTemplate(str(t[0]), t[1])


def find_logo_any(arr: np.ndarray, templates: list, short_edge: int, min_score: float = 0.62) -> LogoMatch | None:
    """Best match across the light-ground and dark-ground templates; `variant` names the ground the lockup was found on.
    `box` is the full lockup's footprint at the matched scale (a mark-only template is extended to its file's lockup extent, clipped
    to the frame); `match_box` is the region the template itself matched. Templates are LogoTemplates or (name, gray) pairs."""
    found: list[LogoMatch] = []
    H, W = arr.shape[:2]
    for t in (_as_template(x) for x in templates):
        if t.gray.std() < 1.0:
            continue
        m = find_logo(arr, t.gray, short_edge, min_score)
        if not m:
            continue
        box = list(m.box)
        if t.full_w and t.full_h and t.gray.shape[1]:
            s = m.box[2] / t.gray.shape[1]
            x0, y0 = m.box[0] - t.dx * s, m.box[1] - t.dy * s
            x1, y1 = x0 + t.full_w * s, y0 + t.full_h * s
            x0, y0, x1, y1 = max(0.0, x0), max(0.0, y0), min(float(W), x1), min(float(H), y1)
            box = [x0, y0, x1 - x0, y1 - y0]
        found.append(LogoMatch(m.score, box, m.height_share, t.name, list(m.box)))
    if not found:
        return None
    # a lockup template that matches explains more of the post than its mark alone: among near-equal scores the larger match wins
    top = max(f.score for f in found)
    close = [f for f in found if f.score >= top - NEAR_EQUAL_SCORE]
    return max(close, key=lambda f: ((f.match_box or f.box)[2] * (f.match_box or f.box)[3], f.score))
