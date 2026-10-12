"""The video spec Remotion renders, built from measured things only: the platform's video size and safe zone, the family's headline
slot reflowed to that size, the brand's observed pair, font files and logo file, and the cards' copy. Seconds per card come from the
card's word count at a reading pace, inside a floor and a ceiling."""
from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path

from ..compose.template import frame_boxes
from ..gate.check import logo_floor_for
from ..measure.logo import ink_aspect
from ..platform.specs import Size

READ_WPS = 2.2  # words per second a viewer reads comfortably on a phone
CARD_MIN_S, CARD_MAX_S = 2.0, 5.0
FPS = 30


def card_seconds(text: str) -> float:
    words = len((text or "").split())
    return round(min(CARD_MAX_S, max(CARD_MIN_S, words / READ_WPS + 0.8)), 2)


def build_spec(profile: Mapping, family: Mapping, size: Size, cards: Sequence[Mapping], fonts: Mapping[str, Path], logo_path: Path,
               pair: Mapping, broll: Path | None = None, captions: Sequence[Mapping] | None = None) -> dict:
    """cards: [{headline, subline?}]. The headline block takes the family's headline slot at this size; the logo its slot, never
    below the client's floor; captions sit above the platform's bottom safe inset."""
    boxes = frame_boxes(dict(family), size, "p50")
    head = boxes.get("headline") or (0.1 * size.w, 0.4 * size.h, 0.8 * size.w, 0.2 * size.h)
    logo = boxes.get("logo") or (0.06 * size.w, 0.05 * size.h, 0.3 * size.w, 0.05 * size.h)
    grammar = profile.get("grammar") or {}
    h_px = float((grammar.get("headline_h_share") or {}).get("p50") or 0.07) * size.short_edge
    s_px = float((grammar.get("subline_h_share") or {}).get("p50") or 0.035) * size.short_edge
    logo_min_h = logo_floor_for(profile, size.w, size.h) * size.short_edge
    lx, ly, lw, lh = logo
    if lh < logo_min_h:
        lw, lh = lw * (logo_min_h / lh), logo_min_h
    # the box takes the file's own aspect so the drawn logo fills it exactly (the gate compares the box to the file)
    aspect = ink_aspect(logo_path) if Path(logo_path).exists() else None
    if aspect:
        lw = lh * aspect
    safe = size.safe or {}
    align = "center" if (family.get("template") or {}).get("alignment") == "center" else "left"
    spec = {
        "width": size.w, "height": size.h, "fps": FPS,
        "fonts": {"headline": str(fonts["headline"]), "subline": str(fonts.get("subline") or fonts["headline"])},
        "logo": {"path": str(logo_path), "box": {"x": lx / size.w, "y": ly / size.h, "w": lw / size.w, "h": lh / size.h}},
        "broll": {"path": str(broll), "darken": 0.45} if broll else None,
        "cards": [{"headline": str(c["headline"]), "subline": c.get("subline") or None, "seconds": card_seconds(str(c["headline"]) + " " + str(c.get("subline") or "")),
                   "ink": pair["ink_hex"], "ground": pair["ground_hex"],
                   "slot": {"x": head[0] / size.w, "y": head[1] / size.h, "w": head[2] / size.w, "h": head[3] / size.h},
                   "headlinePx": round(h_px / 1.15), "sublinePx": round(s_px / 1.25), "align": align} for c in cards],
        "captions": [dict(c) for c in (captions or [])],
        "captionStyle": {"ink": pair["ink_hex"], "ground": "rgba(0,0,0,0.6)", "px": round(max(float(size.min_text_px), s_px / 1.25)),
                         "bottomInset": int(safe.get("bottom", 0)) + 40},
    }
    return spec


def write_spec(spec: Mapping, path: Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"spec": spec}, indent=1))
    return path


def duration_seconds(spec: Mapping) -> float:
    return round(sum(float(c["seconds"]) for c in spec.get("cards", [])), 2)


__all__ = ["CARD_MAX_S", "CARD_MIN_S", "FPS", "READ_WPS", "build_spec", "card_seconds", "duration_seconds", "write_spec"]
