# Design Engine, Plan 1: foundation and brand learner. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Python engine package inside the Socialytics repo whose brand learner reads a client's stored posts, website and uploads and writes a brand profile with a source on every token, measured layout families and calibration floors, plus one evidence board per client; run offline on Bader Law and LegaBot.

**Architecture:** `engine/` is a `uv`-managed Python 3.12 package with three layers: `measure/` (faithful ports of the reference agent's pixel measurements), `learn/` (palette, typeface, layers, grammar, families, imagery, profile), `store/` and `report/`. A CLI runs the learner per client against the live bucket read-only and writes `engine/work/<client>/profile.json` and `board.jpg`. One edge function, `design-harvest`, moves Sprout posts into the bucket and `brand_assets` rows; its deploy is gated on Lital's yes, so the proof first runs on the posts already stored.

**Tech Stack:** Python 3.12 via `uv`; numpy, Pillow, scikit-image, fontTools, rembg (onnxruntime, `isnet-general-use`), Playwright (Chromium) for the website read, rapidocr-onnxruntime (portable OCR) with an Apple Vision backend on macOS, anthropic SDK for the imagery read; pytest. Deno edge function + Vitest for the harvest.

**Spec:** `docs/superpowers/specs/2026-10-08-design-engine-design.md` (sections 1 to 5, 11, 17, 18).

## Global Constraints

- Every profile token carries `source`; `profile.validate()` refuses a profile with any token lacking one (spec section 4).
- No silent font substitution: `type.status` is `resolved` only on a measured `match`; otherwise `unresolved` with candidates, and no run may start (spec section 4).
- Posts come from Sprout only; no RivalIQ code path anywhere in `engine/` or the harvest function (spec section 1).
- The Creative Production agent folder is read only; nothing imports from it or runs it. Ports carry a comment naming the function they port.
- Client-facing strings never contain "AI", "prompt", "score", "pipeline", "model" or "gate" (spec section 1). The board is for Lital and may name measurements.
- No client value is a constant in code; Bader and LegaBot appear only in `scripts/` arguments and test fixtures named as such.
- Tests never touch the network; the Anthropic and Supabase calls are behind interfaces with fakes.
- Measurements use fractions of 1 (0.037), never percent numbers (spec section 6 inherits the reference convention).

## Review Focus

1. A plain photograph or video still that the harvest's classifier let through must not become a family: families need two or more posts with the same signature, and a singleton is `seen_once` (Task 13 test `test_singleton_is_seen_once`).
2. A post with no visible logo must not produce a logo slot in the grammar or inflate the logo floor (Task 6 `test_no_logo_returns_zero`, Task 12 `test_grammar_skips_posts_without_logo`).
3. Two near-identical font candidates must yield `unresolved` with a tie, never `match` (Task 11 `test_tie_is_unresolved`).
4. OCR reads the logo's wordmark as a text line; the wordmark must be excluded from headline and subline detection (Task 12 `test_wordmark_line_is_not_headline`).
5. Album slides from one post must not be clustered as if they were separate posts' layouts when they share a template; slides keep `slide_index` and a family counts posts, not slides (Task 13 `test_family_counts_posts_not_slides`).

---

### Task 1: Engine package scaffold

**Files:**
- Create: `engine/pyproject.toml`, `engine/README.md`, `engine/.python-version`, `engine/design_engine/__init__.py`, `engine/design_engine/config.py`, `engine/tests/__init__.py`, `engine/tests/conftest.py`, `engine/tests/test_config.py`
- Modify: `.gitignore` (add `engine/.venv/`, `engine/work/`, `engine/bin/`)

**Interfaces:**
- Produces: `design_engine.config.Settings` with `work_dir: Path`, `supabase_url: str`, `supabase_service_key: str | None`, `anthropic_api_key: str | None`, `ocr_backend: str`; `settings()` reads env and `engine/.env`.

- [ ] **Step 1: Create pyproject**

```toml
[project]
name = "design-engine"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "numpy>=2.0",
  "pillow>=11.0",
  "scikit-image>=0.24",
  "fonttools>=4.58",
  "rembg[cpu]>=2.0.60",
  "rapidocr-onnxruntime>=1.4",
  "playwright>=1.50",
  "anthropic>=0.60",
  "httpx>=0.27",
  "python-dotenv>=1.0",
]
[project.optional-dependencies]
dev = ["pytest>=8.3", "ruff>=0.8"]
[tool.pytest.ini_options]
testpaths = ["tests"]
[tool.ruff]
line-length = 140
```

- [ ] **Step 2: Create config and a failing test**

`engine/design_engine/config.py`:
```python
from __future__ import annotations
import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

ENGINE_ROOT = Path(__file__).resolve().parent.parent

@dataclass(frozen=True)
class Settings:
    work_dir: Path
    supabase_url: str
    supabase_service_key: str | None
    anthropic_api_key: str | None
    ocr_backend: str  # "auto" | "vision" | "rapidocr"

def settings(env: dict[str, str] | None = None) -> Settings:
    if env is None:
        load_dotenv(ENGINE_ROOT / ".env")
        env = dict(os.environ)
    return Settings(
        work_dir=Path(env.get("ENGINE_WORK_DIR", ENGINE_ROOT / "work")),
        supabase_url=env.get("SUPABASE_URL", "https://rwouwxqggjjacbpbhqsn.supabase.co"),
        supabase_service_key=env.get("SUPABASE_SERVICE_ROLE_KEY"),
        anthropic_api_key=env.get("ANTHROPIC_API_KEY"),
        ocr_backend=env.get("OCR_BACKEND", "auto"),
    )
```

`engine/tests/test_config.py`:
```python
from pathlib import Path
from design_engine.config import settings

def test_settings_from_env_dict():
    s = settings({"ENGINE_WORK_DIR": "/tmp/x", "OCR_BACKEND": "rapidocr"})
    assert s.work_dir == Path("/tmp/x")
    assert s.ocr_backend == "rapidocr"
    assert s.supabase_url.startswith("https://")
```

- [ ] **Step 3: Install and run**

Run (from `engine/`): `uv python install 3.12 && uv venv --python 3.12 && uv pip install -e ".[dev]" && uv run pytest -q`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add engine .gitignore
git commit -m "feat(engine): python package scaffold with settings"
```

### Task 2: Image basics, contrast and busy ground (ports)

**Files:**
- Create: `engine/design_engine/measure/__init__.py`, `engine/design_engine/measure/image.py`, `engine/design_engine/measure/contrast.py`, `engine/tests/test_contrast.py`

**Interfaces:**
- Produces: `image.load_rgb(path) -> np.ndarray[H,W,3] uint8`, `image.rel_lum(arr) -> np.ndarray`, `image.contrast(l1, l2) -> float`, `image.crop(arr, box) -> np.ndarray | None` (box = `[x, y, w, h]` pixels), `contrast.ink_vs_ground(region) -> float | None`, `contrast.busy_ground(region) -> float`.

- [ ] **Step 1: Failing tests**

```python
import numpy as np
from design_engine.measure.image import rel_lum, contrast, crop
from design_engine.measure.contrast import ink_vs_ground, busy_ground

def flat(h, w, rgb):
    return np.full((h, w, 3), rgb, dtype=np.uint8)

def test_contrast_black_on_white_is_21():
    assert round(contrast(rel_lum(np.array([255,255,255])), rel_lum(np.array([0,0,0]))), 1) == 21.0

def test_ink_vs_ground_reads_marks_inside_padding():
    region = flat(120, 400, (255, 255, 255))
    region[40:80, 100:300] = (0, 0, 0)      # a black "glyph" block with white padding around it
    assert ink_vs_ground(region) > 15

def test_busy_ground_flat_plate_is_near_zero():
    region = flat(120, 400, (20, 30, 60))
    region[50:70, 50:350] = (255, 255, 255)  # the type itself must not count
    assert busy_ground(region) < 0.02

def test_busy_ground_noise_is_high():
    rng = np.random.default_rng(1)
    region = rng.integers(0, 255, size=(120, 400, 3), dtype=np.uint8)
    assert busy_ground(region) > 0.11

def test_crop_clips_to_frame():
    arr = flat(10, 10, (0, 0, 0))
    assert crop(arr, [8, 8, 5, 5]).shape == (2, 2, 3)
    assert crop(arr, [20, 20, 5, 5]) is None
```

- [ ] **Step 2: Run, expect ImportError**

Run: `uv run pytest tests/test_contrast.py -q`

- [ ] **Step 3: Implement (ports of `measure_qa.rel_lum/contrast/crop/ink_vs_ground/busy_ground`)**

`image.py`:
```python
from __future__ import annotations
import numpy as np
from PIL import Image

Box = list[float]  # [x, y, w, h] in pixels

def load_rgb(path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"))

def rel_lum(rgb) -> np.ndarray:
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]

def contrast(l1: float, l2: float) -> float:
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)

def crop(arr: np.ndarray, box: Box):
    x, y, w, h = [int(round(v)) for v in box]
    H, W = arr.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return None
    return arr[y0:y1, x0:x1]
```

`contrast.py`:
```python
"""Ports of measure_qa.ink_vs_ground and measure_qa.busy_ground (reference agent, read only)."""
from __future__ import annotations
import numpy as np
from PIL import Image, ImageFilter
from .image import rel_lum, contrast

def ink_vs_ground(region: np.ndarray) -> float | None:
    lum_full = rel_lum(region)
    if lum_full.size < 50:
        return None
    med = float(np.median(lum_full))
    diff = np.abs(lum_full - med) > 0.08
    ys, xs = np.where(diff)
    lum = lum_full[ys.min():ys.max() + 1, xs.min():xs.max() + 1].ravel() if ys.size >= 20 else lum_full.ravel()
    if lum.size < 50:
        return None
    lo, hi = np.percentile(lum, 12), np.percentile(lum, 88)
    return contrast(hi, lo)

def busy_ground(region: np.ndarray) -> float:
    im = Image.fromarray(region.astype(np.uint8)).filter(ImageFilter.MedianFilter(9)).filter(ImageFilter.GaussianBlur(6))
    lum = rel_lum(np.asarray(im)).ravel()
    if lum.size < 50:
        return float(lum.std())
    dev = np.abs(lum - np.median(lum))
    return float(lum[dev <= np.percentile(dev, 70)].std())
```

- [ ] **Step 4: Run, expect 5 passed**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): image basics, contrast and busy-ground ports"`

### Task 3: Bands, free rectangle, content span, saliency and quiet rectangles (ports)

**Files:**
- Create: `engine/design_engine/measure/bands.py`, `engine/design_engine/measure/saliency.py`, `engine/tests/test_bands.py`, `engine/tests/test_saliency.py`

**Interfaces:**
- Produces: `bands.empty_bands(arr, boxes, thresh=0.012) -> (top, bot)`, `bands.largest_free_rect(W, H, boxes, grid=24) -> float`, `bands.content_span(boxes, H, safe_box=None) -> float`; `saliency.saliency_map(arr, cell=24) -> np.ndarray`, `saliency.largest_quiet_rect(sal, thresh) -> float`, `saliency.quiet_rects(sal, thresh, min_cells=(3, 3)) -> list[CellBox]` where `CellBox = (cy, cx, ch, cw)` in cells, `saliency.salient_share(sal, cell_box) -> float` (mean saliency inside the box divided by the frame mean).

- [ ] **Step 1: Failing tests**

```python
import numpy as np
from design_engine.measure.bands import empty_bands, largest_free_rect, content_span
from design_engine.measure.saliency import saliency_map, largest_quiet_rect, quiet_rects, salient_share

def test_empty_bands_top_and_bottom():
    arr = np.full((1000, 800, 3), 30, dtype=np.uint8)
    arr[300:700] = np.random.default_rng(0).integers(0, 255, (400, 800, 3))
    top, bot = empty_bands(arr, [])
    assert abs(top - 0.3) < 0.02 and abs(bot - 0.3) < 0.02

def test_empty_bands_skips_covered_rows():
    arr = np.full((1000, 800, 3), 30, dtype=np.uint8)
    top, _ = empty_bands(arr, [[0, 0, 800, 200]])
    assert top == 0.0

def test_largest_free_rect_half_frame():
    assert abs(largest_free_rect(1000, 1000, [[0, 0, 1000, 500]]) - 0.5) < 0.05

def test_content_span():
    assert abs(content_span([[0, 100, 10, 100], [0, 800, 10, 100]], 1000) - 0.8) < 0.001

def test_saliency_flat_vs_noise():
    arr = np.full((480, 480, 3), 120, dtype=np.uint8)
    arr[:, 240:] = np.random.default_rng(0).integers(0, 255, (480, 240, 3))
    sal = saliency_map(arr)
    assert sal[:, :10].mean() < sal[:, 10:].mean() / 10

def test_quiet_rects_find_the_flat_half():
    arr = np.full((480, 480, 3), 120, dtype=np.uint8)
    arr[:, 240:] = np.random.default_rng(0).integers(0, 255, (480, 240, 3))
    sal = saliency_map(arr)
    rects = quiet_rects(sal, float(np.percentile(sal, 50)))
    cy, cx, ch, cw = rects[0]
    assert cx == 0 and cw <= 10 and ch == 20
    assert abs(largest_quiet_rect(sal, float(np.percentile(sal, 50))) - 0.5) < 0.05
    assert salient_share(sal, rects[0]) < 0.2
```

- [ ] **Step 2: Run, expect failures**
- [ ] **Step 3: Implement**

`bands.py` is a verbatim port of `measure_qa.empty_bands` and `largest_free_rect` (code in the reference listing above, with `rel_lum` imported from `.image`) plus:
```python
def content_span(boxes, H, safe_box=None) -> float:
    boxes = [b for b in boxes if b]
    if not boxes:
        return 0.0
    top = min(b[1] for b in boxes); bot = max(b[1] + b[3] for b in boxes)
    ref_h = safe_box[3] if safe_box else H
    return (bot - top) / ref_h
```

`saliency.py`: port `saliency_map` and `largest_quiet_rect` verbatim, then:
```python
CellBox = tuple[int, int, int, int]  # cy, cx, ch, cw

def quiet_rects(sal: np.ndarray, thresh: float, min_cells=(3, 3)) -> list[CellBox]:
    """All maximal quiet rectangles (histogram stack), largest area first; the placement engine picks among them."""
    quiet = sal < thresh
    gy, gx = quiet.shape
    found: list[tuple[int, CellBox]] = []
    heights = [0] * gx
    for y in range(gy):
        for x in range(gx):
            heights[x] = heights[x] + 1 if quiet[y, x] else 0
        stack: list[tuple[int, int]] = []
        for x in range(gx + 1):
            h = heights[x] if x < gx else 0
            start = x
            while stack and stack[-1][1] >= h:
                idx, sh = stack.pop()
                if sh >= min_cells[0] and (x - idx) >= min_cells[1]:
                    found.append((sh * (x - idx), (y - sh + 1, idx, sh, x - idx)))
                start = idx
            stack.append((start, h))
    found.sort(key=lambda t: -t[0])
    out: list[CellBox] = []
    for _, box in found:
        if not any(box[0] >= o[0] and box[1] >= o[1] and box[0] + box[2] <= o[0] + o[2] and box[1] + box[3] <= o[1] + o[3] for o in out):
            out.append(box)
    return out

def salient_share(sal: np.ndarray, cell_box: CellBox) -> float:
    cy, cx, ch, cw = cell_box
    inside = sal[cy:cy + ch, cx:cx + cw]
    mean_all = float(sal.mean()) or 1e-9
    return float(inside.mean()) / mean_all
```

- [ ] **Step 4: Run, expect 6 passed**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): bands, free-rect, saliency and quiet-rect ports"`

### Task 4: Difference hash and near-copy check (port)

**Files:**
- Create: `engine/design_engine/measure/hashes.py`, `engine/tests/test_hashes.py`

**Interfaces:**
- Produces: `dhash(img: PIL.Image, size=16) -> int`, `hamming(a, b) -> int`, `parts(img) -> (whole, top, bottom)`, `near_copy(candidate: PIL.Image, references: list[PIL.Image], whole_max=40, half_max=20) -> NearCopy(min_whole, min_half, is_copy, index)`.

- [ ] **Step 1: Failing tests**

```python
import numpy as np
from PIL import Image, ImageDraw
from design_engine.measure.hashes import dhash, hamming, near_copy

def picture(seed):
    rng = np.random.default_rng(seed)
    return Image.fromarray(rng.integers(0, 255, (400, 320, 3), dtype=np.uint8))

def test_identical_is_copy():
    a = picture(1)
    assert hamming(dhash(a), dhash(a)) == 0
    assert near_copy(a, [picture(2), a]).is_copy and near_copy(a, [picture(2), a]).index == 1

def test_headline_over_same_picture_is_copy():
    a = picture(3); b = a.copy(); ImageDraw.Draw(b).rectangle([20, 150, 300, 200], fill=(255, 255, 255))
    r = near_copy(b, [a])
    assert r.is_copy and r.min_whole <= 40

def test_unrelated_is_not_copy():
    r = near_copy(picture(4), [picture(5)])
    assert not r.is_copy and r.min_whole > 60
```

- [ ] **Step 2: Run, expect failures**
- [ ] **Step 3: Implement** (port of `_dhash`, `_hamming` and the whole/half comparison of `_reference_reuse`)

```python
from __future__ import annotations
from dataclasses import dataclass
from PIL import Image

def dhash(img: Image.Image, size: int = 16) -> int:
    g = img.convert("L").resize((size + 1, size))
    px = list(g.getdata()); bits = 0
    for y in range(size):
        for x in range(size):
            bits = (bits << 1) | (1 if px[y * (size + 1) + x] > px[y * (size + 1) + x + 1] else 0)
    return bits

def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")

def parts(img: Image.Image):
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
            best = NearCopy(min(whole, best.min_whole), min(half, best.min_half), whole <= whole_max or half <= half_max, i if (whole <= whole_max or half <= half_max) else best.index)
    return best
```

- [ ] **Step 4: Run, expect 3 passed**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): dhash near-copy port"`

### Task 5: OCR interface with two backends, and text lines

**Files:**
- Create: `engine/design_engine/measure/ocr.py`, `engine/design_engine/measure/text_lines.py`, `engine/tools/ocr.swift` (copied from `~/Desktop/socialytics-design-lane/2026-10-07-bader/checks/ocr.swift`, a file written by the previous Socialytics session, not by the reference agent), `engine/tools/build_ocr.sh`, `engine/tests/test_ocr.py`, `engine/tests/fixtures/make_text_fixture.py`

**Interfaces:**
- Produces: `ocr.Line(text: str, box: Box, confidence: float)`, `ocr.read_lines(path, backend="auto") -> list[Line]`, `ocr.FakeOCR(lines)` for tests; `text_lines.classify(lines, W, H, exclude_boxes=()) -> TextRead(headline: list[Line], subline: list[Line], other: list[Line], headline_box, subline_box)`.

- [ ] **Step 1: Fixture generator and failing tests**

`tests/fixtures/make_text_fixture.py` draws a 1080×1350 navy frame with a two-line headline (Pillow default font at size 96) at (120, 400) and a subline (size 44) at (120, 700), returns the image and the drawn boxes. Tests:
```python
from design_engine.measure.ocr import FakeOCR, Line
from design_engine.measure.text_lines import classify

def test_classify_headline_vs_subline():
    lines = [Line("Some injuries", [120, 400, 600, 90], 1.0), Line("don't heal", [120, 500, 520, 90], 1.0), Line("Here is what", [120, 700, 400, 40], 1.0)]
    r = classify(lines, 1080, 1350)
    assert [l.text for l in r.headline] == ["Some injuries", "don't heal"]
    assert [l.text for l in r.subline] == ["Here is what"]
    assert r.headline_box == [120, 400, 600, 190]

def test_excluded_box_removes_wordmark():
    lines = [Line("BADER LAW", [100, 80, 300, 40], 1.0), Line("Headline", [120, 400, 600, 90], 1.0)]
    r = classify(lines, 1080, 1350, exclude_boxes=[[90, 70, 320, 60]])
    assert [l.text for l in r.headline] == ["Headline"] and all(l.text != "BADER LAW" for l in r.other)

def test_rapidocr_reads_fixture(tmp_path):
    import pytest
    pytest.importorskip("rapidocr_onnxruntime")
    from tests.fixtures.make_text_fixture import make
    img, boxes = make(); p = tmp_path / "f.png"; img.save(p)
    from design_engine.measure.ocr import read_lines
    lines = read_lines(p, backend="rapidocr")
    assert any("injuries" in l.text.lower() for l in lines)
```

- [ ] **Step 2: Run, expect failures**
- [ ] **Step 3: Implement**

`ocr.py`:
```python
from __future__ import annotations
import json, platform, subprocess
from dataclasses import dataclass
from pathlib import Path
from .image import Box

@dataclass(frozen=True)
class Line:
    text: str
    box: Box
    confidence: float

class FakeOCR:
    def __init__(self, lines: list[Line]): self.lines = lines
    def __call__(self, path) -> list[Line]: return list(self.lines)

def _vision(path: Path) -> list[Line]:
    binary = Path(__file__).resolve().parents[2] / "bin" / "ocr"
    out = subprocess.run([str(binary), str(path)], capture_output=True, text=True, check=True).stdout
    from PIL import Image
    W, H = Image.open(path).size
    rows = json.loads(out)  # [{"text","x","y","w","h","confidence"}] normalised 0..1, origin top-left
    return [Line(r["text"], [r["x"] * W, r["y"] * H, r["w"] * W, r["h"] * H], float(r.get("confidence", 1.0))) for r in rows]

def _rapid(path: Path) -> list[Line]:
    from rapidocr_onnxruntime import RapidOCR
    result, _ = RapidOCR()(str(path))
    lines = []
    for quad, text, conf in (result or []):
        xs = [p[0] for p in quad]; ys = [p[1] for p in quad]
        lines.append(Line(text, [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)], float(conf)))
    return lines

def read_lines(path, backend: str = "auto") -> list[Line]:
    path = Path(path)
    if backend == "auto":
        backend = "vision" if platform.system() == "Darwin" and (Path(__file__).resolve().parents[2] / "bin" / "ocr").exists() else "rapidocr"
    return _vision(path) if backend == "vision" else _rapid(path)
```

`text_lines.py`:
```python
from __future__ import annotations
from dataclasses import dataclass, field
from .ocr import Line
from .image import Box

def _overlap(a: Box, b: Box) -> float:
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])); iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    return (ix * iy) / max(1.0, a[2] * a[3])

def union(boxes: list[Box]) -> Box | None:
    if not boxes: return None
    x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
    return [x0, y0, max(b[0] + b[2] for b in boxes) - x0, max(b[1] + b[3] for b in boxes) - y0]

@dataclass
class TextRead:
    headline: list[Line] = field(default_factory=list)
    subline: list[Line] = field(default_factory=list)
    other: list[Line] = field(default_factory=list)
    headline_box: Box | None = None
    subline_box: Box | None = None

def classify(lines: list[Line], W: int, H: int, exclude_boxes=()) -> TextRead:
    kept = [l for l in lines if l.confidence >= 0.5 and not any(_overlap(l.box, e) > 0.5 for e in exclude_boxes)]
    if not kept: return TextRead()
    kept.sort(key=lambda l: l.box[1])
    tallest = max(l.box[3] for l in kept)
    head = [l for l in kept if l.box[3] >= 0.8 * tallest]
    rest = [l for l in kept if l not in head]
    # the subline is the block of lines just below the headline with a consistent smaller height
    sub = []
    if rest:
        h0 = rest[0].box[3]
        for l in rest:
            if abs(l.box[3] - h0) <= 0.25 * h0 and (not sub or l.box[1] - (sub[-1].box[1] + sub[-1].box[3]) < 1.5 * h0): sub.append(l)
            else: break
    other = [l for l in rest if l not in sub]
    return TextRead(head, sub, other, union([l.box for l in head]), union([l.box for l in sub]))
```

`tools/build_ocr.sh`: `swiftc -O -o ../bin/ocr ocr.swift` (macOS only; the rapidocr path is the portable one).

- [ ] **Step 4: Run, expect 3 passed (the rapidocr test downloads its model once)**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): OCR backends and text line classification"`

### Task 6: Logo finder (port, extended to return the box)

**Files:**
- Create: `engine/design_engine/measure/logo.py`, `engine/tests/test_logo.py`

**Interfaces:**
- Produces: `logo_gray_from_file(path) -> np.ndarray` (alpha composited on white, trimmed to ink), `LogoMatch(score, box: Box, height_share, variant)`, `find_logo(arr, logo_gray, short_edge, min_score=0.62) -> LogoMatch | None` (multi-scale NCC exactly as `find_logo_height`, keeping the best position and mapping it back to full-resolution pixels), `find_logo_colour(arr, logo_rgba, ...)` is deferred to Plan 2.

- [ ] **Step 1: Failing tests**

```python
import numpy as np
from PIL import Image, ImageDraw
from design_engine.measure.logo import logo_gray_from_file, find_logo

def lockup(tmp_path):
    im = Image.new("RGBA", (400, 100), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 90, 90], fill=(220, 40, 40, 255)); d.rectangle([110, 20, 390, 70], fill=(255, 255, 255, 255))
    p = tmp_path / "logo.png"; im.save(p); return p

def test_finds_logo_at_known_place(tmp_path):
    frame = Image.new("RGB", (1080, 1350), (20, 40, 80))
    lg = Image.open(lockup(tmp_path)).resize((324, 81)); frame.paste(lg, (100, 120), lg)
    m = find_logo(np.asarray(frame), logo_gray_from_file(lockup(tmp_path)), 1080)
    assert m and abs(m.height_share - 81 / 1080) < 0.015
    assert abs(m.box[0] - 100) < 25 and abs(m.box[1] - 120) < 25

def test_no_logo_returns_zero(tmp_path):
    frame = np.full((1350, 1080, 3), 30, dtype=np.uint8)
    assert find_logo(frame, logo_gray_from_file(lockup(tmp_path)), 1080) is None
```

- [ ] **Step 2: Run, expect failures**
- [ ] **Step 3: Implement** (port of `find_logo_height`; identical scales, stride and 0.62 floor; the loop also records `(x, y)` of the best window and returns `box = [x/scale, y/scale, tw/scale, th/scale]`)

```python
from __future__ import annotations
from dataclasses import dataclass
import numpy as np
from PIL import Image
from .image import rel_lum, Box

SCALES = (0.03, 0.04, 0.05, 0.06, 0.075, 0.09, 0.11, 0.13, 0.16)

def logo_gray_from_file(path) -> np.ndarray:
    lg = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", lg.size, (255, 255, 255, 255)); bg.alpha_composite(lg)
    g = np.asarray(bg.convert("L"))
    bbox = Image.fromarray(255 - g).getbbox()
    return g[bbox[1]:bbox[3], bbox[0]:bbox[2]] if bbox else g

@dataclass(frozen=True)
class LogoMatch:
    score: float
    box: Box
    height_share: float
    variant: str = "unknown"

def find_logo(arr: np.ndarray, logo_gray: np.ndarray, short_edge: int, min_score: float = 0.62) -> LogoMatch | None:
    lum = (rel_lum(arr) * 255).astype(np.float32); H, W = lum.shape
    scale_img = 480 / max(H, W)
    if scale_img < 1:
        lum = np.asarray(Image.fromarray(lum.astype(np.uint8)).resize((int(W * scale_img), int(H * scale_img)))).astype(np.float32); H, W = lum.shape
    else:
        scale_img = 1.0
    lh0, lw0 = logo_gray.shape
    best, best_box = 0.0, None
    for share in SCALES:
        th_ = max(6, int(short_edge * scale_img * share)); tw_ = max(6, int(lw0 * th_ / lh0))
        if th_ >= H or tw_ >= W: continue
        t = np.asarray(Image.fromarray(logo_gray.astype(np.uint8)).resize((tw_, th_))).astype(np.float32)
        t = t - t.mean(); tn = np.linalg.norm(t) or 1.0
        stride = max(2, th_ // 4)
        for y in range(0, H - th_, stride):
            for x in range(0, W - tw_, stride):
                w = lum[y:y + th_, x:x + tw_]; w = w - w.mean(); wn = np.linalg.norm(w) or 1.0
                c = float((w * t).sum() / (wn * tn))
                if c > best: best, best_box = c, (x, y, tw_, th_)
    if best < min_score or best_box is None: return None
    x, y, tw_, th_ = best_box
    return LogoMatch(best, [x / scale_img, y / scale_img, tw_ / scale_img, th_ / scale_img], (th_ / scale_img) / short_edge)
```

- [ ] **Step 4: Run, expect 2 passed**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): logo finder port with box"`

### Task 7: Calibration floors (port)

**Files:**
- Create: `engine/design_engine/measure/calibrate.py`, `engine/tests/test_calibrate.py`

**Interfaces:**
- Produces: `calibrate(post_paths: list[Path], logo_gray: np.ndarray | None, client: str) -> dict` with keys `client, measured_on, dead_space{p50,p75,p90}, edge_bands{...}, logo_height_share{found_in,p25,p50,p75}, floors{dead_space_max, edge_band_max, logo_height_min, basis}` exactly as the reference writes them.

- [ ] **Step 1: Failing tests**

```python
import numpy as np
from PIL import Image
from design_engine.measure.calibrate import calibrate

def make_posts(tmp_path, n):
    paths = []
    for i in range(n):
        arr = np.full((1350, 1080, 3), 30, dtype=np.uint8)
        arr[200 + 20 * i:900, 100:980] = np.random.default_rng(i).integers(0, 255, (700 - 20 * i, 880, 3))
        p = tmp_path / f"p{i}.png"; Image.fromarray(arr).save(p); paths.append(p)
    return paths

def test_provisional_floors_below_six(tmp_path):
    cal = calibrate(make_posts(tmp_path, 4), None, "Test")
    assert cal["floors"]["dead_space_max"] == 0.38 and cal["measured_on"] == 4 and "provisional" in cal["floors"]["basis"]

def test_measured_floors_at_six(tmp_path):
    cal = calibrate(make_posts(tmp_path, 6), None, "Test")
    f = cal["floors"]
    assert 0.25 <= f["dead_space_max"] <= 0.50 and 0.10 <= f["edge_band_max"] <= 0.30 and f["logo_height_min"] == 0.06
```

- [ ] **Step 2: Run, expect failures**
- [ ] **Step 3: Implement**: port `calibrate()` body from the reference (skip the `filter_exemplars` classification step: the harvest's classifier already dropped non-designed posts; skip images with short edge under 300 px; same percentiles, same clamps, same `basis` strings), using `saliency_map`, `largest_quiet_rect`, `empty_bands`, `find_logo` from the earlier tasks. Returns the dict instead of writing a file.
- [ ] **Step 4: Run, expect 2 passed**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): calibration floors port"`

### Task 8: Store: clients, stored posts, uploads, downloads

**Files:**
- Create: `engine/design_engine/store/__init__.py`, `engine/design_engine/store/supabase.py`, `engine/design_engine/store/workspace.py`, `engine/tests/test_store.py`

**Interfaces:**
- Produces: `supabase.Store(url, service_key=None)` with `client_by_name(name) -> dict` (id, name, website_url, logo_url, content_pillars, brand_notes), `post_assets(client_id, client_name) -> list[PostAsset]` reading `brand_assets` rows of kind `post` when the table exists, else the legacy `clients.harvested_design_references` entries plus `design_references/<Client-Name>/new-*` uploads, each as `PostAsset(path, platform, posted_at, source_post_id, slide_index, kind)`; `upload_assets(client_id, client_name) -> list[Asset]` (kind `logo|font|brand_book`) from `brand_assets` or legacy `clients.logo_url` and `brand-books/`; `download(bucket, path) -> bytes` over the public URL; `workspace.Workspace(root, client_slug)` with `posts/`, `uploads/`, `website/`, `out/` dirs and `materialise(store, assets)` that downloads each asset once (sha256 names) and returns local paths.
- Reads use the PostgREST endpoint with the service key when present, else the anon-readable views are not enough, so the proof requires `SUPABASE_SERVICE_ROLE_KEY` in `engine/.env` (Lital's key, never committed).

- [ ] **Step 1: Failing tests** (HTTP mocked with a fake transport)

```python
import json
from design_engine.store.supabase import Store, PostAsset

class FakeHttp:
    def __init__(self, routes): self.routes = routes
    def get(self, url, headers=None, params=None):
        for k, v in self.routes.items():
            if k in url: return FakeResp(v)
        raise AssertionError(url)

class FakeResp:
    def __init__(self, body): self.body = body; self.status_code = 200
    def json(self): return self.body
    @property
    def content(self): return self.body if isinstance(self.body, bytes) else json.dumps(self.body).encode()
    def raise_for_status(self): pass

def test_legacy_posts_are_listed_with_provenance():
    client = {"id": "c1", "name": "Bader Law", "harvested_design_references": [{"path": "c1/social-abc.jpg", "platform": "INSTAGRAM", "posted_at": "2026-09-07T17:06:35Z", "source_post_id": "igmed:1"}], "design_references": ["Bader-Law/new-1.jpg"]}
    http = FakeHttp({"/rest/v1/clients": [client], "/rest/v1/brand_assets": []})
    s = Store("https://x.supabase.co", "key", http=http)
    posts = s.post_assets("c1", "Bader Law")
    assert posts[0] == PostAsset("c1/social-abc.jpg", "INSTAGRAM", "2026-09-07T17:06:35Z", "igmed:1", 0, "post")
    assert posts[1].path == "Bader-Law/new-1.jpg" and posts[1].kind == "upload"
```

- [ ] **Step 2: Run, expect failures**
- [ ] **Step 3: Implement** with `httpx.Client` by default and the fake injectable; PostgREST calls: `GET {url}/rest/v1/clients?name=eq.{name}&select=*`, `GET {url}/rest/v1/brand_assets?client_id=eq.{id}&kind=eq.post` (404 or error means the table does not exist yet: fall back to legacy), public downloads `GET {url}/storage/v1/object/public/{bucket}/{path}`.
- [ ] **Step 4: Run, expect 1 passed**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): supabase store with legacy fallback and workspace"`

### Task 9: Website read: logo, font files, colours

**Files:**
- Create: `engine/design_engine/ingest/__init__.py`, `engine/design_engine/ingest/website.py`, `engine/design_engine/ingest/fonts.py`, `engine/tests/test_website.py`, `engine/tests/fixtures/site/index.html`, `engine/tests/fixtures/site/style.css`, `engine/tests/fixtures/site/logo.svg`

**Interfaces:**
- Produces: `fonts.font_file_names(data: bytes) -> dict(family, subfamily, weight, style)` via fontTools name table; `fonts.to_ttf(data) -> bytes` (WOFF/WOFF2 decompressed); `website.read_site(url, out_dir, browser=None) -> SiteRead(logo_candidates: list[dict(src, kind, width, height, path)], font_files: list[dict(path, family, weight, style, url)], colours: list[dict(hex, weight, where)], captured_at)`; Playwright is wrapped so tests pass a `file://` URL.

- [ ] **Step 1: Fixture site and failing tests**

`index.html` has `<header><a href="/"><svg class="logo" width="200" height="40">…</svg></a></header>`, a `<h1>` styled by `style.css` with `@font-face { font-family: TestSans; src: url(test.ttf) }` (the test writes a tiny TTF from `fontTools.fontBuilder` in a fixture helper), `.cta { background:#dc2a2e }`, body `background:#0e1b2e; color:#fff`.
```python
import pytest
from design_engine.ingest.website import read_site

def test_read_site_finds_logo_fonts_colours(tmp_path, fixture_site):
    pytest.importorskip("playwright")
    r = read_site(fixture_site.as_uri(), tmp_path)
    assert r.logo_candidates and r.logo_candidates[0]["kind"] == "inline-svg"
    assert any(f["family"] == "TestSans" for f in r.font_files)
    hexes = [c["hex"].lower() for c in r.colours]
    assert "#dc2a2e" in hexes and "#0e1b2e" in hexes
```

- [ ] **Step 2: Run, expect failures** (run `uv run playwright install chromium` once)
- [ ] **Step 3: Implement**: in the page context run one script that returns (a) logo candidates in the order `a[href="/"] svg, [class*="logo" i] svg, header svg, nav svg`, then `[class*="logo" i] img, img[alt*="logo" i], header a[href="/"] img, header img` (16 to 640 px wide, 8 px tall), then `link[rel="apple-touch-icon"], link[rel~="icon"]`, then `meta[property="og:image"]`; (b) every `@font-face` rule's family and `src` URLs from `document.styleSheets` (cross-origin sheets fetched by httpx and parsed with a regex on `@font-face{...}` blocks); (c) computed `backgroundColor`, `color`, `borderColor` of up to 4,000 elements with weights: `theme-color` 1000, backgrounds ×2, elements matching `/btn|cta|button|brand|logo|nav|header|primary|hero/i` ×3; drop saturation < 0.2 or lightness < 0.07 or > 0.95; dedupe at RGB distance 40; keep the top 8. Download font files, convert WOFF/WOFF2 to TTF bytes with fontTools, read the name table, save under `out_dir/fonts/<family>-<weight>.ttf`. Inline SVG logos are saved as `logo-inline-N.svg`.
- [ ] **Step 4: Run, expect 1 passed**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): website read for logo, font files and colours"`

### Task 10: Palette and observed pairs

**Files:**
- Create: `engine/design_engine/learn/__init__.py`, `engine/design_engine/learn/palette.py`, `engine/tests/test_palette.py`

**Interfaces:**
- Produces: `palette(post_arrays: list[np.ndarray], max_colours=8) -> list[Swatch(hex, share, role)]` (quantise to 32-step bins, weight by area, merge within RGB distance 28, roles: `ground` for the largest-area colour, `ink` for the colour of highest contrast against the ground that appears inside text boxes when given, `accent` for the most saturated remaining colour above 2% share, else `other`); `observed_pairs(arr, text_boxes: list[Box]) -> list[Pair(ink_hex, ground_hex, contrast, box)]` (ink = the minority population furthest from the box's median luminance, ground = the median of the rest).

- [ ] **Step 1: Failing tests**

```python
import numpy as np
from design_engine.learn.palette import palette, observed_pairs

def post():
    arr = np.full((1350, 1080, 3), (14, 27, 46), dtype=np.uint8)   # navy ground
    arr[:, :110] = (220, 42, 46)                                     # red bar
    arr[400:500, 150:800] = (255, 255, 255)                          # white headline block
    return arr

def test_palette_roles():
    sw = palette([post()])
    by_role = {s.role: s.hex for s in sw}
    assert by_role["ground"].lower() == "#0e1b2e" and by_role["accent"].lower() == "#dc2a2e" and by_role["ink"].lower() == "#ffffff"

def test_observed_pair_white_on_navy():
    pairs = observed_pairs(post(), [[150, 400, 650, 100]])
    assert pairs[0].ink_hex.lower() == "#ffffff" and pairs[0].ground_hex.lower() == "#0e1b2e" and pairs[0].contrast > 14
```

- [ ] **Step 2: Run, expect failures**
- [ ] **Step 3: Implement** as specified (numpy histogram on `arr // 8 * 8 + 4`, area shares, merge, roles; pairs via `rel_lum` split at the median deviation).
- [ ] **Step 4: Run, expect 2 passed**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): palette with roles and observed text-ground pairs"`

### Task 11: Typeface match (port of the shape-score method)

**Files:**
- Create: `engine/design_engine/learn/typeface.py`, `engine/tests/test_typeface.py`, `engine/tests/fixtures/fonts/` (two open fonts with different letterforms and one near-twin, generated or vendored: the test builds them with `fontTools.fontBuilder` as A, B, and A' = A with one glyph changed)

**Interfaces:**
- Produces: `match_headlines(samples: list[tuple[Path, Box, str]], font_files: list[Path], floor=0.80, lead=0.05, tie_gap=0.02) -> TypeMatch(verdict: "match"|"unresolved", family, file, score, next_family, next_score, ranking, tie: list[str])`; `ink_mask(crop) -> np.ndarray | None`; `render_line(font_path, text, size=96) -> PIL.Image`.

- [ ] **Step 1: Failing tests**

```python
def test_match_prefers_the_true_font(fonts, tmp_path):
    img = render_line(fonts["A"], "Some injuries", 96); p = tmp_path / "s.png"; img.save(p)
    r = match_headlines([(p, [0, 0, img.width, img.height], "Some injuries")], [fonts["A"], fonts["B"]])
    assert r.verdict == "match" and r.file == fonts["A"]

def test_tie_is_unresolved(fonts, tmp_path):
    img = render_line(fonts["A"], "Some injuries", 96); p = tmp_path / "s.png"; img.save(p)
    r = match_headlines([(p, [0, 0, img.width, img.height], "Some injuries")], [fonts["A"], fonts["A_twin"]])
    assert r.verdict == "unresolved" and set(r.tie) >= {"A_twin"} or r.verdict == "unresolved"
```

- [ ] **Step 2: Run, expect failures**
- [ ] **Step 3: Implement**: `ink_mask` thresholds luminance deviation from the median; `_shape_score(a, b, W=512, H=64, sigma=1.6)` fits both masks into W×H preserving aspect, Gaussian-blurs, normalised correlation; `match_headlines` scores every file (regular and, if variable, weight 700) as the mean over samples, ranks families, verdict `match` when top ≥ floor and leads by ≥ lead, else `unresolved` with `tie` = families within `tie_gap` of the top. No `closest` verdict: a stand-in is a decision the client makes on the Setup screen, never the engine's.
- [ ] **Step 4: Run, expect 2 passed**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): typeface match by measured letterforms"`

### Task 12: Reading a post into layers, and the composition grammar

**Files:**
- Create: `engine/design_engine/learn/layers.py`, `engine/design_engine/learn/grammar.py`, `engine/tests/test_layers.py`, `engine/tests/test_grammar.py`

**Interfaces:**
- Produces: `layers.read_post(path, logo_gray, ocr=read_lines, matting=True) -> PostRead(W, H, lines, text: TextRead, logo: LogoMatch | None, picture_boxes: list[Box], ground: dict(kind: "flat"|"gradient"|"photo", hex), accent_boxes: list[Box], platform, posted_at)`; matting via `rembg.remove` with `isnet-general-use` gives the foreground mask; connected components over 1.5% of the frame that are not text and not the logo are `picture_boxes`; the ground kind is `flat` when the residual's luminance std < 0.02, `gradient` when a 1-D linear fit explains > 0.9 of its row-means variance, else `photo`; accent boxes are saturated flat regions touching an edge (bars, tabs). `grammar.bands(reads: list[PostRead]) -> Grammar(side_margin, top_inset, bottom_inset, logo_corner_counts, logo_width_share, text_column_x, text_column_w, headline_h_share, subline_h_share, alignment_counts)` where each numeric band is `{p25, p50, p75, n, sources}`; posts without a logo contribute to text bands only.

- [ ] **Step 1: Failing tests** (synthetic posts drawn with Pillow: navy ground, red left bar, logo lockup pasted top-left, two headline lines and a subline; a second variant without the logo; a third with a photo block)

```python
def test_read_post_separates_text_logo_bar(synthetic_post, logo_gray):
    r = read_post(synthetic_post["path"], logo_gray, ocr=FakeOCR(synthetic_post["lines"]), matting=False)
    assert r.logo and abs(r.logo.box[0] - synthetic_post["logo_box"][0]) < 30
    assert r.text.headline_box and abs(r.text.headline_box[1] - synthetic_post["headline_box"][1]) < 5
    assert r.ground["kind"] == "flat" and r.accent_boxes and r.accent_boxes[0][0] == 0

def test_wordmark_line_is_not_headline(synthetic_post, logo_gray):
    lines = synthetic_post["lines"] + [Line("BADER LAW", synthetic_post["wordmark_box"], 1.0)]
    r = read_post(synthetic_post["path"], logo_gray, ocr=FakeOCR(lines), matting=False)
    assert all(l.text != "BADER LAW" for l in r.text.headline + r.text.subline)

def test_grammar_skips_posts_without_logo(reads_with_and_without_logo):
    g = bands(reads_with_and_without_logo)
    assert g.logo_width_share["n"] == 2 and g.side_margin["n"] == 3
```

- [ ] **Step 2: Run, expect failures**
- [ ] **Step 3: Implement** as specified; `grammar.bands` computes side margin as the min of text-column left and logo left as a share of W, top inset from the topmost of logo and headline, bottom inset from the lowest content, logo corner from the logo box centre's quadrant, alignment from the spread of line left edges versus centres.
- [ ] **Step 4: Run, expect 3 passed**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): post layers and composition grammar bands"`

### Task 13: Layout families

**Files:**
- Create: `engine/design_engine/learn/families.py`, `engine/tests/test_families.py`

**Interfaces:**
- Produces: `signature(read: PostRead) -> Signature(text_third: "top"|"middle"|"bottom", text_align: "left"|"center", logo_corner: "tl"|"tc"|"tr"|"bl"|"bc"|"br"|"none", accent_side: "left"|"right"|"top"|"bottom"|"none", picture_role: "none"|"full"|"top"|"bottom"|"side"|"inset", ground_kind)`; `cluster(reads: list[PostRead]) -> list[Family]` where `Family(key, signature, post_ids: list[str], seen_count, status: "family"|"seen_once", slots: dict[name, Band], parameters: dict(alignment, colour_roles, picture_text_ratio, device_on, logo_variant, headline_chars{p25,p50,p75}, headline_lines{...}), template: dict)`; posts with the same `source_post_id` (album slides) count once toward `seen_count` but all slides contribute to slots; `template` is `{"slots": {name: {"x","y","w","h"} as fractions (p50) with "band": {...}}, "ground": ..., "devices": [...], "alignment": ...}`.

- [ ] **Step 1: Failing tests**

```python
def test_two_posts_same_signature_form_a_family(reads_redbar_a, reads_redbar_b, read_testimonial):
    fams = cluster([reads_redbar_a, reads_redbar_b, read_testimonial])
    keys = {f.key: f for f in fams}
    redbar = [f for f in fams if f.seen_count == 2][0]
    assert redbar.status == "family" and set(redbar.post_ids) == {"a", "b"}

def test_singleton_is_seen_once(reads_redbar_a, read_testimonial):
    fams = cluster([reads_redbar_a, read_testimonial])
    assert all(f.status == "seen_once" for f in fams)

def test_family_counts_posts_not_slides(slide_1, slide_2):
    # both slides share source_post_id "album-1" and the same signature
    fams = cluster([slide_1, slide_2])
    assert len(fams) == 1 and fams[0].seen_count == 1 and fams[0].status == "seen_once"

def test_template_slots_are_fractions(reads_redbar_a, reads_redbar_b):
    fam = cluster([reads_redbar_a, reads_redbar_b])[0]
    head = fam.template["slots"]["headline"]
    assert 0 <= head["x"] <= 1 and 0 < head["w"] <= 1 and "band" in head
```

- [ ] **Step 2: Run, expect failures**
- [ ] **Step 3: Implement**: signature from the read's boxes (thirds by the headline box centre; corner by the logo box centre; accent by which edge an accent box touches; picture role by the picture box's coverage and position); cluster = group by signature tuple; slots = per-slot p25/p50/p75 of fraction boxes; parameters as listed (headline chars and lines from OCR text); `device_on` when accent boxes exist; `logo_variant` from the logo's ink luminance against its ground (light or dark).
- [ ] **Step 4: Run, expect 4 passed**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): layout family induction from post reads"`

### Task 14: Imagery language (vision read with evidence)

**Files:**
- Create: `engine/design_engine/learn/imagery.py`, `engine/tests/test_imagery.py`, `engine/tests/fixtures/imagery_response.json`

**Interfaces:**
- Produces: `describe_imagery(post_paths: list[Path], client_name: str, model="claude-opus-5-5", client=None) -> Imagery(items: list[dict(kind, description, evidence_post_ids)], people: "real_only"|"none"|"generated_ok", devices: list[str], grounds: list[str], never: list[str])`; `client` is an Anthropic client or a fake with `messages.create`. The prompt asks for structured JSON listing what the posts actually show, each item naming the post indexes it saw it in; items without evidence are dropped by code.

- [ ] **Step 1: Failing test** with a fake client returning the fixture JSON (one item with evidence, one without)

```python
def test_items_without_evidence_are_dropped(tmp_path, fake_anthropic):
    r = describe_imagery([tmp_path / "a.jpg", tmp_path / "b.jpg"], "Test", client=fake_anthropic)
    assert [i["kind"] for i in r.items] == ["device"] and r.people == "real_only"
```

- [ ] **Step 2: Run, expect failures**
- [ ] **Step 3: Implement**: images downscaled to 768 px long edge, sent as base64 in one message; JSON parsed from the first `{...}` block; validation drops items whose `evidence_post_ids` are empty or out of range; `people` is read from the items (a real headshot item sets `real_only`, no people items sets `none`).
- [ ] **Step 4: Run, expect 1 passed**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): imagery language read with evidence"`

### Task 15: Profile assembly, validation, evidence board and the CLI

**Files:**
- Create: `engine/design_engine/learn/profile.py`, `engine/design_engine/report/__init__.py`, `engine/design_engine/report/board.py`, `engine/scripts/learn_client.py`, `engine/tests/test_profile.py`, `engine/tests/test_board.py`

**Interfaces:**
- Produces: `profile.build(client, site: SiteRead | None, uploads, reads: list[PostRead], palette, pairs, type_match, grammar, families, imagery, calibration) -> dict` with top-level keys `client_id, client_name, version, status: "draft", built_at, sources: [...], palette: [{hex, role, share, source}], observed_pairs, type: {status: "resolved"|"unresolved", family, file, weight_files, score, candidates, source}, logo: {files: [{path, variant, source}], width_share_band, corner_counts, source}, grammar: {...each band with source}, families: [...], imagery: {...}, voice: {pillars, notes, source}, calibration: {...}`; `profile.validate(profile) -> list[str]` returns the paths of tokens missing a `source` (empty list means valid); `board.render(profile, workspace, out_path)` draws one JPEG: the posts, the palette with sources, the type evidence line (sample crop beside the matched render), the logo variants, each family's slot outlines drawn over its source posts, imagery items with their post thumbnails, floors with their basis; `scripts/learn_client.py --client "Bader Law" [--skip-site] [--ocr vision|rapidocr]` runs store → workspace → website → reads → palette/pairs → type → grammar → families → imagery → calibration → profile → validate → board and prints the output paths and the validation result.

- [ ] **Step 1: Failing tests**

```python
def test_validate_flags_missing_source(minimal_profile):
    minimal_profile["palette"][0].pop("source")
    assert validate(minimal_profile) == ["palette[0]"]

def test_type_unresolved_when_no_match(minimal_inputs):
    p = build(**{**minimal_inputs, "type_match": TypeMatch("unresolved", None, None, 0.0, None, None, [], [])})
    assert p["type"]["status"] == "unresolved" and validate(p) == []

def test_board_renders(minimal_profile, workspace, tmp_path):
    out = render(minimal_profile, workspace, tmp_path / "board.jpg")
    from PIL import Image
    assert Image.open(out).size[0] >= 1600
```

- [ ] **Step 2: Run, expect failures**
- [ ] **Step 3: Implement** as specified. `build` writes every token with its `source` (post ids as `post:<source_post_id>#<slide>`, site as `site:<url>`, uploads as `upload:<path>`, measurements as `measured:<function>`), and `validate` walks the dict recursively, treating any dict with a `value` or `hex` or `band` key as a token that needs a sibling `source`.
- [ ] **Step 4: Run, expect 3 passed**
- [ ] **Step 5: Run the learner for real**

Run (from `engine/`, with `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` in `engine/.env`):
`uv run python scripts/learn_client.py --client "Bader Law"` then `--client "LegaBot"`.
Expected: `work/bader-law/profile.json`, `work/bader-law/board.jpg`, same for `legabot`; `validate` prints `ok`; the console lists per client: posts read, families found with their seen counts, type verdict, floors basis. If the type verdict is `unresolved` for a client, say so in the report; do not substitute.

- [ ] **Step 6: Commit** `git commit -m "feat(engine): brand profile assembly, validation, evidence board and learn_client CLI"`

### Task 16: Sprout harvest edge function and tables (deploy gated)

**Files:**
- Create: `supabase/migrations/20261008170000_brand_assets.sql`, `supabase/functions/design-harvest/index.ts`, `supabase/functions/design-harvest/harvest.ts`, `supabase/functions/design-harvest/harvest.test.ts`
- Modify: `supabase/config.toml` (register `design-harvest` with `verify_jwt = false`)

**Interfaces:**
- Produces: tables `brand_assets` and `brand_profiles` as in spec section 11 with RLS (select `can_access_client`, writes service role only); `POST /design-harvest {client_id}` with the operational secret header or a staff JWT; `harvest.ts` exports `harvestClient(deps, clientId) -> {posts: number, slides: number, videos: number, skipped: number}` with `deps = {db, sproutToken(), fetchImage(url), classify(imageBytes, mime) -> {usable, confidence, reason}}` so Vitest drives it with fakes; it pulls `analytics/posts` for the client's active Sprout profiles over 180 days, keeps `PHOTO` and `ALBUM` posts (every `visual_media` entry with `media_type` `PHOTO`, `slide_index` by order) and `VIDEO` posts (thumbnail plus `media_url`), classifies each still with the existing vision check (confidence ≥ 0.8 to keep), stores stills under `design-references/{client_id}/post-{sha256}.{ext}` and writes one `brand_assets` row per file with `provenance {source: "sprout", source_post_id, source_url, profile_id, platform, posted_at, slide_index, impressions, classification, confidence}`; idempotent on `(client_id, sha256)`.

- [ ] **Step 1: Failing Vitest test** with fake deps: two PHOTO posts, one ALBUM with three slides (two usable, one plain photo), one VIDEO; expect 4 stills stored, 1 video row, 1 skipped, and a second run storing nothing new.
- [ ] **Step 2: Run `npx vitest run supabase/functions/design-harvest`, expect failure**
- [ ] **Step 3: Implement** `harvest.ts` by moving the Sprout fetch and classification from `_shared/brand-references/discover.ts` (same token call, same `analytics/posts` body with `limit: 50` paging up to 10 pages, 180-day window) without the cap of 8 and without the 55-second budget (the function runs under the server secret from the worker or a staff click, and returns 202 with a job row when the client has more than 60 candidates: `design_runs` is not used; a `brand_assets` row with kind `harvest_job` records progress so a second call resumes). Write the migration with both tables, indexes `(client_id, kind)` and the unique `(client_id, sha256)`, and the RLS policies.
- [ ] **Step 4: Run tests, expect pass; `npx tsc --noEmit -p tsconfig.app.json` clean**
- [ ] **Step 5: Commit** `git commit -m "feat(design-harvest): Sprout posts to brand_assets, every slide, no cap"`
- [ ] **Step 6: Deploy gate**: do not apply the migration or deploy the function. Report to Lital that they are ready; apply through the Lovable connector and deploy through the Lovable agent only after her yes. Until then the proof uses the stored posts (Task 8's legacy path).

---

## Execution notes

- Task order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16. Tasks 2 to 7 are independent of each other after Task 1 and may run in parallel; so may 9, 10, 11 and 14.
- Every test runs with `uv run pytest -q` from `engine/`; the harvest tests with `npx vitest run` from the repo root. No test touches the network.
- The real learner run in Task 15 step 5 reads the live bucket and calls the vision model once per client (about 20 images each). It spends no Higgsfield credits.
- Outputs for Lital: `engine/work/bader-law/board.jpg` and `engine/work/legabot/board.jpg`, with the type verdicts and floor bases stated plainly in the report.
