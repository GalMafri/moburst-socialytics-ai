import numpy as np

from design_engine.measure.bands import content_span, empty_bands, largest_free_rect


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
