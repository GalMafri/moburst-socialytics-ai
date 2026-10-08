"""The gate on one render, in export pixels, with floors from the client's calibration (spec section 6, "The gate").

Checks run in the plan's order and every failure is a plain sentence naming the element and the number. Measurements are
kept whatever the verdict so the sheet can show them. Nothing here guesses: every number comes from the render's pixels,
the element boxes the composer returned, and the OCR of the final file.
"""
from __future__ import annotations

import itertools
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

import numpy as np
from PIL import Image

from ..measure.bands import content_span, empty_bands, largest_free_rect
from ..measure.contrast import busy_ground, ink_vs_ground
from ..measure.hashes import near_copy
from ..measure.image import Box, crop, load_rgb, rel_lum
from ..measure.ocr import Line, read_lines

LOGO_MATCH_MIN = 0.90
LOGO_CONTRAST_MIN = 3.0
TEXT_CONTRAST_MIN = 4.5
BUSY_MAX = 0.11
HEADLINE_SHORT_EDGE_SHARE_MIN = 0.08
CONTENT_SPAN_MIN = 0.55
TALL_FRAME_ASPECT = 0.7
TALL_FRAME_LOGO_FACTOR = 1.15
NEAR_COPY_WHOLE = 40  # the reference's thresholds: same skeleton, used as a warning here (a family shares its skeleton by design)
NEAR_COPY_HALF = 20
PIXEL_COPY_WHOLE = 12  # near-identical pixels over the whole frame: a copy, whatever the words say. A half can be identical by design
# (the skeleton half with the logo and the bar), so halves only feed the warning.
SUBJECT_OVERLAP_MAX = 0.01
TEXT_SLOTS = ("headline", "subline")


@runtime_checkable
class SizeLike(Protocol):
    """What the gate reads from a platform size. Task 1's `Size` dataclass satisfies it; a dict with the same keys does too."""
    w: int
    h: int
    safe: Mapping[str, int]
    min_text_px: int
    max_file_kb: int


@dataclass
class GateResult:
    passed: bool
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    measurements: dict = field(default_factory=dict)


def _size_fields(size: Any) -> tuple[int, int, dict, int, int]:
    get = size.get if isinstance(size, Mapping) else lambda k, d=None: getattr(size, k, d)
    safe = dict(get("safe") or {})
    return int(get("w")), int(get("h")), {k: int(safe.get(k, 0)) for k in ("top", "bottom", "left", "right")}, int(get("min_text_px", 0)), int(get("max_file_kb", 0))


def _fmt(v: float, nd: int = 2) -> str:
    return f"{v:.{nd}f}"


def _outside_safe(box: Box, W: int, H: int, safe: dict) -> tuple[str, float] | None:
    x, y, w, h = box
    spill = {"left": safe["left"] - x, "top": safe["top"] - y, "right": (x + w) - (W - safe["right"]), "bottom": (y + h) - (H - safe["bottom"])}
    side, px = max(spill.items(), key=lambda kv: kv[1])
    return (side, px) if px > 0.5 else None


def _overlap_share(a: Box, b: Box) -> float:
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    return (ix * iy) / max(1.0, a[2] * a[3])


def _ground_under(arr: np.ndarray, box: Box, ring: int = 4) -> np.ndarray:
    """Median colour of a thin ring just outside the box: the ground the logo was composited on. Falls back to the box itself."""
    x, y, w, h = [round(v) for v in box]
    H, W = arr.shape[:2]
    x0, y0, x1, y1 = max(0, x - ring), max(0, y - ring), min(W, x + w + ring), min(H, y + h + ring)
    outer = np.zeros((H, W), dtype=bool)
    outer[y0:y1, x0:x1] = True
    outer[max(0, y):min(H, y + h), max(0, x):min(W, x + w)] = False
    px = arr[outer]
    if px.size == 0:
        px = arr[max(0, y):min(H, y + h), max(0, x):min(W, x + w)].reshape(-1, 3)
    return np.median(px, axis=0)


def _logo_match(region: np.ndarray, logo_path: Path, ground_rgb: np.ndarray) -> tuple[float, float]:
    """NCC (on luminance) of the render's logo region against the file composited on the ground under it and resampled to the box,
    and the file's ink height as a share of its own height (so the logo height floor is judged on ink, as the calibration was)."""
    lg = Image.open(logo_path).convert("RGBA")
    alpha = np.asarray(lg)[..., 3]
    rows = np.where(alpha.max(axis=1) > 8)[0]
    ink_share = (rows.max() - rows.min() + 1) / lg.height if rows.size else 1.0
    g = [round(float(v)) for v in ground_rgb]
    bg = Image.new("RGBA", lg.size, (g[0], g[1], g[2], 255))
    bg.alpha_composite(lg)
    h, w = region.shape[:2]
    expected = rel_lum(np.asarray(bg.convert("RGB").resize((w, h), Image.Resampling.BICUBIC)))
    got = rel_lum(region)
    a = expected - expected.mean()
    b = got - got.mean()
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    return (float((a * b).sum() / denom) if denom > 1e-9 else 0.0), float(ink_share)


def _lines_in(lines: list[Line], box: Box) -> list[Line]:
    x, y, w, h = box
    inside = [ln for ln in lines if x <= ln.box[0] + ln.box[2] / 2 <= x + w and y <= ln.box[1] + ln.box[3] / 2 <= y + h]
    inside.sort(key=lambda ln: (ln.box[1], ln.box[0]))
    return inside


_QUOTES = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"'})


def _norm(text: str) -> str:
    s = "".join(text.split()).translate(_QUOTES)
    return s[:1].lower() + s[1:]


def _copy_matches(lines: list[Line], expected: str) -> tuple[bool, str]:
    """True when the OCR'd lines equal the copy ignoring whitespace, the first letter's case and line order."""
    texts = [ln.text for ln in lines]
    target = _norm(expected)
    read = " ".join(t.strip() for t in texts)
    if _norm("".join(texts)) == target:
        return True, read
    if len(texts) <= 7:
        for perm in itertools.permutations(texts):
            if _norm("".join(perm)) == target:
                return True, read
    return False, read


def check(png: Path, boxes: dict, profile: dict, size: SizeLike | Mapping, references: list[Path], prior: list[Path], copy: dict,
          ocr: Callable[[Path], list[Line]] = read_lines, logo_path: Path | None = None, picture_references: list | None = None) -> GateResult:
    """Run every check in the plan's order on one render. `boxes` maps slots (logo, headline, subline, picture, accent, subject) to
    [x, y, w, h] in export pixels; `copy` has `headline` and `subline`; `references` are the client's stored posts and `prior` the
    earlier deliveries; `ocr` reads the final file (injectable; tests pass a FakeOCR). The logo file is `logo_path` or the files on
    `profile["logo"]["files"]` (the best match counts, so any variant the composer used is accepted)."""
    png = Path(png)
    W, H, safe, min_text_px, max_file_kb = _size_fields(size)
    short = min(W, H)
    floors = (profile.get("calibration") or {}).get("floors") or {}
    arr = load_rgb(png)
    fails: list[str] = []
    warns: list[str] = []
    m: dict[str, Any] = {"size": [W, H]}

    # ---- logo: present, from the file, tall enough, readable, inside the safe box ----
    logo_box = boxes.get("logo")
    logo_files = [Path(logo_path)] if logo_path else [Path(f["path"]) for f in (profile.get("logo") or {}).get("files") or [] if f.get("path")]
    ink_share = 1.0
    if not logo_box:
        fails.append("logo is missing: no logo box on the render")
    else:
        region = crop(arr, logo_box)
        if region is None or not logo_files:
            fails.append("logo is not the file: no logo file to compare against" if logo_files else "logo is not the file: no logo file on the profile")
        else:
            ground = _ground_under(arr, logo_box)
            best, ink_share = max((_logo_match(region, f, ground) for f in logo_files if f.exists()), default=(0.0, 1.0))
            m["logo_match"] = round(best, 3)
            if best < LOGO_MATCH_MIN:
                fails.append(f"logo is not the file: match {_fmt(best)} is below {_fmt(LOGO_MATCH_MIN)}")
            lc = ink_vs_ground(region)
            m["logo_contrast"] = round(lc, 2) if lc is not None else None
        logo_floor = float(floors.get("logo_height_min", 0.06))
        if W / H < TALL_FRAME_ASPECT:
            logo_floor *= TALL_FRAME_LOGO_FACTOR
        share = (logo_box[3] * ink_share) / short
        m["logo_height_share"] = round(share, 4)
        m["logo_height_min"] = round(logo_floor, 4)
        if share < logo_floor:
            fails.append(f"logo height {_fmt(share, 3)} of the short edge is below {_fmt(logo_floor, 3)}")
        if m.get("logo_contrast") is not None and m["logo_contrast"] < LOGO_CONTRAST_MIN:
            fails.append(f"logo contrast {_fmt(m['logo_contrast'], 1)}:1 is below {_fmt(LOGO_CONTRAST_MIN, 1)}:1")
        spill = _outside_safe(logo_box, W, H, safe)
        if spill:
            fails.append(f"logo leaves the safe box by {_fmt(spill[1], 0)} px at the {spill[0]}")

    # ---- text: contrast, busy ground, size, headline height, safe box, subject overlap ----
    lines = list(ocr(png))
    subject = boxes.get("subject")
    smallest: float | None = None
    for slot in TEXT_SLOTS:
        box = boxes.get(slot)
        if not box:
            if slot == "headline":
                fails.append("headline is missing: no headline box on the render")
            continue
        region = crop(arr, box)
        if region is None:
            fails.append(f"{slot} box lies outside the render")
            continue
        c = ink_vs_ground(region)
        busy = busy_ground(region)
        m[f"{slot}_contrast"] = round(c, 2) if c is not None else None
        m[f"{slot}_busy"] = round(busy, 3)
        if c is None:
            warns.append(f"{slot} region is too small to measure contrast")
        elif c < TEXT_CONTRAST_MIN:
            fails.append(f"{slot} contrast {_fmt(c, 1)}:1 is below {_fmt(TEXT_CONTRAST_MIN, 1)}:1")
        if busy > BUSY_MAX:
            fails.append(f"{slot} busy ground {_fmt(busy)} is above {_fmt(BUSY_MAX)}")
        inside = _lines_in(lines, box)
        heights = [ln.box[3] for ln in inside]
        if not heights:
            warns.append(f"{slot}: OCR read no lines inside its box, so text size is taken from the box height")
            heights = [box[3]]
        smallest = min(heights) if smallest is None else min(smallest, min(heights))
        if slot == "headline":
            hs = max(heights) / short
            m["headline_h_share"] = round(hs, 4)
            if hs < HEADLINE_SHORT_EDGE_SHARE_MIN:
                fails.append(f"headline height {_fmt(hs, 3)} of the short edge is below {_fmt(HEADLINE_SHORT_EDGE_SHARE_MIN, 2)}")
        spill = _outside_safe(box, W, H, safe)
        if spill:
            fails.append(f"{slot} leaves the safe box by {_fmt(spill[1], 0)} px at the {spill[0]}")
        if subject:
            ov = _overlap_share(box, subject)
            m[f"{slot}_subject_overlap"] = round(ov, 3)
            if ov > SUBJECT_OVERLAP_MAX:
                fails.append(f"{slot} overlaps the picture subject by {_fmt(ov * 100, 0)}%")
    if smallest is not None:
        m["min_text_px"] = round(smallest, 1)
        if smallest < min_text_px:
            fails.append(f"smallest text {_fmt(smallest, 0)} px is below the platform floor of {min_text_px} px")

    # ---- composition: edge bands, dead space, content span ----
    element_boxes = [b for k, b in boxes.items() if b and k != "subject"]
    top, bot = empty_bands(arr, element_boxes)
    band_max = float(floors.get("edge_band_max", 0.16))
    m["empty_bands"] = {"top": round(top, 3), "bottom": round(bot, 3)}
    for name, v in (("top", top), ("bottom", bot)):
        if v > band_max:
            fails.append(f"empty {name} band {_fmt(v)} of the height is above {_fmt(band_max)}")
    dead = largest_free_rect(W, H, element_boxes)
    dead_max = float(floors.get("dead_space_max", 0.38))
    m["dead_space"] = round(dead, 3)
    if dead > dead_max:
        fails.append(f"largest free rectangle {_fmt(dead)} of the frame is above {_fmt(dead_max)}")
    safe_box = [safe["left"], safe["top"], W - safe["left"] - safe["right"], H - safe["top"] - safe["bottom"]]
    span = content_span(element_boxes, H, safe_box)
    m["content_span"] = round(span, 3)
    if span < CONTENT_SPAN_MIN:
        fails.append(f"content span {_fmt(span)} of the safe height is below {_fmt(CONTENT_SPAN_MIN)}")

    # ---- near-copy against the client's posts and the earlier deliveries ----
    # A family reuses the client's skeleton on purpose, and a 16x16 luminance hash sees the skeleton as the picture (a same-family render
    # with new copy sits at distance ~22 from the post it was learned from). So the whole frame is a copy only at pixel-copy distances;
    # the reference's 40/20 is a warning; and what must differ is measured where it lives: the picture region (picture_references) and
    # the words (the OCR check below).
    cand = Image.open(png)
    pool = [(Path(p), "reference") for p in references] + [(Path(p), "prior delivery") for p in prior]
    nc = near_copy(cand, [Image.open(p) for p, _ in pool], NEAR_COPY_WHOLE, NEAR_COPY_HALF) if pool else None
    m["near_copy"] = {"min_whole": nc.min_whole, "min_half": nc.min_half, "same_skeleton": nc.is_copy, "index": nc.index} if nc else {"same_skeleton": False}
    if nc and nc.index is not None:
        path, kind = pool[nc.index]
        if nc.min_whole <= PIXEL_COPY_WHOLE:
            fails.append(f"pixel copy of {kind} {path.name}: whole-frame distance {nc.min_whole} is within {PIXEL_COPY_WHOLE}")
        elif nc.is_copy:
            warns.append(f"same skeleton as {kind} {path.name} (whole-frame distance {nc.min_whole}); the picture and the words must carry the difference")
    pic_box = boxes.get("picture")
    if pic_box and picture_references:
        pc = crop(np.asarray(cand.convert("RGB")), pic_box)
        if pc is not None and pc.size:
            pnc = near_copy(Image.fromarray(pc), [Image.open(p) for p in picture_references], NEAR_COPY_WHOLE, NEAR_COPY_HALF)
            m["picture_near_copy"] = {"min_whole": pnc.min_whole, "min_half": pnc.min_half, "is_copy": pnc.is_copy, "index": pnc.index}
            if pnc.is_copy and pnc.index is not None:
                fails.append(f"picture is a near copy of {Path(picture_references[pnc.index]).name}: distance {pnc.min_whole} is within {NEAR_COPY_WHOLE}")

    # ---- copy exactness, verified once by OCR on the final render ----
    m["ocr"] = {}
    for slot in TEXT_SLOTS:
        box = boxes.get(slot)
        expected = (copy or {}).get(slot)
        if not box or not expected:
            continue
        ok, read = _copy_matches(_lines_in(lines, box), expected)
        m["ocr"][slot] = ok
        if not ok:
            fails.append(f'{slot} copy reads "{read}" instead of "{expected}"')

    # ---- file size ----
    kb = png.stat().st_size / 1024
    m["file_kb"] = round(kb, 1)
    if max_file_kb and kb > max_file_kb:
        fails.append(f"file size {_fmt(kb, 0)} KB is above {max_file_kb} KB")

    return GateResult(not fails, fails, warns, m)
