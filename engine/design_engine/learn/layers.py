"""Read one published post into layers: text lines (OCR), the logo (template match of the client's file), picture regions
(matting), accent devices (saturated flat regions touching an edge) and the ground (what is left).

Nothing here guesses positions from a description; every box is measured on the post's pixels.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

from ..measure.image import Box, load_rgb, rel_lum
from ..measure.logo import LogoMatch, find_logo
from ..measure.ocr import Line, read_lines
from ..measure.text_lines import TextRead, classify


@dataclass
class PostRead:
    path: Path
    W: int
    H: int
    lines: list[Line]
    text: TextRead
    logo: LogoMatch | None
    picture_boxes: list[Box]
    ground: dict
    accent_boxes: list[Box]
    source_post_id: str = ""
    platform: str = ""
    posted_at: str = ""
    slide_index: int = 0
    kind: str = "post"
    extras: dict = field(default_factory=dict)

    @property
    def source(self) -> str:
        return f"post:{self.source_post_id}#{self.slide_index}" if self.kind != "upload" else f"upload:{self.path.name}"


def _hex(rgb) -> str:
    r, g, b = [int(round(float(v))) for v in rgb]
    return f"#{r:02x}{g:02x}{b:02x}"


def _components(mask: np.ndarray, min_share: float, W: int, H: int) -> list[Box]:
    """Bounding boxes of connected components covering at least min_share of the frame."""
    from skimage.measure import label, regionprops

    lab = label(mask, connectivity=2)
    out: list[Box] = []
    for r in regionprops(lab):
        y0, x0, y1, x1 = r.bbox
        if (x1 - x0) * (y1 - y0) >= min_share * W * H:
            out.append([float(x0), float(y0), float(x1 - x0), float(y1 - y0)])
    out.sort(key=lambda b: -(b[2] * b[3]))
    return out


def _saturation(arr: np.ndarray) -> np.ndarray:
    a = arr.astype(np.float64) / 255.0
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    return np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0.0)


def _dominant_colour(arr: np.ndarray, exclude: list[Box]) -> np.ndarray:
    H, W = arr.shape[:2]
    mask = np.ones((H, W), dtype=bool)
    for b in exclude:
        x, y, w, h = [int(round(v)) for v in b]
        mask[max(0, y):min(H, y + h), max(0, x):min(W, x + w)] = False
    px = arr[mask] if mask.any() else arr.reshape(-1, 3)
    return np.median(px, axis=0)


def _accent_boxes(arr: np.ndarray, exclude: list[Box]) -> list[Box]:
    """Saturated, flat regions that touch a frame edge and differ from the dominant ground: bars, tabs, pills the brand uses
    as devices. A device is a minority region; the ground itself, however saturated, is never a device."""
    H, W = arr.shape[:2]
    ground = _dominant_colour(arr, exclude)
    sat = _saturation(arr)
    lum = rel_lum(arr)
    cell = max(8, min(W, H) // 60)
    gy, gx = H // cell, W // cell
    flat_sat = np.zeros((gy, gx), dtype=bool)
    for i in range(gy):
        for j in range(gx):
            blk = arr[i * cell:(i + 1) * cell, j * cell:(j + 1) * cell].reshape(-1, 3).astype(np.float64)
            blk_s = sat[i * cell:(i + 1) * cell, j * cell:(j + 1) * cell]
            blk_l = lum[i * cell:(i + 1) * cell, j * cell:(j + 1) * cell]
            far_from_ground = np.linalg.norm(blk.mean(axis=0) - ground) > 60
            flat_sat[i, j] = far_from_ground and blk_s.mean() > 0.45 and blk_l.std() < 0.03
    boxes = _components(flat_sat, 0.004, gx, gy)
    out: list[Box] = []
    for b in boxes:
        box = [b[0] * cell, b[1] * cell, b[2] * cell, b[3] * cell]
        if box[2] * box[3] > 0.25 * W * H:
            continue
        touches = box[0] <= cell or box[1] <= cell or box[0] + box[2] >= W - cell or box[1] + box[3] >= H - cell
        if not touches or any(_iou(box, e) > 0.5 for e in exclude):
            continue
        out.append(box)
    return out


def _iou(a: Box, b: Box) -> float:
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def _ground(arr: np.ndarray, exclude: list[Box]) -> dict:
    """Describe what remains once text, logo, pictures and devices are masked out."""
    H, W = arr.shape[:2]
    mask = np.ones((H, W), dtype=bool)
    for b in exclude:
        x, y, w, h = [int(round(v)) for v in b]
        mask[max(0, y):min(H, y + h), max(0, x):min(W, x + w)] = False
    if mask.sum() < 0.05 * H * W:
        return {"kind": "photo", "hex": None, "coverage": float(mask.mean())}
    lum = rel_lum(arr)
    rows = []
    for y in range(H):
        row = lum[y][mask[y]]
        if row.size:
            rows.append(row.mean())
    rows_arr = np.asarray(rows)
    residual_std = float(lum[mask].std())
    med_rgb = np.median(arr[mask], axis=0)
    if residual_std < 0.02:
        return {"kind": "flat", "hex": _hex(med_rgb), "coverage": float(mask.mean())}
    # gradient: a line through the row means explains most of the variance
    if rows_arr.size > 10:
        x = np.arange(rows_arr.size)
        coef = np.polyfit(x, rows_arr, 1)
        fit = np.polyval(coef, x)
        ss_res = float(((rows_arr - fit) ** 2).sum())
        ss_tot = float(((rows_arr - rows_arr.mean()) ** 2).sum()) or 1e-9
        if 1 - ss_res / ss_tot > 0.9 and residual_std < 0.12:
            return {"kind": "gradient", "hex": _hex(med_rgb), "coverage": float(mask.mean()), "direction": "vertical"}
    return {"kind": "photo", "hex": _hex(med_rgb), "coverage": float(mask.mean())}


def _texture_mask(arr: np.ndarray, cell: int = 16, thresh: float = 0.06) -> np.ndarray:
    """Cells whose luminance varies more than flat type or colour fields do: photographs, renders, textured grounds."""
    H, W = arr.shape[:2]
    lum = rel_lum(arr)
    out = np.zeros((H, W), dtype=bool)
    for y in range(0, H - cell + 1, cell):
        for x in range(0, W - cell + 1, cell):
            if lum[y:y + cell, x:x + cell].std() > thresh:
                out[y:y + cell, x:x + cell] = True
    return out


def _matting_mask(path: Path) -> np.ndarray | None:
    try:
        from rembg import new_session, remove
    except Exception:
        return None
    session = _matting_mask.__dict__.setdefault("session", new_session("isnet-general-use"))
    im = Image.open(path).convert("RGB")
    out = remove(im, session=session, only_mask=True)
    return np.asarray(out) > 128


def read_post(path, logo_gray: np.ndarray | None, ocr: Callable[[Path], list[Line]] = read_lines, matting: bool = True,
              meta: dict | None = None) -> PostRead:
    path = Path(path)
    arr = load_rgb(path)
    H, W = arr.shape[:2]
    logo = find_logo(arr, logo_gray, min(W, H)) if logo_gray is not None else None
    lines = ocr(path)
    text = classify(lines, W, H, exclude_boxes=[logo.box] if logo else ())
    text_boxes = [b for b in (text.headline_box, text.subline_box) if b] + [l.box for l in text.other]
    exclude = text_boxes + ([logo.box] if logo else [])
    # A picture is where the pixels vary (texture) or where the matting model finds an object; both are measured, neither guessed.
    mask = _texture_mask(arr)
    if matting:
        mm = _matting_mask(path)
        if mm is not None:
            mask = mask | mm
    for b in exclude:
        x, y, w, h = [int(round(v)) for v in b]
        mask[max(0, y):min(H, y + h), max(0, x):min(W, x + w)] = False
    picture_boxes = _components(mask, 0.015, W, H)[:4]
    accents = _accent_boxes(arr, exclude + picture_boxes)
    ground = _ground(arr, exclude + picture_boxes + accents)
    m = meta or {}
    return PostRead(path, W, H, lines, text, logo, picture_boxes, ground, accents,
                    m.get("source_post_id", ""), m.get("platform", ""), m.get("posted_at", ""), int(m.get("slide_index", 0)), m.get("kind", "post"))
