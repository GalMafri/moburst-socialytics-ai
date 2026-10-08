from design_engine.learn.typeface import match_headlines, render_line


def test_match_prefers_the_true_font(fonts, tmp_path):
    img = render_line(fonts["A"], "Some injuries", 96)
    p = tmp_path / "s.png"
    img.save(p)
    r = match_headlines([(p, [0, 0, img.width, img.height], "Some injuries")], [fonts["A"], fonts["B"]])
    assert r.verdict == "match" and r.file == fonts["A"]


def test_tie_is_unresolved(fonts, tmp_path):
    img = render_line(fonts["A"], "Some injuries", 96)
    p = tmp_path / "s.png"
    img.save(p)
    r = match_headlines([(p, [0, 0, img.width, img.height], "Some injuries")], [fonts["A"], fonts["A_twin"]])
    assert r.verdict == "unresolved"
    assert "A_twin" in r.tie or "A" in r.tie
