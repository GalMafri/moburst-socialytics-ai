"""A family must be able to reproduce its own exemplar. Each family without a picture role is rendered from its template with the
exemplar's own words (its headline, subline, footer and button as the post carried them), then judged by the gate's composition
measures with the client's own floors. A family that cannot fill its exemplar's frame is carrying something the learner has not
modelled (a ghosted mark, a panel), and is marked unrenderable: never offered, listed on the board as a limit."""
from __future__ import annotations

from pathlib import Path

from ..compose.option import assemble
from ..gate.check import CONTENT_SPAN_MIN
from ..measure.bands import content_span, empty_bands, largest_free_rect
from ..measure.image import load_rgb
from ..platform.specs import Size


def _size_for(aspect: float) -> Size:
    w, h = (1080, round(1080 / aspect)) if aspect < 1 else (round(1080 * aspect), 1080)
    return Size(f"self-{w}x{h}", w, h, f"{w}:{h}", {"top": 0, "bottom": 0, "left": 0, "right": 0}, 24, 8000, "feed")


def exemplar_copy(fam: dict, reads_by_source: dict) -> dict:
    """The words the exemplar carried, as the read saw them."""
    src = ((fam.get("parameters") or {}).get("exemplars") or [None])[0]
    r = reads_by_source.get(src) if src else None
    if r is None:
        return {}
    text = r.text
    out = {"headline": " ".join(l.text for l in text.headline).strip() or None, "subline": " ".join(l.text for l in text.subline).strip() or None,
           "footer": " ".join(l.text for l in getattr(text, "footer", [])).strip() or None}
    pills = (getattr(r, "extras", {}) or {}).get("pills") or []
    out["cta"] = pills[0].get("text") if pills else None
    return out


def self_test(profile: dict, reads: list, fonts: dict, logo_files: list[dict], out_dir: Path, browser=None) -> dict[str, list[str]]:
    """Failures per family key for every family without a picture role; an empty list means the family reproduces its exemplar."""
    floors = (profile.get("calibration") or {}).get("floors") or {}
    band_max = float(floors.get("edge_band_max", 0.16))
    dead_max = float(floors.get("dead_space_max", 0.38))
    by_source = {r.source: r for r in reads}
    results: dict[str, list[str]] = {}
    out_dir = Path(out_dir)
    for fam in profile.get("families") or []:
        tpl = fam.get("template") or {}
        if fam.get("status") != "family" or tpl.get("picture_role", "none") != "none" or "headline" not in (tpl.get("slots") or {}):
            continue
        copy = exemplar_copy(fam, by_source)
        if not copy.get("headline"):
            continue
        aspect = float((fam.get("parameters") or {}).get("aspect") or 0.8)
        size = _size_for(aspect)
        try:
            r = assemble(profile, fam, size, None, copy, "p50", None, None, fonts, logo_files, out_dir / fam["key"].replace("|", "_"),
                         floors={}, accent_hex=(fam.get("parameters") or {}).get("accent_hex"), browser=browser)
        except Exception as e:  # noqa: BLE001  a family that cannot even typeset its own exemplar is unrenderable, with the reason
            results[fam["key"]] = [f"could not render its exemplar: {str(e)[:160]}"]
            continue
        arr = load_rgb(r.png)
        boxes = [b for k, b in r.boxes.items() if b and k != "subject"]
        top, bot = empty_bands(arr, boxes)
        free = largest_free_rect(size.w, size.h, boxes)
        span = content_span(boxes, size.h)
        fails = []
        if top > band_max:
            fails.append(f"empty top band {top:.2f} above {band_max:.2f}")
        if bot > band_max:
            fails.append(f"empty bottom band {bot:.2f} above {band_max:.2f}")
        if free > dead_max:
            fails.append(f"largest free rectangle {free:.2f} above {dead_max:.2f}")
        if span < CONTENT_SPAN_MIN:
            fails.append(f"content span {span:.2f} below {CONTENT_SPAN_MIN:.2f}")
        results[fam["key"]] = fails
    return results


def apply(profile: dict, results: dict[str, list[str]]) -> int:
    """Mark the failing families unrenderable on the profile; returns how many."""
    n = 0
    for fam in profile.get("families") or []:
        fails = results.get(fam.get("key"))
        if fails:
            fam["status"] = "unrenderable"
            fam["self_test"] = fails
            n += 1
        elif fails == []:
            fam["self_test"] = []
    return n


__all__ = ["apply", "exemplar_copy", "self_test"]
