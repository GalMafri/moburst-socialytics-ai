"""Text line reading with two backends: Apple Vision on macOS (engine/bin/ocr) and rapidocr-onnxruntime everywhere.

Every backend returns the same Line records: text, a pixel box [x, y, w, h] with a top-left origin, and a confidence.
"""
from __future__ import annotations

import json
import platform
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .image import Box

_ENGINE_ROOT = Path(__file__).resolve().parents[2]
VISION_BINARY = _ENGINE_ROOT / "bin" / "ocr"


@dataclass(frozen=True)
class Line:
    text: str
    box: Box
    confidence: float


class FakeOCR:
    """Test double: returns the lines it was built with, whatever path it is asked to read."""

    def __init__(self, lines: list[Line]):
        self.lines = lines

    def __call__(self, path) -> list[Line]:
        return list(self.lines)


def _vision(path: Path) -> list[Line]:
    out = subprocess.run([str(VISION_BINARY), str(path)], capture_output=True, text=True, check=True).stdout
    from PIL import Image

    W, H = Image.open(path).size
    rows = json.loads(out)  # [{"text","x","y","w","h","confidence"}] normalised 0..1, origin top-left
    return [Line(r["text"], [r["x"] * W, r["y"] * H, r["w"] * W, r["h"] * H], float(r.get("confidence", 1.0))) for r in rows]


def _rapid(path: Path) -> list[Line]:
    from rapidocr_onnxruntime import RapidOCR

    result, _ = RapidOCR()(str(path))
    lines = []
    for quad, text, conf in result or []:
        xs = [p[0] for p in quad]
        ys = [p[1] for p in quad]
        lines.append(Line(text, [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)], float(conf)))
    return lines


def read_lines(path, backend: str = "auto") -> list[Line]:
    path = Path(path)
    if backend == "auto":
        backend = "vision" if platform.system() == "Darwin" and VISION_BINARY.exists() else "rapidocr"
    return _vision(path) if backend == "vision" else _rapid(path)
