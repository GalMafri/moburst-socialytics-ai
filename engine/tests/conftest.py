"""Shared fixtures. The `fonts` fixture builds three small TrueType fonts at test time with fontTools so no font is vendored:
A (blocky letterforms), B (clearly different proportions and stroke), and A_twin (A with one glyph changed)."""
from __future__ import annotations

from pathlib import Path

import pytest
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000

# Each letter is a list of rectangles (x0, y0, x1, y1) in a unit cell: x across the advance, y from baseline (0) to top (1).
# Lowercase letters live below X_H; capitals reach 1.0.
_TEMPLATES = {
    "S": [(0.0, 0.85, 1.0, 1.0), (0.0, 0.5, 1.0, 0.65), (0.0, 0.0, 1.0, 0.15), (0.0, 0.65, 0.25, 0.85), (0.75, 0.15, 1.0, 0.5)],
    "o": [(0.0, 0.0, 1.0, 0.15), (0.0, 0.85, 1.0, 1.0), (0.0, 0.0, 0.25, 1.0), (0.75, 0.0, 1.0, 1.0)],
    "m": [(0.0, 0.0, 0.2, 1.0), (0.4, 0.0, 0.6, 1.0), (0.8, 0.0, 1.0, 1.0), (0.0, 0.85, 1.0, 1.0)],
    "e": [(0.0, 0.0, 0.25, 1.0), (0.0, 0.85, 1.0, 1.0), (0.0, 0.45, 1.0, 0.6), (0.0, 0.0, 1.0, 0.15), (0.75, 0.6, 1.0, 1.0)],
    "i": [(0.35, 0.0, 0.65, 1.0), (0.35, 1.2, 0.65, 1.45)],
    "n": [(0.0, 0.0, 0.25, 1.0), (0.75, 0.0, 1.0, 1.0), (0.0, 0.85, 1.0, 1.0)],
    "j": [(0.5, -0.4, 0.8, 1.0), (0.1, -0.4, 0.8, -0.2), (0.5, 1.2, 0.8, 1.45)],
    "u": [(0.0, 0.0, 0.25, 1.0), (0.75, 0.0, 1.0, 1.0), (0.0, 0.0, 1.0, 0.15)],
    "r": [(0.0, 0.0, 0.3, 1.0), (0.0, 0.8, 0.9, 1.0)],
    "s": [(0.0, 0.85, 1.0, 1.0), (0.0, 0.45, 1.0, 0.6), (0.0, 0.0, 1.0, 0.15), (0.0, 0.6, 0.3, 0.85), (0.7, 0.15, 1.0, 0.45)],
}

# Font B: same letters, drawn differently (bars on the other side, hairline stems, different proportions).
_TEMPLATES_B = {
    "S": [(0.0, 0.9, 1.0, 1.0), (0.0, 0.45, 1.0, 0.55), (0.0, 0.0, 1.0, 0.1), (0.9, 0.55, 1.0, 0.9), (0.0, 0.1, 0.1, 0.45)],
    "o": [(0.3, 0.0, 0.7, 0.1), (0.3, 0.9, 0.7, 1.0), (0.2, 0.0, 0.3, 1.0), (0.7, 0.0, 0.8, 1.0)],
    "m": [(0.0, 0.0, 0.1, 1.0), (0.45, 0.0, 0.55, 1.0), (0.9, 0.0, 1.0, 1.0), (0.0, 0.0, 1.0, 0.1)],
    "e": [(0.9, 0.0, 1.0, 1.0), (0.0, 0.9, 1.0, 1.0), (0.0, 0.5, 1.0, 0.6), (0.0, 0.0, 1.0, 0.1), (0.0, 0.6, 0.1, 1.0)],
    "i": [(0.45, 0.0, 0.55, 1.0), (0.3, 1.25, 0.7, 1.35)],
    "n": [(0.0, 0.0, 0.1, 1.0), (0.9, 0.0, 1.0, 1.0), (0.0, 0.0, 1.0, 0.1)],
    "j": [(0.45, -0.5, 0.55, 1.0), (0.0, -0.5, 0.55, -0.4), (0.3, 1.25, 0.7, 1.35)],
    "u": [(0.0, 0.0, 0.1, 1.0), (0.9, 0.0, 1.0, 1.0), (0.0, 0.9, 1.0, 1.0)],
    "r": [(0.9, 0.0, 1.0, 1.0), (0.0, 0.0, 1.0, 0.1)],
    "s": [(0.0, 0.9, 1.0, 1.0), (0.0, 0.45, 1.0, 0.55), (0.0, 0.0, 1.0, 0.1), (0.9, 0.55, 1.0, 0.9), (0.0, 0.1, 0.1, 0.45)],
}

_GLYPH_NAMES = {"S": "S", "o": "o", "m": "m", "e": "e", "i": "i", "n": "n", "j": "j", "u": "u", "r": "r", "s": "s", " ": "space"}


def _build_font(path: Path, family: str, templates: dict, *, width: int, cap: int, x_height: int) -> Path:
    glyph_order = [".notdef", "space"] + [n for ch, n in _GLYPH_NAMES.items() if ch != " "]
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap({ord(ch): name for ch, name in _GLYPH_NAMES.items()})
    glyphs = {}
    for name in glyph_order:
        pen = TTGlyphPen(None)
        ch = name if len(name) == 1 else None
        if ch is not None:
            height = cap if ch.isupper() else x_height
            for x0, y0, x1, y1 in templates[ch]:
                pen.moveTo((round(x0 * width), round(y0 * height)))
                pen.lineTo((round(x1 * width), round(y0 * height)))
                pen.lineTo((round(x1 * width), round(y1 * height)))
                pen.lineTo((round(x0 * width), round(y1 * height)))
                pen.closePath()
        glyphs[name] = pen.glyph()
    fb.setupGlyf(glyphs)
    advance = width + 120
    fb.setupHorizontalMetrics({name: (advance if name != "space" else width // 2, 0) for name in glyph_order})
    fb.setupHorizontalHeader(ascent=900, descent=-300)
    fb.setupNameTable({"familyName": family, "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=900, sTypoDescender=-300, usWinAscent=900, usWinDescent=300)
    fb.setupPost()
    fb.save(str(path))
    return path


@pytest.fixture(scope="module")
def fonts(tmp_path_factory) -> dict[str, Path]:
    d = tmp_path_factory.mktemp("fonts")
    twin = dict(_TEMPLATES)
    twin["j"] = [(0.5, -0.4, 0.8, 1.0), (0.1, -0.4, 0.8, -0.2)]  # the twin's j has no dot
    return {
        "A": _build_font(d / "A.ttf", "A", _TEMPLATES, width=560, cap=700, x_height=500),
        "B": _build_font(d / "B.ttf", "B", _TEMPLATES_B, width=340, cap=880, x_height=560),
        "A_twin": _build_font(d / "A_twin.ttf", "A_twin", twin, width=560, cap=700, x_height=500),
    }


# ---- Website read (Task 9): the static test site under tests/fixtures/site with a freshly built test.ttf ----

FIXTURES = Path(__file__).parent / "fixtures"


def build_test_font(path: Path, family: str = "TestSans", weight: int = 400) -> Path:
    """Write a tiny valid TTF (one triangle glyph for 'A') with fontTools.fontBuilder; used by test_website."""
    fb = FontBuilder(UPM, isTTF=True)
    order = [".notdef", "space", "A"]
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({32: "space", 65: "A"})
    pen = TTGlyphPen(None)
    pen.moveTo((100, 0))
    pen.lineTo((500, 700))
    pen.lineTo((900, 0))
    pen.closePath()
    fb.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "space": TTGlyphPen(None).glyph(), "A": pen.glyph()})
    fb.setupHorizontalMetrics({".notdef": (600, 0), "space": (300, 0), "A": (1000, 100)})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": family, "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200, usWeightClass=weight)
    fb.setupPost()
    fb.save(str(path))
    return path


@pytest.fixture
def fixture_site():
    """Yields tests/fixtures/site/index.html after writing test.ttf beside it; removes the TTF afterwards."""
    site = FIXTURES / "site"
    ttf = build_test_font(site / "test.ttf")
    try:
        yield site / "index.html"
    finally:
        ttf.unlink(missing_ok=True)
