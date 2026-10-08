"""Font file helpers: read a font's own name table and normalise WOFF/WOFF2 to TTF bytes.

The family a font declares about itself is the only name the learner trusts (spec section 4):
never a CSS font-family string, never a face read off a picture.
"""
from __future__ import annotations

from io import BytesIO

from fontTools.ttLib import TTFont

_WOFF_MAGICS = (b"wOFF", b"wOF2")
_SFNT_MAGICS = (b"\x00\x01\x00\x00", b"true", b"OTTO", b"ttcf")

_ITALIC_BIT = 1 << 0  # OS/2 fsSelection bit 0
_OBLIQUE_BIT = 1 << 9  # OS/2 fsSelection bit 9


def _open(data: bytes) -> TTFont:
    try:
        return TTFont(BytesIO(data), lazy=True)
    except Exception as e:  # fontTools raises TTLibError or struct errors on non-fonts
        raise ValueError(f"not a font file ({type(e).__name__}: {e})") from e


def to_ttf(data: bytes) -> bytes:
    """Return SFNT (TTF/OTF) bytes. WOFF and WOFF2 are decompressed; TTF/OTF are returned as-is."""
    head = data[:4]
    if head in _SFNT_MAGICS:
        return data
    if head not in _WOFF_MAGICS:
        raise ValueError(f"unrecognised font signature {head!r}")
    try:
        font = TTFont(BytesIO(data))
        font.flavor = None
        out = BytesIO()
        font.save(out)
    except Exception as e:  # TTLibError, brotli/zlib errors, struct errors: all mean "not a usable font"
        raise ValueError(f"could not decompress font ({type(e).__name__}: {e})") from e
    return out.getvalue()


def font_file_names(data: bytes) -> dict:
    """family, subfamily, weight and style as the font declares them (name ids 16/1, 17/2, OS/2 usWeightClass, fsSelection)."""
    font = _open(data)
    name = font["name"]
    family = name.getDebugName(16) or name.getDebugName(1) or ""
    subfamily = name.getDebugName(17) or name.getDebugName(2) or ""
    weight = 400
    italic = False
    if "OS/2" in font:
        os2 = font["OS/2"]
        weight = int(getattr(os2, "usWeightClass", 400) or 400)
        sel = int(getattr(os2, "fsSelection", 0) or 0)
        italic = bool(sel & (_ITALIC_BIT | _OBLIQUE_BIT))
    if not italic and any(w in subfamily.lower() for w in ("italic", "oblique")):
        italic = True
    return {"family": family.strip(), "subfamily": subfamily.strip(), "weight": weight, "style": "italic" if italic else "normal"}
