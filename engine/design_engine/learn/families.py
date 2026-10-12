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


def device_box(read: PostRead) -> Box | None:
    """The post's layout device, if it carries one: a band along an edge (at least 60% of one frame edge, under 30% of the other).
    A small saturated block in a corner is a badge or a pictorial element, not a device, and shapes no family."""
    for box in read.accent_boxes:
        w, h = box[2], box[3]
        if (h >= 0.6 * read.H and w < 0.3 * read.W) or (w >= 0.6 * read.W and h < 0.3 * read.H):
            return list(box)
    return None


def _accent_side(read: PostRead) -> str:
    box = device_box(read)
    if box is None:
        return "none"
    if box[3] >= 0.6 * read.H:
        return "left" if box[0] < read.W / 2 else "right"
    return "top" if box[1] < read.H / 2 else "bottom"


def _picture_role(read: PostRead) -> str:
    if not read.picture_boxes:
        return "none"
    _x, y, w, h = read.picture_boxes[0]
    cover = (w * h) / (read.W * read.H)
    if cover > 0.8:
        return "full"
    cy = (y + h / 2) / read.H
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
    """The slot's band across the family: the medians, the p25/p75 of each coordinate, the count and the sources."""
    out = {}
    for k in ("x", "y", "w", "h"):
        vals = [f[k] for f in fracs]
        b = band(vals, sources)
        out[k] = b["p50"]
        out.setdefault("band", {})[k] = {"p25": b["p25"], "p75": b["p75"]}
    out["n"] = len(fracs)
    out["sources"] = list(sources)
    return out


def exemplar_order(per_member: list[dict[str, dict]], medians: dict[str, dict]) -> list[int]:
    """Members ordered by how close their whole geometry sits to the family's slot medians (the medoid first): the exemplar whose
    slots the template takes, then the next nearest, whose geometries are the family's other arrangements. A slot median composed
    from different posts is a layout nobody published; an exemplar's slots were published together."""
    def distance(slots: dict[str, dict]) -> float:
        d, n = 0.0, 0
        for k, med in medians.items():
            b = slots.get(k)
            if b is None:
                d += 1.0  # a member without the slot is far from the family on it
                continue
            d += sum(abs(b[c] - med[c]) for c in ("x", "y", "w", "h"))
            n += 1
        return d / max(1, len(medians))

    return sorted(range(len(per_member)), key=lambda i: distance(per_member[i]))


def _exemplar_slots(per_member: list[dict[str, dict]], order: list[int], bands: dict[str, dict]) -> dict[str, dict]:
    """Slots as the exemplar published them, the next two exemplars' boxes as the p25/p75 arrangements, the family band kept for
    the record. A slot the exemplar lacks takes the nearest member that has it."""
    out: dict[str, dict] = {}
    for k, b in bands.items():
        havers = [i for i in order if k in per_member[i]]
        if not havers:
            continue
        first = per_member[havers[0]][k]
        alts = [per_member[i][k] for i in havers[1:3]]
        slot = {c: float(first[c]) for c in ("x", "y", "w", "h")}
        slot["band"] = {c: {"p25": float(alts[0][c]) if alts else float(first[c]), "p75": float(alts[1][c]) if len(alts) > 1 else (float(alts[0][c]) if alts else float(first[c]))}
                        for c in ("x", "y", "w", "h")}
        slot["family_band"] = b["band"]
        slot["median"] = {c: b[c] for c in ("x", "y", "w", "h")}
        slot["n"] = b["n"]
        slot["sources"] = b["sources"]
        slot["exemplar"] = havers[0]
        out[k] = slot
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
        slots: dict[str, list[dict]] = {"logo": [], "headline": [], "subline": [], "footer": [], "cta": [], "picture": [], "accent": []}
        src: dict[str, list[str]] = {k: [] for k in slots}
        per_member: list[dict[str, dict]] = []
        accent_hexes: list[str] = []
        cta_hexes: list[str] = []
        cta_texts: list[str] = []
        footer_texts: list[str] = []
        for m in members:
            per_member.append({})
            if m.logo:
                per_member[-1]["logo"] = _frac(m.logo.box, m.W, m.H)
            if m.text.headline_box:
                per_member[-1]["headline"] = _frac(m.text.headline_box, m.W, m.H)
            if m.text.subline_box:
                per_member[-1]["subline"] = _frac(m.text.subline_box, m.W, m.H)
            if getattr(m.text, "footer_box", None):
                per_member[-1]["footer"] = _frac(m.text.footer_box, m.W, m.H)
                footer_texts.append(" ".join(l.text for l in m.text.footer).strip())
            pills = (getattr(m, "extras", {}) or {}).get("pills") or []
            if pills:
                pill = max(pills, key=lambda pb: pb["box"][2] * pb["box"][3])
                per_member[-1]["cta"] = _frac(pill["box"], m.W, m.H)
                cta_hexes.append(pill.get("hex") or "")
                if pill.get("text"):
                    cta_texts.append(pill["text"])
            if m.picture_boxes and sig.picture_role != "none":  # a sliver under 4% of the frame is not a picture slot
                per_member[-1]["picture"] = _frac(m.picture_boxes[0], m.W, m.H)
            dev = device_box(m)
            if dev is not None:
                per_member[-1]["accent"] = _frac(dev, m.W, m.H)
                hexes = (getattr(m, "extras", {}) or {}).get("accent_hex") or []
                idx = next((i for i, b in enumerate(m.accent_boxes) if list(b) == list(dev)), None)
                if idx is not None and idx < len(hexes):
                    accent_hexes.append(hexes[idx])
            for k, v in per_member[-1].items():
                slots[k].append(v)
                src[k].append(m.source)
        if len(slots["footer"]) < max(1, len(members) / 2):  # a footer is a family trait only when most members carry one
            slots["footer"], src["footer"] = [], []
            footer_texts = []
            for pm in per_member:
                pm.pop("footer", None)
        if len(slots["cta"]) < max(1, len(members) / 2):  # likewise a button
            slots["cta"], src["cta"] = [], []
            cta_hexes, cta_texts = [], []
            for pm in per_member:
                pm.pop("cta", None)
        bands_ = {k: _slot_band(v, src[k]) for k, v in slots.items() if v}
        order = exemplar_order(per_member, {k: {c: b[c] for c in ("x", "y", "w", "h")} for k, b in bands_.items()})
        fam.slots = _exemplar_slots(per_member, order, bands_)
        fam.parameters["exemplars"] = [members[i].source for i in order[:3]]
        heads = [" ".join(l.text for l in m.text.headline) for m in members if m.text.headline]
        head_lines = [len(m.text.headline) for m in members if m.text.headline]
        pic_ratio = []
        for m in members:
            if m.picture_boxes and m.text.headline_box:
                pic_ratio.append((m.picture_boxes[0][2] * m.picture_boxes[0][3]) / max(1.0, m.text.headline_box[2] * m.text.headline_box[3]))
        variants = [m.logo.variant for m in members if m.logo]
        exemplars = fam.parameters.get("exemplars", [])
        fam.parameters = {
            "exemplars": exemplars,
            "alignment": sig.text_align,
            "headline_chars": band([len(h) for h in heads], [m.source for m in members if m.text.headline]),
            "headline_lines": band([float(n) for n in head_lines], [m.source for m in members if m.text.headline]),
            "footer_chars": band([float(len(" ".join(l.text for l in m.text.footer))) for m in members if getattr(m.text, "footer", None)],
                                 [m.source for m in members if getattr(m.text, "footer", None)]),
            "picture_text_ratio": band(pic_ratio, [m.source for m in members if m.picture_boxes and m.text.headline_box]),
            "device_on": bool(slots["accent"]),
            "accent_hex": max(set(accent_hexes), key=accent_hexes.count) if accent_hexes else None,  # the band's measured colour
            "cta_hex": max(set(h for h in cta_hexes if h), key=cta_hexes.count) if any(cta_hexes) else None,
            "cta_texts": sorted({t for t in cta_texts if t}, key=lambda t: -cta_texts.count(t))[:5],  # the brand's own button phrases
            "footer_texts": sorted({t for t in footer_texts if t}, key=lambda t: -footer_texts.count(t))[:5],  # its own bottom lines (a phone, a handle)
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
