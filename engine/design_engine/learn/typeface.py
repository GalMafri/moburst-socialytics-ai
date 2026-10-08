"""Typeface match by measured letterforms. Port of type_evidence._ink_mask, _shape_score, _render_line and match_headlines
(reference agent, read only). A headline line from the client's post is compared, as an ink shape, with the same words rendered in
each candidate font file; the verdict is `match` only when the top family clears the floor and leads clearly, otherwise
`unresolved` with the families it could not separate listed in `tie`. There is no stand-in verdict: that choice is the client's."""
from __future__ import annotations

import tempfile
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np
from fontTools.ttLib import TTFont, TTLibError
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from design_engine.measure.image import Box, crop, load_rgb, rel_lum

MATCH_FLOOR, MATCH_LEAD, TIE_GAP = 0.80, 0.05, 0.02
RENDER_SIZE = 96
MARGIN = 20


@dataclass
class TypeMatch:
    verdict: str  # "match" | "unresolved"
    family: str | None = None
    file: Path | None = None
    score: float = 0.0
    next_family: str | None = None
    next_score: float | None = None
    ranking: list[dict] = field(default_factory=list)
    tie: list[str] = field(default_factory=list)
    samples: int = 0


def ink_mask(crop_arr) -> np.ndarray | None:
    """Boolean mask of the ink in a crop (RGB array, grey array or PIL image), trimmed to its bounding box. Ink is the population
    furthest from the median luminance: pixels whose deviation passes the midpoint of the largest deviation. None when there is no ink."""
    a = np.asarray(crop_arr.convert("RGB") if isinstance(crop_arr, Image.Image) else crop_arr)
    if a.ndim == 2:
        a = np.stack([a, a, a], axis=-1)
    lum = rel_lum(a[..., :3])
    dev = np.abs(lum - np.median(lum))
    top = float(dev.max())
    if top <= 0.0:
        return None
    m = dev > top / 2
    ys, xs = np.where(m)
    if len(xs) == 0:
        return None
    return m[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def _shape_score(a: np.ndarray, b: np.ndarray, W: int = 512, H: int = 64, sigma: float = 1.6) -> float:
    """How alike two lines of type are as shapes: both masks are fitted to W x H (so size and tracking do not count twice), blurred a
    little (a stroke a pixel off still meets itself) and compared by normalised correlation: 1.0 is the same drawing."""

    def fit(m):
        im = Image.fromarray(m.astype(np.uint8) * 255).resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(sigma))
        x = np.asarray(im).astype(np.float64)
        x -= x.mean()
        n = np.sqrt((x * x).sum())
        return x / n if n > 0 else x

    return float((fit(a) * fit(b)).sum())


def _is_variable(font_path: Path) -> bool:
    try:
        return "fvar" in TTFont(str(font_path), lazy=True)
    except (TTLibError, OSError):
        return False


@lru_cache(maxsize=256)
def _instance(font_path: str, weight: int) -> str:
    """A static instance of a variable font at the given weight, written once to a temp file."""
    from fontTools.varLib import instancer

    vf = TTFont(font_path)
    axes = {a.axisTag: a for a in vf["fvar"].axes}
    if "wght" not in axes:
        return font_path
    ax = axes["wght"]
    w = max(ax.minValue, min(ax.maxValue, weight))
    inst = instancer.instantiateVariableFont(vf, {"wght": w})
    out = Path(tempfile.mkdtemp(prefix="design-engine-font-")) / f"{Path(font_path).stem}-{int(w)}.ttf"
    inst.save(str(out))
    return str(out)


def family_name(font_path: Path) -> str:
    try:
        return TTFont(str(font_path), lazy=True)["name"].getBestFamilyName() or Path(font_path).stem
    except (TTLibError, OSError, KeyError):
        return Path(font_path).stem


def render_line(font_path: Path, text: str, size: int = RENDER_SIZE) -> Image.Image:
    """The words drawn in the font file: black on white, a 20 px margin, grey image."""
    f = ImageFont.truetype(str(font_path), size)
    bbox = f.getbbox(text)
    im = Image.new("L", (max(1, bbox[2] - bbox[0]) + 2 * MARGIN, max(1, bbox[3] - bbox[1]) + 2 * MARGIN), 255)
    ImageDraw.Draw(im).text((MARGIN - bbox[0], MARGIN - bbox[1]), text, font=f, fill=0)
    return im


def _variants(font_path: Path) -> list[tuple[str, Path]]:
    """(style, file to render) for a candidate: the file itself, plus Regular and Bold instances when it is variable."""
    if not _is_variable(font_path):
        return [("Regular", font_path)]
    return [("Regular", Path(_instance(str(font_path), 400))), ("Bold", Path(_instance(str(font_path), 700)))]


def match_headlines(
    samples: list[tuple[Path, Box, str]],
    font_files: list[Path],
    floor: float = MATCH_FLOOR,
    lead: float = MATCH_LEAD,
    tie_gap: float = TIE_GAP,
) -> TypeMatch:
    """Rank candidate families across headline lines. Each sample is (image path, box of one line, its words). Every file is scored at
    its regular weight (and weight 700 when variable) as the mean shape score over the samples; a family's score is its best file's.
    `match` when the top family reaches `floor` and leads the next by `lead`; else `unresolved`, with `tie` naming every family within
    `tie_gap` of the top (the top included)."""
    masks: list[tuple[np.ndarray, str]] = []
    for path, box, text in samples:
        region = crop(load_rgb(path), box)
        sm = ink_mask(region) if region is not None else None
        if sm is not None:
            masks.append((sm, str(text)))
    if not masks or not font_files:
        return TypeMatch(verdict="unresolved", samples=len(masks))

    rows: list[dict] = []
    for fp in font_files:
        fp = Path(fp)
        fam = family_name(fp)
        for style, render_path in _variants(fp):
            per_sample = []
            for sm, text in masks:
                try:
                    cm = ink_mask(render_line(render_path, text))
                except (OSError, ValueError, TTLibError):  # an unreadable or broken font file scores 0
                    cm = None
                per_sample.append(_shape_score(sm, cm) if cm is not None else 0.0)
            rows.append({"file": fp, "family": fam, "style": style, "score": float(np.mean(per_sample)), "per_sample": per_sample})

    best: dict[str, dict] = {}
    for row in rows:
        if row["family"] not in best or row["score"] > best[row["family"]]["score"]:
            best[row["family"]] = row
    order = sorted(best.values(), key=lambda r: -r["score"])
    top = order[0]
    nxt = order[1] if len(order) > 1 else None
    verdict = "match" if top["score"] >= floor and (nxt is None or top["score"] - nxt["score"] >= lead) else "unresolved"
    tie = [r["family"] for r in order if top["score"] - r["score"] <= tie_gap] if verdict == "unresolved" else []
    return TypeMatch(
        verdict=verdict,
        family=top["family"],
        file=top["file"],
        score=top["score"],
        next_family=nxt["family"] if nxt else None,
        next_score=nxt["score"] if nxt else None,
        ranking=order,
        tie=tie,
        samples=len(masks),
    )
