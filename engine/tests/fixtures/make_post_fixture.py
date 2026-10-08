"""Synthetic brand posts for layer and family tests: navy ground, red left bar, lockup top-left, headline, subline."""
from __future__ import annotations

from PIL import Image, ImageDraw, ImageFont

from design_engine.measure.ocr import Line

NAVY = (14, 27, 46)
RED = (220, 42, 46)


def lockup_image(wordmark_white=True):
    im = Image.new("RGBA", (400, 100), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 90, 90], fill=(220, 40, 40, 255))
    col = (255, 255, 255, 255) if wordmark_white else (30, 30, 60, 255)
    for i in range(6):
        d.rectangle([110 + i * 46, 20, 110 + i * 46 + 34, 70], fill=col)
    return im


def make(tmp_path, name="a", with_logo=True, with_bar=True, with_photo=False, headline=("Some injuries", "don't heal"), sub="Here is what you need"):
    W, H = 1080, 1350
    im = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(im)
    if with_bar:
        d.rectangle([0, 0, 110, H], fill=RED)
    logo_box = None
    if with_logo:
        lg = lockup_image().resize((324, 81))
        im.paste(lg, (160, 120), lg)
        logo_box = [160, 120, 324, 81]
    if with_photo:
        import numpy as np
        rng = np.random.default_rng(3)
        photo = Image.fromarray(rng.integers(40, 220, (500, 760, 3), dtype=np.uint8))
        im.paste(photo, (160, 760))
    f_head = ImageFont.load_default(size=96)
    f_sub = ImageFont.load_default(size=44)
    lines = []
    y = 400
    for t in headline:
        d.text((160, y), t, font=f_head, fill=(255, 255, 255))
        b = d.textbbox((160, y), t, font=f_head)
        lines.append(Line(t, [b[0], b[1], b[2] - b[0], b[3] - b[1]], 1.0))
        y += 110
    d.text((160, 700), sub, font=f_sub, fill=(255, 255, 255))
    b = d.textbbox((160, 700), sub, font=f_sub)
    lines.append(Line(sub, [b[0], b[1], b[2] - b[0], b[3] - b[1]], 1.0))
    path = tmp_path / f"{name}.png"
    im.save(path)
    lgp = tmp_path / "logo.png"
    lockup_image().save(lgp)
    return {"path": path, "logo_path": lgp, "lines": lines, "logo_box": logo_box, "headline_box": lines[0].box,
            "wordmark_box": [250, 135, 230, 50]}
