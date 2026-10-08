"""Sizes per platform and format from the seeded table. Loaded once; every size carries the platform's safe insets in pixels,
its text floor and its file cap so the composer and the gate never look them up separately."""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

TABLE = Path(__file__).with_name("platform_specs.json")
_SAFE_KEYS = ("top", "bottom", "left", "right")


@dataclass(frozen=True)
class Size:
    name: str
    w: int
    h: int
    aspect: str
    safe: dict  # {top, bottom, left, right} pixels the platform UI covers; 0 where nothing is covered
    min_text_px: int
    max_file_kb: int
    placement: str  # feed | story

    @property
    def short_edge(self) -> int:
        return min(self.w, self.h)

    @property
    def safe_box(self) -> list[float]:
        """[x, y, w, h] of the area outside the platform's UI insets."""
        s = self.safe
        return [float(s["left"]), float(s["top"]), float(self.w - s["left"] - s["right"]), float(self.h - s["top"] - s["bottom"])]


@lru_cache(maxsize=1)
def _table() -> dict:
    return json.loads(TABLE.read_text())


@lru_cache(maxsize=1)
def _platform_index() -> dict[str, str]:
    """lower-cased name or alias -> the table's platform key."""
    idx: dict[str, str] = {}
    for key, entry in _table()["platforms"].items():
        idx[key.lower()] = key
        for alias in entry.get("aliases", []):
            idx[alias.lower()] = key
    return idx


def _platform(platform: str) -> tuple[str, dict]:
    key = _platform_index().get(platform.strip().lower())
    if key is None:
        raise KeyError(f"unknown platform {platform!r}; known: {', '.join(all_platforms())}")
    return key, _table()["platforms"][key]


def _size(entry: dict, raw: dict) -> Size:
    safe = {k: int(raw.get("safe", {}).get(k, 0)) for k in _SAFE_KEYS}
    return Size(raw["name"], int(raw["w"]), int(raw["h"]), raw["aspect"], safe, int(entry["min_text_px"]), int(entry["max_file_kb"]),
                raw.get("placement", "feed"))


def sizes_for(platform: str, format: str) -> list[Size]:
    """The sizes to build for a platform and a calendar format, in the table's order (the platform's default first)."""
    key, entry = _platform(platform)
    formats = entry["formats"]
    fmt = next((f for f in formats if f.lower() == format.strip().lower()), None)
    if fmt is None:
        raise KeyError(f"unknown format {format!r} for {key}; known: {', '.join(formats)}")
    by_name = {s["name"]: s for s in entry["sizes"]}
    return [_size(entry, by_name[name]) for name in formats[fmt]]


def all_platforms() -> list[str]:
    return list(_table()["platforms"].keys())


def source(platform: str) -> dict:
    """Where this platform's row came from and when: {source_url, fetched_at}."""
    _, entry = _platform(platform)
    return {"source_url": entry["source_url"], "fetched_at": entry["fetched_at"]}
