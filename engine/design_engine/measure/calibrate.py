"""Per-client QA floors. Port of measure_qa.calibrate (reference agent, read only): the client's own designed posts set the floors
the gate uses, inside sane bounds; provisional defaults when fewer than six were measurable."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from .bands import empty_bands
from .logo import find_logo_any
from .saliency import largest_quiet_rect, saliency_map

PROVISIONAL = {"dead_space_max": 0.38, "edge_band_max": 0.16, "logo_height_min": 0.06}


def calibrate(post_paths: list[Path], logo_templates: list[tuple[str, np.ndarray]] | None, client: str) -> dict:
    dead, bands, logos, sources = [], [], [], []
    for f in post_paths:
        try:
            arr = np.asarray(Image.open(f).convert("RGB"))
        except Exception:
            continue
        H, W = arr.shape[:2]
        if min(H, W) < 300:
            continue
        sal = saliency_map(arr)
        thresh = np.percentile(sal, 35)
        dead.append(largest_quiet_rect(sal, thresh))
        top, bot = empty_bands(arr, [])
        bands.append(max(top, bot))
        sources.append(str(f))
        if logo_templates:
            m = find_logo_any(arr, logo_templates, min(H, W))
            if m:
                logos.append(m.height_share)

    def pct(v, q):
        return float(np.percentile(v, q)) if v else None

    enough = len(dead) >= 6
    cal = {
        "client": client, "measured_on": len(dead), "sources": sources, "enough_designed_statics": enough,
        "dead_space": {"p50": pct(dead, 50), "p75": pct(dead, 75), "p90": pct(dead, 90)},
        "edge_bands": {"p50": pct(bands, 50), "p75": pct(bands, 75), "p90": pct(bands, 90)},
        "logo_height_share": {"found_in": len(logos), "p25": pct(logos, 25), "p50": pct(logos, 50), "p75": pct(logos, 75)},
    }
    if enough:
        cal["floors"] = {
            "dead_space_max": round(min(0.50, max(0.25, (cal["dead_space"]["p75"] or 0.33) + 0.05)), 3),
            "edge_band_max": round(min(0.30, max(0.10, (cal["edge_bands"]["p75"] or 0.13) + 0.03)), 3),
            "logo_height_min": round(min(0.10, max(0.04, cal["logo_height_share"]["p25"] or 0.06)), 3) if len(logos) >= 4 else 0.06,
            "basis": f"{len(dead)} of the client's own designed posts"
            + (f"; logo size from {len(logos)} template matches" if len(logos) >= 4 else "; logo size is the provisional default (too few reliable matches)"),
        }
    else:
        cal["floors"] = {**PROVISIONAL, "basis": f"provisional defaults: only {len(dead)} designed posts of the client's own were available (minimum 6)"}
    return cal
