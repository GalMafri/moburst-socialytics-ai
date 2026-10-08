import numpy as np

from design_engine.measure.saliency import largest_quiet_rect, quiet_rects, saliency_map, salient_share


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
    _cy, cx, ch, cw = rects[0]
    assert cx == 0 and cw <= 10 and ch == 20
    assert abs(largest_quiet_rect(sal, float(np.percentile(sal, 50))) - 0.5) < 0.05
    assert salient_share(sal, rects[0]) < 0.2
