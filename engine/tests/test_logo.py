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


def _lockup_white_text(tmp_path):
    """A red mark and a white six-letter wordmark: on white only the mark reads; on black the whole lockup reads."""
    im = Image.new("RGBA", (400, 100), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 90, 90], fill=(220, 40, 40, 255))
    d.rectangle([20, 10, 30, 80], fill=(0, 0, 0, 0))  # two cut-outs give the mark structure, as a real mark has
    d.rectangle([50, 10, 60, 80], fill=(0, 0, 0, 0))
    for i in range(6):
        d.rectangle([110 + i * 46, 20, 110 + i * 46 + 34, 70], fill=(255, 255, 255, 255))
    p = tmp_path / "logo-white.png"
    im.save(p)
    return p


def test_file_ground_from_the_files_own_ink(tmp_path):
    from design_engine.measure.logo import file_ground

    assert file_ground(_lockup_white_text(tmp_path)) == "dark"
    im = Image.new("RGBA", (400, 100), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 90, 90], fill=(220, 40, 40, 255))
    for i in range(6):
        d.rectangle([110 + i * 46, 20, 110 + i * 46 + 34, 70], fill=(0, 0, 0, 255))
    p = tmp_path / "logo-black.png"
    im.save(p)
    assert file_ground(p) == "light"
    mark = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    ImageDraw.Draw(mark).rectangle([5, 5, 95, 95], fill=(220, 40, 40, 255))
    mark.save(tmp_path / "mark.png")
    assert file_ground(tmp_path / "mark.png") is None


def test_mark_only_match_reports_the_whole_lockup_footprint(tmp_path):
    """The posts carry the lockup with a bolder wordmark than the file: only the mark matches, yet the slot is the lockup's footprint."""
    from design_engine.measure.logo import find_logo_any, logo_templates_from_file

    p = _lockup_white_text(tmp_path)
    tpls = logo_templates_from_file(p)
    on_light = next(t for t in tpls if t.name == "on_light")
    assert on_light.gray.shape[1] < 100 and on_light.full_w == 375  # the mark alone, inside a 375-wide lockup extent
    frame = Image.new("RGB", (1080, 1350), (250, 250, 250))  # a light post: the white wordmark cannot be matched here
    mark = Image.open(p).crop((0, 0, 91, 91)).resize((73, 73))
    frame.paste(mark, (100, 120), mark)
    m = find_logo_any(np.asarray(frame), tpls, 1080)
    assert m is not None and m.variant == "on_light"
    assert abs(m.match_box[0] - 100) < 12 and abs(m.match_box[2] - 73) < 12
    assert m.box[2] > 3.5 * m.box[3]  # the footprint is the lockup aspect (375:91), not the mark
    assert abs(m.box[0] - 100) < 12 and abs(m.box[1] - 120) < 12
