"""Palette learned from a client's posts, and the ink-on-ground pairs observed inside text boxes.

Colours are grouped in 32-step RGB bins, weighted by pixel area across every post, and bins within RGB distance 28 are merged.
Each swatch's hex is the mean colour of the pixels it holds, so a flat navy ground reads back as its exact value.
Roles: `ground` is the largest-area colour, `ink` the colour of highest contrast against the ground (restricted to colours seen
inside text boxes when they are given), `accent` the most saturated remaining colour above 2% share, everything else `other`.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from design_engine.measure.image import Box, contrast, crop, rel_lum

BIN = 32  # quantisation step per channel
MERGE_DISTANCE = 28.0  # RGB euclidean distance within which two bins are one colour
ACCENT_MIN_SHARE = 0.02
INK_MIN_DEVIATION = 0.05  # a text box whose brightest departure from its median luminance is below this holds no ink


@dataclass(frozen=True)
class Swatch:
    hex: str
    share: float
    role: str


@dataclass(frozen=True)
class Pair:
    ink_hex: str
    ground_hex: str
    contrast: float
    box: Box


def _hex(rgb) -> str:
    r, g, b = [int(min(255, max(0, round(float(v))))) for v in rgb]
    return f"#{r:02x}{g:02x}{b:02x}"


def _bin_stats(arr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Pixel count and summed RGB per 32-step bin (512 bins) for one array."""
    px = arr.reshape(-1, 3)
    q = px // BIN
    idx = (q[:, 0] * 64 + q[:, 1] * 8 + q[:, 2]).astype(np.int64)
    counts = np.bincount(idx, minlength=512).astype(np.float64)
    sums = np.stack([np.bincount(idx, weights=px[:, c].astype(np.float64), minlength=512) for c in range(3)], axis=1)
    return counts, sums


def _clusters(arrays: list[np.ndarray]) -> list[tuple[np.ndarray, float]]:
    """Merged colours as (mean rgb, share of all pixels), largest share first."""
    counts = np.zeros(512)
    sums = np.zeros((512, 3))
    total = 0
    for arr in arrays:
        a = np.asarray(arr)[..., :3]
        c, s = _bin_stats(a)
        counts += c
        sums += s
        total += a.shape[0] * a.shape[1]
    if total == 0:
        return []
    order = np.argsort(-counts)
    merged: list[list] = []  # [sum rgb, count]
    for i in order:
        if counts[i] == 0:
            break
        mean = sums[i] / counts[i]
        for m in merged:
            if np.linalg.norm(m[0] / m[1] - mean) <= MERGE_DISTANCE:
                m[0] = m[0] + sums[i]
                m[1] = m[1] + counts[i]
                break
        else:
            merged.append([sums[i].copy(), counts[i]])
    merged.sort(key=lambda m: -m[1])
    return [(m[0] / m[1], m[1] / total) for m in merged]


def _saturation(rgb) -> float:
    hi, lo = float(max(rgb)), float(min(rgb))
    return (hi - lo) / hi if hi > 0 else 0.0


def _seen_in_boxes(arrays: list[np.ndarray], text_boxes: list[list[Box]] | None) -> list[np.ndarray] | None:
    if text_boxes is None:
        return None
    crops = []
    for arr, boxes in zip(arrays, text_boxes):
        for box in boxes:
            c = crop(np.asarray(arr)[..., :3], box)
            if c is not None:
                crops.append(c)
    return crops


def palette(post_arrays: list[np.ndarray], max_colours: int = 8, text_boxes: list[list[Box]] | None = None) -> list[Swatch]:
    """The client's colours with their area shares and roles. `text_boxes`, when given, is one list of boxes per post and
    limits the ink candidates to colours that appear inside them."""
    clusters = _clusters(post_arrays)[:max_colours]
    if not clusters:
        return []
    ground_rgb, _ = clusters[0]
    ground_lum = float(rel_lum(ground_rgb))
    roles = ["other"] * len(clusters)
    roles[0] = "ground"

    inside = _seen_in_boxes(post_arrays, text_boxes)
    inside_clusters = None
    if inside:
        inside_clusters = _clusters(inside)

    def seen(rgb) -> bool:
        if inside_clusters is None:
            return True
        return any(np.linalg.norm(c - rgb) <= MERGE_DISTANCE and share >= 0.005 for c, share in inside_clusters)

    ink_i, ink_c = None, 0.0
    for i, (rgb, _) in enumerate(clusters[1:], start=1):
        if not seen(rgb):
            continue
        c = contrast(float(rel_lum(rgb)), ground_lum)
        if c > ink_c:
            ink_i, ink_c = i, c
    if ink_i is not None:
        roles[ink_i] = "ink"

    accent_i, accent_s = None, -1.0
    for i, (rgb, share) in enumerate(clusters):
        if roles[i] != "other" or share < ACCENT_MIN_SHARE:
            continue
        s = _saturation(rgb)
        if s > accent_s:
            accent_i, accent_s = i, s
    if accent_i is not None:
        roles[accent_i] = "accent"

    return [Swatch(_hex(rgb), float(share), role) for (rgb, share), role in zip(clusters, roles)]


def observed_pairs(arr: np.ndarray, text_boxes: list[Box]) -> list[Pair]:
    """For every text box, the ink colour and the ground it sits on. The box is read with a margin of half its height so the ground
    shows even when the box hugs a solid block; pixels are split by their luminance deviation from the median: those past the midpoint
    of the largest deviation are ink (the minority far from the median), the ground is the per-channel median of the rest."""
    a = np.asarray(arr)[..., :3]
    pairs: list[Pair] = []
    for box in text_boxes:
        x, y, w, h = [float(v) for v in box]
        pad = h / 2
        region = crop(a, [x - pad, y - pad, w + 2 * pad, h + 2 * pad])
        if region is None or region.size == 0:
            continue
        px = region.reshape(-1, 3)
        lum = rel_lum(px)
        dev = np.abs(lum - np.median(lum))
        top = float(dev.max())
        if top < INK_MIN_DEVIATION:
            continue
        ink = dev > top / 2
        if not ink.any() or ink.all():
            continue
        ink_rgb = np.median(px[ink], axis=0)
        ground_rgb = np.median(px[~ink], axis=0)
        c = contrast(float(rel_lum(ink_rgb)), float(rel_lum(ground_rgb)))
        pairs.append(Pair(_hex(ink_rgb), _hex(ground_rgb), float(c), list(box)))
    return pairs
