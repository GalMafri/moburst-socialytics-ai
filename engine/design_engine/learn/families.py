"""Layout families: the parametrised layouts a client has published, induced from post reads as measured geometry.

A family is a cluster of posts with the same layout signature. Its template holds slot boxes as fractions of the frame with
the band observed across the family's posts, the ground kind, the devices and the alignment. Parameters record the ranges
the family has carried (headline length, colour roles, picture-to-text ratio) so a family is chosen for a post by fit.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .grammar import alignment, band, logo_corner
from .layers import PostRead


@dataclass(frozen=True)
class Signature:
    text_third: str      # top | middle | bottom | none
    text_align: str      # left | center | none
    logo_corner: str     # tl | tc | tr | ml | mc | mr | bl | bc | br | none
    accent_side: str     # left | right | top | bottom | none
    picture_role: str    # none | full | top | bottom | side | inset
    ground_kind: str     # flat | gradient | photo

    @property
    def key(self) -> str:
        # the skeleton only: where text, logo, device and picture sit. The ground kind is a family parameter, not a different layout.
        return "|".join([self.text_third, self.text_align, self.logo_corner, self.accent_side, self.picture_role])


@dataclass
class Family:
    key: str
    signature: Signature
    post_ids: list[str]
    seen_count: int
    status: str  # family | seen_once
    slots: dict = field(default_factory=dict)
    parameters: dict = field(default_factory=dict)
    template: dict = field(default_factory=dict)
    sources: list[str] = field(default_factory=list)


def _third(y_centre: float) -> str:
    return "top" if y_centre < 1 / 3 else "middle" if y_centre < 2 / 3 else "bottom"


def _accent_side(read: PostRead) -> str:
    if not read.accent_boxes:
        return "none"
    x, y, w, h = read.accent_boxes[0]
    if h >= 0.6 * read.H and w < 0.3 * read.W:
        return "left" if x < read.W / 2 else "right"
    if w >= 0.6 * read.W and h < 0.3 * read.H:
        return "top" if y < read.H / 2 else "bottom"
    return "left" if x + w / 2 < read.W / 2 else "right"


def _picture_role(read: PostRead) -> str:
    if not read.picture_boxes:
        return "none"
    x, y, w, h = read.picture_boxes[0]
    cover = (w * h) / (read.W * read.H)
    if cover > 0.8:
        return "full"
    cy = (y + h / 2) / read.H
    cx = (x + w / 2) / read.W
    if w > 0.7 * read.W:
        return "top" if cy < 0.5 else "bottom"
    if h > 0.5 * read.H:
        return "side"
    return "inset" if cover > 0.04 else "none"


def signature(read: PostRead) -> Signature:
    if read.text.headline_box:
        x, y, w, h = read.text.headline_box
        third = _third((y + h / 2) / read.H)
        align = alignment(read)
    else:
        third, align = "none", "none"
    return Signature(third, align, logo_corner(read), _accent_side(read), _picture_role(read), read.ground.get("kind", "photo"))


def _frac(box, W, H) -> dict:
    return {"x": box[0] / W, "y": box[1] / H, "w": box[2] / W, "h": box[3] / H}


def _slot_band(fracs: list[dict], sources: list[str]) -> dict:
    out = {}
    for k in ("x", "y", "w", "h"):
        vals = [f[k] for f in fracs]
        b = band(vals, sources)
        out[k] = b["p50"]
        out.setdefault("band", {})[k] = {"p25": b["p25"], "p75": b["p75"]}
    out["n"] = len(fracs)
    out["sources"] = list(sources)
    return out


def cluster(reads: list[PostRead]) -> list[Family]:
    groups: dict[str, list[PostRead]] = {}
    for r in reads:
        groups.setdefault(signature(r).key, []).append(r)
    families: list[Family] = []
    for key, members in groups.items():
        sig = signature(members[0])
        post_ids = sorted({m.source_post_id or m.path.stem for m in members})
        seen = len(post_ids)
        fam = Family(key, sig, post_ids, seen, "family" if seen >= 2 else "seen_once", sources=[m.source for m in members])
        slots: dict[str, list[dict]] = {"logo": [], "headline": [], "subline": [], "picture": [], "accent": []}
        src: dict[str, list[str]] = {k: [] for k in slots}
        for m in members:
            if m.logo:
                slots["logo"].append(_frac(m.logo.box, m.W, m.H))
                src["logo"].append(m.source)
            if m.text.headline_box:
                slots["headline"].append(_frac(m.text.headline_box, m.W, m.H))
                src["headline"].append(m.source)
            if m.text.subline_box:
                slots["subline"].append(_frac(m.text.subline_box, m.W, m.H))
                src["subline"].append(m.source)
            if m.picture_boxes:
                slots["picture"].append(_frac(m.picture_boxes[0], m.W, m.H))
                src["picture"].append(m.source)
            if m.accent_boxes:
                slots["accent"].append(_frac(m.accent_boxes[0], m.W, m.H))
                src["accent"].append(m.source)
        fam.slots = {k: _slot_band(v, src[k]) for k, v in slots.items() if v}
        heads = [" ".join(l.text for l in m.text.headline) for m in members if m.text.headline]
        head_lines = [len(m.text.headline) for m in members if m.text.headline]
        pic_ratio = []
        for m in members:
            if m.picture_boxes and m.text.headline_box:
                pic_ratio.append((m.picture_boxes[0][2] * m.picture_boxes[0][3]) / max(1.0, m.text.headline_box[2] * m.text.headline_box[3]))
        variants = [m.logo.variant for m in members if m.logo]
        fam.parameters = {
            "alignment": sig.text_align,
            "headline_chars": band([len(h) for h in heads], [m.source for m in members if m.text.headline]),
            "headline_lines": band([float(n) for n in head_lines], [m.source for m in members if m.text.headline]),
            "picture_text_ratio": band(pic_ratio, [m.source for m in members if m.picture_boxes and m.text.headline_box]),
            "device_on": bool(slots["accent"]),
            "logo_variant": max(set(variants), key=variants.count) if variants else "none",
            "ground_hex": [m.ground.get("hex") for m in members if m.ground.get("hex")],
            "aspect": float(np.median([m.W / m.H for m in members])),
        }
        fam.template = {
            "slots": fam.slots,
            "ground": {"kinds": sorted({m.ground.get("kind", "photo") for m in members}),
                       "hex": fam.parameters["ground_hex"][0] if fam.parameters["ground_hex"] else None, "sources": [m.source for m in members]},
            "devices": [{"kind": "accent", "side": sig.accent_side}] if slots["accent"] else [],
            "alignment": sig.text_align,
            "picture_role": sig.picture_role,
            "logo_corner": sig.logo_corner,
        }
        families.append(fam)
    families.sort(key=lambda f: (-f.seen_count, f.key))
    return families
