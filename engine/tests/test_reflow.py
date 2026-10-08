"""Reflow: a family measured on 4:5 posts placed into a 1.91:1 frame keeps type and logo in short-edge units, anchors margins,
stretches the picture, and keeps apart what the family keeps apart."""
from __future__ import annotations

from design_engine.compose.template import frame_boxes, reflow
from design_engine.platform.specs import Size

PORTRAIT = Size("ig-4x5", 1080, 1350, "4:5", {"top": 0, "bottom": 0, "left": 0, "right": 0}, 24, 8000, "feed")
LANDSCAPE = Size("li-191x100", 1200, 627, "1.91:1", {"top": 0, "bottom": 0, "left": 0, "right": 0}, 24, 8000, "feed")
FAMILY = {
    "parameters": {"aspect": 0.8},
    "template": {"picture_role": "top", "slots": {
        "picture": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.60},
        "headline": {"x": 0.08, "y": 0.66, "w": 0.84, "h": 0.14},
        "subline": {"x": 0.08, "y": 0.82, "w": 0.84, "h": 0.06},
        "logo": {"x": 0.08, "y": 0.91, "w": 0.20, "h": 0.05},
        "accent": {"x": 0.0, "y": 0.0, "w": 0.04, "h": 1.0},
    }},
}


def test_same_aspect_is_plain_fraction_scaling():
    boxes = frame_boxes(FAMILY, PORTRAIT)
    assert boxes["logo"] == (0.08 * 1080, 0.91 * 1350, 0.20 * 1080, 0.05 * 1350)


def test_landscape_keeps_logo_and_type_in_short_edge_units():
    boxes = frame_boxes(FAMILY, LANDSCAPE)
    S = 627
    ref_h = S / 0.8  # the family's frame at this short edge: 627 x 784
    assert abs(boxes["logo"][3] - 0.05 * ref_h) < 0.5 and abs(boxes["logo"][2] - 0.20 * S) < 0.5
    assert abs(boxes["headline"][3] - 0.14 * ref_h) < 0.5
    # the logo anchors to its left margin in short-edge units; the text column, centred in the family, stays centred at its measure
    assert abs(boxes["logo"][0] - 0.08 * S) < 0.5
    assert abs(boxes["headline"][2] - 0.84 * S) < 0.5 and abs(boxes["headline"][0] + boxes["headline"][2] / 2 - 600) < 0.5


def test_landscape_fills_stretch_and_the_band_keeps_its_thickness():
    boxes = frame_boxes(FAMILY, LANDSCAPE)
    assert boxes["picture"][2] == 1200.0 and boxes["picture"][0] == 0.0
    assert abs(boxes["accent"][2] - 0.04 * 627) < 0.5 and boxes["accent"][3] == 627.0


def test_landscape_keeps_apart_what_the_family_keeps_apart():
    b = frame_boxes(FAMILY, LANDSCAPE)
    for a, c in (("headline", "subline"), ("subline", "logo")):
        assert b[a][1] + b[a][3] <= b[c][1] + 0.5, (a, c, b[a], b[c])
    # the picture ends where the headline starts, and everything stays inside the frame
    assert b["picture"][1] + b["picture"][3] <= b["headline"][1] + 0.5
    for name, (x, y, w, h) in b.items():
        assert x >= -0.5 and y >= -0.5 and x + w <= 1200.5 and y + h <= 627.5, (name, (x, y, w, h))


def test_right_anchored_logo_keeps_its_right_margin():
    fam = {"parameters": {"aspect": 0.8}, "template": {"slots": {"logo": {"x": 0.80, "y": 0.05, "w": 0.15, "h": 0.05}}}}
    boxes = reflow(fam["template"]["slots"], LANDSCAPE, 0.8)
    x, w = boxes["logo"][0], boxes["logo"][2]
    assert abs((1200 - (x + w)) - 0.05 * 627) < 0.5


def test_text_slots_are_pushed_off_the_logo():
    fam = {"parameters": {"aspect": 0.8}, "template": {"slots": {
        "logo": {"x": 0.03, "y": 0.03, "w": 0.08, "h": 0.06},
        "subline": {"x": 0.06, "y": 0.04, "w": 0.22, "h": 0.045},  # the median subline lands on the median logo
        "headline": {"x": 0.19, "y": 0.31, "w": 0.43, "h": 0.17}}}}
    b = frame_boxes(fam, PORTRAIT)
    lx, ly, lw, lh = b["logo"]
    sx, sy, sw, sh = b["subline"]
    assert sx >= lx + lw - 0.5 or sy >= ly + lh - 0.5 or sx + sw <= lx + 0.5 or sy + sh <= ly + 0.5
    assert abs(sx - (lx + lw)) < 0.5  # pushed right, the shortest move
