from design_engine.learn.profile import validate


def test_validate_flags_missing_source():
    profile = {"palette": [{"hex": "#000000", "role": "ground", "share": 0.5}], "observed_pairs": [], "type": {"status": "unresolved", "source": "x"},
               "logo": {"files": [], "source": "x"}, "grammar": {}, "families": [], "imagery": {"items": [], "source": "x"}, "calibration": {"source": "x"}}
    assert validate(profile) == ["palette[0]"]


def test_validate_accepts_sourced_tokens():
    profile = {"palette": [{"hex": "#000000", "role": "ground", "share": 0.5, "source": "measured"}], "observed_pairs": [],
               "type": {"status": "unresolved", "source": "x"}, "logo": {"files": [], "source": "x"},
               "grammar": {"side_margin": {"p50": 0.1, "sources": ["post:a#0"]}}, "families": [], "imagery": {"items": [], "source": "x"},
               "calibration": {"source": "x"}}
    assert validate(profile) == []
