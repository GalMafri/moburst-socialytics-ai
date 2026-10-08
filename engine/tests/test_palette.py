import numpy as np

from design_engine.learn.palette import observed_pairs, palette


def post():
    arr = np.full((1350, 1080, 3), (14, 27, 46), dtype=np.uint8)  # navy ground
    arr[:, :110] = (220, 42, 46)  # red bar
    arr[400:500, 150:800] = (255, 255, 255)  # white headline block
    return arr


def test_palette_roles():
    sw = palette([post()])
    by_role = {s.role: s.hex for s in sw}
    assert by_role["ground"].lower() == "#0e1b2e" and by_role["accent"].lower() == "#dc2a2e" and by_role["ink"].lower() == "#ffffff"


def test_observed_pair_white_on_navy():
    pairs = observed_pairs(post(), [[150, 400, 650, 100]])
    assert pairs[0].ink_hex.lower() == "#ffffff" and pairs[0].ground_hex.lower() == "#0e1b2e" and pairs[0].contrast > 14
