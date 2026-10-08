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
    """A slot's [x, y, w, h] in pixels. p25/p75 take the position from the slot's band and keep the median size."""
    x, y, w, h = slot["x"], slot["y"], slot["w"], slot["h"]
    band = slot.get("band") or {}
    if arrangement in ("p25", "p75") and band:
        x = band.get("x", {}).get(arrangement, x) or x
        y = band.get("y", {}).get(arrangement, y) or y
    return x * size.w, y * size.h, w * size.w, h * size.h


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


def _device_box(device: dict, slots: dict, size: Size, arrangement: str) -> tuple[float, float, float, float]:
    if "accent" in slots:
        return slot_px(slots["accent"], size, arrangement)
    t = 0.04 * size.short_edge
    side = device.get("side", "left")
    return {"left": (0, 0, t, size.h), "right": (size.w - t, 0, t, size.h), "top": (0, 0, size.w, t), "bottom": (0, size.h - t, size.w, t)}.get(
        side, (0, 0, t, size.h))


def build_html(family: dict, size: Size, spec: ComposeSpec, fonts: dict[str, Path], logo_path: Path, picture_path: Path | None,
               fit: dict[str, Fit]) -> str:
    tpl = family["template"]
    slots = tpl["slots"]
    arrangement = spec.arrangement if spec.arrangement in ("p25", "p50", "p75") else "p50"
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
    if picture_path is not None:
        if picture_role == "full" or "picture" not in slots:
            box = (0.0, 0.0, float(size.w), float(size.h))
        else:
            box = slot_px(slots["picture"], size, arrangement)
        parts.append(f'<img class="slot" data-slot="picture" src="{_uri(picture_path)}" style="{_pos(*box)}object-fit:cover;">')

    if spec.device:
        accent = spec.accent_hex or family.get("parameters", {}).get("accent_hex") or ink
        for dev in tpl.get("devices") or []:
            x, y, w, h = _device_box(dev, slots, size, arrangement)
            parts.append(f'<div class="slot" data-slot="accent" data-side="{dev.get("side", "")}" style="{_pos(x, y, w, h)}background:{accent};"></div>')

    for role in TEXT_ROLES:
        text = spec.headline if role == "headline" else spec.subline
        if not text or role not in slots or role not in fit:
            continue
        f = fit[role]
        if not f.lines:
            continue
        x, y, w, h = slot_px(slots[role], size, arrangement)
        font_role = role if role in fonts else first_font
        body = html_mod.escape(f.text)
        parts.append(
            f'<div class="slot" data-role="{role}" style="{_pos(x, y, w, h)}text-align:{text_align};">'
            f'<span class="ink" data-slot="{role}" style="font-family:\'Brand-{font_role}\';font-size:{f.size_px:.2f}px;'
            f'line-height:{f.size_px * f.line_height:.2f}px;color:{ink};white-space: pre;">{body}</span></div>'
        )

    if "logo" in slots:
        x, y, w, h = _logo_box(logo_path, slot_px(slots["logo"], size, arrangement), tpl.get("logo_corner", "tl"))
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
