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
