"""One JPEG per client of what the per-post runs produced, for Lital: per run the post copy, the passing options per size as image tiles
with their measurements printed beside them, the dropped options as one text line each with the failure, and the nearest client posts
for comparison. Only a passing design is drawn as a design; a dropped one is a sentence.

    uv run python scripts/proof_sheet.py --client "Bader Law" [--out work/<slug>/out/statics-sheet.jpg]

`plan_sheet(run_dirs)` lists the blocks (tile | text | thumbs) the sheet is made of; `build(run_dirs)` draws them and returns the image with
every text line it drew, so a test can assert on the words without reading them back out of a JPEG.
"""
from __future__ import annotations

import argparse
import json
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from design_engine.config import settings

SHEET_W = 2000
MARGIN = 40
TILE_H = 560
THUMB_H = 240
GAP = 24
LINE_H = 30
FONT_PX = 22
HEAD_PX = 30
BG = (246, 245, 242)
INK = (24, 24, 28)
MUTED = (110, 110, 118)
RED = (170, 40, 40)
GREEN = (30, 120, 60)


def slugify(name: str) -> str:
    import re

    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _font(px: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=px)
    except TypeError:  # an older Pillow: the bitmap default
        return ImageFont.load_default()


def _fmt(v, nd: int = 3) -> str:
    if isinstance(v, bool) or v is None:
        return str(v)
    if isinstance(v, (int, float)):
        return f"{v:.{nd}f}".rstrip("0").rstrip(".") if isinstance(v, float) else str(v)
    return str(v)


def _load(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def measurement_lines(m: dict, size_name: str, file_rec: dict, opt: dict) -> list[str]:
    """The numbers Lital asked to see beside a passing design, each on one line."""
    out = [f"{size_name}: {file_rec.get('w') or '?'}x{file_rec.get('h') or '?'}, arrangement {file_rec.get('arrangement')}, picture {file_rec.get('picture_index')}"]
    fam = opt.get("family_key") or "new arrangement"
    out.append(f"family {fam}" if opt.get("arrangement") != "new" else f"new arrangement (parts {', '.join(opt.get('parts') or [])})")
    if m.get("logo_height_share") is not None:
        out.append(f"logo height {_fmt(m['logo_height_share'])} (floor {_fmt(m.get('logo_height_min'))}), contrast {_fmt(m.get('logo_contrast'), 1)}, "
                   f"match {_fmt(m.get('logo_match'), 2)}")
    if m.get("headline_contrast") is not None:
        out.append(f"headline contrast {_fmt(m['headline_contrast'], 1)}, busy {_fmt(m.get('headline_busy'))}, height share {_fmt(m.get('headline_h_share'))}")
    if m.get("subline_contrast") is not None:
        out.append(f"subline contrast {_fmt(m['subline_contrast'], 1)}, busy {_fmt(m.get('subline_busy'))}")
    if m.get("min_text_px") is not None:
        out.append(f"smallest text {_fmt(m['min_text_px'], 0)} px")
    bands = m.get("empty_bands") or {}
    if bands:
        out.append(f"bands top {_fmt(bands.get('top'))} bottom {_fmt(bands.get('bottom'))}, dead space {_fmt(m.get('dead_space'))}, "
                   f"content span {_fmt(m.get('content_span'))}")
    nc = m.get("near_copy") or {}
    if nc.get("min_whole") is not None:
        out.append(f"near-copy {nc.get('min_whole')}/{nc.get('min_half')} (whole/half), same skeleton {nc.get('same_skeleton')}")
    pnc = m.get("picture_near_copy") or {}
    if pnc.get("min_whole") is not None:
        out.append(f"picture near-copy {pnc.get('min_whole')}/{pnc.get('min_half')}")
    tp = (file_rec.get("text_px") or {}).get("headline") or {}
    if tp.get("size") is not None:
        out.append(f"headline set at {_fmt(tp['size'], 0)} px (floor {_fmt(tp.get('floor'), 0)} px)")
    if m.get("file_kb") is not None:
        out.append(f"file {_fmt(m['file_kb'], 0)} KB, margin {_fmt(file_rec.get('margin'), 2)}")
    out.append(f"{_fmt(opt.get('credits'), 1)} credits, {opt.get('fix_rounds', 0)} fix rounds, rank {opt.get('rank')}")
    return out


def plan_sheet(run_dirs: list[Path]) -> list[dict]:
    """The blocks of the sheet in order: {"kind": "text", "text", "role"} | {"kind": "tile", "png", "option_id", "lines"} | {"kind": "thumbs", ...}."""
    blocks: list[dict] = []
    for run in run_dirs:
        run = Path(run)
        options = _load(run / "options.json", [])
        spent = _load(run / "spent.json", {})
        meta = _load(run / "run.json", {})
        title = f"run {run.name}"
        if meta:
            title += f": {meta.get('client', '')} post {meta.get('post_index')} on {meta.get('platform')} ({meta.get('format')})"
        if meta.get("dry_run"):
            title += " [dry run: the pictures are the client's own crops, no credits spent]"
        blocks.append({"kind": "text", "text": title, "role": "title"})
        if meta.get("stand_in"):
            blocks.append({"kind": "text", "role": "note", "text": f"type: stand-in {Path(str(meta.get('stand_in_file'))).name} accepted for this "
                                                                     f"run; the brand's own font file is unresolved"})
        elif meta.get("fonts"):
            blocks.append({"kind": "text", "role": "note", "text": f"type: {Path(str(meta['fonts'].get('headline'))).name}"})
        blocks.append({"kind": "text", "role": "spent", "text": f"spent: {_fmt(spent.get('credits'), 1)} credits, ${_fmt(spent.get('usd'), 2)} model, "
                                                                 f"{spent.get('turns')} turns; offered {len(spent.get('offered') or [])}, "
                                                                 f"dropped {len(spent.get('dropped') or [])}"})
        copy = meta.get("copy") or next((o.get("headline") for o in options if o.get("headline")), "")
        wrapped = textwrap.wrap(" / ".join(part for part in str(copy).splitlines() if part.strip()), 150)[:4]
        for i, line in enumerate(wrapped):
            blocks.append({"kind": "text", "role": "copy", "text": ("copy: " if i == 0 else "      ") + line})
        offered = [o for o in options if o.get("status") == "offered"]
        dropped = [o for o in options if o.get("status") != "offered"]
        for opt in offered:
            meas_all = _load(run / opt["id"] / "measurements.json", {})
            for size_name, rec in (opt.get("files") or {}).items():
                if not rec.get("passed"):
                    continue
                png = run / rec["png"]
                m = (meas_all.get(size_name) or {}).get("measurements") or {}
                lines = [f"option {opt['id']} (rank {opt.get('rank')}): \"{opt.get('headline')}\""
                         + (f" / \"{opt['subline']}\"" if opt.get("subline") else "")]
                lines += measurement_lines(m, size_name, rec, opt)
                warns = (meas_all.get(size_name) or {}).get("warnings") or []
                lines += [f"warning: {w}" for w in warns[:3]]
                blocks.append({"kind": "tile", "png": png, "option_id": opt["id"], "size": size_name, "lines": lines})
        if not offered:
            blocks.append({"kind": "text", "role": "none", "text": "nothing passed the gate in this run"})
        for opt in dropped:
            reason = opt.get("dropped_reason") or next((d.get("reason") for d in spent.get("dropped") or [] if d.get("id") == opt.get("id")), "no reason recorded")
            fam = opt.get("family_key") or "new arrangement"
            blocks.append({"kind": "text", "role": "dropped", "text": f"dropped {opt['id']} ({fam}, {_fmt(opt.get('credits'), 1)} credits): {reason}"})
        nearest = [n for n in meta.get("nearest") or [] if n.get("path") and Path(n["path"]).exists()]
        if nearest:
            blocks.append({"kind": "text", "role": "nearest", "text": "nearest client posts for comparison:"})
            blocks.append({"kind": "thumbs", "items": [{"png": Path(n["path"]), "label": f"sim {_fmt(n.get('similarity'), 2)} {n.get('source_post_id')} {n.get('family_key') or ''}"}
                                                 for n in nearest[:4]]})
        blocks.append({"kind": "text", "role": "gap", "text": ""})
    return blocks


def _clip(text: str, font, width: int) -> str:
    """The text cut to the pixel width it must fit under, so neighbouring labels never collide."""
    if font.getlength(text) <= width:
        return text
    while text and font.getlength(text + "...") > width:
        text = text[:-1]
    return text + "..."


def _wrap(text: str, font, width: int) -> list[str]:
    """The text broken at spaces into lines that fit the pixel width (a word wider than the width stands alone)."""
    out: list[str] = []
    line = ""
    for word in text.split(" "):
        cand = f"{line} {word}" if line else word
        if line and font.getlength(cand) > width:
            out.append(line)
            line = word
        else:
            line = cand
    if line:
        out.append(line)
    return out or [""]


def _thumb(png: Path, h: int) -> Image.Image | None:
    try:
        with Image.open(png) as im:
            im = im.convert("RGB")
            w = max(1, round(im.width * h / im.height))
            return im.resize((w, h), Image.Resampling.LANCZOS)
    except (OSError, ValueError):
        return None


def build(run_dirs: list[Path]) -> tuple[Image.Image, list[str]]:
    """Draw the sheet; returns (image, every text line drawn, in order)."""
    blocks = plan_sheet(run_dirs)
    font, head = _font(FONT_PX), _font(HEAD_PX)
    # measure the height first
    text_w = SHEET_W - 2 * MARGIN
    height = MARGIN
    for b in blocks:
        if b["kind"] == "text":
            height += LINE_H * len(_wrap(b["text"], head if b.get("role") == "title" else font, text_w)) + (10 if b.get("role") == "title" else 0)
        elif b["kind"] == "tile":
            height += max(TILE_H, len(b["lines"]) * LINE_H) + GAP
        elif b["kind"] == "thumbs":
            height += THUMB_H + LINE_H + GAP
    height += MARGIN
    sheet = Image.new("RGB", (SHEET_W, max(height, 200)), BG)
    draw = ImageDraw.Draw(sheet)
    lines: list[str] = []
    y = MARGIN
    for b in blocks:
        if b["kind"] == "text":
            role = b.get("role")
            colour = RED if role == "dropped" else MUTED if role in ("note", "spent", "nearest") else INK
            f = head if role == "title" else font
            for part in _wrap(b["text"], f, text_w):
                draw.text((MARGIN, y), part, fill=colour, font=f)
                y += LINE_H
            lines.append(b["text"])
            y += 10 if role == "title" else 0
        elif b["kind"] == "tile":
            im = _thumb(b["png"], TILE_H)
            x_text = MARGIN
            if im is not None:
                sheet.paste(im, (MARGIN, y))
                x_text = MARGIN + im.width + GAP
            else:
                draw.text((MARGIN, y), f"(render missing: {b['png'].name})", fill=RED, font=font)
            yy = y
            for i, line in enumerate(b["lines"]):
                draw.text((x_text, yy), line, fill=GREEN if i == 0 else INK, font=font)
                lines.append(line)
                yy += LINE_H
            y += max(TILE_H, len(b["lines"]) * LINE_H) + GAP
        elif b["kind"] == "thumbs":
            x = MARGIN
            for item in b["items"]:
                im = _thumb(item["png"], THUMB_H)
                if im is None:
                    continue
                if x + im.width > SHEET_W - MARGIN:
                    break
                sheet.paste(im, (x, y))
                draw.text((x, y + THUMB_H + 4), _clip(item["label"], font, im.width), fill=MUTED, font=font)
                lines.append(item["label"])
                x += im.width + GAP
            y += THUMB_H + LINE_H + GAP
    return sheet, lines


def run_dirs_for(runs_root: Path) -> list[Path]:
    runs_root = Path(runs_root)
    if not runs_root.exists():
        return []
    return sorted(p for p in runs_root.iterdir() if p.is_dir() and (p / "options.json").exists())


def write(run_dirs: list[Path], out: Path) -> Path:
    sheet, _lines = build(run_dirs)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, format="JPEG", quality=88)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client", required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    ws = settings().work_dir / slugify(args.client)
    runs = run_dirs_for(ws / "runs")
    if not runs:
        print(f"no runs under {ws / 'runs'}; run scripts/run_post.py first")
        sys.exit(1)
    out = write(runs, Path(args.out) if args.out else ws / "out" / "statics-sheet.jpg")
    print(f"sheet: {out} ({len(runs)} runs)")


if __name__ == "__main__":
    main()
