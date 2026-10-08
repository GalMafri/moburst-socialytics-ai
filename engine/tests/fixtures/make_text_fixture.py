"""Synthetic text post for OCR tests: a navy 1080x1350 frame with a two-line headline and one subline.

Returns the image and the boxes actually drawn, so tests can check what a backend reads against ground truth.
"""
from __future__ import annotations

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1350
NAVY = (14, 30, 64)
WHITE = (255, 255, 255)

HEADLINE = ["Some injuries", "don't heal"]
SUBLINE = "Here is what to do next"


def _draw_line(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font) -> list[float]:
    draw.text(xy, text, fill=WHITE, font=font)
    x0, y0, x1, y1 = draw.textbbox(xy, text, font=font)
    return [float(x0), float(y0), float(x1 - x0), float(y1 - y0)]


def make() -> tuple[Image.Image, dict[str, list[float]]]:
    img = Image.new("RGB", (W, H), NAVY)
    draw = ImageDraw.Draw(img)
    head_font = ImageFont.load_default(size=96)
    sub_font = ImageFont.load_default(size=44)

    boxes: dict[str, list[float]] = {}
    y = 400
    for i, text in enumerate(HEADLINE):
        boxes[f"headline_{i}"] = _draw_line(draw, (120, y), text, head_font)
        y += 110
    boxes["subline"] = _draw_line(draw, (120, 700), SUBLINE, sub_font)
    return img, boxes
