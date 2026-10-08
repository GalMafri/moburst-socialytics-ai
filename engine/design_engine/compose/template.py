"""One family template as HTML/CSS: absolute slots from the family's measured fractions scaled to the platform size, the
ground the family carries, its device, the exact logo file in its slot and the fitted copy in the brand's font file.
Every placed element carries data-slot so the renderer can return its box."""
from __future__ import annotations

import html as html_mod
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from ..platform.specs import Size
from .typeset import Fit

BASE_CSS = Path(__file__).with_name("base.css").read_text()
TEXT_ROLES = ("headline", "subline")


@dataclass
class ComposeSpec:
    headline: str
    subline: str | None
    logo_variant: str
    pair: dict  # {ink_hex, ground_hex}: an observed pair from the profile
    device: bool
    arrangement: str  # p50 (the slot medians) | p25 | p75 (positions from the slot bands) | new
    accent_hex: str | None = None  # the device colour; falls back to the family's recorded accent, then the ink
    extra: dict = field(default_factory=dict)


def slot_px(slot: dict, size: Size, arrangement: str = "p50") -> tuple[float, float, float, float]:
    """A slot's [x, y, w, h] in pixels by plain fraction scaling: the path for a size at the family's own aspect."""
    x, y, w, h = _slot_fracs(slot, arrangement)
    return x * size.w, y * size.h, w * size.w, h * size.h


def _slot_fracs(slot: dict, arrangement: str) -> tuple[float, float, float, float]:
    """The slot's fractions; p25/p75 take the position from the slot's band and keep the median size."""
    x, y, w, h = slot["x"], slot["y"], slot["w"], slot["h"]
    band = slot.get("band") or {}
    if arrangement in ("p25", "p75") and band:
        x = band.get("x", {}).get(arrangement, x) or x
        y = band.get("y", {}).get(arrangement, y) or y
    return float(x), float(y), float(w), float(h)


ASPECT_TOLERANCE = 0.03
CENTRED_TOLERANCE = 0.08
FILL_SPAN = 0.6  # a slot spanning this much of the frame along an axis is a fill along it (pictures, bands)


def _fill_axes(name: str, fr: tuple[float, float, float, float]) -> tuple[bool, bool]:
    """Which axes a slot fills (stretches by fraction) instead of keeping its size in short-edge units: a picture on both, a device
    band along the axis it spans, text and logo on neither."""
    if name == "picture":
        return True, True
    if name == "accent":
        return fr[2] >= FILL_SPAN, fr[3] >= FILL_SPAN
    return False, False


def _axis(pos: float, length: float, target: float, ref: float, fill: bool) -> tuple[float, float]:
    """One axis of the reflow. A fill keeps its fractions. Anything else keeps its length in short-edge units; on an axis the target
    extends beyond the family's frame it anchors to the nearer edge with the family's margin (or stays centred); on an axis the target
    compresses, its position scales and it stays inside the frame."""
    if fill:
        return pos * target, length * target
    px_len = length * ref
    if target >= ref:
        centre = pos + length / 2
        if abs(centre - 0.5) < CENTRED_TOLERANCE:
            return (target - px_len) / 2, px_len
        if centre < 0.5:
            return pos * ref, px_len
        return target - (1 - pos - length) * ref - px_len, px_len
    px_len = min(px_len, target)
    return min(max(0.0, pos * target), target - px_len), px_len


def _overlap(a, b) -> bool:
    return not (a[0] + a[2] <= b[0] or b[0] + b[2] <= a[0] or a[1] + a[3] <= b[1] or b[1] + b[3] <= a[1])


def reflow(slots: dict[str, dict], size: Size, ref_aspect: float, arrangement: str = "p50") -> dict[str, tuple[float, float, float, float]]:
    """Every slot of a family measured at `ref_aspect` (W/H) placed into a frame of another aspect. Sizes of text and logo stay in
    short-edge units, margins anchor along an axis that grows, positions scale along an axis that shrinks, pictures and bands take the
    difference, and two slots the family keeps apart stay apart: a fill is cut back from a slot it would now cover, and a later text
    slot is pushed after an earlier one along the compressed axis."""
    S = float(size.short_edge)
    ref_w, ref_h = (S, S / ref_aspect) if ref_aspect < 1 else (S * ref_aspect, S)
    fracs = {name: _slot_fracs(slot, arrangement) for name, slot in slots.items()}
    out: dict[str, list[float]] = {}
    for name, fr in fracs.items():
        fx, fy = _fill_axes(name, fr)
        x, w = _axis(fr[0], fr[2], float(size.w), ref_w, fx)
        y, h = _axis(fr[1], fr[3], float(size.h), ref_h, fy)
        out[name] = [x, y, w, h]
    ref_px = {n: (f[0] * ref_w, f[1] * ref_h, f[2] * ref_w, f[3] * ref_h) for n, f in fracs.items()}
    compressed = 1 if float(size.h) < ref_h - 0.5 else 0 if float(size.w) < ref_w - 0.5 else None
    if compressed is None:
        return {n: tuple(b) for n, b in out.items()}
    # text and logo first, in the family's reading order along the compressed axis: a later one is pushed after an earlier one
    solid = [n for n in fracs if not any(_fill_axes(n, fracs[n]))]
    solid.sort(key=lambda n: ref_px[n][compressed])
    limit = float(size.h) if compressed == 1 else float(size.w)
    for i, later in enumerate(solid):
        for earlier in solid[:i]:
            if not _overlap(ref_px[earlier], ref_px[later]) and _overlap(out[earlier], out[later]):
                out[later][compressed] = out[earlier][compressed] + out[earlier][compressed + 2]
                out[later][compressed] = min(out[later][compressed], limit - out[later][compressed + 2])
    # then the fills give way: cut back along the compressed axis from the side the solid slot sits on
    for name in fracs:
        if name in solid:
            continue
        for other in solid:
            if _overlap(ref_px[name], ref_px[other]) or not _overlap(out[name], out[other]):
                continue
            a, o = out[name], out[other]
            if ref_px[other][compressed] >= ref_px[name][compressed] + ref_px[name][compressed + 2] / 2:
                a[compressed + 2] = max(0.0, o[compressed] - a[compressed])  # the solid slot is after the fill: shorten the fill
            else:
                end = a[compressed] + a[compressed + 2]
                a[compressed] = o[compressed] + o[compressed + 2]  # the solid slot is before the fill: start the fill after it
                a[compressed + 2] = max(0.0, end - a[compressed])
    return {n: tuple(b) for n, b in out.items()}


def frame_boxes(family: dict, size: Size, arrangement: str = "p50") -> dict[str, tuple[float, float, float, float]]:
    """Every slot of the family in pixels at this size: plain fraction scaling when the size has the family's aspect, the reflow
    otherwise. The family's aspect is `parameters.aspect` (W/H of the posts it was measured on); without it, fractions."""
    slots = (family.get("template") or {}).get("slots") or {}
    arrangement = arrangement if arrangement in ("p25", "p50", "p75") else "p50"
    ref = (family.get("parameters") or {}).get("aspect")
    target = size.w / size.h
    if isinstance(ref, (int, float)) and ref > 0 and abs(float(ref) - target) / target > ASPECT_TOLERANCE:
        return reflow(slots, size, float(ref), arrangement)
    return {name: slot_px(slot, size, arrangement) for name, slot in slots.items()}


def _darken(hex_colour: str, share: float = 0.25) -> str:
    c = hex_colour.lstrip("#")
    r, g, b = (int(c[i:i + 2], 16) for i in (0, 2, 4))
    return "#" + "".join(f"{round(v * (1 - share)):02x}" for v in (r, g, b))


def _uri(path: Path) -> str:
    return Path(path).resolve().as_uri()


def _pos(x: float, y: float, w: float, h: float) -> str:
    return f"left:{x:.2f}px;top:{y:.2f}px;width:{w:.2f}px;height:{h:.2f}px;"


def _logo_box(logo_path: Path, slot_box: tuple[float, float, float, float], corner: str) -> tuple[float, float, float, float]:
    """The logo drawn at the file's own aspect inside the slot, anchored to the family's logo corner."""
    with Image.open(logo_path) as im:
        lw, lh = im.size
    sx, sy, sw, sh = slot_box
    scale = min(sw / lw, sh / lh)
    w, h = lw * scale, lh * scale
    col = corner[1] if len(corner) == 2 else "l"
    row = corner[0] if len(corner) == 2 else "t"
    x = sx if col == "l" else sx + sw - w if col == "r" else sx + (sw - w) / 2
    y = sy if row == "t" else sy + sh - h if row == "b" else sy + (sh - h) / 2
    return x, y, w, h


def _device_box(device: dict, boxes: dict, size: Size) -> tuple[float, float, float, float]:
    if "accent" in boxes:
        return boxes["accent"]
    t = 0.04 * size.short_edge
    side = device.get("side", "left")
    return {"left": (0, 0, t, size.h), "right": (size.w - t, 0, t, size.h), "top": (0, 0, size.w, t), "bottom": (0, size.h - t, size.w, t)}.get(
        side, (0, 0, t, size.h))


def build_html(family: dict, size: Size, spec: ComposeSpec, fonts: dict[str, Path], logo_path: Path, picture_path: Path | None,
               fit: dict[str, Fit]) -> str:
    tpl = family["template"]
    slots = tpl["slots"]
    arrangement = spec.arrangement if spec.arrangement in ("p25", "p50", "p75") else "p50"
    boxes = frame_boxes(family, size, arrangement)
    ink = spec.pair["ink_hex"]
    ground_hex = spec.pair["ground_hex"]
    kinds = list(tpl.get("ground", {}).get("kinds") or ["flat"])
    picture_role = tpl.get("picture_role", "none")
    align = tpl.get("alignment", "left")
    text_align = "center" if align == "center" else "left"

    faces = []
    for role, path in fonts.items():
        faces.append(f"@font-face {{ font-family: 'Brand-{role}'; src: url('{_uri(path)}'); }}")
    first_font = next(iter(fonts)) if fonts else None

    ground_css = f"background: linear-gradient(180deg, {ground_hex} 0%, {_darken(ground_hex)} 100%);" if "gradient" in kinds and "flat" not in kinds \
        else f"background: {ground_hex};"

    parts: list[str] = []
    if picture_path is not None and picture_role != "none":  # a family without a picture role never draws one
        if picture_role == "full" or "picture" not in slots:
            box = (0.0, 0.0, float(size.w), float(size.h))
        else:
            box = boxes["picture"]
        parts.append(f'<img class="slot" data-slot="picture" src="{_uri(picture_path)}" style="{_pos(*box)}object-fit:cover;">')

    if spec.device:
        accent = spec.accent_hex or family.get("parameters", {}).get("accent_hex") or ink
        for dev in tpl.get("devices") or []:
            x, y, w, h = _device_box(dev, boxes, size)
            parts.append(f'<div class="slot" data-slot="accent" data-side="{dev.get("side", "")}" style="{_pos(x, y, w, h)}background:{accent};"></div>')

    for role in TEXT_ROLES:
        text = spec.headline if role == "headline" else spec.subline
        if not text or role not in slots or role not in fit:
            continue
        f = fit[role]
        if not f.lines:
            continue
        x, y, w, h = boxes[role]
        font_role = role if role in fonts else first_font
        body = html_mod.escape(f.text)
        parts.append(
            f'<div class="slot" data-role="{role}" style="{_pos(x, y, w, h)}text-align:{text_align};">'
            f'<span class="ink" data-slot="{role}" style="font-family:\'Brand-{font_role}\';font-size:{f.size_px:.2f}px;'
            f'line-height:{f.size_px * f.line_height:.2f}px;color:{ink};white-space: pre;">{body}</span></div>'
        )

    if "logo" in slots:
        x, y, w, h = _logo_box(logo_path, boxes["logo"], tpl.get("logo_corner", "tl"))
        parts.append(f'<img class="slot" data-slot="logo" data-variant="{html_mod.escape(spec.logo_variant)}" src="{_uri(logo_path)}" '
                     f'style="{_pos(x, y, w, h)}">')

    return (
        "<!doctype html><html><head><meta charset=\"utf-8\"><style>"
        + BASE_CSS + "\n" + "\n".join(faces)
        + f"\nhtml, body {{ width:{size.w}px; height:{size.h}px; }}\n.frame {{ width:{size.w}px; height:{size.h}px; {ground_css} }}\n"
        + "</style></head><body>"
        + f'<div class="frame" data-family="{html_mod.escape(str(family.get("key", "")))}" data-arrangement="{arrangement}">'
        + "".join(parts)
        + "</div></body></html>"
    )
