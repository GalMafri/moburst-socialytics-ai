import pytest

from design_engine.platform import specs


def test_instagram_single_image_feed_order():
    sizes = specs.sizes_for("Instagram", "Single Image")
    assert [(s.w, s.h) for s in sizes[:2]] == [(1080, 1350), (1080, 1080)]
    assert sizes[0].aspect == "4:5" and sizes[1].aspect == "1:1"
    assert sizes[0].placement == "feed" and sizes[0].min_text_px == 24
    assert sizes[0].safe == {"top": 0, "bottom": 0, "left": 0, "right": 0}


def test_instagram_story_insets():
    (story,) = specs.sizes_for("Instagram", "Story")
    assert (story.w, story.h) == (1080, 1920)
    assert story.safe["top"] == 250 and story.safe["bottom"] == 340


def test_tiktok_single_image_insets_and_floor():
    sizes = specs.sizes_for("TikTok", "Single Image")
    tt = sizes[0]
    assert (tt.w, tt.h) == (1080, 1920)
    assert tt.safe == {"top": 150, "bottom": 480, "left": 0, "right": 120}
    assert tt.min_text_px == 28


def test_unknown_platform_names_it():
    with pytest.raises(KeyError, match="Threads"):
        specs.sizes_for("Threads", "Single Image")


def test_unknown_format_names_it():
    with pytest.raises(KeyError, match="Reel"):
        specs.sizes_for("Instagram", "Reel")


def test_all_platforms_and_sources():
    plats = specs.all_platforms()
    assert {"Instagram", "Facebook", "LinkedIn", "X", "TikTok"} <= set(plats)
    for p in plats:
        src = specs.source(p)
        assert src["source_url"].startswith("https://") and src["fetched_at"] == "2026-10-08"


def test_platform_name_is_case_insensitive():
    assert specs.sizes_for("instagram", "Single Image") == specs.sizes_for("Instagram", "Single Image")
