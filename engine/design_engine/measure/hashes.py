"""Difference hash and near-copy check. Ports of _dhash, _hamming and the whole/half comparison of _reference_reuse (reference agent, read only)."""
from __future__ import annotations

from dataclasses import dataclass

from PIL import Image


def dhash(img: Image.Image, size: int = 16) -> int:
    g = img.convert("L").resize((size + 1, size))
    px = list(g.getdata())
    bits = 0
    for y in range(size):
        for x in range(size):
            bits = (bits << 1) | (1 if px[y * (size + 1) + x] > px[y * (size + 1) + x + 1] else 0)
    return bits


def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def parts(img: Image.Image) -> tuple[int, int, int]:
    w, h = img.size
    return dhash(img), dhash(img.crop((0, 0, w, h // 2))), dhash(img.crop((0, h // 2, w, h)))


@dataclass(frozen=True)
class NearCopy:
    min_whole: int
    min_half: int
    is_copy: bool
    index: int | None


def near_copy(candidate: Image.Image, references: list[Image.Image], whole_max: int = 40, half_max: int = 20) -> NearCopy:
    cw, ct, cb = parts(candidate)
    best = NearCopy(10**6, 10**6, False, None)
    for i, ref in enumerate(references):
        rw, rt, rb = parts(ref)
        whole = hamming(cw, rw)
        half = min(hamming(ct, rt), hamming(cb, rb), hamming(ct, rb), hamming(cb, rt))
        if whole < best.min_whole or half < best.min_half:
            hit = whole <= whole_max or half <= half_max
            best = NearCopy(min(whole, best.min_whole), min(half, best.min_half), hit, i if hit else best.index)
    return best
