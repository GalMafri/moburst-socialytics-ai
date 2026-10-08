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
    a = picture(3)
    b = a.copy()
    ImageDraw.Draw(b).rectangle([20, 150, 300, 200], fill=(255, 255, 255))
    r = near_copy(b, [a])
    assert r.is_copy and r.min_whole <= 40


def test_unrelated_is_not_copy():
    r = near_copy(picture(4), [picture(5)])
    assert not r.is_copy and r.min_whole > 60
