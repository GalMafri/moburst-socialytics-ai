from pathlib import Path

from design_engine.platform.specs import Size
from design_engine.video.spec import build_spec, card_seconds, duration_seconds

SIZE = Size("ig-story-9x16", 1080, 1920, "9:16", {"top": 250, "bottom": 340, "left": 0, "right": 0}, 28, 8000, "story")
PROFILE = {"grammar": {"headline_h_share": {"p50": 0.08}, "subline_h_share": {"p50": 0.04}}, "calibration": {"floors": {"logo_height_min": 0.05}}}
FAMILY = {"parameters": {"aspect": 0.8}, "template": {"alignment": "center", "slots": {
    "headline": {"x": 0.1, "y": 0.4, "w": 0.8, "h": 0.2}, "logo": {"x": 0.06, "y": 0.05, "w": 0.3, "h": 0.02}}}}


def test_card_seconds_follow_reading_pace():
    assert card_seconds("Two words") == 2.0
    assert card_seconds(" ".join(["w"] * 30)) == 5.0


def test_spec_uses_measured_geometry_and_the_logo_floor(tmp_path):
    spec = build_spec(PROFILE, FAMILY, SIZE, [{"headline": "Results matter,", "subline": "but standards matter first."}, {"headline": "Every case."}],
                      {"headline": Path("/f/h.ttf"), "subline": Path("/f/s.ttf")}, Path("/l/logo.png"), {"ink_hex": "#ffffff", "ground_hex": "#0e1b2e"})
    assert spec["width"] == 1080 and spec["height"] == 1920 and len(spec["cards"]) == 2
    assert spec["logo"]["box"]["h"] * 1920 >= 0.05 * 1080 * 1.15 - 0.5  # raised to the client's floor (tall frame factor), in frame height
    assert spec["cards"][0]["headlinePx"] == round(0.08 * 1080, 1) and spec["cards"][0]["align"] == "center"  # the brand size, as statics typeset it
    assert spec["captionStyle"]["bottomInset"] == 380
    assert abs(duration_seconds(spec) - sum(c["seconds"] for c in spec["cards"]) - spec["endCard"]["seconds"]) < 0.01
    assert abs(spec["endCard"]["logoBox"]["x"] + spec["endCard"]["logoBox"]["w"] / 2 - 0.5) < 0.01  # the closing mark is centred


def test_stage_assets_stages_the_plate(tmp_path):
    from design_engine.video.render import stage_assets
    f = tmp_path / "h.ttf"; f.write_bytes(b"f")
    logo = tmp_path / "logo.png"; logo.write_bytes(b"l")
    plate = tmp_path / "plate-1.png"; plate.write_bytes(b"p")
    spec = {"fonts": {"headline": str(f), "subline": str(f)}, "logo": {"path": str(logo)}, "plate": {"path": str(plate), "darken": 0.0}, "cards": []}
    staged = stage_assets(spec, tmp_path / "public")
    assert staged["plate"]["path"] == "plate-1.png" and (tmp_path / "public" / "plate-1.png").exists()
