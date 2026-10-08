"""Placement by measured free space and option assembly, on the Plan 1 synthetic family and synthetic pictures
(numpy noise in one half, a flat field in the other). Renders go through the real Chromium; no network."""
from __future__ import annotations

import copy
from dataclasses import asdict

import numpy as np
import pytest
from PIL import Image

from design_engine.compose import place
from design_engine.compose.option import Rendered, assemble
from design_engine.compose.place import Arrangement, choose
from design_engine.learn.families import cluster
from design_engine.learn.layers import read_post
from design_engine.measure.image import rel_lum
from design_engine.measure.logo import logo_gray_from_file
from design_engine.measure.ocr import FakeOCR
from design_engine.picture.zone import ZoneRead
from design_engine.platform import specs
from tests.fixtures.make_post_fixture import lockup_image, make

W, H = 1080, 1350
HEADLINE = "Some injuries"
SUBLINE = "Some sense in rumours"

# The synthetic family's two posts share every position, so its bands are a point. The arrangements under test need a band:
# p25 lifts the text block and the logo into the upper half, p75 drops them into the lower half, p50 straddles the middle.
BANDS = {
    "logo": {"y": {"p25": 0.02, "p75": 0.40}},
    "headline": {"y": {"p25": 0.10, "p75": 0.62}},
    "subline": {"y": {"p25": 0.30, "p75": 0.84}},
}
SLOT_H = {"headline": 0.17, "subline": 0.05}


def _read(tmp_path, name, **kw):
    fx = make(tmp_path, name=name, **kw)
    return fx, read_post(fx["path"], logo_gray_from_file(fx["logo_path"], 0), ocr=FakeOCR(fx["lines"]), matting=False,
                         meta={"source_post_id": name, "slide_index": 0})


@pytest.fixture(scope="module")
def family(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("family")
    _, a = _read(tmp, "a")
    _, b = _read(tmp, "b", headline=("Some injuries", "ruin summers"))
    fam = asdict(cluster([a, b])[0])
    fam["template"]["picture_role"] = "full"
    for slot, bands in BANDS.items():
        s = fam["template"]["slots"][slot]
        s["band"] = {**s.get("band", {}), **bands}
        if slot in SLOT_H:
            s["h"] = SLOT_H[slot]
    return fam


@pytest.fixture(scope="module")
def size():
    s = specs.sizes_for("Instagram", "Single Image")[0]
    assert (s.w, s.h) == (W, H)
    return s


def _picture(path, *, busy_rows: slice | None, flat=(120, 120, 120), seed=0):
    arr = np.full((H, W, 3), flat, dtype=np.uint8)
    if busy_rows is not None:
        rows = arr[busy_rows]
        arr[busy_rows] = np.random.default_rng(seed).integers(0, 255, rows.shape)
    Image.fromarray(arr).save(path)
    return path


@pytest.fixture
def logo_files(tmp_path):
    light = tmp_path / "logo-light-wordmark.png"
    lockup_image(wordmark_white=True).save(light)
    dark = tmp_path / "logo-dark-wordmark.png"
    lockup_image(wordmark_white=False).save(dark)
    return [{"path": str(light), "variant": "upload", "ground": "dark", "source": "upload"},
            {"path": str(dark), "variant": "upload", "ground": "light", "source": "upload"}]


PROFILE = {
    "grammar": {"headline_h_share": {"p25": 0.06, "p50": 0.085, "p75": 0.1}, "subline_h_share": {"p25": 0.03, "p50": 0.04, "p75": 0.05}},
    "observed_pairs": [
        {"ink_hex": "#ffffff", "ground_hex": "#0e1b2e", "contrast": 16.0, "source": "a"},
        {"ink_hex": "#101010", "ground_hex": "#f4f1ea", "contrast": 15.0, "source": "b"},
    ],
    "calibration": {"dead_space": {"p50": 0.2}},
}


# ---- place.choose ----


def test_choose_prefers_quiet_arrangement(tmp_path, family, size):
    pic = _picture(tmp_path / "lower-busy.png", busy_rows=slice(H // 2, H))
    arr = choose(family, size, pic)
    assert isinstance(arr, Arrangement)
    assert arr.name == "p25"
    assert set(arr.boxes) == {"headline", "subline", "logo"}
    # every placed slot sits in the flat upper half and measures as such
    for slot, (_x, y, _w, h) in arr.boxes.items():
        assert y + h <= H / 2 + 1, (slot, arr.boxes[slot])
        assert arr.shares[slot] <= 0.05
    assert arr.share <= 0.05 and arr.ok
    # the alternatives were measured too and are busier; p75 puts the whole block on the noise
    ranked = place.rank(family, size, pic)
    assert ranked[0].name == "p25"
    by_name = {a.name: a for a in ranked}
    assert by_name["p75"].share > by_name["p50"].share > by_name["p25"].share
    assert by_name["p75"].share > 0.35


def test_choose_none_when_all_busy(tmp_path, family, size):
    pic = _picture(tmp_path / "all-busy.png", busy_rows=slice(0, H))
    assert choose(family, size, pic) is None
    ranked = place.rank(family, size, pic)
    assert len(ranked) == 3 and all(not a.ok and a.share > 0.35 for a in ranked)


def test_choose_accepts_precomputed_reads(family, size):
    reads = {"p25": ZoneRead(salient_share=0.6, ok=False), "p50": ZoneRead(salient_share=0.2, ok=True), "p75": ZoneRead(salient_share=0.4, ok=False)}
    arr = choose(family, size, reads)
    assert arr is not None and arr.name == "p50" and arr.share == 0.2
    assert choose(family, size, {k: ZoneRead(salient_share=0.9, ok=False) for k in reads}) is None
    # a stricter floor passed by the caller wins over the reads' own
    assert choose(family, size, reads, floor=0.1) is None


def test_choose_measures_custom_overrides(tmp_path, family, size):
    pic = _picture(tmp_path / "upper-busy.png", busy_rows=slice(0, H // 2))
    custom = {"name": "low", "logo": {"y": 0.55}, "headline": {"y": 0.66}, "subline": {"y": 0.86}}
    arr = choose(family, size, pic, arrangements=["p25", custom])
    assert arr is not None and arr.name == "low" and arr.overrides == {"logo": {"y": 0.55}, "headline": {"y": 0.66}, "subline": {"y": 0.86}}
    assert all(y >= H / 2 - 1 for _x, y, _w, _h in arr.boxes.values())
    assert arr.ok
    # the overrides are what the template renders: the family copy carries them at the median position
    fam = place.family_for(family, arr)
    assert fam["template"]["slots"]["headline"]["y"] == 0.66 and family["template"]["slots"]["headline"]["y"] != 0.66
    assert arr.template_name == "p50"


def test_boxes_follow_the_slot_bands(family, size):
    boxes = {name: place.boxes_for(family, size, name) for name in ("p25", "p50", "p75")}
    assert boxes["p25"]["headline"][1] == pytest.approx(0.10 * H)
    assert boxes["p75"]["headline"][1] == pytest.approx(0.62 * H)
    assert boxes["p50"]["headline"][1] == pytest.approx(family["template"]["slots"]["headline"]["y"] * H)
    assert boxes["p25"]["headline"][2:] == boxes["p75"]["headline"][2:]  # the band moves the slot, never resizes it


def test_frame_box_maps_through_object_fit_cover():
    # a 2000x2000 picture covering a 1080x1350 frame is scaled to 1350 tall and cropped left and right
    mapped = place.frame_to_picture([0.0, 0.0, 1080.0, 675.0], [0.0, 0.0, 1080.0, 1350.0], 2000, 2000)
    assert mapped is not None
    x, y, w, h = mapped
    assert y == pytest.approx(0) and h == pytest.approx(1000) and w == pytest.approx(1600) and x == pytest.approx(200)
    assert place.frame_to_picture([0.0, 0.0, 100.0, 100.0], [500.0, 500.0, 200.0, 200.0], 200, 200) is None


# ---- option.assemble ----


def _fonts(fonts):
    return {"headline": fonts["A"], "subline": fonts["A"]}


def test_assemble_picks_pair_by_ground(tmp_path, family, size, fonts, logo_files):
    pic = _picture(tmp_path / "dark.png", busy_rows=None, flat=(18, 24, 36))
    r = assemble(PROFILE, family, size, pic, {"headline": HEADLINE, "subline": SUBLINE}, "p25", None, None, _fonts(fonts), logo_files,
                 tmp_path / "out", floors={}, accent_hex="#dc2a2e")
    assert isinstance(r, Rendered)
    assert r.spec.pair["ink_hex"] == "#ffffff" and r.spec.pair["ground_hex"] == "#0e1b2e"
    assert r.ground_lum is not None and r.ground_lum < 0.05
    assert r.logo_path.name == "logo-light-wordmark.png" and r.spec.logo_variant == "dark"
    assert r.png == tmp_path / "out" / f"{size.name}.png" and Image.open(r.png).size == (W, H)
    assert {"headline", "subline", "logo", "picture"} <= set(r.boxes)
    assert r.spec.arrangement == "p25" and r.arrangement == "p25"
    # the copy is typeset at the brand size: the headline block is the fitted lines at p50 of the headline share
    fit = r.fit["headline"]
    assert fit.size_px == pytest.approx(0.085 * size.short_edge) and not fit.overflow
    assert abs(r.boxes["headline"][3] - len(fit.lines) * fit.size_px * fit.line_height) <= 2
    # the ink on the render is the pair's ink
    x, y, w, h = [round(v) for v in r.boxes["headline"]]
    region = np.asarray(Image.open(r.png).convert("RGB"))[y:y + h, x:x + w].reshape(-1, 3)
    assert (region == 255).all(axis=1).any()


def test_assemble_picks_dark_ink_on_light_ground(tmp_path, family, size, fonts, logo_files):
    pic = _picture(tmp_path / "light.png", busy_rows=None, flat=(240, 236, 228))
    r = assemble(PROFILE, family, size, pic, {"headline": HEADLINE, "subline": None}, "p25", None, None, _fonts(fonts), logo_files,
                 tmp_path / "out", floors={})
    assert r.spec.pair["ink_hex"] == "#101010"
    assert r.logo_path.name == "logo-dark-wordmark.png" and r.spec.logo_variant == "light"
    assert "subline" not in r.boxes and r.spec.subline is None


def test_assemble_measures_untagged_logo_files(tmp_path, family, size, fonts, logo_files):
    untagged = [{k: v for k, v in f.items() if k != "ground"} for f in logo_files]
    pic = _picture(tmp_path / "dark2.png", busy_rows=None, flat=(18, 24, 36))
    r = assemble(PROFILE, family, size, pic, {"headline": HEADLINE, "subline": SUBLINE}, "p25", None, None, _fonts(fonts), untagged,
                 tmp_path / "out", floors={})
    assert r.logo_path.name == "logo-light-wordmark.png"  # the white wordmark is the one that reads on a dark ground
    # an explicit variant names the file and is honoured
    r2 = assemble(PROFILE, family, size, pic, {"headline": HEADLINE, "subline": SUBLINE}, "p25", None, "logo-dark-wordmark",
                  _fonts(fonts), untagged, tmp_path / "out2", floors={})
    assert r2.logo_path.name == "logo-dark-wordmark.png"


def test_assemble_honours_an_explicit_pair_and_arrangement(tmp_path, family, size, fonts, logo_files):
    pic = _picture(tmp_path / "dark3.png", busy_rows=None, flat=(18, 24, 36))
    pair = {"ink_hex": "#ffd700", "ground_hex": "#0e1b2e"}
    arr = choose(family, size, pic)
    r = assemble(PROFILE, family, size, pic, {"headline": HEADLINE, "subline": SUBLINE}, arr, pair, None, _fonts(fonts), logo_files,
                 tmp_path / "out", floors={})
    assert r.spec.pair == pair
    assert r.boxes["headline"][1] == pytest.approx(arr.boxes["headline"][1], abs=1)


def test_assemble_rejects_overflow_naming_the_slot(tmp_path, family, size, fonts, logo_files):
    pic = _picture(tmp_path / "dark4.png", busy_rows=None, flat=(18, 24, 36))
    narrow = copy.deepcopy(family)
    narrow["template"]["slots"]["headline"]["w"] = 0.3
    narrow["template"]["slots"]["headline"]["h"] = 0.08
    long_copy = " ".join(["Some injuries ruin summers"] * 4)
    with pytest.raises(OverflowError) as e:
        assemble(PROFILE, narrow, size, pic, {"headline": long_copy, "subline": SUBLINE}, "p25", None, None, _fonts(fonts), logo_files,
                 tmp_path / "out", floors={})
    assert "headline" in str(e.value) and size.name in str(e.value)
    assert not (tmp_path / "out").exists()  # nothing rendered


def test_text_floor_never_below_platform_floor(size):
    assert place.text_floor_px({"p25": 0.01, "p50": 0.03}, size) == size.min_text_px
    assert place.text_floor_px({"p25": 0.06, "p50": 0.085}, size) == pytest.approx(0.06 * size.short_edge)


def test_flat_ground_lum_is_the_template_ground(family, size):
    lum = place.ground_under(None, family, size, "p50", place.boxes_for(family, size, "p50")["headline"])
    hexes = family["parameters"]["ground_hex"]
    c = hexes[0].lstrip("#")
    expected = float(rel_lum(np.array([int(c[i:i + 2], 16) for i in (0, 2, 4)])))
    assert lum == pytest.approx(expected, abs=1e-6)
