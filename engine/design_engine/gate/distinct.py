"""Distinctness across a set of options: no two options share family and picture, and no option repeats the layout of one of the
client's last three delivered posts. The layout signature mirrors `learn.families.signature` (text third, alignment, logo corner,
device side, picture role) but works from the composer's element boxes rather than a PostRead, so the key compares with a family's."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from ..measure.image import Box


@dataclass
class Option:
    id: str
    rank: int                   # 1 is the best; "lower-ranked" means a larger number
    family_id: str | None
    picture_sha: str | None
    boxes: dict
    size: Any                   # Task 1's Size or anything with w and h


def _wh(size: Any) -> tuple[float, float]:
    if isinstance(size, Mapping):
        return float(size["w"]), float(size["h"])
    return float(size.w), float(size.h)


def _third(y_centre: float) -> str:
    return "top" if y_centre < 1 / 3 else "middle" if y_centre < 2 / 3 else "bottom"


def _logo_corner(box: Box | None, W: float, H: float) -> str:
    if not box:
        return "none"
    x, y, w, h = box
    cx, cy = (x + w / 2) / W, (y + h / 2) / H
    row = "t" if cy < 0.4 else "b" if cy > 0.6 else "m"
    col = "l" if cx < 0.4 else "r" if cx > 0.6 else "c"
    return row + col


def _accent_side(box: Box | None, W: float, H: float) -> str:
    if not box:
        return "none"
    x, y, w, h = box
    if h >= 0.6 * H and w < 0.3 * W:
        return "left" if x < W / 2 else "right"
    if w >= 0.6 * W and h < 0.3 * H:
        return "top" if y < H / 2 else "bottom"
    return "left" if x + w / 2 < W / 2 else "right"


def _picture_role(box: Box | None, W: float, H: float) -> str:
    if not box:
        return "none"
    _x, y, w, h = box
    cover = (w * h) / (W * H)
    if cover > 0.8:
        return "full"
    cy = (y + h / 2) / H
    if w > 0.7 * W:
        return "top" if cy < 0.5 else "bottom"
    if h > 0.5 * H:
        return "side"
    return "inset" if cover > 0.04 else "none"


def _alignment(head: Box, sub: Box | None, W: float) -> str:
    """Left when the text boxes share a left edge, centre when they share a centre but not a left edge; one box alone is read by
    where it sits (families.alignment reads OCR lines the same way: left when the lefts vary less than the centres)."""
    if sub:
        same_left = abs(head[0] - sub[0]) <= 0.02 * W
        same_centre = abs((head[0] + head[2] / 2) - (sub[0] + sub[2] / 2)) <= 0.02 * W
        if same_centre and not same_left:
            return "center"
        if same_left and not same_centre:
            return "left"
    centred = abs((head[0] + head[2] / 2) - W / 2) <= 0.1 * W and head[0] > 0.3 * W
    return "center" if centred else "left"


def signature(boxes: dict, size: Any, align: str | None = None) -> str:
    """`text_third|text_align|logo_corner|accent_side|picture_role`, the same key `learn.families.Signature.key` produces."""
    W, H = _wh(size)
    head = boxes.get("headline")
    if head:
        third = _third((head[1] + head[3] / 2) / H)
        text_align = align or _alignment(head, boxes.get("subline"), W)
    else:
        third, text_align = "none", "none"
    accent = boxes.get("accent") or boxes.get("device")
    return "|".join([third, text_align, _logo_corner(boxes.get("logo"), W, H), _accent_side(accent, W, H), _picture_role(boxes.get("picture"), W, H)])


def filter_set(options: list[Option], recent_signatures: list[str] | tuple[str, ...] = (), dropped: list[str] | None = None) -> list[Option]:
    """Keep the best-ranked option of every (family_id, picture_sha) pair and drop any option whose layout signature equals one of
    the client's last three delivered posts. Returns the kept options in rank order; `dropped`, when given, collects one sentence
    per dropped option."""
    recent = set(recent_signatures)
    seen: dict[tuple[str | None, str | None], str] = {}
    kept: list[Option] = []
    for o in sorted(options, key=lambda o: o.rank):
        key = (o.family_id, o.picture_sha)
        if key in seen:
            if dropped is not None:
                dropped.append(f"{o.id}: shares family {o.family_id} and picture {o.picture_sha} with option {seen[key]}")
            continue
        sig = signature(o.boxes, o.size)
        if sig in recent:
            if dropped is not None:
                dropped.append(f"{o.id}: layout {sig} repeats one of the client's last three posts")
            continue
        seen[key] = o.id
        kept.append(o)
    return kept
