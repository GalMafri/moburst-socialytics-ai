"""The statics sheet: passing options appear as image tiles with their measurements beside them; dropped options appear only as a
text line naming the failure. The run dir is hand-made in the shape record.write produces (options.json, per-option measurements.json,
spent.json, run.json), so no model, no Chromium and no network."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import proof_sheet

DROP_REASON = "failed the gate after its fix round: li-feed-4x5: headline busy ground 0.21 is above 0.11"


def _run_dir(tmp_path: Path) -> Path:
    run = tmp_path / "runs" / "20261008-120000"
    (run / "o1").mkdir(parents=True)
    (run / "o2").mkdir(parents=True)
    Image.new("RGB", (216, 270), (23, 44, 68)).save(run / "o1" / "design-20261008-120000-o1-1080x1350.png")
    # the dropped option also left a render on disk; the sheet must not tile it
    Image.new("RGB", (216, 270), (200, 30, 30)).save(run / "o2" / "design-20261008-120000-o2-1080x1350.png")
    measurements = {"li-feed-4x5": {"passed": True, "failures": [], "warnings": [], "margin": 2.1, "measurements": {
        "logo_height_share": 0.071, "logo_height_min": 0.047, "logo_contrast": 12.4, "logo_match": 0.97, "headline_contrast": 13.9,
        "headline_busy": 0.03, "subline_contrast": 11.2, "subline_busy": 0.02, "min_text_px": 41.0, "headline_h_share": 0.12,
        "empty_bands": {"top": 0.05, "bottom": 0.08}, "dead_space": 0.19, "content_span": 0.71,
        "near_copy": {"min_whole": 31, "min_half": 14, "same_skeleton": False, "index": 3}, "file_kb": 412.0}}}
    (run / "o1" / "measurements.json").write_text(json.dumps(measurements))
    (run / "o2" / "measurements.json").write_text(json.dumps({"li-feed-4x5": {"passed": False, "failures": [DROP_REASON], "measurements": {}}}))
    options = [
        {"id": "o1", "run_id": run.name, "status": "offered", "rank": 1, "family_key": "top|left|br|left|full", "arrangement": "family",
         "headline": "Standards matter first.", "subline": "Results follow.", "picture_concept": "a calm courtroom corridor", "credits": 12.0,
         "fix_rounds": 0, "dropped_reason": None, "signature": "top|left|br|left|full",
         "files": {"li-feed-4x5": {"png": "o1/design-20261008-120000-o1-1080x1350.png", "w": 1080, "h": 1350, "passed": True, "failures": [],
                                   "arrangement": "p50", "picture_index": 1, "margin": 2.1, "text_px": {"headline": {"size": 92.0, "floor": 60.0}}}},
         "pictures": [], "unrendered": {}},
        {"id": "o2", "run_id": run.name, "status": "dropped", "rank": None, "family_key": "middle|center|bl|none|none", "arrangement": "family",
         "headline": "Standards matter first.", "subline": None, "picture_concept": "marble steps at dawn", "credits": 12.0, "fix_rounds": 2,
         "dropped_reason": DROP_REASON, "signature": None,
         "files": {"li-feed-4x5": {"png": "o2/design-20261008-120000-o2-1080x1350.png", "w": 1080, "h": 1350, "passed": False,
                                   "failures": ["headline busy ground 0.21 is above 0.11"], "arrangement": "p25", "picture_index": 2, "margin": -0.4}},
         "pictures": [], "unrendered": {}},
    ]
    (run / "options.json").write_text(json.dumps(options))
    (run / "spent.json").write_text(json.dumps({"usd": 0.42, "credits": 24.0, "turns": 7, "warnings": [], "model_calls": [],
                                                "dropped": [{"id": "o2", "reason": DROP_REASON}], "offered": ["o1"]}))
    (run / "run.json").write_text(json.dumps({"client": "Some Firm", "post_index": 2, "platform": "LinkedIn", "format": "Single Image",
                                              "copy": "Standards matter first.\n\nResults follow.", "dry_run": True,
                                              "fonts": {"headline": "/x/PoppinsMedium-500.ttf", "subline": "/x/Poppins-400.ttf"},
                                              "stand_in": True, "stand_in_file": "/x/PoppinsMedium-500.ttf", "nearest": []}))
    return run


def test_sheet_lists_dropped_as_text(tmp_path):
    run = _run_dir(tmp_path)
    blocks = proof_sheet.plan_sheet([run])
    tiles = [b for b in blocks if b["kind"] == "tile"]
    assert len(tiles) == 1 and tiles[0]["option_id"] == "o1" and tiles[0]["png"].name.endswith("o1-1080x1350.png")
    dropped_lines = [b for b in blocks if b["kind"] == "text" and b.get("role") == "dropped"]
    assert len(dropped_lines) == 1 and "o2" in dropped_lines[0]["text"] and "busy ground" in dropped_lines[0]["text"]

    image, lines = proof_sheet.build([run])
    assert image.width > 0 and image.height > 0
    assert any("o2" in line and "dropped" in line and "busy ground" in line for line in lines)
    assert not any("o2-1080x1350" in line for line in lines)  # the dropped render is named nowhere, let alone drawn
    # the passing option's measurements are printed beside its tile
    joined = "\n".join(lines)
    assert "logo height 0.071" in joined and "headline contrast 13.9" in joined and "dead space 0.19" in joined
    assert "near-copy 31/14" in joined and "12 credits" in joined and "top|left|br|left|full" in joined
    # the sheet says the type was a stand-in
    assert any("stand-in" in line for line in lines)


def test_sheet_writes_a_jpeg(tmp_path):
    run = _run_dir(tmp_path)
    out = proof_sheet.write([run], tmp_path / "out" / "statics-sheet.jpg")
    with Image.open(out) as im:
        assert im.format == "JPEG" and im.width >= 1200
