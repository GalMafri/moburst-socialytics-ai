"""The gate on synthetic renders drawn with Pillow: a navy post with a red bar, the lockup file, headline, subline and a picture."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from design_engine.gate.check import check
from design_engine.gate.distinct import Option, filter_set, signature
from design_engine.measure.ocr import FakeOCR, Line
from tests.fixtures.make_post_fixture import NAVY, RED, lockup_image

W, H = 1080, 1350
LOGO_BOX = [160, 120, 324, 81]
HEAD_SLOT = [160, 380, 760, 240]
SUB_SLOT = [160, 660, 760, 60]
PIC_SLOT = [160, 780, 760, 450]
ACCENT = [0, 0, 110, H]


@dataclass
class S:
    """The shape Task 1's Size has; the gate reads only these fields."""
    w: int = W
    h: int = H
    safe: dict = field(default_factory=lambda: {"top": 60, "bottom": 60, "left": 60, "right": 60})
    min_text_px: int = 24
    max_file_kb: int = 8192


def profile_for(logo_path) -> dict:
    return {"calibration": {"floors": {"dead_space_max": 0.38, "edge_band_max": 0.16, "logo_height_min": 0.06}},
            "logo": {"files": [{"path": str(logo_path), "kind": "png"}]}}


def quiet_picture(w, h):
    rows = np.linspace(0, 1, h)[:, None, None]
    top, bot = np.array([70, 80, 100]), np.array([120, 130, 150])
    return Image.fromarray((top + (bot - top) * rows).repeat(w, axis=1).astype(np.uint8))


def busy_picture(w, h, cell=48, seed=3):
    rng = np.random.default_rng(seed)
    blocks = rng.choice([25, 235], size=(h // cell + 1, w // cell + 1, 1)).astype(np.uint8)
    arr = np.kron(blocks, np.ones((cell, cell, 3), dtype=np.uint8))[:h, :w]
    return Image.fromarray(arr)


def render(tmp_path, name, *, headline=("Some injuries", "don't heal"), sub="Here is what you need", logo="file", busy_under_text=False):
    im = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 110, H], fill=RED)
    boxes = {"accent": ACCENT, "logo": LOGO_BOX, "headline": HEAD_SLOT, "subline": SUB_SLOT}
    if busy_under_text:
        pic_box = [160, 360, 760, 870]
        im.paste(busy_picture(pic_box[2], pic_box[3]), (pic_box[0], pic_box[1]))
    else:
        pic_box = PIC_SLOT
        im.paste(quiet_picture(pic_box[2], pic_box[3]), (pic_box[0], pic_box[1]))
    boxes["picture"] = pic_box
    lgp = tmp_path / "logo.png"
    lockup_image().save(lgp)
    if logo == "file":
        lg = Image.open(lgp).resize((LOGO_BOX[2], LOGO_BOX[3]))
        im.paste(lg, (LOGO_BOX[0], LOGO_BOX[1]), lg)
    elif logo == "shape":
        d.rectangle([LOGO_BOX[0], LOGO_BOX[1], LOGO_BOX[0] + LOGO_BOX[2] - 1, LOGO_BOX[1] + LOGO_BOX[3] - 1], fill=(255, 255, 255))
    lines = []
    f_head = ImageFont.load_default(size=120)
    y = 390
    for t in headline:
        d.text((160, y), t, font=f_head, fill=(255, 255, 255))
        b = d.textbbox((160, y), t, font=f_head)
        lines.append(Line(t, [b[0], b[1], b[2] - b[0], b[3] - b[1]], 1.0))
        y += 115
    f_sub = ImageFont.load_default(size=44)
    d.text((160, 668), sub, font=f_sub, fill=(255, 255, 255))
    b = d.textbbox((160, 668), sub, font=f_sub)
    lines.append(Line(sub, [b[0], b[1], b[2] - b[0], b[3] - b[1]], 1.0))
    path = tmp_path / f"{name}.png"
    im.save(path)
    return {"path": path, "logo_path": lgp, "boxes": boxes, "lines": lines, "copy": {"headline": " ".join(headline), "subline": sub}}


def unrelated_reference(tmp_path):
    im = Image.new("RGB", (W, H), (240, 240, 240))
    ImageDraw.Draw(im).ellipse([200, 300, 880, 1000], fill=(20, 20, 20))
    p = tmp_path / "other-client-post.png"
    im.save(p)
    return p


def run(fx, references=(), prior=()):
    return check(fx["path"], fx["boxes"], profile_for(fx["logo_path"]), S(), list(references), list(prior), fx["copy"], ocr=FakeOCR(fx["lines"]))


def test_clean_render_passes(tmp_path):
    fx = render(tmp_path, "clean")
    r = run(fx, references=[unrelated_reference(tmp_path)])
    assert r.failures == [] and r.passed
    m = r.measurements
    assert m["logo_match"] >= 0.9 and m["logo_contrast"] >= 3 and m["headline_contrast"] >= 4.5 and m["subline_contrast"] >= 4.5
    assert m["headline_busy"] <= 0.11 and m["headline_h_share"] >= 0.08 and m["content_span"] >= 0.55 and m["dead_space"] <= 0.38
    assert m["ocr"] == {"headline": True, "subline": True}


def test_headline_over_busy_picture_fails_naming_the_box(tmp_path):
    fx = render(tmp_path, "busy", busy_under_text=True)
    r = run(fx)
    assert not r.passed
    busy = [f for f in r.failures if re.fullmatch(r"headline busy ground 0\.\d{2} is above 0\.11", f)]
    assert busy, r.failures
    assert r.measurements["headline_busy"] > 0.11


def test_drawn_shape_in_place_of_logo_fails_as_not_the_file(tmp_path):
    fx = render(tmp_path, "shape", logo="shape")
    r = run(fx)
    assert not r.passed
    assert any(re.fullmatch(r"logo is not the file: match -?0\.\d{2} is below 0\.90", f) for f in r.failures), r.failures
    assert r.measurements["logo_match"] < 0.9


def test_copy_of_client_post_with_new_text_fails_near_copy(tmp_path):
    ref = render(tmp_path, "ref")
    fx = render(tmp_path, "cand", headline=("Your child was", "hurt at school"))
    r = run(fx, references=[ref["path"]])
    assert not r.passed
    hits = [f for f in r.failures if f.startswith("near copy of reference ref.png: ")]
    assert hits and re.fullmatch(r"near copy of reference ref\.png: (whole-frame distance \d+ is within 40|half-frame distance \d+ is within 20)", hits[0])
    # the same render against an unrelated post is not a near copy
    assert run(fx, references=[unrelated_reference(tmp_path)]).measurements["near_copy"]["is_copy"] is False


def test_ocr_copy_check_is_whitespace_and_line_order_tolerant(tmp_path):
    fx = render(tmp_path, "ocr")
    reordered = [fx["lines"][1], fx["lines"][0], Line("  Here is   what you need ", fx["lines"][2].box, 1.0)]
    r = check(fx["path"], fx["boxes"], profile_for(fx["logo_path"]), S(), [], [], fx["copy"], ocr=FakeOCR(reordered))
    assert r.passed and r.measurements["ocr"] == {"headline": True, "subline": True}
    wrong = [Line("Some injuries", fx["lines"][0].box, 1.0), Line("do heal", fx["lines"][1].box, 1.0), fx["lines"][2]]
    r = check(fx["path"], fx["boxes"], profile_for(fx["logo_path"]), S(), [], [], fx["copy"], ocr=FakeOCR(wrong))
    assert 'headline copy reads "Some injuries do heal" instead of "Some injuries don\'t heal"' in r.failures


def test_signature_mirrors_the_family_key():
    boxes = {"accent": ACCENT, "logo": LOGO_BOX, "headline": HEAD_SLOT, "subline": SUB_SLOT, "picture": PIC_SLOT}
    assert signature(boxes, S()) == "middle|left|tl|left|bottom"
    assert signature({"headline": [160, 1000, 760, 200]}, S()) == "bottom|left|none|none|none"


def test_set_distinctness_drops_duplicate():
    boxes = {"accent": ACCENT, "logo": LOGO_BOX, "headline": HEAD_SLOT, "subline": SUB_SLOT, "picture": PIC_SLOT}
    other = {"logo": [700, 1200, 300, 80], "headline": [160, 200, 760, 240], "picture": [0, 0, 1080, 1350]}
    opts = [
        Option("a", 1, "fam-redbar", "pic-1", boxes, S()),
        Option("b", 2, "fam-redbar", "pic-1", boxes, S()),      # same family and picture as a: dropped
        Option("c", 3, "fam-redbar", "pic-2", boxes, S()),      # same family, other picture: kept
        Option("d", 4, "fam-photo", "pic-3", other, S()),       # its signature is one of the client's last three: dropped
        Option("e", 5, "fam-redbar", "pic-1", boxes, S()),      # duplicate of a again: dropped
    ]
    dropped: list[str] = []
    kept = filter_set(opts, recent_signatures=[signature(other, S())], dropped=dropped)
    assert [o.id for o in kept] == ["a", "c"]
    assert any(d.startswith("b: ") for d in dropped) and any(d.startswith("d: ") for d in dropped)
