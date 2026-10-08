"""Run the per-post loop for one calendar post of one client against the local workspace.

    uv run python scripts/run_post.py --client "Bader Law" --post-index 2 [--accept-stand-in <font file>] [--dry-run]
                                      [--max-credits 30] [--model claude-opus-5-5]

Loads work/<slug>/out/profile.json (families included), the reads cache out/reads.json, calendar_posts.json[N], the sizes for the post's
platform and format, the earlier runs under work/<slug>/runs, the font files and the logo files, then runs `loop.run_post` with one shared
Chromium. The model is always real (dollars are counted); `--dry-run` swaps Higgsfield for a FakeClient fed with the client's own picture
crops so renders and the gate run for real and no credit is spent. A client whose type is unresolved runs only with `--accept-stand-in`.

Writes the run dir (options.json, spent.json, renders, transcript.jsonl) plus run.json with what the proof sheet prints.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from learn_client import is_designed, load_reads, slugify

from design_engine.compose.render import chromium
from design_engine.config import settings
from design_engine.picture import zone as zone_mod
from design_engine.picture.higgsfield import FakeClient
from design_engine.platform import specs
from design_engine.run import loop, record
from design_engine.run.tools import Budget, RunContext, quiet_zone

FORMAT_ALIASES = {"image": "Single Image", "single image": "Single Image", "carousel": "Carousel", "story": "Story"}
STYLE_WORDS = ("thin", "extralight", "extra light", "light", "regular", "medium", "semibold", "semi bold", "demibold", "bold", "extrabold",
               "extra bold", "black", "heavy", "italic", "book", "normal")
FONT_SUFFIXES = (".ttf", ".otf")
MIN_CROP_PX = 240
MAX_CROP_CANDIDATES = 40
TOP_FAMILIES_FOR_ZONE = 5


# ---- post and sizes ----


def format_key(fmt: str | None) -> str:
    return FORMAT_ALIASES.get(str(fmt or "Single Image").strip().lower(), str(fmt or "Single Image").strip())


def sizes_for_post(platform: str, fmt: str) -> tuple[str, list[specs.Size]]:
    """The platform key the specs table knows and its sizes; a name like "Twitter/X" is tried whole, then part by part."""
    tried = [platform.strip()] + [p.strip() for p in platform.split("/") if p.strip()]
    last: KeyError | None = None
    for name in tried:
        try:
            return name, specs.sizes_for(name, fmt)
        except KeyError as e:
            last = e
    raise SystemExit(f"no sizes for platform {platform!r} and format {fmt!r}: {last}")


def load_post(ws: Path, index: int) -> dict:
    posts = json.loads((ws / "calendar_posts.json").read_text())
    posts = posts if isinstance(posts, list) else list(posts.values())
    if not 0 <= index < len(posts):
        raise SystemExit(f"post index {index} is out of range; the calendar has {len(posts)} posts")
    return posts[index]


# ---- fonts ----


def font_info(path: Path) -> tuple[str, int]:
    """(family, weight) read from the file's own tables; the family with style words stripped."""
    from fontTools.ttLib import TTFont

    with TTFont(str(path), lazy=True) as f:
        name = f["name"]
        family = (name.getBestFamilyName() or "").strip() if hasattr(name, "getBestFamilyName") else ""
        if not family:
            family = str(name.getDebugName(16) or name.getDebugName(1) or path.stem)
        weight = int(getattr(f["OS/2"], "usWeightClass", 400)) if "OS/2" in f else 400
    low = family.lower()
    for word in sorted(STYLE_WORDS, key=len, reverse=True):
        low = re.sub(rf"\s*\b{re.escape(word)}\b\s*$", "", low)
    return low.strip() or family.lower(), weight


def _font_info_or_none(path: Path) -> tuple[str, int] | None:
    try:
        return font_info(path)
    except Exception:  # noqa: BLE001  an unreadable font file is skipped, never fatal
        return None


def choose_fonts(profile: dict, accept_stand_in: str | None, fonts_dir: Path) -> tuple[Path, Path, bool]:
    """Headline font = the profile's resolved file, else the accepted stand-in; subline = the same family's nearest lighter weight in
    website/fonts when present, else the same file. Refuses to run with an unresolved type and no stand-in, naming the candidates."""
    typ = profile.get("type") or {}
    stand_in = False
    if typ.get("status") == "resolved" and typ.get("file"):
        headline = Path(typ["file"])
    elif accept_stand_in:
        headline = Path(accept_stand_in)
        stand_in = True
    else:
        cands = typ.get("candidates") or []
        lines = [f"type.status is {typ.get('status')!r}: no run starts without an accepted stand-in (--accept-stand-in <file>)", "candidates from the profile:"]
        lines += [f"  {c.get('score', 0):.3f}  {c.get('family')}  {c.get('file')}" for c in cands] or ["  (none)"]
        raise SystemExit("\n".join(lines))
    if not headline.exists():
        raise SystemExit(f"font file not found: {headline}")
    family, weight = font_info(headline)
    subline = headline
    lighter: list[tuple[int, Path]] = []
    if fonts_dir.exists():
        for f in sorted(fonts_dir.iterdir()):
            if f.suffix.lower() not in FONT_SUFFIXES or f.resolve() == headline.resolve():
                continue
            info = _font_info_or_none(f)
            if info and info[0] == family and info[1] < weight:
                lighter.append((info[1], f))
    if lighter:
        subline = max(lighter)[1]  # the nearest lighter weight
    return headline, subline, stand_in


# ---- the client's own picture crops (gate references, and the dry run's pictures) ----


def _overlaps(a, b) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return not (ax + aw <= bx or bx + bw <= ax or ay + ah <= by or by + bh <= ay)


def picture_crops(reads: list, out_dir: Path) -> list[Path]:
    """One crop per read of a picture box that carries neither text nor logo and is at least MIN_CROP_PX on each side, written once."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out: list[Path] = []
    for r in reads:
        keep_out = [line.box for line in r.lines if line.box]
        if r.logo:
            keep_out.append(r.logo.box)
        for box in r.picture_boxes or []:
            if any(_overlaps(box, k) for k in keep_out):
                continue
            x, y, w, h = (round(v) for v in box)
            if w < MIN_CROP_PX or h < MIN_CROP_PX:
                continue
            target = out_dir / f"crop-{re.sub(r'[^a-z0-9]+', '-', r.source.lower()).strip('-')}.png"
            if not target.exists():
                try:
                    Image.open(r.path).convert("RGB").crop((x, y, x + w, y + h)).save(target)
                except (OSError, ValueError):
                    break
            out.append(target)
            break
    return out


def framed(path: Path, w: int, h: int) -> Image.Image:
    """The crop at the frame's size with object-fit cover, centred (what _FramedClient does to a downloaded picture)."""
    with Image.open(path) as im:
        im = im.convert("RGB")
        scale = max(w / im.width, h / im.height)
        rw, rh = max(w, round(im.width * scale)), max(h, round(im.height * scale))
        im = im.resize((rw, rh), Image.Resampling.LANCZOS)
        left, top = (rw - w) // 2, (rh - h) // 2
        return im.crop((left, top, left + w, top + h))


def text_zones(families: list[dict], size: specs.Size) -> list[list[float]]:
    """The quiet zones (headline, subline, logo union) of the most observed families, in frame pixels."""
    top = sorted(families, key=lambda f: -(f.get("seen_count") or 0))[:TOP_FAMILIES_FOR_ZONE]
    zones = []
    for fam in top:
        z = quiet_zone(fam)
        zones.append([z["x"] * size.w, z["y"] * size.h, z["w"] * size.w, z["h"] * size.h])
    return zones or [[0.0, 0.0, float(size.w), size.h * 0.45]]


def _tmp_png(im: Image.Image) -> Path:
    """zone.read takes a path; one scratch file per process is reused (two runs side by side must not share it)."""
    p = Path(settings().work_dir) / f"_scratch-zone-{os.getpid()}.png"
    p.parent.mkdir(parents=True, exist_ok=True)
    im.save(p)
    return p


def rank_crops(crops: list[Path], families: list[dict], size: specs.Size, floor: float) -> tuple[list[Path], list[str]]:
    """The crops framed to the primary size and ordered by their mean salient share under the most observed families' text zones,
    calmest first; the notes say how many are calm at or under the floor."""
    zones = text_zones(families, size)
    scored: list[tuple[float, Path]] = []
    for crop in crops[:MAX_CROP_CANDIDATES]:
        im = framed(crop, size.w, size.h)
        shares = []
        for z in zones:
            try:
                shares.append(zone_mod.read(_tmp_png(im), z, floor).salient_share)
            except Exception:  # noqa: BLE001  one unreadable crop is skipped
                shares.append(1.0)
        scored.append((float(np.mean(shares)), crop))
    scored.sort(key=lambda s: s[0])
    calm = sum(1 for s, _c in scored if s <= floor)
    notes = [f"{len(scored)} crops evaluated under {len(zones)} family text zones; {calm} calm at or under the floor {floor:.2f}"]
    return [c for _s, c in scored], notes


class DryRunClient(FakeClient):
    """The dry run's Higgsfield: the FakeClient surface, but every picture answers the brief it was asked for. `generate` reads the
    quiet-zone instruction out of the prompt ("keep the upper 45% calm ..."); `download` hands back the next client crop framed to the
    primary size and, when that crop measures busy inside the named zone, paints the zone flat with the crop's own median colour there
    (a two-tone stand-in that is flat exactly where the text will sit). No credit is ever spent; every call is on `calls`."""

    ZONE = re.compile(r"keep the (upper|lower|left|right) (\d+)% calm", re.IGNORECASE)

    def __init__(self, crops: list[Path], w: int, h: int, floor: float):
        super().__init__(pictures=[], costs=0.0)
        if not crops:
            raise SystemExit("the dry run needs at least one picture crop from the client's own posts; none qualified")
        self.crops, self.w, self.h, self.floor = list(crops), int(w), int(h), float(floor)
        self.zones: dict[str, list[float] | None] = {}
        self.made: list[dict] = []
        self._next = 0

    def _zone(self, side: str, pct: int) -> list[float]:
        f = min(max(pct, 1), 100) / 100.0
        w, h = float(self.w), float(self.h)
        return {"upper": [0.0, 0.0, w, h * f], "lower": [0.0, h * (1 - f), w, h * f], "left": [0.0, 0.0, w * f, h],
                "right": [w * (1 - f), 0.0, w * f, h]}[side.lower()]

    def generate(self, requests: list[dict]) -> list:
        refs = super().generate(requests)
        for r, ref in zip(requests, refs):
            m = self.ZONE.search(str((r.get("params") or {}).get("prompt") or ""))
            self.zones[ref.job_id] = self._zone(m.group(1), int(m.group(2))) if m else None
        return refs

    def download(self, url: str, out: Path) -> Path:
        self.calls.append(("download", {"url": url, "out": str(out)}))
        job = url.rsplit("/", 1)[-1]
        crop = self.crops[self._next % len(self.crops)]
        self._next += 1
        im = framed(crop, self.w, self.h)
        zone = self.zones.get(job)
        share_before = None
        flattened = False
        if zone is not None:
            share_before = zone_mod.read(_tmp_png(im), zone, self.floor).salient_share
            if share_before > self.floor:
                x, y, w, h = (round(v) for v in zone)
                arr = np.asarray(im).copy()
                region = arr[y:y + h, x:x + w]
                arr[y:y + h, x:x + w] = np.median(region.reshape(-1, 3), axis=0).astype(np.uint8)
                im = Image.fromarray(arr)
                flattened = True
        out = Path(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        im.save(out)
        self.made.append({"job": job, "crop": crop.name, "zone": zone, "share_before": share_before, "flattened": flattened})
        self._downloads += 1
        return out


# ---- the context ----


def build_context(args: argparse.Namespace, browser) -> tuple[RunContext, dict]:
    cfg = settings()
    slug = slugify(args.client)
    ws = cfg.work_dir / slug
    profile_path = ws / "out" / "profile.json"
    if not profile_path.exists():
        raise SystemExit(f"no profile at {profile_path}; run scripts/learn_client.py first")
    profile = json.loads(profile_path.read_text())
    families = [f for f in profile.get("families") or [] if "headline" in ((f.get("template") or {}).get("slots") or {})]
    if not families:
        raise SystemExit("the profile has no family with a headline slot; nothing can be typeset")
    reads_path = ws / "out" / "reads.json"
    reads = load_reads(reads_path) if reads_path.exists() else []
    designed = [r for r in reads if is_designed(r)]
    post = load_post(ws, args.post_index)
    fmt = format_key(post.get("format"))
    platform, sizes = sizes_for_post(str(post.get("platform") or "Instagram"), fmt)
    headline_font, subline_font, stand_in = choose_fonts(profile, args.accept_stand_in, ws / "website" / "fonts")
    if stand_in:
        profile.setdefault("type", {})["accepted_stand_in"] = str(headline_font)
    logo_files = [f for f in (profile.get("logo") or {}).get("files") or []
                  if f.get("path") and (Path(f["path"]) if Path(f["path"]).is_absolute() else ws / f["path"]).exists()]
    if not logo_files:
        raise SystemExit("the profile carries no logo file that exists on disk")
    prior = [r for r in record.prior_runs_from(ws / "runs") if not str(r.get("run_id", "")).endswith("-dry")]
    crops = picture_crops(designed, ws / "out" / "picture_crops")
    floor = zone_mod.floor_from_calibration(profile.get("calibration"))
    run_dir = ws / "runs" / (time.strftime("%Y%m%d-%H%M%S") + f"-post{args.post_index}" + ("-dry" if args.dry_run else ""))
    notes: list[str] = []
    if args.dry_run:
        ranked, notes = rank_crops(crops, families, sizes[0], floor)
        feed, picture_references = ranked[0::2], ranked[1::2]  # the fake pictures must not be judged copies of themselves
        higgsfield = DryRunClient(feed, sizes[0].w, sizes[0].h, floor)
        notes.append(f"DryRunClient cycles {len(feed)} client crops as pictures (flattened in the brief's zone when busy there); "
                     f"{len(picture_references)} other crops stay as picture references")
    else:
        from design_engine.picture.higgsfield import Client

        higgsfield = Client.from_env()
        picture_references = list(crops)
    if not cfg.anthropic_api_key:
        raise SystemExit("ANTHROPIC_API_KEY is not set in engine/.env; the model cannot run")
    import anthropic

    ctx = RunContext(
        profile=profile, families=families, reads=reads, workspace=ws, size_list=sizes, platform=platform,
        post={"copy": post.get("copy"), "format": fmt, "pillar": post.get("pillar"), "post_key": post.get("post_key"),
              "visual_direction": post.get("visual_direction"), "post_index": args.post_index},
        prior_runs=prior, budget=Budget(max_turns=24, max_usd=6.0, max_credits=args.max_credits),
        clients={"anthropic": anthropic.Anthropic(api_key=cfg.anthropic_api_key), "higgsfield": higgsfield},
        fonts={"headline": headline_font, "subline": subline_font}, logo_files=logo_files, run_dir=run_dir, browser=browser,
        references=[r.path for r in designed], picture_references=picture_references, model=args.model,
    )
    meta = {"client": args.client, "slug": slug, "post_index": args.post_index, "platform": platform, "format": fmt,
            "sizes": [{"name": s.name, "w": s.w, "h": s.h} for s in sizes], "copy": post.get("copy"), "pillar": post.get("pillar"),
            "fonts": {"headline": str(headline_font), "subline": str(subline_font)}, "stand_in": stand_in,
            "stand_in_file": str(headline_font) if stand_in else None, "dry_run": bool(args.dry_run), "model": args.model,
            "families": len(families), "references": len(designed), "picture_references": len(picture_references), "prior_runs": len(prior),
            "occlusion_floor": floor, "notes": notes, "started_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    return ctx, meta


def print_result(result: loop.RunResult, ctx: RunContext) -> None:
    print("\noffered:")
    if not result.options:
        print("  none")
    for o in result.options:
        fam = o.family_key or (o.family or {}).get("key")
        sizes = ", ".join(f"{name} {rec['rendered'].png.name} {'pass' if rec['gate'].passed else 'FAIL'}" for name, rec in o.renders.items())
        print(f"  {o.id} rank {o.rank} family {fam}: \"{o.headline}\"" + (f" / \"{o.subline}\"" if o.subline else ""))
        print(f"     sizes: {sizes}")
        print(f"     credits {o.credits:g}, picture jobs {o.job_ids}")
    print("dropped:")
    if not result.dropped:
        print("  none")
    for d in result.dropped:
        print(f"  {d['id']} ({d.get('family_key')}): {d['reason']}")
    for o in result.states:
        for size_name, fails in (o.failures or {}).items():
            print(f"  {o.id} {size_name} could not be composed: {'; '.join(fails)}")
    sp = result.spent
    print(f"spent: {sp.get('credits', 0):g} credits, ${sp.get('usd', 0):.4f} model, {result.turns} turns")
    for w in sp.get("warnings") or []:
        print(f"  warning: {w}")
    print(f"run dir: {ctx.run_dir}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client", required=True)
    ap.add_argument("--post-index", type=int, required=True)
    ap.add_argument("--accept-stand-in", default=None, help="font file to typeset with when the profile's type is unresolved")
    ap.add_argument("--dry-run", action="store_true", help="FakeClient fed with the client's own picture crops; no Higgsfield credit is spent")
    ap.add_argument("--max-credits", type=float, default=30.0)
    ap.add_argument("--model", default=loop.DEFAULT_MODEL)
    args = ap.parse_args()
    with chromium() as browser:
        ctx, meta = build_context(args, browser)
        ctx.run_dir.mkdir(parents=True, exist_ok=True)
        (ctx.run_dir / "run.json").write_text(json.dumps(meta, indent=1))
        print(f"client {meta['client']} ({meta['slug']}), post {args.post_index} on {meta['platform']} {meta['format']}: "
              + ", ".join(f"{s['name']} {s['w']}x{s['h']}" for s in meta["sizes"]))
        print(f"fonts: headline {Path(meta['fonts']['headline']).name}, subline {Path(meta['fonts']['subline']).name}"
              + (" (STAND-IN accepted for this run; the brand's type is unresolved)" if meta["stand_in"] else ""))
        print(f"families with a headline slot: {meta['families']}; references {meta['references']}; picture references {meta['picture_references']}; "
              f"prior runs {meta['prior_runs']}; occlusion floor {meta['occlusion_floor']:.2f}")
        for n in meta["notes"]:
            print(f"  {n}")
        print(f"model {args.model}, budget {ctx.budget}; {'DRY RUN' if args.dry_run else 'LIVE Higgsfield'}")
        t0 = time.time()
        result = loop.run_post(ctx)
        meta.update({"finished_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "seconds": round(time.time() - t0), "nearest": ctx.nearest,
                     "offered": [o.id for o in result.options], "dropped": result.dropped, "spent": result.spent,
                     "fake_pictures": getattr(ctx.clients.get("higgsfield"), "made", None)})
        (ctx.run_dir / "run.json").write_text(json.dumps(meta, indent=1, default=str))
    print_result(result, ctx)


if __name__ == "__main__":
    main()
