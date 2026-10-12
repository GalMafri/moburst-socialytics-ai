"""The worker moves rows and files; it decides nothing. A run without a confirmed brand fails with the reason; offered options become
rows with uploaded files; slides carry their carousel."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from design_engine.worker.main import option_rows, process
from design_engine.worker.store import FakeStore, Run


def test_run_without_confirmed_profile_fails_with_reason(tmp_path):
    store = FakeStore(runs=[{"id": "r1", "client_id": "c1", "post_key": "k1", "platform": "Instagram", "format": "Single Image", "copy": "Hello", "budget": {}}])
    run = store.lease()
    out = process(store, run, browser=None, clients={})
    assert out["status"] == "failed" and "no confirmed brand profile" in out["failure"]
    assert store.finished[0]["status"] == "failed" and store.options == []


def test_option_rows_upload_offered_renders_and_keep_slides(tmp_path):
    png = tmp_path / "a.png"
    png.write_bytes(b"png")
    gate = SimpleNamespace(passed=True, measurements={"logo_match": 0.99}, warnings=[])
    rendered = SimpleNamespace(png=png)
    def opt(oid, parent=None, kind="static", status="offered", rank=1, role=None):
        return SimpleNamespace(id=oid, status=status, parent=parent, kind=kind, rank=rank, slide_role=role, family_key="fam", family={"key": "fam"},
                               arrangement="family", picture_brief="a dusk", distinct_signature="sig", copy={"headline": "x"}, pictures=[],
                               renders={"ig-feed-4x5": {"rendered": rendered, "gate": gate}} if kind != "carousel" else {})
    parent = opt("K", kind="carousel")
    s1, s2 = opt("K.1", parent="K", role="cover"), opt("K.2", parent="K", role="body")
    dropped = opt("B", status="dropped")
    result = SimpleNamespace(options=[parent], states=[parent, s1, s2, dropped], dropped=[{"id": "B", "reason": "x"}])
    ctx = SimpleNamespace(size_list=[SimpleNamespace(name="ig-feed-4x5", w=1080, h=1350)])
    store = FakeStore()
    run = Run("r1", "c1", "k1", "Instagram", "Carousel", "copy", None, {})
    rows = option_rows(store, run, ctx, result)
    keys = [(r["option_key"], r["kind"], r["parent_key"]) for r in rows]
    assert keys == [("K", "carousel", None), ("K.1", "slide", "K"), ("K.2", "slide", "K")]
    assert rows[1]["files"]["ig-feed-4x5"]["url"].startswith("fake://generated-media/designs/c1/r1/K.1-ig-feed-4x5.png")
    assert len(store.uploads) == 2 and rows[0]["files"] == {}


def test_fallback_rows_offer_the_brand_cards(tmp_path, monkeypatch):
    """No composed option passed: the brand cards are offered as option T (one card for a static run, every card as slides for a carousel)."""
    from design_engine.worker import main as wm

    def fake_stills(profile, copy, size, fonts, logo_files, out_dir, cards=5, only_first=False, plate=None):
        out = []
        for i in range(1 if only_first else 3):
            png = Path(out_dir) / f"card-{i + 1}.png"
            png.parent.mkdir(parents=True, exist_ok=True)
            png.write_bytes(b"png")
            out.append(wm_make.CardStill(i, f"line {i + 1}", png, True, [], 1.0))
        return out, None

    from design_engine.video import make as wm_make
    monkeypatch.setattr(wm_make, "make_card_stills", fake_stills)
    monkeypatch.setattr(wm, "card_assets", lambda profile, ws: ({"headline": tmp_path / "f.ttf"}, []))
    sizes = [SimpleNamespace(name="li-feed-4x5", w=1080, h=1350), SimpleNamespace(name="li-feed-191x100", w=1200, h=628)]
    store = FakeStore()
    run = Run("r1", "c1", "k1", "LinkedIn", "Single Image", "line 1. line 2. line 3.", None, {})
    ctx = SimpleNamespace(size_list=sizes, run_dir=tmp_path / "run", is_carousel=False, options={})
    rows, fail = wm.fallback_rows(store, run, ctx, {}, tmp_path)
    assert fail is None and [r["option_key"] for r in rows] == ["T"] and rows[0]["kind"] == "static"
    assert set(rows[0]["files"]) == {"li-feed-4x5", "li-feed-191x100"} and rows[0]["measurements"]["fallback"] is True
    assert len(store.uploads) == 2
    ctx.is_carousel = True
    store = FakeStore()
    rows, fail = wm.fallback_rows(store, Run("r2", "c1", "k1", "LinkedIn", "Carousel", "copy", None, {}), ctx, {}, tmp_path)
    assert fail is None and [(r["option_key"], r["kind"], r["parent_key"], r["slide_role"]) for r in rows] == [
        ("T", "carousel", None, None), ("T.1", "slide", "T", "cover"), ("T.2", "slide", "T", "body"), ("T.3", "slide", "T", "closing")]
    assert len(store.uploads) == 6
