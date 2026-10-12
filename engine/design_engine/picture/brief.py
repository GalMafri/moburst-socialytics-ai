"""The picture brief, in the brand's own imagery language, with the quiet zone named and the forbidden words refused.

A picture never carries a logo or text (Global Constraints): the brief may not name a logo, text, headline, wordmark,
caption, letters or the brand itself as something to draw. `check` is the word-level refusal the worker runs before any
credit is spent; `build` composes the brief from the confirmed profile and never lets a profile string trip it either.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from ..measure.image import Box
from .higgsfield import IMAGE_MODEL, nearest_aspect

FORBIDDEN_WORDS = ("logo", "logos", "text", "texts", "headline", "headlines", "wordmark", "wordmarks", "caption", "captions", "letters", "lettering")
DEFAULT_MODEL, DEFAULT_RESOLUTION = IMAGE_MODEL, "2k"
OBJECT_MODEL, OBJECT_QUALITY = "gpt_image_2_5", "high"
MAX_REFERENCES = 3
STRONGER_ZONE_INSTRUCTION = ("leave the {side} of the frame completely empty: one flat colour or one smooth gradient only, "
                             "nothing drawn, placed or textured there at all; every subject sits in the {other}")

# colour words for the palette, nearest by RGB distance
_NAMED = {
    "black": (0, 0, 0), "white": (255, 255, 255), "off-white": (245, 243, 238), "light grey": (200, 200, 200), "grey": (128, 128, 128),
    "charcoal": (55, 55, 60), "navy": (20, 40, 70), "blue": (40, 90, 200), "sky blue": (120, 180, 240), "teal": (0, 128, 128),
    "green": (40, 140, 70), "lime": (170, 220, 60), "yellow": (240, 210, 40), "gold": (200, 160, 40), "orange": (240, 140, 30),
    "red": (200, 40, 40), "pink": (235, 120, 170), "purple": (120, 60, 160), "brown": (120, 80, 50), "beige": (225, 205, 170),
}


class BriefRefused(ValueError):
    pass


@dataclass
class Brief:
    text: str
    reference_paths: list[Path]
    model: str
    params: dict
    aspect: str = "4:5"
    brand_name: str | None = None
    zone_instruction: str = ""
    zone_side: tuple[str, str] | None = ("upper part", "lower part")  # None: no text sits on the picture, nothing to keep calm
    reference_urls: list[str] = field(default_factory=list)  # hosted copies of reference_paths, filled by the caller before the real call
    reference_media_ids: list[str] = field(default_factory=list)  # references already in Higgsfield storage (client.upload)


PICTURELESS_KINDS = {"text_only", "typography", "type_only", "ghost_mark", "logo", "wordmark"}  # imagery items that describe type or marks, never a picture


def forbidden_pattern(brand_name: str | None = None) -> re.Pattern:
    words = list(FORBIDDEN_WORDS)
    if brand_name and brand_name.strip():
        words.append(r"\s+".join(re.escape(w) for w in brand_name.split()))
    return re.compile(r"(?<![\w-])(?:" + "|".join(words) + r")(?![\w-])", re.IGNORECASE)


def check(text: str, brand_name: str | None = None) -> None:
    """Raise BriefRefused when the text names a logo, text, headline, wordmark, caption, letters or the brand (whole words, any case)."""
    m = forbidden_pattern(brand_name).search(text or "")
    if m:
        raise BriefRefused(f"a picture brief may not name {m.group(0)!r}: pictures never carry a logo, text or the brand name")


def is_clean(text: str, brand_name: str | None = None) -> bool:
    return forbidden_pattern(brand_name).search(text or "") is None


def colour_word(hex_value: str) -> str:
    h = (hex_value or "").lstrip("#")
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except ValueError:
        return "colour"
    return min(_NAMED, key=lambda n: (_NAMED[n][0] - r) ** 2 + (_NAMED[n][1] - g) ** 2 + (_NAMED[n][2] - b) ** 2)


def palette_words(palette: list[dict]) -> str:
    parts = []
    for role in ("ground", "ink", "accent"):
        for s in palette:
            if s.get("role") == role and s.get("hex"):
                parts.append(f"{colour_word(s['hex'])} ({s['hex']}) as the {role}")
                break
    return ", ".join(parts)


def zone_sides(slot_zone: dict) -> tuple[str, str, int]:
    """(the zone's side, the opposite side, the share in percent) for a fractional {x, y, w, h} zone."""
    x, y, w, h = (float(slot_zone.get(k, 0.0)) for k in ("x", "y", "w", "h"))
    if w >= h or w >= 0.6:
        if y + h / 2 < 0.5:
            return "upper", "lower", round((y + h) * 100)
        return "lower", "upper", round((1 - y) * 100)
    if x + w / 2 < 0.5:
        return "left", "right", round((x + w) * 100)
    return "right", "left", round((1 - x) * 100)


def zone_instruction(slot_zone: dict) -> str:
    side, _other, pct = zone_sides(slot_zone)
    return f"keep the {side} {pct}% calm and uncluttered: no objects, no texture, a plain or softly graded field"


def without_clause(text: str) -> str:
    """The brief without the worker's own no-lettering clause, for the screen that forbids the model those words."""
    return (text or "").replace(NO_LETTERING, "")


def stronger(brief: Brief) -> str:
    if not brief.zone_side:
        return brief.text
    side, other = brief.zone_side
    return f"{brief.text} {STRONGER_ZONE_INSTRUCTION.format(side=side, other=other)}."


def _overlaps(a: Box, b: Box) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return not (ax + aw <= bx or bx + bw <= ax or ay + ah <= by or by + bh <= ay)


def reference_crops(reads: list, ref_dir: Path, limit: int = MAX_REFERENCES) -> list[Path]:
    """Crops of the client's own picture regions that carry neither text nor logo, written to ref_dir; at most `limit`, one per read."""
    out: list[Path] = []
    ref_dir = Path(ref_dir)
    for i, r in enumerate(reads):
        if len(out) >= limit:
            break
        d = r if isinstance(r, dict) else {"path": r.path, "logo": {"box": r.logo.box} if r.logo else None,
                                           "lines": [{"box": line.box} for line in r.lines], "picture_boxes": r.picture_boxes}
        keep_out: list[Box] = [line["box"] for line in d.get("lines") or [] if line.get("box")]
        if d.get("logo") and d["logo"].get("box"):
            keep_out.append(d["logo"]["box"])
        for box in d.get("picture_boxes") or []:
            if any(_overlaps(box, k) for k in keep_out):
                continue
            x, y, w, h = (round(v) for v in box)
            if w < 32 or h < 32:
                continue
            try:
                im = Image.open(d["path"]).convert("RGB").crop((x, y, x + w, y + h))
            except (OSError, ValueError):
                break
            ref_dir.mkdir(parents=True, exist_ok=True)
            path = ref_dir / f"ref-{i}.png"
            im.save(path)
            out.append(path)
            break
    return out


NO_LETTERING = ("No lettering, numbers, signage, logos, badges, crests, interface elements, buttons or captions anywhere in the picture; "
                "the copy and the mark are added afterwards by the layout.")
USE_REFERENCES = False  # the client's own crops fed as image references were pasted into the pictures (icons, headshots, footers)


def build(profile: dict, family: dict, slot_zone: dict | None, concept: str, platform: str, reads: list | None = None,
          ref_dir: Path | None = None, legible_objects: bool = False, use_references: bool = USE_REFERENCES,
          picture_aspect: float | None = None) -> Brief:
    """The brief for one picture: the concept in the brand's imagery language, the palette as words, the quiet zone named, the aspect
    from the family; refused before anything else when the concept names a logo, text or the brand."""
    brand = profile.get("client_name") or None
    check(concept, brand)
    imagery = profile.get("imagery") or {}
    # The learned imagery items describe the client's whole posts (quote cards with headshots, flyers, screens showing a match)
    # and pasted into every prompt they came back as lettered cards and signage. The planner reads them in the brand summary and
    # writes the concept in that language; the prompt carries the concept, the grounds, the palette and the never list only.
    lines = [concept.strip().rstrip(".") + "."]
    grounds = [g for g in imagery.get("grounds") or [] if is_clean(g, brand)]
    if grounds:
        lines.append("Grounds the brand uses: " + ", ".join(grounds) + ".")
    pal = palette_words(profile.get("palette") or [])
    if pal:
        lines.append("Palette: " + pal + ".")
    never = [n for n in imagery.get("never") or [] if is_clean(n, brand)]
    if never:
        lines.append("Never: " + "; ".join(never) + ".")
    instruction = zone_instruction(slot_zone) if slot_zone else ""
    if instruction:
        lines.append(instruction[0].upper() + instruction[1:] + ".")
    lines.append(f"A single still picture for {platform}, photographic realism unless the brand's own pictures are illustrated.")
    text = " ".join(lines)
    check(text, brand)  # the model's concept and the profile's words are screened; the worker's own clause follows the screen
    text = text + " " + NO_LETTERING
    zone_side = None
    if slot_zone:
        side, other, _pct = zone_sides(slot_zone)
        zone_side = (f"{side} part", f"{other} part")
    # the picture is asked for at the shape it will fill (the family's picture slot at this size), so object-fit cover crops nothing
    # that matters; the family's frame aspect only when no slot shape is known
    ratio = picture_aspect if isinstance(picture_aspect, (int, float)) and picture_aspect > 0 else (family.get("parameters") or {}).get("aspect")
    aspect = nearest_aspect(float(ratio)) if isinstance(ratio, (int, float)) and ratio > 0 else "4:5"
    if legible_objects and imagery.get("people") == "none":
        model, params = OBJECT_MODEL, {"model": OBJECT_MODEL, "aspect_ratio": aspect, "resolution": DEFAULT_RESOLUTION, "quality": OBJECT_QUALITY,
                                       "use_unlim": False}
    else:
        model, params = DEFAULT_MODEL, {"model": DEFAULT_MODEL, "aspect_ratio": aspect, "resolution": DEFAULT_RESOLUTION, "use_unlim": False}
    refs = reference_crops(reads, ref_dir, MAX_REFERENCES) if use_references and reads and ref_dir else []
    return Brief(text=text, reference_paths=refs, model=model, params=params, aspect=aspect, brand_name=brand, zone_instruction=instruction,
                 zone_side=zone_side)
