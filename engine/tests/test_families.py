from design_engine.learn.families import cluster, signature
from design_engine.learn.layers import read_post
from design_engine.measure.logo import logo_gray_from_file
from design_engine.measure.ocr import FakeOCR
from tests.fixtures.make_post_fixture import make


def read(tmp_path, name, post_id=None, slide=0, **kw):
    fx = make(tmp_path, name=name, **kw)
    return read_post(fx["path"], logo_gray_from_file(fx["logo_path"], 0), ocr=FakeOCR(fx["lines"]), matting=False,
                     meta={"source_post_id": post_id or name, "slide_index": slide})


def test_two_posts_same_signature_form_a_family(tmp_path):
    a = read(tmp_path, "a")
    b = read(tmp_path, "b", headline=("Your child was", "hurt at school?"))
    c = read(tmp_path, "c", with_bar=False, with_logo=False, with_photo=True)
    fams = cluster([a, b, c])
    redbar = [f for f in fams if f.seen_count == 2][0]
    assert redbar.status == "family" and set(redbar.post_ids) == {"a", "b"}
    assert signature(c).key != redbar.key


def test_singleton_is_seen_once(tmp_path):
    a = read(tmp_path, "a")
    c = read(tmp_path, "c", with_bar=False, with_logo=False, with_photo=True)
    assert all(f.status == "seen_once" for f in cluster([a, c]))


def test_family_counts_posts_not_slides(tmp_path):
    s1 = read(tmp_path, "s1", post_id="album-1", slide=0)
    s2 = read(tmp_path, "s2", post_id="album-1", slide=1, headline=("Second slide", "same look"))
    fams = cluster([s1, s2])
    assert len(fams) == 1 and fams[0].seen_count == 1 and fams[0].status == "seen_once"
    assert fams[0].slots["headline"]["n"] == 2  # both slides still teach the slot band


def test_template_slots_are_fractions(tmp_path):
    a = read(tmp_path, "a")
    b = read(tmp_path, "b")
    fam = cluster([a, b])[0]
    head = fam.template["slots"]["headline"]
    assert 0 <= head["x"] <= 1 and 0 < head["w"] <= 1 and "band" in head
    assert fam.template["devices"] == [{"kind": "accent", "side": "left"}] and fam.template["logo_corner"] == "tl"
    assert fam.parameters["headline_lines"]["p50"] == 2.0 and fam.parameters["device_on"] is True
