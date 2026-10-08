"""Placement by measured free space. A family's arrangements are the positions its slot bands allow: the median (p50) and the
p25 and p75 positions of the text block and the logo. Each arrangement is judged by the saliency of the picture under the
slots it places; the quietest wins, and none is offered when every one of them exceeds the floor (the caller regenerates the
picture or drops the option). A custom arrangement (slot overrides in frame fractions) is measured the same way."""
from __future__ import annotations

import copy
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

from ..measure.image import Box, crop, load_rgb, rel_lum
from ..measure.saliency import saliency_map, salient_share
from ..picture.zone import CELL, DEFAULT_FLOOR, ZoneRead, zone_to_cells
from ..platform.specs import Size
from .template import slot_px

NAMED = ("p50", "p25", "p75")  # the median first: on a tie the brand's most observed position keeps the place
PLACED = ("headline", "subline", "logo")  # the slots an arrangement moves and the saliency is read under
Reader = Callable[[str, dict[str, Box]], "ZoneRead | float | Mapping[str, float]"]


@dataclass
class Arrangement:
    name: str  # p25 | p50 | p75, or the custom arrangement's own name
    boxes: dict[str, Box]  # the placed slots in pixels at this arrangement
    overrides: dict[str, dict] = field(default_factory=dict)  # slot -> {x?, y?} fractions for a custom arrangement
    shares: dict[str, float] = field(default_factory=dict)  # salient share under each placed slot (frame mean = 1)
    share: float = 0.0  # the busiest placed slot's share: what the floor is judged on
    floor: float = DEFAULT_FLOOR

    @property
    def ok(self) -> bool:
        return self.share <= self.floor

    @property
    def template_name(self) -> str:
        """What the template renders: a named arrangement as itself, a custom one as the median of a family copy (family_for)."""
        return self.name if self.name in NAMED else "p50"

    @property
    def mean_share(self) -> float:
        return float(np.mean(list(self.shares.values()))) if self.shares else self.share


def _overrides(candidate: Mapping) -> tuple[str, dict[str, dict]]:
    name = str(candidate.get("name") or "custom")
    return name, {k: dict(v) for k, v in candidate.items() if k != "name" and isinstance(v, Mapping)}


def family_for(family: dict, arrangement: Arrangement | str | Mapping) -> dict:
    """The family to render: unchanged for a named arrangement; for a custom one a deep copy whose slot medians carry the
    overrides, so the template places them at p50."""
    if isinstance(arrangement, str):
        return family
    overrides = arrangement.overrides if isinstance(arrangement, Arrangement) else _overrides(arrangement)[1]
    if not overrides:
        return family
    fam = copy.deepcopy(family)
    slots = fam["template"]["slots"]
    for slot, pos in overrides.items():
        if slot in slots:
            for k in ("x", "y", "w", "h"):
                if k in pos and pos[k] is not None:
                    slots[slot][k] = float(pos[k])
    return fam


def boxes_for(family: dict, size: Size, arrangement: str | Mapping | Arrangement, slots: Sequence[str] = PLACED) -> dict[str, Box]:
    """The placed slots in pixels for one arrangement."""
    fam = family_for(family, arrangement)
    name = arrangement.template_name if isinstance(arrangement, Arrangement) else arrangement if isinstance(arrangement, str) else "p50"
    tpl_slots = fam["template"]["slots"]
    return {s: list(slot_px(tpl_slots[s], size, name)) for s in slots if s in tpl_slots}


def picture_box(family: dict, size: Size, arrangement_name: str = "p50") -> Box:
    """Where the template draws the picture: the whole frame for a full-bleed family, else the picture slot."""
    tpl = family["template"]
    slots = tpl["slots"]
    if tpl.get("picture_role", "none") == "full" or "picture" not in slots:
        return [0.0, 0.0, float(size.w), float(size.h)]
    return list(slot_px(slots["picture"], size, arrangement_name))


def frame_to_picture(box: Box, pic_box: Box, pw: int, ph: int) -> Box | None:
    """A frame box mapped into the picture's own pixels, the picture drawn with object-fit: cover inside pic_box.
    None when the box lies outside the picture."""
    bx, by, bw, bh = (float(v) for v in pic_box)
    x0, y0 = max(float(box[0]), bx), max(float(box[1]), by)
    x1, y1 = min(float(box[0]) + float(box[2]), bx + bw), min(float(box[1]) + float(box[3]), by + bh)
    if x1 <= x0 or y1 <= y0 or pw <= 0 or ph <= 0:
        return None
    scale = max(bw / pw, bh / ph)
    ox, oy = (bw - pw * scale) / 2, (bh - ph * scale) / 2
    px0, py0 = (x0 - bx - ox) / scale, (y0 - by - oy) / scale
    px1, py1 = (x1 - bx - ox) / scale, (y1 - by - oy) / scale
    return [px0, py0, px1 - px0, py1 - py0]


def picture_reader(picture: Path | str, family: dict, size: Size, cell: int = CELL) -> Reader:
    """One saliency map of the picture, read under each arrangement's placed slots. A slot off the picture reads 0."""
    arr = load_rgb(picture)
    ph, pw = arr.shape[:2]
    sal = saliency_map(arr, cell)

    def read(name: str, boxes: dict[str, Box]) -> dict[str, float]:
        pic = picture_box(family, size, name if name in NAMED else "p50")
        shares: dict[str, float] = {}
        for slot, box in boxes.items():
            mapped = frame_to_picture(box, pic, pw, ph)
            shares[slot] = 0.0 if mapped is None else float(salient_share(sal, zone_to_cells(mapped, cell, sal.shape)))
        return shares

    return read


def _shares(result: ZoneRead | float | Mapping[str, float], boxes: dict[str, Box]) -> dict[str, float]:
    if isinstance(result, ZoneRead):
        return {slot: float(result.salient_share) for slot in boxes}
    if isinstance(result, Mapping):
        return {k: float(v) for k, v in result.items()}
    return {slot: float(result) for slot in boxes}


def rank(family: dict, size: Size, zone_reads: Mapping[str, ZoneRead] | Reader | Path | str, floor: float | None = None,
         arrangements: Sequence[str | Mapping] = NAMED) -> list[Arrangement]:
    """Every candidate arrangement measured, quietest first (busiest slot, then the mean over the placed slots).
    `zone_reads` is precomputed reads keyed by arrangement name, a reader callable `(name, boxes) -> ZoneRead | share | {slot: share}`,
    or the picture path to measure. Precomputed reads cover only the names they carry."""
    reader: Reader | None = None
    reads: Mapping[str, ZoneRead] | None = None
    if isinstance(zone_reads, (str, Path)):
        reader = picture_reader(zone_reads, family, size)
    elif callable(zone_reads):
        reader = zone_reads
    else:
        reads = zone_reads
    out: list[Arrangement] = []
    for cand in arrangements:
        if isinstance(cand, str):
            name, overrides = cand, {}
        else:
            name, overrides = _overrides(cand)
        if reads is not None and name not in reads:
            continue
        boxes = boxes_for(family, size, cand)
        if not boxes:
            continue
        arr_floor = DEFAULT_FLOOR if floor is None else float(floor)
        if reads is not None:
            zr = reads[name]
            shares = _shares(zr, boxes)
            if floor is None:
                arr_floor = float(zr.floor)
        else:
            assert reader is not None
            shares = _shares(reader(name, boxes), boxes)
        share = max(shares.values()) if shares else 0.0
        out.append(Arrangement(name, boxes, overrides, {k: round(v, 4) for k, v in shares.items()}, round(share, 4), arr_floor))
    out.sort(key=lambda a: (a.share, a.mean_share))
    return out


def choose(family: dict, size: Size, zone_reads: Mapping[str, ZoneRead] | Reader | Path | str, floor: float | None = None,
           arrangements: Sequence[str | Mapping] = NAMED) -> Arrangement | None:
    """The arrangement with the least salient share under its text and logo slots; None when every one exceeds the floor."""
    ranked = rank(family, size, zone_reads, floor, arrangements)
    if not ranked or not ranked[0].ok:
        return None
    return ranked[0]


# ---- the ground under a slot, for the pair and logo choice in option.assemble ----


def hex_lum(hex_colour: str) -> float:
    c = hex_colour.lstrip("#")
    return float(rel_lum(np.array([int(c[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)))


def ground_under(picture: Path | str | None, family: dict, size: Size, arrangement_name: str, box: Box) -> float | None:
    """Median relative luminance of what lies under a slot: the picture crop when the slot is on the picture, else the
    family's recorded ground colour. None when neither is known (the caller falls back to the first observed pair)."""
    if picture is not None:
        with Image.open(picture) as im:
            pw, ph = im.size
        mapped = frame_to_picture(box, picture_box(family, size, arrangement_name), pw, ph)
        if mapped is not None:
            region = crop(load_rgb(picture), mapped)
            if region is not None and region.size:
                return float(np.median(rel_lum(region)))
    tpl_hex = (family.get("template", {}).get("ground") or {}).get("hex")
    hexes = family.get("parameters", {}).get("ground_hex") or []
    ground = tpl_hex or (hexes[0] if hexes else None)
    return hex_lum(ground) if ground else None


def text_floor_px(band: Mapping | None, size: Size, explicit: float | None = None) -> float:
    """The client's own floor for a text role (the band's p25 of the short edge), never below the platform floor;
    an explicit floor only ever raises it."""
    p25 = (band or {}).get("p25")
    floor = float(p25) * size.short_edge if isinstance(p25, (int, float)) else 0.0
    return max(floor, float(size.min_text_px), float(explicit or 0.0))


__all__ = ["NAMED", "PLACED", "Arrangement", "boxes_for", "choose", "family_for", "frame_to_picture", "ground_under", "hex_lum",
           "picture_box", "picture_reader", "rank", "text_floor_px"]
