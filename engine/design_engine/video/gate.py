"""The video gate: sampled frames through the static gate's own measures (logo from the file, text contrast and busy ground, safe
zone), captions checked against the transcript when there is one. A frame with no card on it (a transition) is judged on the logo
and the safe zone only. No face may appear in a generated clip: that check belongs to the b-roll step, before anything is rendered."""
from __future__ import annotations

from pathlib import Path

from ..gate.check import LOGO_CONTRAST_MIN, LOGO_MATCH_MIN, TEXT_CONTRAST_MIN, _logo_match, _ground_under
from ..measure.contrast import busy_ground, ink_vs_ground
from ..measure.image import crop, load_rgb
from ..platform.specs import Size
from ..compose.place import BUSY_MAX


FADE_MARGIN_S = 0.6  # the composition fades a card over at most a third of a second at each end


def _px(box: dict, size: Size) -> list[float]:
    return [box["x"] * size.w, box["y"] * size.h, box["w"] * size.w, box["h"] * size.h]


def check_frame(png: Path, spec: dict, size: Size, second: float, logo_path: Path) -> list[str]:
    """Failures on one sampled frame, named with their numbers."""
    fails: list[str] = []
    arr = load_rgb(png)
    cards_end = sum(float(c["seconds"]) for c in spec["cards"])
    end_card = spec.get("endCard") or None
    logo_box = _px(end_card["logoBox"], size) if end_card and second >= cards_end else _px(spec["logo"]["box"], size)
    region = crop(arr, logo_box)
    if region is None:
        fails.append("logo box lies outside the frame")
    else:
        best, _ = _logo_match(region, logo_path, _ground_under(arr, logo_box))
        if best < LOGO_MATCH_MIN:
            fails.append(f"logo is not the file at {second:.0f}s: match {best:.2f} is below {LOGO_MATCH_MIN:.2f}")
        lc = ink_vs_ground(region)
        if lc is not None and lc < LOGO_CONTRAST_MIN:
            fails.append(f"logo contrast {lc:.1f}:1 at {second:.0f}s is below {LOGO_CONTRAST_MIN:.1f}:1")
    # which card is on screen
    t = 0.0
    card = None
    for c in spec["cards"]:
        if t <= second < t + float(c["seconds"]):
            card = c
            break
        t += float(c["seconds"])
    if card is not None and second - t > FADE_MARGIN_S and (t + float(card["seconds"])) - second > FADE_MARGIN_S:  # not in a fade
        box = _px(card["slot"], size)
        region = crop(arr, box)
        if region is not None and region.size:
            c = ink_vs_ground(region)
            b = busy_ground(region)
            if c is not None and c < TEXT_CONTRAST_MIN:
                fails.append(f"card contrast {c:.1f}:1 at {second:.0f}s is below {TEXT_CONTRAST_MIN:.1f}:1")
            if b > BUSY_MAX:
                fails.append(f"card busy ground {b:.2f} at {second:.0f}s is above {BUSY_MAX:.2f}")
        safe = size.safe or {}
        if box[1] < float(safe.get("top", 0)) or box[1] + box[3] > size.h - float(safe.get("bottom", 0)):
            fails.append(f"card leaves the safe zone at {second:.0f}s")
    return fails


def check_video(frames: list[Path], spec: dict, size: Size, logo_path: Path, every_seconds: float = 1.0) -> dict:
    per_frame = {str(p.name): check_frame(p, spec, size, i * every_seconds, logo_path) for i, p in enumerate(frames)}
    failures = [f"{name}: {f}" for name, fs in per_frame.items() for f in fs]
    return {"passed": not failures, "failures": failures, "frames": len(frames)}


__all__ = ["check_frame", "check_video"]
