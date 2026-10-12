"""Run the brand learner for one client against the local workspace (Sprout stills, uploads) and the client's website.

    uv run python scripts/learn_client.py --client "Bader Law" --site https://www.baderlaw.com/ [--skip-site] [--skip-matting] [--limit N]

Writes work/<slug>/profile.json, board.jpg, reads.json and type-sheet.jpg. Spends no Higgsfield credits. The imagery read runs only
when ANTHROPIC_API_KEY is set; otherwise the profile says so.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import asdict, replace
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from design_engine.config import settings
from design_engine.ingest.website import read_site
from design_engine.learn.families import cluster
from design_engine.learn.grammar import bands
from design_engine.learn.imagery import describe_imagery
from design_engine.learn.layers import read_post
from design_engine.learn.palette import observed_pairs, palette
from design_engine.learn.profile import build, validate
from design_engine.learn.typeface import match_headlines, render_line
from design_engine.measure.calibrate import calibrate
from design_engine.measure.image import load_rgb
from design_engine.learn.layers import pill_boxes
from design_engine.measure.logo import file_ground, logo_templates_from_file, trim_to_ink
from design_engine.measure.ocr import read_lines
from design_engine.report.board import render
from design_engine.store.workspace import Workspace

FONT_LIBRARY = "https://rwouwxqggjjacbpbhqsn.supabase.co/storage/v1/object/public/brand-assets/fonts/"


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


MIN_LOGO_PX = 1200  # the ink of a placed logo is never upscaled from a smaller raster


def svg_to_png(svg_path: Path, out: Path, width: int = 1600, scale: float = 1.0) -> Path:
    """Rasterise an SVG with Chromium by inlining it (a file:// image inside a generated page is refused); the vector file stays
    the brand's own asset, this PNG is only the measuring template."""
    import re as _re

    from playwright.sync_api import sync_playwright

    svg = svg_path.read_text(errors="ignore")
    # width-only sizing keeps the aspect ratio: strip fixed width/height attrs on the root so CSS width applies
    svg = _re.sub(r"<svg([^>]*?)\s(width|height)=\"[^\"]*\"", r"<svg\1", svg, count=2)
    html = f"<html><body style='margin:0;background:transparent'><div id='l' style='display:inline-block;width:{width}px'>{svg}</div></body></html>"
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": width + 20, "height": 800}, device_scale_factor=scale)  # scale: a vector whose ink is small on the page
        page.set_content(html)
        page.evaluate("document.querySelector('#l svg') && (document.querySelector('#l svg').style.width='100%')")
        el = page.query_selector("#l")
        el.screenshot(path=str(out), omit_background=True)
        b.close()
    return out


def font_library(work_root: Path) -> list[Path]:
    """The engine's candidate library: the Google-font TTFs already in the brand-assets bucket (names read from their own tables)."""
    lib = work_root / "_fonts"
    lib.mkdir(parents=True, exist_ok=True)
    index = lib / "index.json"
    if index.exists():
        return [lib / n for n in json.loads(index.read_text())]
    names = []
    try:
        listing = httpx.post("https://rwouwxqggjjacbpbhqsn.supabase.co/storage/v1/object/list/brand-assets",
                             json={"prefix": "fonts/", "limit": 500}, headers={"apikey": settings().supabase_service_key or ""}, timeout=60)
        files = [o["name"] for o in listing.json()] if listing.status_code == 200 else []
    except Exception:
        files = []
    if not files:  # anonymous listing is not allowed; use the known family set at regular and bold weights
        fams = ["poppins", "montserrat", "inter", "roboto", "open-sans", "lato", "dm-sans", "manrope", "outfit", "plus-jakarta-sans", "sora",
                "urbanist", "nunito-sans", "work-sans", "rubik", "karla", "mulish", "figtree", "geist", "archivo", "barlow", "heebo",
                "ibm-plex-sans", "instrument-sans", "jost", "lexend", "onest", "public-sans", "quicksand", "red-hat-display", "space-grotesk",
                "source-sans-3", "wix-madefor-display", "hanken-grotesk", "golos-text", "be-vietnam-pro", "albert-sans", "gantari", "schibsted-grotesk"]
        files = [f"{f}-{w}.ttf" for f in fams for w in (400, 700)] + ["poppins-300.ttf", "montserrat-300.ttf", "open-sans-300.ttf", "roboto-300.ttf"]
    c = httpx.Client(timeout=60)
    for f in files:
        local = lib / Path(f).name
        if local.exists():
            names.append(local.name)
            continue
        r = c.get(FONT_LIBRARY + Path(f).name)
        if r.status_code == 200 and r.content[:4] in (b"\x00\x01\x00\x00", b"true", b"OTTO"):
            local.write_bytes(r.content)
            names.append(local.name)
    index.write_text(json.dumps(names))
    return [lib / n for n in names]


def device_colour(arr, box) -> str:
    """The median colour inside a device box, as hex: the band's own colour, never the ink's."""
    x, y, w, h = [int(round(v)) for v in box]
    region = arr[max(0, y):y + max(1, h), max(0, x):x + max(1, w)].reshape(-1, 3)
    r, g, b = (int(v) for v in np.median(region, axis=0))
    return f"#{r:02x}{g:02x}{b:02x}"


def dump_read(r) -> dict:
    return {"path": str(r.path), "source_post_id": r.source_post_id, "platform": r.platform, "posted_at": r.posted_at, "slide_index": r.slide_index,
            "kind": r.kind, "W": r.W, "H": r.H, "lines": [asdict(l) for l in r.lines], "logo": asdict(r.logo) if r.logo else None,
            "picture_boxes": r.picture_boxes, "ground": r.ground, "accent_boxes": r.accent_boxes, "designed": is_designed(r)}


def load_reads(cache: Path) -> list:
    from design_engine.learn.layers import PostRead, pill_boxes
    from design_engine.measure.logo import LogoMatch
    from design_engine.measure.ocr import Line
    from design_engine.measure.text_lines import classify

    reads = []
    for d in json.loads(cache.read_text()):
        lines = [Line(**l) for l in d.get("lines", [])] or [Line(**l) for l in d.get("headline", []) + d.get("subline", [])]
        logo = LogoMatch(**d["logo"]) if d.get("logo") else None
        text = classify(lines, d["W"], d["H"], exclude_boxes=[logo.box] if logo else ())
        reads.append(PostRead(Path(d["path"]), d["W"], d["H"], lines, text, logo, d.get("picture_boxes", []), d.get("ground", {}),
                              d.get("accent_boxes", []), d.get("source_post_id", ""), d.get("platform", ""), d.get("posted_at", ""),
                              int(d.get("slide_index", 0)), d.get("kind", "post")))
    return reads


def type_samples(designed, n=4):
    """Headline lines fit to measure a typeface on: horizontal, mostly letters, readable size, high OCR confidence, on a flat or
    gradient ground (letterforms cannot be isolated on a photograph), from different posts and different wordings."""
    from design_engine.measure.contrast import busy_ground

    cands = []
    seen_text = set()
    for r in designed:
        short = min(r.W, r.H)
        for l in r.text.headline[:1]:
            x, y, w, h = l.box
            letters = sum(c.isalpha() for c in l.text)
            key = l.text.strip().lower()
            if key in seen_text:
                continue
            if w / max(1.0, h) >= 3 and letters >= 6 and letters >= 0.7 * len(l.text.replace(" ", "")) and 0.03 * short <= h <= 0.15 * short and l.confidence >= 0.9:
                region = load_rgb(r.path)[max(0, int(y - h * 0.3)):int(y + h * 1.3), max(0, int(x - w * 0.05)):int(x + w * 1.05)]
                if region.size and busy_ground(region) <= 0.11:
                    cands.append((letters, r.path, l.box, l.text))
                    seen_text.add(key)
    cands.sort(key=lambda c: -c[0])
    return [(p, b, t) for _, p, b, t in cands[:n]]


def is_designed(read) -> bool:
    """Measured criterion for a designed still: the brand's logo is on it, or it carries set type of readable size."""
    short = min(read.W, read.H)
    typed = [l for l in read.lines if l.confidence >= 0.8 and l.box[3] >= 0.02 * short and len(l.text.strip()) >= 3]
    return bool(read.logo) or len(typed) >= 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", required=True)
    ap.add_argument("--site")
    ap.add_argument("--skip-site", action="store_true")
    ap.add_argument("--skip-matting", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--ocr", default=None)
    ap.add_argument("--from-cache", action="store_true", help="reuse out/reads.json instead of reading the posts again")
    args = ap.parse_args()
    cfg = settings()
    slug = slugify(args.client)
    ws = Workspace(cfg.work_dir, slug)
    out = ws.root / "out"
    t0 = time.time()

    # 1. website
    site = None
    logo_files: list[dict] = []
    own_fonts: list[Path] = []
    if args.site and not args.skip_site:
        try:
            site = read_site(args.site, ws.root / "website")
            print(f"site: {len(site.logo_candidates)} logo candidates, {len(site.font_files)} font files, {len(site.colours)} colours")
            for f in site.font_files:
                if f.get("path"):
                    own_fonts.append(Path(f["path"]) if Path(f["path"]).is_absolute() else ws.root / "website" / f["path"])
            # every candidate the page offered, lockups first: icons under 24 px and square inline glyphs are social buttons, not marks
            ranked = []
            for lc in site.logo_candidates:
                w, h = lc.get("width") or 0, lc.get("height") or 0
                if lc.get("kind") == "inline-svg" and max(w, h) <= 24:
                    continue
                aspect = (w / h) if (w and h) else 1.0
                ranked.append((0 if aspect >= 1.3 else 1 if lc.get("kind") in ("img", "inline-svg") else 2, lc))
            ranked.sort(key=lambda t: t[0])
            for i, (_, lc) in enumerate(ranked):
                p = lc.get("path")
                if not p:
                    continue
                p = Path(p) if Path(p).is_absolute() else ws.root / "website" / p
                if p.suffix.lower() == ".svg":
                    png = svg_to_png(p, ws.root / "website" / f"logo-{i}.png")
                    logo_files.append({"path": str(png.relative_to(ws.root)), "variant": "site", "source": f"site:{args.site} {lc.get('kind')}", "svg": str(p.relative_to(ws.root))})
                elif p.suffix.lower() in (".png", ".webp", ".jpg", ".jpeg"):
                    logo_files.append({"path": str(p.relative_to(ws.root)), "variant": "site", "source": f"site:{args.site} {lc.get('kind')}"})
        except Exception as e:  # the site is evidence, not a dependency; say what failed
            print(f"site read failed: {e}")
    # a logo the team uploaded wins over the site's
    up_index = ws.root / "uploads_index.json"
    uploads = list(json.loads(up_index.read_text()).values()) if up_index.exists() else []
    for u in uploads:
        if u.get("kind") == "logo":
            logo_files.insert(0, {"path": u["path"], "variant": "upload", "source": u["source"]})
    # the asset is the file's ink: a site export padded with transparent space is cropped to its lockup (the client's own pixels)
    for lf in logo_files:
        src = ws.root / lf["path"]
        if src.suffix.lower() not in (".png", ".webp"):
            continue
        trimmed = trim_to_ink(src, src.with_name(src.stem + "-trim.png"))
        if trimmed is not None and lf.get("svg"):
            # a vector rasterised wide but with little ink: rasterise again so the ink itself is at least MIN_LOGO_PX wide
            with Image.open(trimmed) as im:
                ink_w = im.width
            if ink_w < MIN_LOGO_PX:
                svg_to_png(ws.root / lf["svg"], src, scale=MIN_LOGO_PX / max(ink_w, 1))
                trimmed = trim_to_ink(src, src.with_name(src.stem + "-trim.png")) or src
        if trimmed is not None:
            lf["original"] = lf["path"]
            lf["path"] = str(trimmed.relative_to(ws.root))

    # 2. posts
    posts = [p for p in ws.posts() if p.kind == "post"]
    if args.limit:
        posts = posts[: args.limit]
    upload_posts = [u for u in uploads if u.get("kind") == "upload"]
    # Which candidate file is the brand's lockup is decided by the posts: a candidate must match on at least two of them.
    from design_engine.measure.logo import find_logo_any

    probe = posts[:40]
    kept_files, templates = [], []
    for lf in logo_files:
        try:
            cand = logo_templates_from_file(ws.root / lf["path"])
        except Exception as e:
            print(f"logo template failed for {lf['path']}: {e}")
            continue
        hits = 0
        grounds: dict[str, int] = {}
        for pp in probe:
            try:
                arr = load_rgb(pp.path)
            except Exception:
                continue
            m = find_logo_any(arr, cand, min(arr.shape[0], arr.shape[1]), min_score=0.8)
            if m and m.height_share >= 0.03:
                hits += 1
                grounds[m.variant] = grounds.get(m.variant, 0) + 1
        print(f"logo candidate {lf['path']}: {hits} matches in {len(probe)} posts {grounds}")
        if hits >= 2:
            # the ground this file reads on: from its own ink (a white wordmark vanishes on white, so the file is for dark grounds);
            # a single-colour mark that reads on both is tagged by which composite matched the posts
            own = file_ground(ws.root / lf["path"])
            ground = own or ("dark" if grounds.get("on_dark", 0) >= grounds.get("on_light", 0) else "light")
            kept_files.append({**lf, "matches_in_probe": hits, "ground": ground, "ground_source": f"file ink:{own}" if own else f"measured:{grounds}"})
            templates += [replace(t, name=f"{lf['path']}:{t.name}") for t in cand]
    seen_logo_paths: set[str] = set()
    kept_files = [f for f in kept_files if not (f["path"] in seen_logo_paths or seen_logo_paths.add(f["path"]))]
    if not kept_files and logo_files:
        kept_files = [logo_files[0]]
        templates = logo_templates_from_file(ws.root / logo_files[0]["path"])
        print("no candidate matched two posts; keeping the first site candidate as the file")
    logo_files = kept_files
    ocr = (lambda p: read_lines(p, backend=args.ocr)) if args.ocr else read_lines

    reads = []
    designed = []
    cache = out / "reads.json"
    if args.from_cache and cache.exists():
        reads = load_reads(cache)
        if templates:
            # the cache keeps the OCR (the slow part); the logo is matched again so its box follows the current templates
            from design_engine.measure.text_lines import classify

            for r in reads:
                try:
                    arr = load_rgb(r.path)
                except Exception:  # noqa: BLE001  a missing file keeps its cached read
                    continue
                r.logo = find_logo_any(arr, templates, min(r.W, r.H))
                if r.logo:
                    r.logo = type(r.logo)(r.logo.score, r.logo.box, r.logo.height_share, r.logo.variant.split(":")[-1], r.logo.match_box)
                pills = pill_boxes(arr, r.lines, [r.logo.box] if r.logo else [])
                r.extras["pills"] = pills
                r.text = classify(r.lines, r.W, r.H, exclude_boxes=([r.logo.box] if r.logo else []) + [pb["box"] for pb in pills])
                r.extras["accent_hex"] = [device_colour(arr, b) for b in r.accent_boxes]
        designed = [r for r in reads if is_designed(r)]
        print(f"loaded {len(reads)} reads from cache; logo re-matched on {sum(1 for r in reads if r.logo)}")
    else:
        for i, p in enumerate(posts + [None] * len(upload_posts)):
            if p is None:
                u = upload_posts[i - len(posts)]
                path, meta = ws.root / u["path"], {"source_post_id": u["source"], "kind": "upload"}
            else:
                path, meta = p.path, {"source_post_id": p.source_post_id, "platform": p.platform, "posted_at": p.posted_at, "slide_index": p.slide_index, "kind": p.kind}
            try:
                r = read_post(path, None, ocr=ocr, matting=not args.skip_matting, meta=meta)
                if templates:
                    arr = load_rgb(path)
                    r.logo = find_logo_any(arr, templates, min(r.W, r.H))
                    if r.logo:
                        r.logo = type(r.logo)(r.logo.score, r.logo.box, r.logo.height_share, r.logo.variant.split(":")[-1], r.logo.match_box)
                        from design_engine.measure.text_lines import classify

                        r.text = classify(r.lines, r.W, r.H, exclude_boxes=[r.logo.box])
                r.extras["accent_hex"] = [device_colour(load_rgb(path), b) for b in r.accent_boxes]
            except Exception as e:  # noqa: BLE001  one unreadable file must not stop the learner; it is reported
                print(f"read failed {path.name}: {e}")
                continue
            reads.append(r)
            if is_designed(r):
                designed.append(r)
            if (i + 1) % 25 == 0:
                print(f"  read {i + 1}/{len(posts) + len(upload_posts)} ({len(designed)} designed) {time.time() - t0:.0f}s")
    # the same design re-posted at another platform's size is one design: collapse reads whose luminance structure matches
    from PIL import Image as _Image

    from design_engine.measure.hashes import dhash, hamming

    hashed = []
    kept: list = []
    for r in sorted(reads, key=lambda r: -(r.W * r.H)):
        h = dhash(_Image.open(r.path))
        if any(hamming(h, k) <= 6 for k in hashed):
            r.extras["duplicate_of_larger"] = True
            continue
        hashed.append(h)
        kept.append(r)
    dupes = len(reads) - len(kept)
    reads = kept
    designed = [r for r in reads if is_designed(r)]
    print(f"posts read: {len(reads)} (+{dupes} re-posts of the same design collapsed), designed: {len(designed)}, with logo: {sum(1 for r in designed if r.logo)}")
    (out / "reads.json").parent.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    (out / "reads.json").write_text(json.dumps([dump_read(r) for r in reads], indent=1))

    # 3. palette and pairs
    arrays = [load_rgb(r.path) for r in designed]
    text_boxes = [[b for b in (r.text.headline_box, r.text.subline_box) if b] for r in designed]
    pal = palette(arrays, text_boxes=text_boxes)
    # pairs carry their post source for the profile
    pair_rows = []
    seen = set()
    for r, arr, tb in zip(designed, arrays, text_boxes):
        if r.ground.get("kind") not in ("flat", "gradient"):
            continue
        for pr in observed_pairs(arr, tb):
            k = (pr.ink_hex, pr.ground_hex)
            if k in seen:
                continue
            seen.add(k)
            pair_rows.append(type("P", (), {"ink_hex": pr.ink_hex, "ground_hex": pr.ground_hex, "contrast": pr.contrast, "source": r.source})())
    # the accent is what the brand's devices are painted with, measured on the device boxes, never the most saturated pixel of a photo
    device_cols = []
    for r, arr in zip(designed, arrays):
        for b in r.accent_boxes[:2]:
            x, y, w, h = [int(round(v)) for v in b]
            region = arr[max(0, y):y + h, max(0, x):x + w].reshape(-1, 3)
            if region.size:
                device_cols.append(np.median(region, axis=0))
    site_accents = [c["hex"] for c in (site.colours if site else []) if c.get("where") in ("theme-color", "background")][:3]
    # The accent, in evidence order: a colour the brand declares on its own site (theme-color, CTA background) that also appears in
    # its posts wins; the dominant device colour measured on the posts is the fallback when the site declares nothing that the posts use.
    chosen_accent = None
    if site_accents and arrays:
        sample = np.concatenate([a.reshape(-1, 3)[:: max(1, a.shape[0] * a.shape[1] // 20000)] for a in arrays]).astype(np.float64)
        best_share = 0.0
        best_key = -1.0
        ground_cols = [np.array([int(sw.hex[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64) for sw in pal if sw.role == "ground"]
        for h in site_accents:
            col = np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64)
            share = float((np.linalg.norm(sample - col, axis=1) < 40).mean())
            is_ground = any(np.linalg.norm(col - g) < 60 for g in ground_cols)
            sat = (col.max() - col.min()) / max(col.max(), 1.0)
            print(f"site accent {h}: {share:.3%} of designed-post pixels, saturation {sat:.2f}{', reads as the ground' if is_ground else ''}")
            # an accent is a minority, saturated colour: the ground itself never qualifies, and among the rest the most saturated
            # colour the posts actually use wins
            if share >= 0.003 and not is_ground and sat > best_key:
                best_key, best_share, chosen_accent = sat, share, h
    if chosen_accent:
        from design_engine.learn.palette import Swatch

        pal = [Swatch(sw.hex, sw.share, "other" if sw.role == "accent" else sw.role) for sw in pal]
        pal.append(Swatch(chosen_accent, round(best_share, 4), "accent"))
        print(f"accent {chosen_accent} from the site, present in the posts")
    elif device_cols:
        # the dominant device colour: quantise and take the largest cluster, never a median across unlike devices
        q = (np.asarray(device_cols) // 24).astype(int)
        keys, counts = np.unique(q, axis=0, return_counts=True)
        dom = keys[int(np.argmax(counts))]
        members = np.asarray(device_cols)[(q == dom).all(axis=1)]
        dev = np.median(members, axis=0)
        dev_hex = "#%02x%02x%02x" % tuple(int(v) for v in dev)
        from design_engine.learn.palette import Swatch

        def dist(h):
            a = np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)])
            return float(np.linalg.norm(a - dev))

        nearest = min(range(len(pal)), key=lambda i: dist(pal[i].hex)) if pal else None
        pal = [Swatch(sw.hex, sw.share, "other" if sw.role == "accent" else sw.role) for sw in pal]
        if nearest is not None and dist(pal[nearest].hex) < 60:
            pal[nearest] = Swatch(pal[nearest].hex, pal[nearest].share, "accent")
        else:
            pal.append(Swatch(dev_hex, 0.0, "accent"))
        print(f"device colour {dev_hex} from the largest cluster of {len(device_cols)} device boxes ({int(counts.max())} boxes); site accents {site_accents}")
    print(f"palette: {[(s.hex, s.role) for s in pal[:6]]}; pairs: {len(pair_rows)}")

    # 4. type: the brand's own files first, the library only to name candidates
    samples = type_samples(designed)
    print(f"type samples: {[t for _, _, t in samples]}")
    type_match = None
    if samples:
        if own_fonts:
            type_match = match_headlines(samples, own_fonts)
            print(f"type vs own files: {type_match.verdict} {type_match.family} {type_match.score}")
        if not type_match or type_match.verdict != "match":
            lib = font_library(cfg.work_dir)
            lib_match = match_headlines(samples, lib)
            print(f"type vs library: top {lib_match.family} {lib_match.score} next {lib_match.next_family} {lib_match.next_score}")
            if type_match is None:
                type_match = lib_match
                type_match.verdict = "unresolved"  # a library family is a candidate, never the brand's confirmed face
            else:
                type_match.ranking = (type_match.ranking or []) + (lib_match.ranking or [])
        # type sheet: sample crops beside the top candidates
        try:
            sheet_rows = []
            for path, box, text in samples[:2]:
                x, y, w, h = [int(round(v)) for v in box]
                crop_im = Image.open(path).convert("RGB").crop((x, y, x + w, y + h))
                sheet_rows.append(("sample", crop_im))
                for row in (type_match.ranking or [])[:3]:
                    try:
                        sheet_rows.append((f"{row['family']} {row['score']:.2f}", render_line(row["file"], text).convert("RGB")))
                    except Exception:
                        pass
            Wd = 1400
            ims = [(lab, im.resize((Wd - 40, max(1, int(im.height * (Wd - 40) / im.width))))) for lab, im in sheet_rows]
            Hd = sum(im.height + 40 for _, im in ims) + 20
            sheet = Image.new("RGB", (Wd, Hd), (245, 245, 245))
            from PIL import ImageDraw

            d = ImageDraw.Draw(sheet)
            yy = 10
            for lab, im in ims:
                d.text((20, yy), lab, fill=(20, 20, 20))
                yy += 20
                sheet.paste(im, (20, yy))
                yy += im.height + 20
            sheet.save(out / "type-sheet.jpg", quality=85)
        except Exception as e:
            print(f"type sheet failed: {e}")

    # 5. grammar, families, calibration
    grammar = bands(designed)
    fams = cluster(designed)
    print(f"families: {[(f.status, f.seen_count, f.key) for f in fams[:8]]}")
    cal = calibrate([r.path for r in designed], templates or None, args.client)
    print(f"floors: {cal['floors']}")

    # 6. imagery (needs the key)
    imagery = None
    if cfg.anthropic_api_key:
        try:
            pick = [r.path for r in designed[:20]]
            imagery = describe_imagery(pick, args.client)
            print(f"imagery: {len(imagery.items)} items, people {imagery.people}")
        except Exception as e:
            print(f"imagery read failed: {e}")
    else:
        print("imagery: not run (no ANTHROPIC_API_KEY)")

    client = {"id": None, "name": args.client}
    profile = build(client, site, [{"source": u.get("source")} for u in uploads], designed, pal, pair_rows, type_match, grammar, fams, imagery, cal,
                    logo_files=logo_files, measured_on=[r.source for r in designed])
    profile["site_accents"] = [{"hex": h, "source": f"site:{args.site} theme-color or CTA background"} for h in site_accents]
    from design_engine.learn.carousel import carousel_block

    profile["carousel"] = carousel_block(designed, profile["families"])
    print(f"carousel: {profile['carousel']['albums']} albums, slide count p50 {profile['carousel']['slide_count'].get('p50')}, "
          f"role families cover {len(profile['carousel']['roles']['cover'])} body {len(profile['carousel']['roles']['body'])} closing {len(profile['carousel']['roles']['closing'])}")
    profile["classification"] = {"designed_rule": "logo found by template match, or at least one set line of readable size (OCR confidence >= 0.8, height >= 2% of the short edge)",
                                 "read": len(reads), "designed": len(designed), "source": "measured:is_designed"}
    (out / "profile.json").write_text(json.dumps(profile, indent=1, default=str))
    problems = validate(profile)
    print("validate:", "ok" if not problems else problems)
    board = render(profile, designed, out / "board.jpg", type_sheet=out / "type-sheet.jpg")
    print(f"board: {board}  ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
