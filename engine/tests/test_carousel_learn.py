from types import SimpleNamespace

from design_engine.learn.carousel import album_sizes, carousel_block, slide_roles


def _read(pid, i, kind="post"):
    return SimpleNamespace(source_post_id=pid, slide_index=i, kind=kind, source=f"post:{pid}#{i}" if kind == "post" else f"upload:{pid}")


def test_roles_from_slide_position():
    reads = [_read("a", 0), _read("a", 1), _read("a", 2), _read("b", 0), _read("b", 1), _read("c", 0), _read("u", 0, "upload")]
    assert album_sizes(reads) == {"a": 3, "b": 2}
    roles = slide_roles(reads)
    assert roles["post:a#0"] == "cover" and roles["post:a#1"] == "body" and roles["post:a#2"] == "closing"
    assert roles["post:b#0"] == "cover" and roles["post:b#1"] == "body"  # a two-slide album has no closing
    assert "post:c#0" not in roles


def test_families_serve_roles_with_two_members():
    reads = [_read("a", 0), _read("a", 1), _read("a", 2), _read("b", 0), _read("b", 1), _read("b", 2)]
    fams = [{"key": "cover-fam", "source": ["post:a#0", "post:b#0"]}, {"key": "body-fam", "source": ["post:a#1", "post:b#1", "post:a#2"]},
            {"key": "lone", "source": ["post:b#2"]}]
    block = carousel_block(reads, fams)
    assert block["albums"] == 2 and block["slide_count"]["p50"] == 3.0
    assert [e["key"] for e in block["roles"]["cover"]] == ["cover-fam"]
    assert [e["key"] for e in block["roles"]["body"]] == ["body-fam"]
    assert block["roles"]["closing"] == []  # one closing member each: no family serves the role yet
