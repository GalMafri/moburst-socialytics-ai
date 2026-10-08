from io import BytesIO

import pytest
from fontTools.ttLib import TTFont

from design_engine.ingest.fonts import font_file_names, to_ttf
from design_engine.ingest.website import read_site
from tests.conftest import build_test_font


def test_read_site_finds_logo_fonts_colours(tmp_path, fixture_site):
    pytest.importorskip("playwright")
    r = read_site(fixture_site.as_uri(), tmp_path)
    assert r.logo_candidates and r.logo_candidates[0]["kind"] == "inline-svg"
    assert any(f["family"] == "TestSans" for f in r.font_files)
    hexes = [c["hex"].lower() for c in r.colours]
    assert "#dc2a2e" in hexes and "#0e1b2e" in hexes


def test_read_site_saves_files_and_weights(tmp_path, fixture_site):
    pytest.importorskip("playwright")
    r = read_site(fixture_site.as_uri(), tmp_path)
    svg = r.logo_candidates[0]
    assert (tmp_path / svg["path"]).read_text().lstrip().startswith("<svg")
    assert svg["width"] == 200 and svg["height"] == 40
    kinds = [c["kind"] for c in r.logo_candidates]
    assert kinds.index("inline-svg") < kinds.index("img") < kinds.index("icon") < kinds.index("og-image")
    f = next(f for f in r.font_files if f["family"] == "TestSans")
    assert f["weight"] == 400 and f["style"] == "normal" and f["url"].endswith("test.ttf")
    assert (tmp_path / f["path"]).name == "TestSans-400.ttf"
    assert TTFont(tmp_path / f["path"])["name"].getDebugName(1) == "TestSans"
    by_hex = {c["hex"].lower(): c for c in r.colours}
    assert "#ffffff" not in by_hex and "#888888" not in by_hex
    assert by_hex["#dc2a2e"]["weight"] >= 1000
    assert all(c["weight"] > 0 and c["where"] for c in r.colours) and len(r.colours) <= 8
    assert r.captured_at.endswith("Z")


def test_font_file_names_and_to_ttf(tmp_path):
    ttf_path = build_test_font(tmp_path / "t.ttf", family="TestSans", weight=700)
    data = ttf_path.read_bytes()
    assert to_ttf(data) == data
    names = font_file_names(data)
    assert names == {"family": "TestSans", "subfamily": "Regular", "weight": 700, "style": "normal"}
    for flavor in ("woff", "woff2"):
        font = TTFont(BytesIO(data))
        font.flavor = flavor
        buf = BytesIO()
        font.save(buf)
        converted = to_ttf(buf.getvalue())
        assert converted[:4] == b"\x00\x01\x00\x00"
        assert font_file_names(converted)["family"] == "TestSans"


def test_to_ttf_rejects_non_font():
    with pytest.raises(ValueError):
        to_ttf(b"<html>not a font</html>")


def test_read_site_with_caller_owned_browser(tmp_path, fixture_site):
    sync_playwright = pytest.importorskip("playwright.sync_api").sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            a = read_site(fixture_site.as_uri(), tmp_path / "a", browser=browser)
            b = read_site(fixture_site.as_uri(), tmp_path / "b", browser=browser)
            assert browser.is_connected()
            assert [c["kind"] for c in a.logo_candidates] == [c["kind"] for c in b.logo_candidates]
            assert (tmp_path / "b" / "fonts" / "TestSans-400.ttf").exists()
        finally:
            browser.close()
