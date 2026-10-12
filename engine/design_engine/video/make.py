"""A brand video for a post: the post copy as timed text cards in the brand's font and colours, the client's logo file in the
family's slot, at the platform's video size, rendered by Remotion, sampled by ffmpeg and judged frame by frame. No credits are
spent here; b-roll (Seedance) is a separate, priced step the caller may add with `broll`."""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from ..compose.option import pick_logo, pick_pair
from ..platform.specs import Size
from . import gate as vgate
from . import render as vrender
from . import spec as vspec

MAX_CARDS = 5


@dataclass
class VideoResult:
    status: str  # ok | failed
    mp4: Path | None
    poster: Path | None
    seconds: float
    family_key: str | None
    gate: dict
    spec_path: Path | None = None
    failure: str | None = None
    frames: list[Path] = field(default_factory=list)


def cards_from_copy(copy: str, n: int = MAX_CARDS) -> list[dict]:
    """The copy's own lines, in order, one card each; a long line becomes one card per sentence. Nothing is cut or rewritten;
    hashtag lines and language tags are left out."""
    lines = [ln.strip() for ln in (copy or "").splitlines() if ln.strip() and not ln.strip().startswith("#") and not ln.lower().startswith("language:")]
    out: list[dict] = []
    for ln in lines:
        parts = [ln] if len(ln) <= 110 else [p.strip() for p in re.split(r"(?<=[.!?:])\s+", ln) if p.strip()]
        for part in parts:
            if len(out) >= n:
                return out
            out.append({"headline": part})
    return out


def choose_family(profile: dict) -> dict | None:
    fams = [f for f in profile.get("families") or [] if f.get("status") == "family" and {"headline", "logo"} <= set((f.get("template") or {}).get("slots") or {})]
    fams.sort(key=lambda f: -(f.get("seen_count") or 0))
    return fams[0] if fams else None


def make_video(profile: dict, copy: str, size: Size, fonts: dict, logo_files: list[dict], out_dir: Path, broll: Path | None = None,
               cards: int = MAX_CARDS) -> VideoResult:
    fam = choose_family(profile)
    if fam is None:
        return VideoResult("failed", None, None, 0.0, None, {}, failure="no family with a headline and a logo slot")
    pairs = profile.get("observed_pairs") or []
    pair = pick_pair(pairs, 0.02) if pairs else {"ink_hex": "#ffffff", "ground_hex": "#0e1b2e"}
    logo_path, _ = pick_logo(logo_files, 0.02, pair)
    card_list = cards_from_copy(copy, cards)
    if not card_list:
        return VideoResult("failed", None, None, 0.0, fam.get("key"), {}, failure="the post copy has no lines to set")
    spec = vspec.build_spec(profile, fam, size, card_list, fonts, logo_path, pair, broll=broll)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    spec_path = vspec.write_spec(spec, out_dir / "spec.json")
    try:
        mp4 = vrender.render(spec, out_dir / "video.mp4")
        frames = vrender.sample_frames(mp4, out_dir / "frames", 1.0)
    except vrender.RenderError as e:
        return VideoResult("failed", None, None, 0.0, fam.get("key"), {}, spec_path, f"render failed: {str(e)[:300]}")
    result = vgate.check_video(frames, spec, size, logo_path, 1.0)
    poster = None
    if frames:
        mid = frames[min(len(frames) - 1, max(1, len(frames) // 3))]
        poster = out_dir / "poster.jpg"
        Image.open(mid).convert("RGB").save(poster, quality=90)
    (out_dir / "gate.json").write_text(json.dumps(result, indent=1))
    status = "ok" if result["passed"] else "failed"
    return VideoResult(status, mp4 if status == "ok" else None, poster, vspec.duration_seconds(spec), fam.get("key"), result, spec_path,
                       None if status == "ok" else "; ".join(result["failures"][:4]), frames)


__all__ = ["MAX_CARDS", "VideoResult", "cards_from_copy", "choose_family", "make_video"]
