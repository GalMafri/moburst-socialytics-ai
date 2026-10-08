"""Typesetting against the client's floor. Measures with the brand's font file through Pillow, wraps at the brand size,
balances the last line, shrinks in 2 px steps to the floor, and reports overflow at the floor instead of going lower.
Never an ellipsis, never a dropped word: an overflowing fit still carries every word so the caller can show what did not fit."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import ImageFont

LINE_HEIGHT = 1.15  # line box as a share of the font size; the renderer sets the same value in CSS
REFLOW_WIDTHS = (0.9, 0.8, 0.7)  # narrower wrap widths tried, in order, to balance a short last line


@dataclass(frozen=True)
class Fit:
    lines: list[str]
    size_px: float
    overflow: bool
    line_height: float = LINE_HEIGHT

    @property
    def block_h(self) -> float:
        return len(self.lines) * self.size_px * self.line_height

    @property
    def text(self) -> str:
        return "\n".join(self.lines)


def _font(font_path: Path, size: float) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(font_path), size)


def _wrap(words: list[str], font: ImageFont.FreeTypeFont, width: float) -> tuple[list[str], bool]:
    """Greedy wrap. Returns the lines and whether every line fits the width (a single word wider than the box does not)."""
    lines: list[str] = []
    cur: list[str] = []
    ok = True
    for w in words:
        trial = " ".join(cur + [w])
        if cur and font.getlength(trial) > width:
            lines.append(" ".join(cur))
            cur = [w]
        else:
            cur.append(w)
        if font.getlength(w) > width:
            ok = False
    if cur:
        lines.append(" ".join(cur))
    return lines, ok


def _short_last(lines: list[str], font: ImageFont.FreeTypeFont, width: float) -> bool:
    if len(lines) < 2:
        return False
    last, prev = lines[-1], lines[-2]
    return font.getlength(last) < width / 3 or (len(last.split()) == 1 and len(prev.split()) >= 2)


def _balance(words: list[str], font: ImageFont.FreeTypeFont, width: float, lines: list[str]) -> list[str]:
    """Reflow at a narrower width when the last line is short, keeping the line count; the first improvement wins."""
    if not _short_last(lines, font, width):
        return lines
    for share in REFLOW_WIDTHS:
        alt, ok = _wrap(words, font, width * share)
        if not ok or len(alt) != len(lines):
            continue
        if font.getlength(alt[-1]) > font.getlength(lines[-1]):
            return alt
    return lines


def fit_block(lines_text: str, font_path: Path, size_px: float, floor_px: float, box_w: int, box_h: int, max_lines: int,
              balance: bool = True, line_height: float = LINE_HEIGHT) -> Fit:
    """Fit the copy into box_w × box_h: wrap at size_px, balance, then shrink by 2 px steps down to floor_px.
    At the floor the result is returned with overflow=True rather than shrinking further, clipping or dropping words."""
    words = lines_text.split()
    if not words:
        return Fit([], float(size_px), False, line_height)
    size = float(size_px)
    floor = float(floor_px)
    while True:
        font = _font(font_path, size)
        lines, width_ok = _wrap(words, font, box_w)
        fits = width_ok and len(lines) <= max_lines and len(lines) * size * line_height <= box_h
        if fits:
            if balance:
                lines = _balance(words, font, box_w, lines)
            return Fit(lines, size, False, line_height)
        if size <= floor:
            return Fit(lines, size, True, line_height)
        size = max(floor, size - 2.0)
