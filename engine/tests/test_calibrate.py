import numpy as np
from PIL import Image

from design_engine.measure.calibrate import calibrate


def make_posts(tmp_path, n):
    paths = []
    for i in range(n):
        arr = np.full((1350, 1080, 3), 30, dtype=np.uint8)
        arr[200 + 20 * i:900, 100:980] = np.random.default_rng(i).integers(0, 255, (700 - 20 * i, 880, 3))
        p = tmp_path / f"p{i}.png"
        Image.fromarray(arr).save(p)
        paths.append(p)
    return paths


def test_provisional_floors_below_six(tmp_path):
    cal = calibrate(make_posts(tmp_path, 4), None, "Test")
    assert cal["floors"]["dead_space_max"] == 0.38 and cal["measured_on"] == 4 and "provisional" in cal["floors"]["basis"]


def test_measured_floors_at_six(tmp_path):
    cal = calibrate(make_posts(tmp_path, 6), None, "Test")
    f = cal["floors"]
    assert 0.25 <= f["dead_space_max"] <= 0.50 and 0.10 <= f["edge_band_max"] <= 0.30 and f["logo_height_min"] == 0.06
    assert cal["sources"] and "own designed posts" in f["basis"]
