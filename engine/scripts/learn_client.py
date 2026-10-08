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
from dataclasses import asdict
from pathlib import Path

import httpx
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
from design_engine.measure.logo import logo_templates_from_file
from design_engine.measure.ocr import read_lines
from design_engine.report.board import render
from design_engine.store.workspace import Workspace

FONT_LIBRARY = "https://rwouwxqggjjacbpbhqsn.supabase.co/storage/v1/object/public/brand-assets/fonts/"


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def svg_to_png(svg_path: Path, out: Path, width: int = 1600) -> Path:
    """Rasterise an SVG with Chromium on a transparent page; the file stays the brand's own vector."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": width, "height": 600})
        html = f"<html><body style='margin:0;background:transparent'><img id='l' src='{svg_path.resolve().as_uri()}' style='width:{width}px'></body></html>"
        page.set_content(html)
        page.wait_for_load_state("networkidle")
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
            for i, lc in enumerate(site.logo_candidates[:3]):
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

    # 2. posts
    posts = [p for p in ws.posts() if p.kind == "post"]
    if args.limit:
        posts = posts[: args.limit]
    upload_posts = [u for u in uploads if u.get("kind") == "upload"]
    templates = []
    for lf in logo_files:
        try:
            templates += logo_templates_from_file(ws.root / lf["path"])
        except Exception as e:
            print(f"logo template failed for {lf['path']}: {e}")
    ocr = (lambda p: read_lines(p, backend=args.ocr)) if args.ocr else read_lines
    from design_engine.measure.logo import find_logo_any

    reads = []
    designed = []
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
                if r.logo:  # re-classify text with the logo excluded, as read_post does when the template is given up front
                    from design_engine.measure.text_lines import classify

                    r.text = classify(r.lines, r.W, r.H, exclude_boxes=[r.logo.box])
        except Exception as e:
            print(f"read failed {path.name}: {e}")
            continue
        reads.append(r)
        if is_designed(r):
            designed.append(r)
        if (i + 1) % 25 == 0:
            print(f"  read {i + 1}/{len(posts) + len(upload_posts)} ({len(designed)} designed) {time.time() - t0:.0f}s")
    print(f"posts read: {len(reads)}, designed: {len(designed)}, with logo: {sum(1 for r in designed if r.logo)}")
    (out / "reads.json").parent.mkdir(parents=True, exist_ok=True)
    (out / "reads.json").write_text(json.dumps([{"path": str(r.path), "source": r.source, "W": r.W, "H": r.H, "logo": asdict(r.logo) if r.logo else None,
        "headline": [asdict(l) for l in r.text.headline], "subline": [asdict(l) for l in r.text.subline], "picture_boxes": r.picture_boxes,
        "ground": r.ground, "accent_boxes": r.accent_boxes, "designed": is_designed(r)} for r in reads], indent=1))

    # 3. palette and pairs
    arrays = [load_rgb(r.path) for r in designed]
    text_boxes = [[b for b in (r.text.headline_box, r.text.subline_box) if b] for r in designed]
    pal = palette(arrays, text_boxes=text_boxes)
    # pairs carry their post source for the profile
    pair_rows = []
    seen = set()
    for r, arr, tb in zip(designed, arrays, text_boxes):
        for pr in observed_pairs(arr, tb):
            k = (pr.ink_hex, pr.ground_hex)
            if k in seen:
                continue
            seen.add(k)
            pair_rows.append(type("P", (), {"ink_hex": pr.ink_hex, "ground_hex": pr.ground_hex, "contrast": pr.contrast, "source": r.source})())
    print(f"palette: {[(s.hex, s.role) for s in pal[:6]]}; pairs: {len(pair_rows)}")

    # 4. type: the brand's own files first, the library only to name candidates
    samples = []
    for r in sorted(designed, key=lambda r: -(r.text.headline[0].box[3] if r.text.headline else 0)):
        if r.text.headline and len(r.text.headline[0].text.strip()) >= 6:
            l = r.text.headline[0]
            samples.append((r.path, l.box, l.text))
        if len(samples) >= 4:
            break
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
    profile["classification"] = {"designed_rule": "logo found by template match, or at least one set line of readable size (OCR confidence >= 0.8, height >= 2% of the short edge)",
                                 "read": len(reads), "designed": len(designed), "source": "measured:is_designed"}
    (out / "profile.json").write_text(json.dumps(profile, indent=1, default=str))
    problems = validate(profile)
    print("validate:", "ok" if not problems else problems)
    board = render(profile, designed, out / "board.jpg", type_sheet=out / "type-sheet.jpg")
    print(f"board: {board}  ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
