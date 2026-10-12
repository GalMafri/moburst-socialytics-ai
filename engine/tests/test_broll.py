import pytest

from design_engine.video.broll import BrollRefused, build_brief, check_brief

PROFILE = {"client_name": "Bader Law", "palette": [{"hex": "#172c44", "role": "ground", "share": 0.3}],
           "imagery": {"items": [{"kind": "photography", "description": "Quiet courthouse steps at dusk."}, {"kind": "people", "description": "A lawyer at a desk."}]}}


def test_broll_brief_refuses_people_and_brand():
    with pytest.raises(BrollRefused):
        check_brief("a crowd outside the courthouse", "Bader Law")
    with pytest.raises(Exception):
        check_brief("the Bader Law office", "Bader Law")
    text = build_brief(PROFILE, "rain on a city street at night")
    assert "nobody in frame" in text and "lawyer" not in text and "No lettering" in text
