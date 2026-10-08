from dataclasses import asdict

import numpy as np
import pytest
from PIL import Image

from design_engine.compose import ComposeSpec, build_html, fit_block, render_html
from design_engine.learn.families import cluster
from design_engine.learn.layers import read_post
from design_engine.measure.logo import logo_gray_from_file
from design_engine.measure.ocr import FakeOCR
from design_engine.platform import specs
from tests.fixtures.make_post_fixture import NAVY, make

HEADLINE = "Some injuries ruin summers"
SUBLINE = "Some sense in rumours"


def _read(tmp_path, name, **kw):
    fx = make(tmp_path, name=name, **kw)
    return fx, read_post(fx["path"], logo_gray_from_file(fx["logo_path"], 0), ocr=FakeOCR(fx["lines"]), matting=False,
                         meta={"source_post_id": name, "slide_index": 0})


@pytest.fixture(scope="module")
def rendered(tmp_path_factory, fonts):
    tmp = tmp_path_factory.mktemp("render")
    fx_a, a = _read(tmp, "a")
    _, b = _read(tmp, "b", headline=("Some injuries", "ruin summers"))
    family = asdict(cluster([a, b])[0])
    size = specs.sizes_for("Instagram", "Single Image")[0]
    assert (size.w, size.h) == (1080, 1350)
    slots = family["template"]["slots"]
    fit = {}
    for role, text in (("headline", HEADLINE), ("subline", SUBLINE)):
        s = slots[role]
        box_w, box_h = int(s["w"] * size.w), int(s["h"] * size.h)
        fit[role] = fit_block(text, fonts["A"], 96 if role == "headline" else 44, 24, box_w=box_w, box_h=box_h, max_lines=3)
        assert fit[role].overflow is False
    spec = ComposeSpec(headline=HEADLINE, subline=SUBLINE, logo_variant="light", pair={"ink_hex": "#ffffff", "ground_hex": "#0e1b2e"},
                       device=True, arrangement="p50", accent_hex="#dc2a2e")
    html = build_html(family, size, spec, {"headline": fonts["A"], "subline": fonts["A"]}, fx_a["logo_path"], None, fit)
    out = tmp / "render.png"
    boxes = render_html(html, size.w, size.h, out)
    return {"family": family, "size": size, "fit": fit, "html": html, "png": out, "boxes": boxes, "logo_path": fx_a["logo_path"]}


def _slot_px(slot, size):
    return slot["x"] * size.w, slot["y"] * size.h, slot["w"] * size.w, slot["h"] * size.h


def test_png_size_is_exact(rendered):
    assert Image.open(rendered["png"]).size == (1080, 1350)


def test_render_boxes_match_slots(rendered):
    boxes, size, slots = rendered["boxes"], rendered["size"], rendered["family"]["template"]["slots"]
    assert {"headline", "subline", "logo", "accent"} <= set(boxes)
    for role in ("headline", "subline"):
        sx, sy, sw, sh = _slot_px(slots[role], size)
        x, y, w, h = boxes[role]
        assert x >= sx - 1 and y >= sy - 1 and x + w <= sx + sw + 1 and y + h <= sy + sh + 1, (role, boxes[role], (sx, sy, sw, sh))
        assert w > 0 and h > 0
    # the headline block height is the fitted lines at the fitted size
    fit = rendered["fit"]["headline"]
    assert abs(boxes["headline"][3] - len(fit.lines) * fit.size_px * 1.15) <= 2
    lx, ly, lw, lh = _slot_px(slots["logo"], size)
    x, y, w, h = boxes["logo"]
    assert abs(x - lx) <= 1 and abs(y - ly) <= 1 and w <= lw + 1 and h <= lh + 1


def test_html_uses_font_files_and_data_slots(rendered):
    html = rendered["html"]
    assert "@font-face" in html and "A.ttf" in html
    assert html.count("data-slot=") >= 4
    assert "white-space: pre" in html or "white-space:pre" in html


def test_logo_is_the_file(rendered):
    x, y, w, h = [round(v) for v in rendered["boxes"]["logo"]]
    frame = np.asarray(Image.open(rendered["png"]).convert("L"), dtype=np.float64)
    region = frame[y:y + h, x:x + w]
    logo = Image.open(rendered["logo_path"]).convert("RGBA")
    bg = Image.new("RGBA", logo.size, NAVY + (255,))
    bg.alpha_composite(logo)
    ref = np.asarray(bg.convert("L").resize((w, h), Image.LANCZOS), dtype=np.float64)
    a, b = region - region.mean(), ref - ref.mean()
    ncc = float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-9))
    assert ncc >= 0.95


def test_accent_device_is_drawn_in_its_slot(rendered):
    x, y, _w, h = rendered["boxes"]["accent"]
    assert x == 0 and h >= 0.6 * rendered["size"].h
    px = np.asarray(Image.open(rendered["png"]).convert("RGB"))[int(y) + 5, int(x) + 5]
    assert px[0] > 150 and px[1] < 100  # the red bar of the synthetic brand


def test_headline_ink_is_the_pair_ink(rendered):
    x, y, w, h = [round(v) for v in rendered["boxes"]["headline"]]
    region = np.asarray(Image.open(rendered["png"]).convert("RGB"))[y:y + h, x:x + w].reshape(-1, 3)
    assert (region == 255).all(axis=1).any()  # white ink present
    assert (np.abs(region - np.array(NAVY)) < 3).all(axis=1).any()  # on the navy ground
