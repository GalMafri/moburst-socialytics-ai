"""The saliency read of a returned picture inside the declared quiet zone, on Plan 1's measurements."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..measure.image import Box, load_rgb
from ..measure.saliency import CellBox, quiet_rects, saliency_map, salient_share

CELL = 24
QUIET_PERCENTILE = 35  # the threshold calibrate uses for a client's own posts
DEFAULT_FLOOR = 0.35


@dataclass
class ZoneRead:
    salient_share: float  # mean saliency inside the zone over the frame mean (0 = flat, 1 = as busy as the rest)
    quiet_rects: list[CellBox] = field(default_factory=list)  # maximal quiet rectangles of the whole frame, cells, largest first
    ok: bool = False
    floor: float = DEFAULT_FLOOR
    zone_cells: CellBox = (0, 0, 0, 0)
    cell: int = CELL
    thresh: float = 0.0
    reason: str = ""  # why the picture is not ok, when it is not: "busy under the text" or "lettering in the picture"


def zone_to_cells(zone_box: Box, cell: int, grid: tuple[int, int]) -> CellBox:
    """Pixel box to (cy, cx, ch, cw) in whole cells, inside the grid, at least one cell each way."""
    x, y, w, h = (float(v) for v in zone_box)
    gy, gx = grid
    cx0 = min(max(round(x / cell), 0), gx - 1)
    cy0 = min(max(round(y / cell), 0), gy - 1)
    cx1 = min(max(round((x + w) / cell), cx0 + 1), gx)
    cy1 = min(max(round((y + h) / cell), cy0 + 1), gy)
    return (cy0, cx0, cy1 - cy0, cx1 - cx0)


def read(png: Path, zone_box: Box, floor: float = DEFAULT_FLOOR, cell: int = CELL) -> ZoneRead:
    """Saliency inside the zone against the frame; ok when the share is at or under the floor."""
    arr = load_rgb(png)
    sal = saliency_map(arr, cell)
    cells = zone_to_cells(zone_box, cell, sal.shape)
    share = salient_share(sal, cells)
    # a perfectly flat field measures exactly 0 and quiet_rects uses a strict <, so the threshold stays above zero
    thresh = max(float(np.percentile(sal, QUIET_PERCENTILE)), 1e-6)
    return ZoneRead(salient_share=round(share, 4), quiet_rects=quiet_rects(sal, thresh), ok=share <= floor, floor=floor,
                    zone_cells=cells, cell=cell, thresh=thresh)


def floor_from_calibration(calibration: dict | None) -> float:
    """The client's occlusion floor from its dead_space p50: a client whose posts keep large quiet fields gets a stricter floor,
    a photo-heavy one a looser one. Linear, 0.35 at p50 0.20, clamped to [0.20, 0.45]; the default when nothing was measured."""
    p50 = ((calibration or {}).get("dead_space") or {}).get("p50")
    if not isinstance(p50, (int, float)):
        return DEFAULT_FLOOR
    return round(min(0.45, max(0.20, 0.45 - 0.5 * float(p50))), 4)
