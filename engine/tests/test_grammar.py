from design_engine.learn.grammar import bands
from design_engine.learn.layers import read_post
from design_engine.measure.logo import logo_gray_from_file
from design_engine.measure.ocr import FakeOCR
from tests.fixtures.make_post_fixture import make


def test_grammar_skips_posts_without_logo(tmp_path):
    reads = []
    for name, logo in (("a", True), ("b", True), ("c", False)):
        fx = make(tmp_path, name=name, with_logo=logo)
        reads.append(read_post(fx["path"], logo_gray_from_file(fx["logo_path"], 0), ocr=FakeOCR(fx["lines"]), matting=False,
                               meta={"source_post_id": name}))
    g = bands(reads)
    assert g.logo_width_share["n"] == 2 and g.side_margin["n"] == 3
    assert g.logo_corner_counts == {"tl": 2} and g.alignment_counts.get("left") == 3
    assert 0.1 < g.side_margin["p50"] < 0.2 and g.headline_h_share["n"] == 3
