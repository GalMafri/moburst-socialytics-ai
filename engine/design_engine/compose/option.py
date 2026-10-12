"""One option at one size: the copy typeset at the brand size against the client's floor, the ink and the logo variant chosen
from an observed pair whose ground matches what is measured under the text, the family template rendered through Chromium.
A line that cannot fit at the floor raises OverflowError naming the slot: the run loop turns that into "shorten the copy"."""
from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

from ..measure.image import Box, contrast, rel_lum
from ..gate.check import TEXT_CONTRAST_MIN, logo_floor_for
from ..measure.logo import ink_aspect
from ..platform.specs import Size
from . import place
from .place import Arrangement, hex_lum
from .render import render_html
from .template import ComposeSpec, build_html
from .typeset import LINE_HEIGHT, Fit, fit_block

LOGO_FLOOR_MARGIN = 1.10  # the logo is drawn a tenth above the client's floor (still under its median): a lockup at the floor on a landscape frame blurs to the match floor
TEXT_ROLES = ("headline", "subline", "footer")
DEFAULT_MAX_LINES = {"headline": 3, "subline": 2, "footer": 1}
GROUND_TAGS = ("dark", "light")


@dataclass
class Rendered:
    png: Path
    boxes: dict[str, Box]
    spec: ComposeSpec
    html: str
    fit: dict[str, Fit] = field(default_factory=dict)
    arrangement: str = "p50"  # the arrangement's name (p25 | p50 | p75 | a custom name)
    logo_path: Path | None = None
    ground_lum: float | None = None  # measured under the headline slot
    logo_ground_lum: float | None = None  # measured under the logo slot
    text_px: dict[str, dict] = field(default_factory=dict)  # role -> {size, floor, max_lines}


def _as_arrangement(family: dict, size: Size, arrangement: Arrangement | str | Mapping) -> Arrangement:
    if isinstance(arrangement, Arrangement):
        return arrangement
    if isinstance(arrangement, str):
        if arrangement not in place.NAMED:
            raise ValueError(f"unknown arrangement {arrangement!r}; named arrangements are {', '.join(place.NAMED)}")
        return Arrangement(arrangement, place.boxes_for(family, size, arrangement))
    name, overrides = place._overrides(arrangement)
    return Arrangement(name, place.boxes_for(family, size, arrangement), overrides)


def _max_lines(family: dict, role: str, floors: Mapping) -> int:
    explicit = floors.get(f"{role}_lines")
    if isinstance(explicit, (int, float)) and explicit >= 1:
        return int(explicit)
    band = (family.get("parameters") or {}).get(f"{role}_lines") or {}
    p75 = band.get("p75")
    if isinstance(p75, (int, float)) and p75 >= 1:
        return int(np.ceil(p75))
    return DEFAULT_MAX_LINES[role]


def _typeset(profile: dict, family: dict, size: Size, copy: Mapping, boxes: dict[str, Box], fonts: Mapping[str, Path],
             floors: Mapping) -> tuple[dict[str, Fit], dict[str, dict]]:
    grammar = profile.get("grammar") or {}
    first_font = next(iter(fonts.values())) if fonts else None
    fits: dict[str, Fit] = {}
    text_px: dict[str, dict] = {}
    for role in TEXT_ROLES:
        text = copy.get(role)
        if not text or role not in boxes:
            continue
        band = grammar.get(f"{role}_h_share") or {}
        p50 = band.get("p50")
        if role == "footer" and p50 is None:  # the footer's size is its slot: a single line at the family's measured height
            _fx, _fy, _fw, fh = boxes[role]
            p50, band = fh / LINE_HEIGHT / size.short_edge, {"p25": 0.8 * fh / LINE_HEIGHT / size.short_edge}
        if p50 is None:
            raise ValueError(f"profile.grammar.{role}_h_share has no p50: the brand size of the {role} is unmeasured")
        size_px = float(p50) * size.short_edge
        floor_px = min(place.text_floor_px(band, size, floors.get(role)), size_px)
        font = fonts.get(role) or first_font
        if font is None:
            raise ValueError(f"no font file for the {role}")
        _x, _y, w, h = boxes[role]
        max_lines = _max_lines(family, role, floors)
        fit = fit_block(str(text), Path(font), size_px, floor_px, int(w), int(h), max_lines)
        if fit.overflow:
            raise OverflowError(f"{role} does not fit {size.name} at the client's floor {floor_px:.0f}px: "
                                f"{len(fit.lines)} lines of {len(str(text).split())} words in a {int(w)}x{int(h)}px slot (max {max_lines} lines)")
        fits[role] = fit
        text_px[role] = {"size": round(fit.size_px, 2), "brand": round(size_px, 2), "floor": round(floor_px, 2), "max_lines": max_lines}
    return fits, text_px


def pick_pair(pairs: Sequence[Mapping], ground_lum: float | None, contrast_min: float = TEXT_CONTRAST_MIN) -> dict:
    """The observed pair whose ground is closest in luminance to the measured ground, among the pairs whose ink clears the contrast
    floor against that measured ground; when none clears it, the pair whose ink contrasts most. The first pair when nothing was measured."""
    if not pairs:
        raise ValueError("no observed pair to compose with: the profile carries no observed_pairs")
    if ground_lum is None:
        return dict(pairs[0])
    legible = [p for p in pairs if contrast(hex_lum(p["ink_hex"]), ground_lum) >= contrast_min]
    if legible:
        return dict(min(legible, key=lambda p: abs(hex_lum(p["ground_hex"]) - ground_lum)))
    return dict(max(pairs, key=lambda p: contrast(hex_lum(p["ink_hex"]), ground_lum)))


def _ground_tag(entry: Mapping) -> str | None:
    """dark | light when the file is tagged for a ground: an explicit `ground`, or a `variant` named for the ground the way the
    logo matcher names it (on_dark, on_light). A file name is never read as a tag: "logo-dark" may describe the ink."""
    ground = str(entry.get("ground") or "").lower()
    if ground in GROUND_TAGS:
        return ground
    variant = str(entry.get("variant") or "").lower()
    for tag in GROUND_TAGS:
        if variant == f"on_{tag}" or variant.startswith(f"on_{tag}_"):
            return tag
    return None


def _ink_lum(path: Path) -> float | None:
    """Mean relative luminance of the file's ink (its opaque pixels)."""
    with Image.open(path) as im:
        rgba = np.asarray(im.convert("RGBA"))
    mask = rgba[..., 3] > 128
    if not mask.any():
        return None
    return float(rel_lum(rgba[..., :3][mask]).mean())


def _by_slot_aspect(files: list[dict], slot_aspect: float | None) -> list[dict]:
    """The files ordered by how close their ink aspect sits to the slot's: a square slot the posts carry takes the mark file, a wide
    one the lockup. Order unchanged when no slot aspect is known."""
    if slot_aspect is None or len(files) < 2:
        return files

    def distance(f: Mapping) -> float:
        a = ink_aspect(Path(str(f["path"])))
        return abs(math.log(a / slot_aspect)) if a else 9.0

    return sorted(files, key=distance)


def pick_logo(logo_files: Sequence[Mapping], ground_lum: float | None, pair: Mapping, logo_variant: str | None = None,
              slot_aspect: float | None = None) -> tuple[Path, str]:
    """The logo file for this ground and the variant name recorded on the spec. An explicit `logo_variant` naming a file's
    `variant`, `ground` tag or stem is honoured. Otherwise the ground the pair reads on (dark when its ink is lighter than its
    ground) selects a file tagged for that ground; among those, the file whose ink aspect fits the slot the posts carry (the mark
    for a square slot, the lockup for a wide one); untagged files are measured: the one whose ink contrasts most with the ground."""
    files = _by_slot_aspect([dict(f) for f in logo_files if f.get("path")], slot_aspect)
    if not files:
        raise ValueError("no logo file to place: the profile carries no logo files")
    if logo_variant:
        want = str(logo_variant).lower()
        for f in files:
            if want in {str(f.get("variant", "")).lower(), str(f.get("ground", "")).lower(), Path(str(f["path"])).stem.lower()}:
                return Path(str(f["path"])), str(f.get("ground") or f.get("variant") or logo_variant)
    dark_ground = hex_lum(pair["ink_hex"]) > hex_lum(pair["ground_hex"])
    want_tag = "dark" if dark_ground else "light"
    tagged = [f for f in files if _ground_tag(f) == want_tag]
    if tagged:
        return Path(str(tagged[0]["path"])), want_tag
    if len(files) == 1:
        return Path(str(files[0]["path"])), want_tag
    lum = ground_lum if ground_lum is not None else hex_lum(pair["ground_hex"])
    best, best_c = files[0], -1.0
    for f in files:
        ink = _ink_lum(Path(str(f["path"])))
        c = contrast(ink, lum) if ink is not None else 0.0
        if c > best_c:
            best, best_c = f, c
    return Path(str(best["path"])), want_tag


def assemble(profile: dict, family: dict, size: Size, picture_path: Path | str | None, copy: Mapping, arrangement: Arrangement | str | Mapping,
             pair: Mapping | Sequence[Mapping] | None, logo_variant: str | None, fonts: Mapping[str, Path], logo_files: Sequence[Mapping],
             out_dir: Path | str, floors: Mapping | None = None, accent_hex: str | None = None, browser=None) -> Rendered:
    """Typeset, choose the pair and the logo file by the measured ground, build the template and render to out_dir/<size.name>.png.

    `pair`: a dict is used as given (the caller's explicit choice); a list is the pool to pick from; None picks from
    `profile["observed_pairs"]`. `logo_files` entries are `{path, variant?, ground?}` with absolute paths. `floors` may raise a
    role's floor in px (`headline`, `subline`) or set its line cap (`headline_lines`, `subline_lines`)."""
    floors = floors or {}
    arr = _as_arrangement(family, size, arrangement)
    fam = place.family_for(family, arr)
    tname = arr.template_name
    boxes = place.boxes_for(fam, size, tname)
    headline = copy.get("headline")
    if not headline:
        raise ValueError("an option needs a headline")
    fits, text_px = _typeset(profile, fam, size, copy, boxes, fonts, floors)

    ground_lum = place.ground_under(picture_path, fam, size, tname, boxes["headline"]) if "headline" in boxes else None
    logo_ground_lum = place.ground_under(picture_path, fam, size, tname, boxes["logo"]) if "logo" in boxes else None
    if isinstance(pair, Mapping):
        chosen = dict(pair)
    else:
        chosen = pick_pair(list(pair) if pair is not None else list(profile.get("observed_pairs") or []), ground_lum)
    logo_slot = boxes.get("logo")
    slot_aspect = (logo_slot[2] / logo_slot[3]) if logo_slot and logo_slot[3] > 0 else None
    logo_path, variant = pick_logo(logo_files, ground_lum, chosen, logo_variant, slot_aspect)

    tpl = fam.get("template") or {}
    params = fam.get("parameters") or {}
    device = bool(tpl.get("devices")) and bool(params.get("device_on", True))
    spec = ComposeSpec(headline=str(headline), subline=str(copy["subline"]) if copy.get("subline") else None, logo_variant=variant,
                       footer=str(copy["footer"]) if copy.get("footer") else None,
                       pair=chosen, device=device, arrangement=tname, accent_hex=accent_hex or params.get("accent_hex"),
                       extra={"arrangement_name": arr.name, "overrides": arr.overrides, "shares": arr.shares})
    logo_min_h = logo_floor_for(profile, size.w, size.h) * size.short_edge * LOGO_FLOOR_MARGIN
    html = build_html(fam, size, spec, dict(fonts), logo_path, Path(picture_path) if picture_path is not None else None, fits, logo_min_h=logo_min_h)
    png = Path(out_dir) / f"{size.name}.png"
    rendered = render_html(html, size.w, size.h, png, browser)
    return Rendered(png, rendered, spec, html, fits, arr.name, logo_path, ground_lum, logo_ground_lum, text_px)


__all__ = ["Rendered", "assemble", "pick_logo", "pick_pair"]
