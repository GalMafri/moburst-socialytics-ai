"""Sort OCR lines into headline, subline and the rest by their measured heights and vertical order."""
from __future__ import annotations

from dataclasses import dataclass, field

from .image import Box
from .ocr import Line


def _overlap(a: Box, b: Box) -> float:
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    return (ix * iy) / max(1.0, a[2] * a[3])


def union(boxes: list[Box]) -> Box | None:
    if not boxes:
        return None
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    return [x0, y0, max(b[0] + b[2] for b in boxes) - x0, max(b[1] + b[3] for b in boxes) - y0]


@dataclass
class TextRead:
    headline: list[Line] = field(default_factory=list)
    subline: list[Line] = field(default_factory=list)
    other: list[Line] = field(default_factory=list)
    headline_box: Box | None = None
    subline_box: Box | None = None
    footer: list[Line] = field(default_factory=list)  # lines along the bottom edge: dates, rounds, handles, closing lines
    footer_box: Box | None = None


FOOTER_BAND = 0.22  # the bottom share of the frame a footer line sits in (a phone line under a button, a date row)


def classify(lines: list[Line], W: int, H: int, exclude_boxes=()) -> TextRead:
    kept = [line for line in lines if line.confidence >= 0.5 and not any(_overlap(line.box, e) > 0.5 for e in exclude_boxes)]
    if not kept:
        return TextRead()
    kept.sort(key=lambda line: line.box[1])
    # a headline is set in words: a line of fewer than three letters (a "VS" bolt, a monogram read as letters) is furniture
    worded = [line for line in kept if sum(c.isalpha() for c in line.text) >= 3]
    if not worded:
        return TextRead(other=kept)
    tallest = max(line.box[3] for line in worded)
    head = [line for line in worded if line.box[3] >= 0.8 * tallest]
    furniture = [line for line in kept if line not in worded]
    rest = [line for line in worded if line not in head]
    # the subline is the block of lines just below the headline with a consistent smaller height
    sub: list[Line] = []
    if rest:
        h0 = rest[0].box[3]
        for line in rest:
            if abs(line.box[3] - h0) <= 0.25 * h0 and (not sub or line.box[1] - (sub[-1].box[1] + sub[-1].box[3]) < 1.5 * h0):
                sub.append(line)
            else:
                break
    other = [line for line in rest if line not in sub] + furniture
    # a bottom-edge line is a footer when it is small set type, or furniture of any size (a phone number as tall as the headline)
    footer = [line for line in other if line.box[1] >= (1 - FOOTER_BAND) * H and (line.box[3] < 0.6 * tallest or line in furniture)]
    other = [line for line in other if line not in footer]
    return TextRead(head, sub, other, union([line.box for line in head]), union([line.box for line in sub]), footer, union([line.box for line in footer]))
