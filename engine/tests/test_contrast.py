import numpy as np

from design_engine.measure.contrast import busy_ground, ink_vs_ground
from design_engine.measure.image import contrast, crop, rel_lum


def flat(h, w, rgb):
    return np.full((h, w, 3), rgb, dtype=np.uint8)


def test_contrast_black_on_white_is_21():
    assert round(contrast(rel_lum(np.array([255, 255, 255])), rel_lum(np.array([0, 0, 0]))), 1) == 21.0


def test_ink_vs_ground_reads_marks_inside_padding():
    region = flat(120, 400, (255, 255, 255))
    # two black "glyph" strokes with a white gap between them and white padding around them (a solid block has no
    # ground inside its own bounds, so the reference crop-to-marks step would read nothing but ink)
    region[40:80, 100:180] = (0, 0, 0)
    region[40:80, 220:300] = (0, 0, 0)
    assert ink_vs_ground(region) > 15


def test_busy_ground_flat_plate_is_near_zero():
    region = flat(120, 400, (20, 30, 60))
    region[50:70, 50:350] = (255, 255, 255)  # the type itself must not count
    assert busy_ground(region) < 0.02


def test_busy_ground_noise_is_high():
    # coarse 40px blocks: the reference median+gaussian pass is designed to erase pixel-level noise (it measures ~0.007),
    # so a busy ground is modelled as variation wide enough to survive the blur (measures ~0.11)
    rng = np.random.default_rng(1)
    coarse = rng.integers(0, 255, size=(3, 10, 3), dtype=np.uint8)
    region = np.repeat(np.repeat(coarse, 40, axis=0), 40, axis=1)
    assert busy_ground(region) > 0.08


def test_crop_clips_to_frame():
    arr = flat(10, 10, (0, 0, 0))
    assert crop(arr, [8, 8, 5, 5]).shape == (2, 2, 3)
    assert crop(arr, [20, 20, 5, 5]) is None
