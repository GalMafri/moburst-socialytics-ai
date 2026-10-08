from design_engine.learn.layers import read_post
from design_engine.measure.logo import logo_gray_from_file
from design_engine.measure.ocr import FakeOCR, Line
from tests.fixtures.make_post_fixture import make


def test_read_post_separates_text_logo_bar(tmp_path):
    fx = make(tmp_path)
    r = read_post(fx["path"], logo_gray_from_file(fx["logo_path"], 0), ocr=FakeOCR(fx["lines"]), matting=False)
    assert r.logo and abs(r.logo.box[0] - fx["logo_box"][0]) < 30
    assert r.text.headline_box and abs(r.text.headline_box[1] - fx["headline_box"][1]) < 5
    assert r.ground["kind"] == "flat" and r.accent_boxes and r.accent_boxes[0][0] == 0


def test_wordmark_line_is_not_headline(tmp_path):
    fx = make(tmp_path)
    lines = fx["lines"] + [Line("BADER LAW", fx["wordmark_box"], 1.0)]
    r = read_post(fx["path"], logo_gray_from_file(fx["logo_path"], 0), ocr=FakeOCR(lines), matting=False)
    assert all(l.text != "BADER LAW" for l in r.text.headline + r.text.subline)


def test_photo_region_found_with_matting(tmp_path):
    import pytest

    pytest.importorskip("rembg")
    fx = make(tmp_path, name="p", with_photo=True)
    r = read_post(fx["path"], logo_gray_from_file(fx["logo_path"], 0), ocr=FakeOCR(fx["lines"]), matting=True)
    assert r.picture_boxes and r.picture_boxes[0][1] >= 700
