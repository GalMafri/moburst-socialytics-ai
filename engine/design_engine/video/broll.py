"""B-roll for a video: one short text-free clip from Higgsfield (Seedance) in the brand's imagery language, never a face. The brief
is screened like a picture brief (no logo, text or brand name) and refused when it names people; every sampled frame is read by OCR
for lettering before the clip is used. Credits are asked for first (get_cost) and recorded; the caller holds the budget."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from ..picture import brief as brief_mod
from ..picture.higgsfield import HiggsfieldError
from .render import sample_frames

VIDEO_MODEL = "seedance_2_5"
DEFAULT_SECONDS = 10
PEOPLE_WORDS = ("person", "people", "man", "woman", "face", "faces", "portrait", "player", "players", "crowd", "child", "children", "attorney",
                "lawyer", "client", "customer", "team", "footballer", "fan", "fans", "someone", "figure")
_PEOPLE = re.compile(r"(?<![\w-])(?:" + "|".join(PEOPLE_WORDS) + r")(?![\w-])", re.IGNORECASE)


class BrollRefused(ValueError):
    pass


@dataclass
class BrollResult:
    status: str  # ok | dropped
    path: Path | None
    job_ids: list[str]
    credits: float
    reasons: list[str] = field(default_factory=list)


def check_brief(text: str, brand_name: str | None) -> None:
    brief_mod.check(text, brand_name)
    m = _PEOPLE.search(text or "")
    if m:
        raise BrollRefused(f"a b-roll brief may not name {m.group(0)!r}: generated clips carry no people and no faces")


def build_brief(profile: dict, concept: str, aspect: str = "9:16") -> str:
    """The concept in the brand's imagery language, as the picture brief does, plus stillness: slow camera, no people, no lettering."""
    brand = profile.get("client_name") or None
    check_brief(concept, brand)
    imagery = profile.get("imagery") or {}
    looks = [f"{it['kind'].replace('_', ' ')}: {it['description'].rstrip('.')}" for it in imagery.get("items") or []
             if isinstance(it, dict) and it.get("description") and str(it.get("kind", "")).lower() not in brief_mod.PICTURELESS_KINDS
             and brief_mod.is_clean(it["description"], brand) and not _PEOPLE.search(it["description"])]
    parts = [concept.strip().rstrip(".") + "."]
    if looks:
        parts.append("In this brand's own picture language, " + "; ".join(looks[:4]) + ".")
    pal = brief_mod.palette_words(profile.get("palette") or [])
    if pal:
        parts.append("Palette: " + pal + ".")
    parts.append("Slow, steady camera; soft natural motion only; nobody in frame; the lower half calm and even for words placed later.")
    text = " ".join(parts)
    check_brief(text, brand)
    return text + " " + brief_mod.NO_LETTERING


def make_broll(client, profile: dict, concept: str, out_dir: Path, ocr, max_credits: float, seconds: int = DEFAULT_SECONDS,
               aspect: str = "9:16", model: str = VIDEO_MODEL) -> BrollResult:
    """Ask the price, refuse above the budget, generate one clip, download it, sample a frame a second and read each for lettering."""
    text = build_brief(profile, concept, aspect)
    params = {"model": model, "prompt": text, "aspect_ratio": aspect, "duration": seconds, "use_unlim": False}
    cost = client.video_cost(model, params)
    if cost is not None and cost > max_credits:
        raise BrollRefused(f"this clip costs {cost:g} credits, above the budget of {max_credits:g}")
    jobs = client.generate_video([{"index": 0, "params": params}])
    done = next((o for o in client.wait(jobs, budget=900.0) if o.status == "completed" and o.result_url), None)
    if done is None:
        raise HiggsfieldError("Higgsfield finished without returning a clip")
    out_dir = Path(out_dir)
    path = client.download(done.result_url, out_dir / f"broll-{jobs[0].job_id}.mp4")
    reasons: list[str] = []
    for frame in sample_frames(path, out_dir / "broll-frames", 1.0):
        lettered = [ln.text for ln in ocr(frame) if ln.confidence >= 0.6 and sum(c.isalnum() for c in ln.text) >= 3]
        if lettered:
            reasons.append(f"{frame.name}: lettering {lettered[:2]}")
    status = "ok" if not reasons else "dropped"
    return BrollResult(status, path if status == "ok" else None, [j.job_id for j in jobs], float(cost or 0.0), reasons)


__all__ = ["BrollRefused", "BrollResult", "VIDEO_MODEL", "build_brief", "check_brief", "make_broll"]
