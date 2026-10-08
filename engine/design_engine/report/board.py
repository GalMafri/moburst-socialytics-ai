"""The evidence board: one JPEG per client showing the posts learned from, the tokens with their sources, the type evidence,
the logo variants, each family's slots drawn over its source posts, the imagery items and the floors. For Lital, not for clients."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from ..learn.layers import PostRead

W = 2000
PAD = 24


def _font(size: int):
    for p in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default(size=size)


def _hex_to_rgb(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _draw_slots(im: Image.Image, read: PostRead, colours: dict) -> Image.Image:
    im = im.copy()
    d = ImageDraw.Draw(im)
    sx, sy = im.width / read.W, im.height / read.H

    def box(b, col, label):
        x, y, w, h = b
        d.rectangle([x * sx, y * sy, (x + w) * sx, (y + h) * sy], outline=col, width=3)
        d.text((x * sx + 4, y * sy + 2), label, fill=col, font=_font(16))

    if read.logo:
        box(read.logo.box, colours["logo"], f"logo {read.logo.score:.2f}")
    if read.text.headline_box:
        box(read.text.headline_box, colours["headline"], "headline")
    if read.text.subline_box:
        box(read.text.subline_box, colours["subline"], "subline")
    for b in read.picture_boxes[:2]:
        box(b, colours["picture"], "picture")
    for b in read.accent_boxes[:2]:
        box(b, colours["accent"], "device")
    return im


def render(profile: dict, reads: list[PostRead], out_path: Path, type_sheet: Path | None = None) -> Path:
    f_h, f_b, f_s = _font(40), _font(24), _font(18)
    colours = {"logo": (255, 200, 0), "headline": (0, 230, 120), "subline": (0, 180, 255), "picture": (255, 80, 200), "accent": (255, 120, 0)}
    rows: list[Image.Image] = []

    def text_block(lines: list[str], font, height=None):
        h = height or (len(lines) * (font.size + 10) + 2 * PAD)
        im = Image.new("RGB", (W, h), (20, 22, 28))
        d = ImageDraw.Draw(im)
        y = PAD
        for ln in lines:
            d.text((PAD, y), ln[:220], fill=(235, 235, 235), font=font)
            y += font.size + 10
        return im

    rows.append(text_block([f"{profile['client_name']}: brand evidence board", f"built {profile['built_at'][:16]}  posts read: {len(reads)}  "
                            f"families: {sum(1 for f in profile['families'] if f['status'] == 'family')} (+{sum(1 for f in profile['families'] if f['status'] == 'seen_once')} seen once)"], f_h))

    # palette and pairs
    pal = profile["palette"]
    im = Image.new("RGB", (W, 150), (20, 22, 28))
    d = ImageDraw.Draw(im)
    x = PAD
    for s in pal[:8]:
        d.rectangle([x, PAD, x + 150, PAD + 70], fill=_hex_to_rgb(s["hex"]))
        d.text((x, PAD + 76), f"{s['hex']} {s['role']} {s['share']:.0%}", fill=(235, 235, 235), font=f_s)
        x += 170
    d.text((PAD, 125), f"palette source: {pal[0]['source'] if pal else 'none'}", fill=(160, 160, 160), font=f_s)
    rows.append(im)
    pairs = profile["observed_pairs"][:6]
    rows.append(text_block(["observed text-on-ground pairs: " + ", ".join(f"{p['ink_hex']} on {p['ground_hex']} ({p['contrast']}:1)" for p in pairs)], f_b))

    # type
    t = profile["type"]
    if t["status"] == "resolved":
        rows.append(text_block([f"type: {t['family']} (matched {t['score']:.2f}; next {t.get('next_family')} {t.get('next_score')})", f"  {t['source']}"], f_b))
    else:
        cand = ", ".join(f"{c['family']} {c['score']:.2f}" for c in t.get("candidates", [])[:4])
        rows.append(text_block([f"type: UNRESOLVED. candidates: {cand or 'none'}", f"  {t['source']}"], f_b))
    if type_sheet and Path(type_sheet).exists():
        ts = Image.open(type_sheet).convert("RGB")
        ts = ts.resize((W, int(ts.height * W / ts.width)))
        rows.append(ts)

    # logo + grammar
    lg = profile["logo"]
    g = profile["grammar"]
    rows.append(text_block([
        f"logo files: {', '.join(f['path'] + ' (' + f.get('variant', '?') + ')' for f in lg.get('files', [])) or 'none'}; width share p50 {g['logo_width_share'].get('p50')}; corners {g['logo_corner_counts']}",
        f"margins: side p50 {g['side_margin'].get('p50')}, top {g['top_inset'].get('p50')}, bottom {g['bottom_inset'].get('p50')}; column x {g['text_column_x'].get('p50')} w {g['text_column_w'].get('p50')}",
        f"type scale: headline h/short p50 {g['headline_h_share'].get('p50')}, subline {g['subline_h_share'].get('p50')}; alignment {g['alignment_counts']}",
    ], f_b))

    # families with posts
    by_source = {r.source: r for r in reads}
    shown = [f for f in profile["families"] if f["status"] == "family"][:12]
    for fam in shown:
        members = [by_source[s] for s in fam["source"] if s in by_source][:6]
        thumbs = []
        for r in members:
            im = Image.open(r.path).convert("RGB")
            im.thumbnail((300, 380))
            thumbs.append(_draw_slots(im, r, colours))
        h = 60 + (max((t.height for t in thumbs), default=0) + 10)
        row = Image.new("RGB", (W, h), (20, 22, 28))
        d = ImageDraw.Draw(row)
        d.text((PAD, 12), f"{fam['status']} x{fam['seen_count']}  {fam['key']}  headline chars p50 {fam['parameters']['headline_chars'].get('p50')}, "
               f"lines {fam['parameters']['headline_lines'].get('p50')}, logo {fam['parameters']['logo_variant']}", fill=(235, 235, 235), font=f_b)
        x = PAD
        for t_ in thumbs:
            row.paste(t_, (x, 55))
            x += t_.width + 12
        rows.append(row)

    # imagery
    items = profile["imagery"].get("items", [])
    rows.append(text_block([f"imagery language ({profile['imagery'].get('people')} people): "] +
                           [f"  - {i.get('kind')}: {i.get('description')} [posts {i.get('evidence_post_ids')}]" for i in items[:10]] +
                           [f"  never: {', '.join(profile['imagery'].get('never', []))}"], f_b))
    cal = profile["calibration"]
    rows.append(text_block([f"floors: {cal.get('floors')}", f"  measured on {cal.get('measured_on')} posts; dead space p75 {cal.get('dead_space', {}).get('p75')}, "
                            f"edge band p75 {cal.get('edge_bands', {}).get('p75')}, logo height p25 {cal.get('logo_height_share', {}).get('p25')}"], f_b))

    H = sum(r.height for r in rows)
    sheet = Image.new("RGB", (W, H), (20, 22, 28))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path, quality=88)
    return out_path
