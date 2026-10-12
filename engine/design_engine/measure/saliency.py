"""Ports of measure_qa.saliency_map and measure_qa.largest_quiet_rect (reference agent, read only), plus quiet_rects and salient_share."""
from __future__ import annotations

import numpy as np

from .image import rel_lum

CellBox = tuple[int, int, int, int]  # cy, cx, ch, cw in cells


def saliency_map(arr: np.ndarray, cell: int = 24) -> np.ndarray:
    """Port of measure_qa.saliency_map: coarse local-contrast map, mean gradient magnitude per cell x cell block."""
    lum = rel_lum(arr)
    H, W = lum.shape
    gy, gx = np.gradient(lum)
    mag = np.hypot(gx, gy)
    cells_y, cells_x = max(1, H // cell), max(1, W // cell)
    m = np.zeros((cells_y, cells_x))
    for i in range(cells_y):
        for j in range(cells_x):
            blk = mag[i * cell:(i + 1) * cell, j * cell:(j + 1) * cell]
            m[i, j] = blk.mean() if blk.size else 0.0
    return m


def largest_quiet_rect(sal: np.ndarray, thresh: float) -> float:
    """Port of measure_qa.largest_quiet_rect: largest rectangle of low-attention cells, as a share of the frame."""
    quiet = sal < thresh
    gy, gx = quiet.shape
    best = 0
    heights = [0] * gx
    for y in range(gy):
        for x in range(gx):
            heights[x] = heights[x] + 1 if quiet[y, x] else 0
        stack: list[tuple[int, int]] = []
        for x in range(gx + 1):
            h = heights[x] if x < gx else 0
            start = x
            while stack and stack[-1][1] >= h:
                idx, sh = stack.pop()
                best = max(best, sh * (x - idx))
                start = idx
            stack.append((start, h))
    return best / (gx * gy)


def quiet_rects(sal: np.ndarray, thresh: float, min_cells: tuple[int, int] = (3, 3)) -> list[CellBox]:
    """All maximal quiet rectangles (histogram stack), largest area first; the placement engine picks among them."""
    quiet = sal < thresh
    gy, gx = quiet.shape
    found: list[tuple[int, CellBox]] = []
    heights = [0] * gx
    for y in range(gy):
        for x in range(gx):
            heights[x] = heights[x] + 1 if quiet[y, x] else 0
        stack: list[tuple[int, int]] = []
        for x in range(gx + 1):
            h = heights[x] if x < gx else 0
            start = x
            while stack and stack[-1][1] >= h:
                idx, sh = stack.pop()
                if sh >= min_cells[0] and (x - idx) >= min_cells[1]:
                    found.append((sh * (x - idx), (y - sh + 1, idx, sh, x - idx)))
                start = idx
            stack.append((start, h))
    found.sort(key=lambda t: -t[0])
    out: list[CellBox] = []
    for _, box in found:
        if not any(
            box[0] >= o[0] and box[1] >= o[1] and box[0] + box[2] <= o[0] + o[2] and box[1] + box[3] <= o[1] + o[3]
            for o in out
        ):
            out.append(box)
    return out


SUBJECT_LEVEL = 0.03  # cell saliency that counts as subject-level detail under a slot (a floor of 0.35 refuses a slot above 0.0105)
SUBJECT_MIN = 0.01  # cell saliency (mean luminance gradient over a cell) below which nothing in the picture competes with the copy;
# measured 2026-10-12: calm plates sit at 0.0004 (max 0.002-0.016), plates with a subject reach 0.02-0.2 where the subject is


def subject_mask(sal: np.ndarray) -> np.ndarray:
    """The cells that carry the picture's subject: above an absolute floor and above the frame's mean by a standard deviation."""
    thresh = max(SUBJECT_MIN, float(sal.mean() + sal.std()))
    return sal > thresh


def salient_share(sal: np.ndarray, cell_box: CellBox) -> float:
    """The share of the picture's subject mass that lies inside the cell box: what copy placed there would cover. A picture with
    no subject (a flat or softly graded plate) has nothing to cover and reads 0. (The earlier measure divided the box's mean
    saliency by the frame mean, which read every slot of a calm plate as ~1.0 and rejected the plates best suited to copy.)"""
    cy, cx, ch, cw = cell_box
    inside_raw = sal[cy:cy + ch, cx:cx + cw]
    level = float(inside_raw.mean()) / SUBJECT_LEVEL if inside_raw.size else 0.0  # detail under the slot, 1.0 = subject-level contrast
    subject = np.where(subject_mask(sal), sal, 0.0)
    total = float(subject.sum())
    mass = float(subject[cy:cy + ch, cx:cx + cw].sum()) / total if total > 0.0 else 0.0
    return max(mass, level)
