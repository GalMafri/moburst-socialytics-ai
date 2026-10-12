"""Picture tool: brief refusal, the two-attempt quiet-zone loop, per-call credit recording, and the MCP call shapes. No network."""
from __future__ import annotations

from io import BytesIO

import numpy as np
import pytest
from PIL import Image

from design_engine.picture import PictureResult, make_picture
from design_engine.picture import brief as brief_mod
from design_engine.picture import zone as zone_mod
from design_engine.picture.brief import Brief, BriefRefused
from design_engine.picture.higgsfield import Client, FakeClient, HiggsfieldError, JobRef

W, H = 480, 600  # 4:5, 20 x 25 saliency cells at the default cell size
TOP_ZONE = [0.0, 0.0, float(W), 270.0]  # the upper 45%


def _png(arr: np.ndarray) -> bytes:
    buf = BytesIO()
    Image.fromarray(arr.astype(np.uint8)).save(buf, format="PNG")
    return buf.getvalue()


def busy_png(seed: int = 0) -> bytes:
    return _png(np.random.default_rng(seed).integers(0, 255, (H, W, 3)))


def quiet_top_png(seed: int = 0) -> bytes:
    arr = np.full((H, W, 3), 120, dtype=np.uint8)
    arr[300:] = np.random.default_rng(seed).integers(0, 255, (H - 300, W, 3))
    return _png(arr)


PROFILE = {
    "client_name": "Bader Law",
    "palette": [
        {"hex": "#172c44", "role": "ground", "share": 0.21},
        {"hex": "#f8f7f5", "role": "ink", "share": 0.14},
        {"hex": "#c9a227", "role": "accent", "share": 0.03},
    ],
    "imagery": {
        "items": [
            {"kind": "photography", "description": "Office interiors and city streets, warm light, shallow depth of field.", "evidence_post_ids": [0]},
            {"kind": "ground", "description": "Navy flat colour behind the copy.", "evidence_post_ids": [1]},
        ],
        "people": "none",
        "devices": [],
        "grounds": ["navy flat colour", "photo"],
        "never": ["no stock photography", "no text overlays on photos"],
    },
    "calibration": {"dead_space": {"p50": 0.048, "p75": 0.079, "p90": 0.094}},
}
FAMILY = {"key": "top|left|br|none|full", "parameters": {"aspect": 0.8}, "template": {"picture_role": "full", "ground": {"kinds": ["photo"]}}}
SLOT_ZONE = {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.45}


def make_brief(text: str = "A quiet law office at dusk, warm light on wood.") -> Brief:
    return Brief(text=text, reference_paths=[], model="nano_banana_pro",
                 params={"model": "nano_banana_pro", "aspect_ratio": "4:5", "resolution": "2k", "use_unlim": False},
                 aspect="4:5", brand_name="Bader Law", zone_instruction="keep the upper 45% calm and uncluttered")


# ---- Step 1 tests from the plan ----


def test_brief_never_names_logo_or_text(tmp_path):
    client = FakeClient(pictures=[quiet_top_png()])
    with pytest.raises(BriefRefused):
        brief_mod.build(PROFILE, FAMILY, SLOT_ZONE, "a courtroom with the BADER LAW logo on the wall", "instagram")
    with pytest.raises(BriefRefused):
        brief_mod.build(PROFILE, FAMILY, SLOT_ZONE, "bader law in gold on a marble wall", "instagram")
    for word in ("Text", "HEADLINE", "wordmark", "caption", "letters"):
        with pytest.raises(BriefRefused):
            brief_mod.build(PROFILE, FAMILY, SLOT_ZONE, f"a desk with a {word} on it", "instagram")
    # the worker refuses a hand-made brief too, before any call is made
    with pytest.raises(BriefRefused):
        make_picture(client, make_brief("A desk with the firm's logo engraved"), tmp_path, TOP_ZONE, 0.35)
    assert client.calls == []
    # words that merely contain a forbidden word are fine
    b = brief_mod.build(PROFILE, FAMILY, SLOT_ZONE, "a textured stone wall with contextual lighting", "instagram")
    assert "textured" in b.text


def test_busy_zone_regenerates_then_drops(tmp_path):
    client = FakeClient(pictures=[busy_png(0), busy_png(1)], costs=[6.0, 6.0])
    result = make_picture(client, make_brief(), tmp_path, TOP_ZONE, 0.35)
    assert isinstance(result, PictureResult)
    assert result.status == "dropped"
    assert result.path is None
    assert result.job_ids == ["job-1", "job-2"]
    assert len(result.zone_reads) == 2 and all(not z.ok for z in result.zone_reads)
    assert all(z.salient_share > 0.35 for z in result.zone_reads)
    generates = [args for tool, args in client.calls if tool == "generate_image_batch"]
    assert len(generates) == 2
    first, second = (g["requests"][0]["params"]["prompt"] for g in generates)
    assert first != second and len(second) > len(first)
    assert "completely empty" in second.lower() and "upper part" in second.lower()


def test_quiet_zone_passes_first_try(tmp_path):
    client = FakeClient(pictures=[quiet_top_png()], costs=[6.0])
    result = make_picture(client, make_brief(), tmp_path, TOP_ZONE, 0.35)
    assert result.status == "ok"
    assert result.path is not None and result.path.exists() and result.path.parent == tmp_path
    assert result.job_ids == ["job-1"]
    assert len(result.zone_reads) == 1 and result.zone_reads[0].ok
    assert len([1 for tool, _ in client.calls if tool == "generate_image_batch"]) == 1


def test_cost_recorded(tmp_path):
    client = FakeClient(pictures=[busy_png(0), busy_png(1)], costs=[6.0, 7.5])
    result = make_picture(client, make_brief(), tmp_path, TOP_ZONE, 0.35)
    assert [s["credits"] for s in result.spent] == [6.0, 7.5]
    assert [s["job_id"] for s in result.spent] == ["job-1", "job-2"]
    assert result.credits == 13.5
    tools = [tool for tool, _ in client.calls]
    # the cost preflight precedes every generate
    for i, tool in enumerate(tools):
        if tool == "generate_image_batch":
            assert tools[i - 1] == "cost"
    assert tools.count("cost") == 2


def test_references_are_imported_as_medias(tmp_path):
    client = FakeClient(pictures=[quiet_top_png()], media_ids=["m-1", None, "m-3"])
    b = make_brief()
    b.reference_urls = ["https://x/1.png", "https://x/2.png", "https://x/3.png"]
    result = make_picture(client, b, tmp_path, TOP_ZONE, 0.35)
    assert result.status == "ok"
    params = next(args for tool, args in client.calls if tool == "generate_image_batch")["requests"][0]["params"]
    assert params["medias"] == [{"value": "m-1", "role": "image_references"}, {"value": "m-3", "role": "image_references"}]
    assert params["use_unlim"] is False


# ---- brief.build ----


def test_brief_builds_from_profile():
    b = brief_mod.build(PROFILE, FAMILY, SLOT_ZONE, "a quiet law office at dusk", "instagram")
    assert "upper 45%" in b.text and "calm and uncluttered" in b.text
    assert "navy" in b.text.lower() and "#172c44" in b.text
    assert "office interiors" not in b.text.lower()  # the planner reads the imagery items; the prompt carries the concept
    assert "no stock photography" in b.text.lower()
    assert "no text overlays" not in b.text.lower()  # a profile line naming text never enters the brief
    assert b.aspect == "4:5" and b.params["aspect_ratio"] == "4:5"
    assert b.model == "nano_banana_pro" and b.params["resolution"] == "2k" and b.params["use_unlim"] is False
    assert b.brand_name == "Bader Law"
    assert b.reference_paths == []
    g = brief_mod.build(PROFILE, FAMILY, SLOT_ZONE, "a brass scale on a desk", "instagram", legible_objects=True)
    assert g.model == "gpt_image_2_5" and g.params["quality"] == "high"
    people = {**PROFILE, "imagery": {**PROFILE["imagery"], "people": "real_only"}}
    assert brief_mod.build(people, FAMILY, SLOT_ZONE, "a brass scale on a desk", "instagram", legible_objects=True).model == "nano_banana_pro"


def test_zone_instruction_names_the_side():
    assert brief_mod.zone_instruction({"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.45}).startswith("keep the upper 45%")
    assert brief_mod.zone_instruction({"x": 0.0, "y": 0.6, "w": 1.0, "h": 0.4}).startswith("keep the lower 40%")
    assert brief_mod.zone_instruction({"x": 0.0, "y": 0.1, "w": 0.5, "h": 0.8}).startswith("keep the left 50%")
    assert brief_mod.zone_instruction({"x": 0.55, "y": 0.1, "w": 0.45, "h": 0.8}).startswith("keep the right 45%")


def test_brief_references_skip_text_and_logo(tmp_path):
    post = tmp_path / "post.png"
    Image.fromarray(np.random.default_rng(3).integers(0, 255, (H, W, 3)).astype(np.uint8)).save(post)
    reads = [
        {"path": str(post), "W": W, "H": H, "logo": {"box": [400.0, 500.0, 60.0, 60.0]}, "lines": [{"box": [20.0, 20.0, 200.0, 40.0]}],
         "picture_boxes": [[380.0, 480.0, 100.0, 120.0], [0.0, 300.0, 480.0, 150.0]]},  # first overlaps the logo, second is clean
        {"path": str(post), "W": W, "H": H, "logo": None, "lines": [{"box": [20.0, 20.0, 200.0, 40.0]}],
         "picture_boxes": [[0.0, 0.0, 480.0, 100.0]]},  # overlaps a text line
        {"path": str(post), "W": W, "H": H, "logo": None, "lines": [], "picture_boxes": [[0.0, 100.0, 480.0, 200.0]]},
        {"path": str(post), "W": W, "H": H, "logo": None, "lines": [], "picture_boxes": [[0.0, 100.0, 480.0, 200.0]]},
        {"path": str(post), "W": W, "H": H, "logo": None, "lines": [], "picture_boxes": [[0.0, 100.0, 480.0, 200.0]]},
    ]
    b = brief_mod.build(PROFILE, FAMILY, SLOT_ZONE, "a quiet office", "instagram", reads=reads, ref_dir=tmp_path / "refs", use_references=True)
    assert len(b.reference_paths) == 3
    assert all(p.exists() for p in b.reference_paths)
    assert Image.open(b.reference_paths[0]).size == (480, 150)


# ---- zone.read ----


def test_zone_read_flat_vs_busy(tmp_path):
    quiet = tmp_path / "quiet.png"
    quiet.write_bytes(quiet_top_png())
    busy = tmp_path / "busy.png"
    busy.write_bytes(busy_png())
    zq = zone_mod.read(quiet, TOP_ZONE, 0.35)
    zb = zone_mod.read(busy, TOP_ZONE, 0.35)
    assert zq.ok and zq.salient_share < 0.1
    assert not zb.ok and zb.salient_share > 0.8
    assert zq.quiet_rects and zq.quiet_rects[0][0] == 0  # the largest quiet rectangle starts at the top row
    assert zq.zone_cells == (0, 0, 11, 20)


def test_floor_from_calibration():
    assert zone_mod.floor_from_calibration({}) == 0.35
    assert zone_mod.floor_from_calibration({"dead_space": {"p50": 0.2}}) == pytest.approx(0.35)
    assert zone_mod.floor_from_calibration(PROFILE["calibration"]) > 0.35
    assert zone_mod.floor_from_calibration({"dead_space": {"p50": 0.6}}) == 0.2


# ---- the real Client's call shapes, with the transport stubbed ----


class StubClient(Client):
    def __init__(self, replies):
        super().__init__(token="t", url="https://mcp.example/mcp")
        self.replies = list(replies)
        self.sent: list[tuple[str, dict]] = []

    def _call(self, name, args):
        self.sent.append((name, args))
        return self.replies.pop(0)


def test_client_call_shapes():
    c = StubClient([
        {"media_id": "m-9", "type": "image"},
        {"cost": {"credits": 6, "credits_exact": 5.5}},
        {"jobs": [{"index": 0, "job_id": "j1", "status": "queued"}], "submitted_count": 1, "failed_count": 0},
    ])
    assert c.import_url("https://x/1.png") == "m-9"
    assert c.sent[0] == ("media_import_url", {"url": "https://x/1.png", "type": "image"})
    assert c.cost("nano_banana_pro", {"prompt": "p", "aspect_ratio": "4:5", "resolution": "2k"}) == 5.5
    name, args = c.sent[1]
    assert name == "generate_image" and args["params"]["get_cost"] is True and args["params"]["use_unlim"] is False
    assert args["params"]["model"] == "nano_banana_pro"
    jobs = c.generate([{"index": 0, "params": {"model": "nano_banana_pro", "prompt": "p", "aspect_ratio": "4:5", "resolution": "2k"}}])
    assert jobs == [JobRef(index=0, job_id="j1")]
    name, args = c.sent[2]
    assert name == "generate_image_batch" and args["requests"][0]["params"]["use_unlim"] is False


def test_client_wait_chunks_and_polls():
    jobs = [JobRef(index=i, job_id=f"j{i}") for i in range(14)]
    done = lambda refs: {"jobs": [{"index": r["index"], "job_id": r["job_id"], "status": "completed", "result_url": f"https://r/{r['job_id']}"} for r in refs],
                         "all_terminal": True}
    c = StubClient([])
    c._call = lambda name, args: (c.sent.append((name, args)), done(args["jobs"]))[1]
    outcomes = c.wait(jobs, timeout=40)
    assert [o.job_id for o in outcomes] == [j.job_id for j in jobs]
    assert all(o.status == "completed" and o.result_url for o in outcomes)
    assert [len(a["jobs"]) for _, a in c.sent] == [12, 2]
    assert all(a["timeout_seconds"] <= 15 for _, a in c.sent)


def test_client_refuses_unlim_question_and_errors():
    c = StubClient([{"unlim_choice": {"options": []}}])
    with pytest.raises(HiggsfieldError):
        c.generate([{"index": 0, "params": {"model": "nano_banana_pro", "prompt": "p"}}])
    c = StubClient([{"jobs": [{"index": 0, "job_id": "j1", "status": "submission_failed", "error": "no"}]}])
    with pytest.raises(HiggsfieldError):
        c.generate([{"index": 0, "params": {"model": "nano_banana_pro", "prompt": "p"}}])


def test_fake_client_download_writes_scripted_png(tmp_path):
    client = FakeClient(pictures=[quiet_top_png()])
    out = client.download("fake://job-1", tmp_path / "p.png")
    assert out.exists() and Image.open(out).size == (W, H)


def test_profile_fragments_never_put_forbidden_words_in_the_brief():
    """An imagery item whose kind or description names type is not a picture description; the brief is built from the rest."""
    profile = {**PROFILE, "imagery": {**PROFILE["imagery"], "items": PROFILE["imagery"]["items"] + [
        {"kind": "text_only", "description": "A result card with large type.", "evidence_post_ids": [2]},
        {"kind": "photography", "description": "A hand holding a card with text on it.", "evidence_post_ids": [3]}]}}
    b = brief_mod.build(profile, FAMILY, SLOT_ZONE, "a quiet stadium at night", "instagram")
    assert brief_mod.is_clean(brief_mod.without_clause(b.text), "Bader Law") and "result card" not in b.text and "holding a card" not in b.text
    assert "Office interiors" not in b.text


def test_plate_brief_carries_the_clients_posts_as_references(tmp_path):
    """A plate brief: the client's posts as look references, the concept, the calm zone and the mark's corner, nothing written; GPT Image."""
    refs = []
    for i in range(6):
        p = tmp_path / f"post-{i}.jpg"
        p.write_bytes(b"jpg")
        refs.append(p)
    b = brief_mod.build_plate(PROFILE, FAMILY, SLOT_ZONE, "a rain-streaked windshield at dusk, soft brake lights ahead", "linkedin", refs,
                              picture_aspect=0.8, logo_zone={"x": 0.06, "y": 0.05, "w": 0.3, "h": 0.05})
    assert b.model == "gpt_image_2_5" and b.params["quality"] == "high" and b.aspect == "4:5"
    assert len(b.reference_paths) == brief_mod.MAX_PLATE_REFERENCES
    assert "reference posts" in b.text and "windshield" in b.text and "upper 45%" in b.text and "brand mark" in b.text
    assert brief_mod.is_clean(brief_mod.without_clause(b.text), "Bader Law")
    assert "Office interiors" not in b.text  # the look comes from the references, not from pasted scene descriptions
    with pytest.raises(brief_mod.BriefRefused):
        brief_mod.build_plate(PROFILE, FAMILY, SLOT_ZONE, "the firm's logo carved in marble", "linkedin", refs)
