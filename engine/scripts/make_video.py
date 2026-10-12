"""A first video from a client's measured brand: the post copy as timed text cards in the brand's font on an observed pair, the
client's logo file in the family's slot, at the platform's vertical size, rendered by Remotion, sampled by ffmpeg, judged by the gate.
No b-roll yet (that is the Seedance step with its own credit ask); no credits are spent here.

    uv run python scripts/make_video.py --client "Bader Law" --post-index 2 [--cards 3] [--accept-stand-in <font>]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from run_post import choose_fonts, load_post, slugify

from design_engine.compose.option import pick_logo, pick_pair
from design_engine.config import settings
from design_engine.platform import specs
from design_engine.video import gate as vgate
from design_engine.video import render as vrender
from design_engine.video import spec as vspec


def cards_from_copy(copy: str, n: int) -> list[dict]:
    """The copy's own lines, in order, one card each: the first non-empty lines without hashtags."""
    lines = [ln.strip() for ln in (copy or "").splitlines() if ln.strip() and not ln.strip().startswith("#") and not ln.lower().startswith("language:")]
    out = []
    for ln in lines:
        if len(out) >= n:
            break
        out.append({"headline": ln[:90]})
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client", required=True)
    ap.add_argument("--post-index", type=int, required=True)
    ap.add_argument("--cards", type=int, default=3)
    ap.add_argument("--accept-stand-in", default=None)
    ap.add_argument("--platform", default="Instagram")
    args = ap.parse_args()
    ws = settings().work_dir / slugify(args.client)
    profile = json.loads((ws / "out" / "profile.json").read_text())
    post = load_post(ws, args.post_index)
    size = specs.sizes_for(args.platform, "Story")[0]
    # a family with a headline and a logo slot, the most observed; portrait families reflow into 9:16
    fams = [f for f in profile.get("families") or [] if f.get("status") == "family" and {"headline", "logo"} <= set((f.get("template") or {}).get("slots") or {})]
    if not fams:
        raise SystemExit("no family with a headline and a logo slot")
    fam = fams[0]
    headline_font, subline_font, _ = choose_fonts(profile, args.accept_stand_in, ws / "website" / "fonts")
    logo_files = [{**f, "path": str(ws / f["path"])} for f in (profile.get("logo") or {}).get("files") or []]
    pair = pick_pair(profile.get("observed_pairs") or [], None)
    # a dark pair reads best on video; take the darkest-ground observed pair that clears contrast
    pairs = profile.get("observed_pairs") or []
    if pairs:
        from design_engine.compose.place import hex_lum
        pair = pick_pair(pairs, 0.02)
    logo_path, _ = pick_logo(logo_files, 0.02, pair)
    cards = cards_from_copy(str(post.get("copy") or ""), args.cards)
    spec = vspec.build_spec(profile, fam, size, cards, {"headline": headline_font, "subline": subline_font}, logo_path, pair)
    out_dir = ws / "video" / time.strftime("%Y%m%d-%H%M%S") + f"-post{args.post_index}" if False else ws / "video" / (time.strftime("%Y%m%d-%H%M%S") + f"-post{args.post_index}")
    out_dir.mkdir(parents=True, exist_ok=True)
    vspec.write_spec(spec, out_dir / "spec.json")
    mp4 = vrender.render(spec, out_dir / "video.mp4")
    frames = vrender.sample_frames(mp4, out_dir / "frames", 1.0)
    result = vgate.check_video(frames, spec, size, logo_path, 1.0)
    (out_dir / "gate.json").write_text(json.dumps(result, indent=1))
    print(f"family {fam['key']}; {len(cards)} cards, {vspec.duration_seconds(spec)} s; {len(frames)} frames sampled; gate {'PASSED' if result['passed'] else 'FAILED'}")
    for f in result["failures"][:12]:
        print("  ", f)
    print("out:", out_dir)


if __name__ == "__main__":
    main()
