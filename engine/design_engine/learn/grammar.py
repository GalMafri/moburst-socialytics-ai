"""Composition grammar: margins, logo slot, text column and type scale as bands measured across a client's post reads."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .layers import PostRead


def band(values: list[float], sources: list[str]) -> dict:
    if not values:
        return {"p25": None, "p50": None, "p75": None, "n": 0, "sources": []}
    v = np.asarray(values, dtype=float)
    return {"p25": float(np.percentile(v, 25)), "p50": float(np.percentile(v, 50)), "p75": float(np.percentile(v, 75)),
            "n": int(v.size), "sources": list(sources)}


@dataclass
class Grammar:
    side_margin: dict = field(default_factory=dict)
    top_inset: dict = field(default_factory=dict)
    bottom_inset: dict = field(default_factory=dict)
    logo_corner_counts: dict = field(default_factory=dict)
    logo_width_share: dict = field(default_factory=dict)
    text_column_x: dict = field(default_factory=dict)
    text_column_w: dict = field(default_factory=dict)
    headline_h_share: dict = field(default_factory=dict)
    subline_h_share: dict = field(default_factory=dict)
    alignment_counts: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__dataclass_fields__}


def logo_corner(read: PostRead) -> str:
    if not read.logo:
        return "none"
    x, y, w, h = read.logo.box
    cx, cy = (x + w / 2) / read.W, (y + h / 2) / read.H
    row = "t" if cy < 0.4 else "b" if cy > 0.6 else "m"
    col = "l" if cx < 0.4 else "r" if cx > 0.6 else "c"
    return row + col


def alignment(read: PostRead) -> str:
    lines = read.text.headline + read.text.subline
    if len(lines) < 2:
        return "left" if lines and lines[0].box[0] < 0.3 * read.W else "center" if lines else "none"
    lefts = np.asarray([l.box[0] for l in lines])
    centres = np.asarray([l.box[0] + l.box[2] / 2 for l in lines])
    return "left" if lefts.std() <= centres.std() else "center"


def bands(reads: list[PostRead]) -> Grammar:
    g = Grammar()
    side, top, bottom, side_src, top_src, bottom_src = [], [], [], [], [], []
    logo_w, logo_src = [], []
    col_x, col_w, col_src = [], [], []
    head_h, head_src, sub_h, sub_src = [], [], [], []
    corners: dict[str, int] = {}
    aligns: dict[str, int] = {}
    for r in reads:
        short = min(r.W, r.H)
        lefts, tops, bottoms = [], [], []
        if r.logo:
            lx, ly, lw, lh = r.logo.box
            lefts.append(lx)
            tops.append(ly)
            bottoms.append(ly + lh)
            logo_w.append(lw / r.W)
            logo_src.append(r.source)
            corners[logo_corner(r)] = corners.get(logo_corner(r), 0) + 1
        if r.text.headline_box:
            hx, hy, hw, hh = r.text.headline_box
            lefts.append(hx)
            tops.append(hy)
            bottoms.append(hy + hh)
            col_x.append(hx / r.W)
            col_w.append(hw / r.W)
            col_src.append(r.source)
            head_h.append(max(l.box[3] for l in r.text.headline) / short)
            head_src.append(r.source)
        if r.text.subline_box:
            sx, sy, sw, sh = r.text.subline_box
            lefts.append(sx)
            bottoms.append(sy + sh)
            sub_h.append(max(l.box[3] for l in r.text.subline) / short)
            sub_src.append(r.source)
        if lefts:
            side.append(min(lefts) / r.W)
            side_src.append(r.source)
        if tops:
            top.append(min(tops) / r.H)
            top_src.append(r.source)
        if bottoms:
            bottom.append(1 - max(bottoms) / r.H)
            bottom_src.append(r.source)
        a = alignment(r)
        if a != "none":
            aligns[a] = aligns.get(a, 0) + 1
    g.side_margin = band(side, side_src)
    g.top_inset = band(top, top_src)
    g.bottom_inset = band(bottom, bottom_src)
    g.logo_width_share = band(logo_w, logo_src)
    g.logo_corner_counts = corners
    g.text_column_x = band(col_x, col_src)
    g.text_column_w = band(col_w, col_src)
    g.headline_h_share = band(head_h, head_src)
    g.subline_h_share = band(sub_h, sub_src)
    g.alignment_counts = aligns
    return g
