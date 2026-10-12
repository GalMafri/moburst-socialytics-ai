"""The video spec Remotion renders, built from measured things only: the platform's video size and safe zone, the family's headline
slot reflowed to that size, the brand's observed pair, font files and logo file, and the cards' copy. Seconds per card come from the
card's word count at a reading pace, inside a floor and a ceiling."""
from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path

from ..compose.place import text_floor_px
from ..compose.template import frame_boxes
from ..compose.typeset import LINE_HEIGHT, fit_block
from ..gate.check import logo_floor_for
from ..measure.logo import ink_aspect
from ..platform.specs import Size

READ_WPS = 2.2  # words per second a viewer reads comfortably on a phone
CARD_MIN_S, CARD_MAX_S = 2.0, 5.0
FPS = 30


def card_seconds(text: str) -> float:
    words = len((text or "").split())
    return round(min(CARD_MAX_S, max(CARD_MIN_S, words / READ_WPS + 0.8)), 2)


END_CARD_S = 2.0  # the closing card: the brand's mark alone on its ground
END_LOGO_W = 0.5  # the mark's width on the closing card as a share of the frame width


def build_spec(profile: Mapping, family: Mapping, size: Size, cards: Sequence[Mapping], fonts: Mapping[str, Path], logo_path: Path,
               pair: Mapping, broll: Path | None = None, captions: Sequence[Mapping] | None = None, plate: Path | None = None,
               end_card: bool = True) -> dict:
    """cards: [{headline, subline?}]. The headline block takes the family's headline slot at this size; the logo its slot, never
    below the client's floor; captions sit above the platform's bottom safe inset."""
    boxes = frame_boxes(dict(family), size, "p50")
    head = boxes.get("headline") or (0.1 * size.w, 0.4 * size.h, 0.8 * size.w, 0.2 * size.h)
    grammar = profile.get("grammar") or {}
    # the card's column: at least the brand's measured text column (a narrow exemplar line must not wrap a sentence word by word);
    # the block may grow to the space between the platform's safe insets, centred on the exemplar's block
    col_w = max(float(head[2]), float((grammar.get("text_column_w") or {}).get("p50") or 0.0) * size.w, 0.6 * size.w)
    safe = size.safe or {}
    top_in, bottom_in = float(safe.get("top", 0)), float(safe.get("bottom", 0))
    max_h = 0.6 * (size.h - top_in - bottom_in)
    cx = float(head[0]) + float(head[2]) / 2
    col_x = min(max(0.06 * size.w, cx - col_w / 2), size.w - col_w - 0.06 * size.w)
    logo = boxes.get("logo") or (0.06 * size.w, 0.05 * size.h, 0.3 * size.w, 0.05 * size.h)
    h_band = grammar.get("headline_h_share") or {}
    s_band = grammar.get("subline_h_share") or {}
    h_px = float(h_band.get("p50") or 0.07) * size.short_edge
    s_px = float(s_band.get("p50") or 0.035) * size.short_edge
    logo_min_h = logo_floor_for(profile, size.w, size.h) * size.short_edge
    lx, ly, lw, lh = logo
    if lh < logo_min_h:
        lw, lh = lw * (logo_min_h / lh), logo_min_h
    # the box takes the file's own aspect so the drawn logo fills it exactly (the gate compares the box to the file)
    aspect = ink_aspect(logo_path) if Path(logo_path).exists() else None
    if aspect:
        lw = lh * aspect
    align = "center" if (family.get("template") or {}).get("alignment") == "center" else "left"
    head_font, sub_font = Path(fonts["headline"]), Path(fonts.get("subline") or fonts["headline"])

    def fitted(text: str, font: Path, px: float, band: Mapping, max_lines: int) -> tuple[str, float, float]:
        """(text with the fitted line breaks, size px, block height px); without a font file on disk the text is left as is."""
        if not text or not font.exists():
            return text, px, px * LINE_HEIGHT * max(1, text.count("\n") + 1)
        floor = min(text_floor_px(band, size), px)
        fit = fit_block(text, font, px, floor, int(col_w), int(max_h), max_lines)
        return "\n".join(fit.lines) if fit.lines else text, fit.size_px, fit.block_h
    spec = {
        "width": size.w, "height": size.h, "fps": FPS,
        "fonts": {"headline": str(fonts["headline"]), "subline": str(fonts.get("subline") or fonts["headline"])},
        "logo": {"path": str(logo_path), "box": {"x": lx / size.w, "y": ly / size.h, "w": lw / size.w, "h": lh / size.h}},
        "broll": {"path": str(broll), "darken": 0.45} if broll else None,
        "plate": {"path": str(plate), "darken": 0.0} if plate else None,
        "endCard": None,
        "cards": [],
        "captions": [dict(c) for c in (captions or [])],
        "captionStyle": {"ink": pair["ink_hex"], "ground": "rgba(0,0,0,0.6)", "px": round(max(float(size.min_text_px), s_px / 1.25)),
                         "bottomInset": int(safe.get("bottom", 0)) + 40},
    }
    for c in cards:
        head_text, head_px, head_h = fitted(str(c["headline"]), head_font, h_px, h_band, 6)
        sub_text, sub_px, sub_h = fitted(str(c.get("subline") or ""), sub_font, s_px, s_band, 4)
        block_h = head_h + (sub_h + head_px * 0.4 if sub_text else 0.0)
        y = min(max(top_in, float(head[1]) + float(head[3]) / 2 - block_h / 2), size.h - bottom_in - block_h)
        spec["cards"].append({"headline": head_text, "subline": sub_text or None,
                              "seconds": card_seconds(str(c["headline"]) + " " + str(c.get("subline") or "")),
                              "ink": pair["ink_hex"], "ground": pair["ground_hex"],
                              "slot": {"x": col_x / size.w, "y": y / size.h, "w": col_w / size.w, "h": block_h / size.h},
                              "headlinePx": round(head_px, 1), "sublinePx": round(sub_px, 1), "align": align})
    if end_card:
        ew = END_LOGO_W * size.w
        eh = ew / aspect if aspect else ew * 0.3
        spec["endCard"] = {"seconds": END_CARD_S, "ground": pair["ground_hex"],
                           "logoBox": {"x": (size.w - ew) / 2 / size.w, "y": (size.h - eh) / 2 / size.h, "w": ew / size.w, "h": eh / size.h}}
    return spec


def write_spec(spec: Mapping, path: Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"spec": spec}, indent=1))
    return path


def duration_seconds(spec: Mapping) -> float:
    end = float((spec.get("endCard") or {}).get("seconds") or 0.0)
    return round(sum(float(c["seconds"]) for c in spec.get("cards", [])) + end, 2)


__all__ = ["CARD_MAX_S", "CARD_MIN_S", "FPS", "READ_WPS", "build_spec", "card_seconds", "duration_seconds", "write_spec"]
