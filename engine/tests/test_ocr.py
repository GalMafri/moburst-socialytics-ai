import platform
from pathlib import Path

import pytest

from design_engine.measure.ocr import FakeOCR, Line
from design_engine.measure.text_lines import classify

ENGINE = Path(__file__).resolve().parents[1]
VISION_BIN = ENGINE / "bin" / "ocr"


def test_classify_headline_vs_subline():
    lines = [
        Line("Some injuries", [120, 400, 600, 90], 1.0),
        Line("don't heal", [120, 500, 520, 90], 1.0),
        Line("Here is what", [120, 700, 400, 40], 1.0),
    ]
    r = classify(lines, 1080, 1350)
    assert [line.text for line in r.headline] == ["Some injuries", "don't heal"]
    assert [line.text for line in r.subline] == ["Here is what"]
    assert r.headline_box == [120, 400, 600, 190]


def test_excluded_box_removes_wordmark():
    lines = [Line("BADER LAW", [100, 80, 300, 40], 1.0), Line("Headline", [120, 400, 600, 90], 1.0)]
    r = classify(lines, 1080, 1350, exclude_boxes=[[90, 70, 320, 60]])
    assert [line.text for line in r.headline] == ["Headline"]
    assert all(line.text != "BADER LAW" for line in r.other)


def test_fake_ocr_returns_given_lines(tmp_path):
    given = [Line("x", [0, 0, 1, 1], 1.0)]
    assert FakeOCR(given)(tmp_path / "any.png") == given


def test_rapidocr_reads_fixture(tmp_path):
    pytest.importorskip("rapidocr_onnxruntime")
    from tests.fixtures.make_text_fixture import make

    img, _boxes = make()
    p = tmp_path / "f.png"
    img.save(p)
    from design_engine.measure.ocr import read_lines

    lines = read_lines(p, backend="rapidocr")
    assert any("injuries" in line.text.lower() for line in lines)


@pytest.mark.skipif(platform.system() != "Darwin" or not VISION_BIN.exists(), reason="Apple Vision binary only on macOS after tools/build_ocr.sh")
def test_vision_reads_fixture(tmp_path):
    from tests.fixtures.make_text_fixture import make

    img, boxes = make()
    p = tmp_path / "f.png"
    img.save(p)
    from design_engine.measure.ocr import read_lines

    lines = read_lines(p, backend="vision")
    hits = [line for line in lines if "injuries" in line.text.lower()]
    assert hits
    # the box comes back in pixels with a top-left origin: it must sit where the fixture drew the first headline line
    drawn = boxes["headline_0"]
    assert abs(hits[0].box[1] - drawn[1]) < 0.5 * drawn[3]
    assert abs(hits[0].box[0] - drawn[0]) < 0.5 * drawn[3]


def test_two_letter_lines_are_furniture_not_headline():
    from design_engine.measure.text_lines import classify

    lines = [Line("VS", [500, 600, 120, 160], 1.0), Line("TOKYO NEON", [100, 900, 300, 60], 1.0), Line("MUMBAI MONSOON", [600, 900, 380, 60], 1.0)]
    r = classify(lines, 1080, 1350)
    assert [l.text for l in r.headline] == ["TOKYO NEON", "MUMBAI MONSOON"] and r.other[0].text == "VS"
