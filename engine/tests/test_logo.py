import numpy as np
from PIL import Image, ImageDraw

from design_engine.measure.logo import find_logo, logo_gray_from_file


def lockup(tmp_path):
    im = Image.new("RGBA", (400, 100), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 90, 90], fill=(220, 40, 40, 255))
    # Wordmark must not be white: logo_gray_from_file composites on white and trims to ink,
    # so a white wordmark vanishes and the template collapses to one flat square (NCC = 0).
    d.rectangle([110, 20, 390, 70], fill=(30, 30, 60, 255))
    p = tmp_path / "logo.png"
    im.save(p)
    return p


def test_finds_logo_at_known_place(tmp_path):
    # Light ground: the template is dark-on-white, and the port has no polarity handling yet.
    frame = Image.new("RGB", (1080, 1350), (235, 235, 235))
    lg = Image.open(lockup(tmp_path)).resize((324, 81))
    frame.paste(lg, (100, 120), lg)
    m = find_logo(np.asarray(frame), logo_gray_from_file(lockup(tmp_path)), 1080)
    # The trimmed ink is 91/100 of the pasted 81 px (73.7 px, 0.068 of 1080), between the 0.06 and
    # 0.075 rungs; the 0.06 rung wins, so the measured share is 0.0599 (0.0151 off the 81/1080 target).
    assert m and abs(m.height_share - 81 / 1080) < 0.02
    assert abs(m.box[0] - 100) < 25 and abs(m.box[1] - 120) < 25


def test_no_logo_returns_zero(tmp_path):
    frame = np.full((1350, 1080, 3), 30, dtype=np.uint8)
    assert find_logo(frame, logo_gray_from_file(lockup(tmp_path)), 1080) is None


def test_white_wordmark_on_navy_is_found_with_dark_template(tmp_path):
    from design_engine.measure.logo import find_logo_any, logo_templates_from_file

    im = Image.new("RGBA", (400, 100), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 90, 90], fill=(220, 40, 40, 255))
    for i in range(6):  # a wordmark of six white "letters" with gaps, not one slab
        d.rectangle([110 + i * 46, 20, 110 + i * 46 + 34, 70], fill=(255, 255, 255, 255))
    p = tmp_path / "logo-white.png"
    im.save(p)
    frame = Image.new("RGB", (1080, 1350), (14, 27, 46))
    lg = im.resize((324, 81))
    frame.paste(lg, (100, 120), lg)
    m = find_logo_any(np.asarray(frame), logo_templates_from_file(p), 1080)
    assert m is not None and m.variant == "on_dark"
    assert abs(m.box[0] - 100) < 30 and abs(m.box[1] - 120) < 30
