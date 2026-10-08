"""Ports of measure_qa.empty_bands and measure_qa.largest_free_rect (reference agent, read only), plus content_span."""
from __future__ import annotations

import numpy as np

from .image import Box, rel_lum


def empty_bands(arr: np.ndarray, boxes: list[Box], thresh: float = 0.012) -> tuple[float, float]:
    """Port of measure_qa.empty_bands: longest run of near-flat rows at the top and bottom that no box touches, as a share of height."""
    lum = rel_lum(arr)
    H = lum.shape[0]
    row_std = lum.std(axis=1)
    covered = np.zeros(H, dtype=bool)
    for b in boxes:
        if b:
            y0, y1 = max(0, int(b[1])), min(H, int(b[1] + b[3]))
            covered[y0:y1] = True
    flat = (row_std < thresh) & ~covered
    top = 0
    while top < H and flat[top]:
        top += 1
    bot = 0
    while bot < H and flat[H - 1 - bot]:
        bot += 1
    return top / H, bot / H


def largest_free_rect(W: int, H: int, boxes: list[Box], grid: int = 24) -> float:
    """Port of measure_qa.largest_free_rect: largest axis-aligned rectangle (share of the frame) touching no box, on a grid x grid raster."""
    cov = [[False] * grid for _ in range(grid)]
    for b in boxes:
        x0, y0 = int(b[0] / W * grid), int(b[1] / H * grid)
        x1, y1 = int((b[0] + b[2]) / W * grid + 0.999), int((b[1] + b[3]) / H * grid + 0.999)
        for gy in range(max(0, y0), min(grid, y1)):
            for gx in range(max(0, x0), min(grid, x1)):
                cov[gy][gx] = True
    best = 0
    heights = [0] * grid
    for gy in range(grid):
        for gx in range(grid):
            heights[gx] = 0 if cov[gy][gx] else heights[gx] + 1
        stack: list[tuple[int, int]] = []
        for gx in range(grid + 1):
            h = heights[gx] if gx < grid else 0
            start = gx
            while stack and stack[-1][1] >= h:
                idx, sh = stack.pop()
                best = max(best, sh * (gx - idx))
                start = idx
            stack.append((start, h))
    return best / (grid * grid)


def content_span(boxes: list[Box], H: int, safe_box: Box | None = None) -> float:
    """Vertical extent from the topmost box edge to the bottommost, as a share of the frame (or of the safe box) height."""
    boxes = [b for b in boxes if b]
    if not boxes:
        return 0.0
    top = min(b[1] for b in boxes)
    bot = max(b[1] + b[3] for b in boxes)
    ref_h = safe_box[3] if safe_box else H
    return (bot - top) / ref_h
