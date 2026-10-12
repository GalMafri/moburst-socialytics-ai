"""The per-post run: worker rules on `plan`, the picture/compose/measure/submit chain on fakes, the budget stop of the model loop,
and the pairwise rank as an order. The model is scripted at the API boundary (`client.beta.messages.parse`) so the real tool runner
drives the real tools; Higgsfield is the FakeClient; OCR reads the engine's own render index. Chromium renders locally; no network."""
from __future__ import annotations

import json
from dataclasses import asdict
from io import BytesIO
from pathlib import Path

import numpy as np
import pytest
from anthropic.types.beta import BetaMessage
from PIL import Image

from design_engine.compose.render import chromium
from design_engine.learn.families import cluster
from design_engine.learn.layers import read_post
from design_engine.measure.logo import logo_gray_from_file
from design_engine.measure.ocr import FakeOCR, Line
from design_engine.picture.higgsfield import FakeClient
from design_engine.platform import specs
from design_engine.run import loop, rank, record, tools
from design_engine.run.tools import Budget, RunContext, ToolRefused
from tests.fixtures.make_post_fixture import lockup_image, make

W, H = 1080, 1350
COPY = "Some injuries ruin summers\n\nSome sense in rumours\n\n#injuries #summers"
HEADLINE = "Some injuries ruin summers"
SUBLINE = "Some sense in rumours"
CONCEPT = "A quiet summer meadow at dusk, soft warm light, shallow depth of field"
BANDS = {
    "logo": {"y": {"p25": 0.02, "p75": 0.40}},
    "headline": {"y": {"p25": 0.10, "p75": 0.62}},
    "subline": {"y": {"p25": 0.30, "p75": 0.84}},
}
SLOT_H = {"headline": 0.17, "subline": 0.05}


def _read(tmp_path, name, **kw):
    fx = make(tmp_path, name=name, **kw)
    return fx, read_post(fx["path"], logo_gray_from_file(fx["logo_path"], 0), ocr=FakeOCR(fx["lines"]), matting=False,
                         meta={"source_post_id": name, "slide_index": 0})


@pytest.fixture(scope="module")
def family(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("family")
    _, a = _read(tmp, "a")
    _, b = _read(tmp, "b", headline=("Some injuries", "ruin summers"))
    fam = asdict(cluster([a, b])[0])
    fam["template"]["picture_role"] = "full"
    for slot, bands in BANDS.items():
        s = fam["template"]["slots"][slot]
        s["band"] = {**s.get("band", {}), **bands}
        if slot in SLOT_H:
            s["h"] = SLOT_H[slot]
    return fam


@pytest.fixture(scope="module")
def browser():
    with chromium() as b:
        yield b


def _png(arr: np.ndarray) -> bytes:
    buf = BytesIO()
    Image.fromarray(arr.astype(np.uint8)).save(buf, format="PNG")
    return buf.getvalue()


def dark_png(seed: int = 0) -> bytes:
    """A picture shaped like a usable one: a calm dark field over the upper 60% (where the family's text and logo sit) and a busy subject
    in the lower 40%. The seed changes the subject so two pictures differ."""
    arr = np.full((H, W, 3), (18, 24, 36), dtype=np.uint8)
    arr[int(H * 0.6):] = np.random.default_rng(seed).integers(0, 255, (H - int(H * 0.6), W, 3))
    return _png(arr)


def blocky(w: int, h: int, seed: int = 3, cell: int = 48) -> Image.Image:
    """Busy ground the way test_gate makes it: coarse light/dark blocks that survive the gate's median filter and blur."""
    blocks = np.random.default_rng(seed).choice([25, 235], size=(h // cell + 1, w // cell + 1, 1)).astype(np.uint8)
    return Image.fromarray(np.kron(blocks, np.ones((cell, cell, 3), dtype=np.uint8))[:h, :w])


def tamper_headline(rec: dict, seed: int) -> None:
    """Overwrite the kept render's headline region with busy ground, leaving the engine's record of it untouched."""
    png = rec["rendered"].png
    im = Image.open(png).convert("RGB")
    x, y, w, h = (round(v) for v in rec["rendered"].boxes["headline"])
    im.paste(blocky(w, h, seed), (x, y))
    im.save(png)


class RenderIndexOCR:
    """Reads the text where the engine placed it: one line per text slot from the run's render index, the copy as typeset."""

    def __init__(self, ctx: RunContext):
        self.ctx = ctx

    def __call__(self, path) -> list[Line]:
        rec = self.ctx.files.get(str(path))
        if not rec:
            return []
        return [Line(rec["copy"][role], list(rec["boxes"][role]), 1.0) for role in ("headline", "subline")
                if rec["copy"].get(role) and rec["boxes"].get(role)]


def _profile(logo_files):
    return {
        "client_name": "Some Firm",
        "palette": [{"hex": "#0e1b2e", "role": "ground", "share": 0.6}, {"hex": "#ffffff", "role": "ink", "share": 0.2},
                    {"hex": "#dc2a2e", "role": "accent", "share": 0.05}],
        "type": {"status": "resolved", "family": "A", "file": None},
        "grammar": {"headline_h_share": {"p25": 0.06, "p50": 0.085, "p75": 0.1}, "subline_h_share": {"p25": 0.03, "p50": 0.04, "p75": 0.05},
                    "alignment_counts": {"left": 2}},
        "observed_pairs": [
            {"ink_hex": "#ffffff", "ground_hex": "#0e1b2e", "contrast": 16.0, "source": "a"},
            {"ink_hex": "#101010", "ground_hex": "#f4f1ea", "contrast": 15.0, "source": "b"},
        ],
        "imagery": {"items": [{"kind": "photography", "description": "Warm meadows and quiet rooms."}], "people": "none",
                    "grounds": ["navy flat colour"], "never": ["no stock photography"]},
        "calibration": {"dead_space": {"p50": 0.2}, "floors": {"dead_space_max": 0.38, "edge_band_max": 0.16, "logo_height_min": 0.06}},
        "logo": {"files": logo_files},
        "rules": ["keep the headline short"],
    }


def _workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "work" / "some-firm"
    (ws / "posts").mkdir(parents=True)
    index = {}
    for i, text in enumerate(["Some injuries ruin summers for families", "Some sense in rumours about injuries", "Summers in the office"]):
        p = ws / "posts" / f"post-{i}.png"
        Image.new("RGB", (120, 150), (30, 30, 60)).save(p)
        index[f"post:{i}#0"] = {"path": f"posts/post-{i}.png", "source_post_id": f"post:{i}", "platform": "INSTAGRAM",
                                "posted_at": f"2026-09-0{i + 1}T00:00:00Z", "slide_index": 0, "text": text}
    (ws / "posts_index.json").write_text(json.dumps(index))
    return ws


@pytest.fixture
def logo_files(tmp_path):
    light = tmp_path / "logo-light.png"
    lockup_image(wordmark_white=True).save(light)
    dark = tmp_path / "logo-dark.png"
    lockup_image(wordmark_white=False).save(dark)
    return [{"path": str(light), "variant": "upload", "ground": "dark"}, {"path": str(dark), "variant": "upload", "ground": "light"}]


def make_ctx(tmp_path, family, fonts, logo_files, browser=None, pictures=None, prior_runs=(), budget=None, sizes=None) -> RunContext:
    ws = _workspace(tmp_path)
    fam = {**family, "post_ids": ["post:0", "post:1"]}
    ctx = RunContext(
        profile=_profile(logo_files), families=[fam], reads=[], workspace=ws,
        size_list=sizes or specs.sizes_for("Instagram", "Single Image")[:1], platform="Instagram",
        post={"copy": COPY, "format": "Single Image", "pillar": "Education", "post_key": "k1"},
        prior_runs=list(prior_runs), budget=budget or Budget(max_turns=6, max_usd=2.0, max_credits=60.0),
        clients={"higgsfield": FakeClient(pictures=list(pictures or []), costs=6.0)},
        fonts={"headline": fonts["A"], "subline": fonts["A"]}, logo_files=logo_files,
        run_dir=tmp_path / "runs" / "r1", browser=browser, rank_with_vision=False,
    )
    ctx.ocr = RenderIndexOCR(ctx)
    return ctx


def option(family_key, headline=HEADLINE, subline=SUBLINE, concept=CONCEPT, **extra):
    return {"family_key": family_key, "headline": headline, "subline": subline, "picture_brief": concept, **extra}


# ---- the plan's four tests ----


def test_plan_rules_refuse_before_spend(tmp_path, family, fonts, logo_files):
    key = family["key"]
    prior = [{"run_id": "p1", "family_key": key, "picture_concept": "a courtroom at dawn"}]
    ctx = make_ctx(tmp_path, family, fonts, logo_files, pictures=[dark_png()], prior_runs=prior)
    fake = ctx.clients["higgsfield"]

    with pytest.raises(ToolRefused, match="last three"):
        tools.plan(ctx, [option(key)])
    with pytest.raises(ToolRefused, match="last three"):
        tools.plan(ctx, [option(None, arrangement="new", parts=["headline", "logo"], bands={"headline": {"x": 0.1, "y": 0.1, "w": 0.7, "h": 0.2},
                                                                                           "logo": {"x": 0.1, "y": 0.8, "w": 0.3, "h": 0.06}},
                                concept="A Courtroom at dawn")])
    assert ctx.options == {}
    ctx.prior_runs = []
    with pytest.raises(ToolRefused, match="logo"):
        tools.plan(ctx, [option(key, concept="a meadow with the firm's logo carved in stone")])
    with pytest.raises(ToolRefused, match="Some Firm"):
        tools.plan(ctx, [option(key, concept="Some Firm in gold on marble")])
    with pytest.raises(ToolRefused, match="longer"):
        tools.plan(ctx, [option(key, headline=" ".join(["Some injuries ruin summers"] * 3))])
    with pytest.raises(ToolRefused, match="post copy"):
        tools.plan(ctx, [option(key, headline="Some injuries never heal")])
    with pytest.raises(ToolRefused, match="at most 3"):
        tools.plan(ctx, [option(key, id=f"o{i}") for i in range(4)])
    with pytest.raises(ToolRefused, match="unknown family"):
        tools.plan(ctx, [option("no|such|family|here|none")])
    assert ctx.options == {} and fake.calls == [] and ctx.spent["credits"] == 0
    # a plan that follows the rules is recorded; a line-join of the copy counts as the copy
    out = tools.plan(ctx, [option(key, headline="ruin summers Some sense", subline=None)])
    assert out["accepted"] == ["o1"] and ctx.options["o1"].family_key == key
    assert fake.calls == []


def test_chain_offers_a_measured_option(tmp_path, family, fonts, logo_files, browser):
    ctx = make_ctx(tmp_path, family, fonts, logo_files, browser=browser, pictures=[dark_png(1), dark_png(2)])
    key = family["key"]
    brand = tools.read_brand(ctx)
    assert brand["families"][0]["key"] == key and brand["rules"] == ["keep the headline short"]
    near = tools.nearest_posts(ctx, COPY, k=2)
    assert {n["source_post_id"] for n in near} == {"post:0", "post:1"} and all(n["family_key"] == key for n in near)
    tools.plan(ctx, [option(key)])
    pic = tools.picture(ctx, "o1")
    assert pic["pictures"] and len(pic["pictures"]) == 2 and all(p["status"] == "ok" for p in pic["pictures"])
    assert ctx.spent["credits"] == 12.0 and ctx.options["o1"].credits == 12.0
    comp = tools.compose(ctx, "o1")
    size = ctx.size_list[0]
    assert comp["sizes"][size.name]["passed"] is True and comp["sizes"][size.name]["arrangement"] in ("p25", "p50", "p75")
    meas = tools.measure(ctx, "o1")
    assert meas["status"] == "passed" and meas["sizes"][size.name]["passed"] is True
    sub = tools.submit(ctx, ["o1"])
    assert sub["accepted"] == ["o1"] and ctx.done
    result = loop.result_from(ctx, turns=0, transcript_path=ctx.run_dir / "transcript.jsonl")
    assert [o.id for o in result.options] == ["o1"] and result.options[0].rank == 1
    written = record.write(ctx.run_dir, result)
    opts = json.loads((ctx.run_dir / "options.json").read_text())
    assert opts[0]["status"] == "offered" and opts[0]["family_key"] == key and opts[0]["picture_job_ids"]
    png = ctx.run_dir / opts[0]["files"][size.name]["png"]
    assert png.exists() and Image.open(png).size == (W, H)
    assert (ctx.run_dir / "o1" / "measurements.json").exists() and (ctx.run_dir / "spent.json").exists()
    assert written["options"] == 1


def test_submit_remeasures(tmp_path, family, fonts, logo_files, browser):
    ctx = make_ctx(tmp_path, family, fonts, logo_files, browser=browser, pictures=[dark_png(1), dark_png(2)])
    tools.plan(ctx, [option(family["key"])])
    tools.picture(ctx, "o1")
    tools.compose(ctx, "o1")
    assert tools.measure(ctx, "o1")["status"] == "passed"
    # whatever was measured before, submit re-reads the files: the headline ground of the kept render is made busy
    tamper_headline(ctx.options["o1"].renders[ctx.size_list[0].name], seed=5)
    with pytest.raises(ToolRefused) as e:
        tools.submit(ctx, ["o1"])
    assert "headline busy ground" in str(e.value) and "o1" in str(e.value)
    assert not ctx.done and ctx.submitted is None
    assert ctx.options["o1"].fix_rounds == 1


def test_measure_second_failure_drops(tmp_path, family, fonts, logo_files, browser):
    ctx = make_ctx(tmp_path, family, fonts, logo_files, browser=browser, pictures=[dark_png(1), dark_png(2)])
    tools.plan(ctx, [option(family["key"])])
    tools.picture(ctx, "o1")
    tools.compose(ctx, "o1")
    tamper_headline(ctx.options["o1"].renders[ctx.size_list[0].name], seed=7)
    first = tools.measure(ctx, "o1")
    assert first["status"] == "needs_fix" and ctx.options["o1"].fix_rounds == 1
    second = tools.measure(ctx, "o1")
    assert second["status"] == "dropped" and ctx.options["o1"].status == "dropped"
    assert any(d["id"] == "o1" for d in ctx.dropped)
    with pytest.raises(ToolRefused, match="dropped"):
        tools.compose(ctx, "o1")


def _scripted_parse(script):
    """A stand-in for client.beta.messages.parse: each call pops one scripted turn (a list of tool calls) and returns a BetaMessage."""
    turns = {"n": 0}

    def parse(**params):
        turns["n"] += 1
        calls = script(turns["n"], params)
        content = [{"type": "text", "text": f"turn {turns['n']}"}]
        content += [{"type": "tool_use", "id": f"tu_{turns['n']}_{i}", "name": name, "input": args} for i, (name, args) in enumerate(calls)]
        return BetaMessage.model_validate({
            "id": f"msg_{turns['n']}", "type": "message", "role": "assistant", "model": params["model"], "content": content,
            "stop_reason": "tool_use" if calls else "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 1000, "output_tokens": 100},
        })

    parse.turns = turns
    return parse


def test_loop_stops_on_budget(tmp_path, family, fonts, logo_files, monkeypatch):
    import anthropic

    monkeypatch.setenv("PRICE_IN_CLAUDE_OPUS_5_5", "4.0")
    monkeypatch.setenv("PRICE_OUT_CLAUDE_OPUS_5_5", "20.0")
    ctx = make_ctx(tmp_path, family, fonts, logo_files, pictures=[dark_png()], budget=Budget(max_turns=3, max_usd=5.0, max_credits=60.0))
    key = family["key"]

    def script(n, params):
        if n == 1:
            return [("read_brand", {}), ("plan", {"options": [option(key)]})]
        return [("read_brand", {})]  # the model loops without ever submitting

    client = anthropic.Anthropic(api_key="test-key")
    client.beta.messages.parse = _scripted_parse(script)
    result = loop.run_post(ctx, model_client=client)
    assert result.turns == 3 and ctx.spent["turns"] == 3
    assert result.options == []
    assert result.dropped and result.dropped[0]["id"] == "o1" and "budget" in result.dropped[0]["reason"]
    assert result.spent["usd"] == pytest.approx(3 * (1000 * 4.0 + 100 * 20.0) / 1_000_000)
    lines = [json.loads(line) for line in result.transcript_path.read_text().splitlines()]
    assert sum(1 for entry in lines if "stop_reason" in entry) == 3  # one line per model turn, plus the tool events of the last turn
    assert ctx.clients["higgsfield"].calls == []
    assert (ctx.run_dir / "options.json").exists() and (ctx.run_dir / "spent.json").exists()


def test_rank_is_an_order_not_a_verdict(tmp_path):
    class O:
        def __init__(self, id):
            self.id = id
            self.png = tmp_path / f"{id}.png"
            Image.new("RGB", (10, 10), (0, 0, 0)).save(self.png)

    opts = [O("a"), O("b"), O("c")]
    asked = []

    def ask(a_png, b_png, refs):
        asked.append((a_png.name, b_png.name))
        return ("B", "B")  # the second of every pair reads more like the brand and cleaner on a phone

    ordered = rank.pairwise(opts, [], client=None, ask=ask, png_of=lambda o: o.png)
    assert [o.id for o in ordered] == ["c", "b", "a"]
    assert sorted(o.id for o in ordered) == ["a", "b", "c"] and len(ordered) == 3
    assert len(asked) == 3
    # no client and no ask: the order is left as given, nothing removed
    assert [o.id for o in rank.pairwise(opts, [], client=None, png_of=lambda o: o.png)] == ["a", "b", "c"]
    # a failing judge removes nothing either
    def broken(a, b, refs):
        raise RuntimeError("no vision today")
    assert len(rank.pairwise(opts, [], client=None, ask=broken, png_of=lambda o: o.png)) == 3


def test_plan_reading_order_and_case(tmp_path, family, fonts, logo_files):
    """A kicker family (subline above the headline) refuses copy in the wrong order; capitalising a first word is not rewriting."""
    from copy import deepcopy

    below = deepcopy(family)
    hs, ss = below["template"]["slots"]["headline"], below["template"]["slots"]["subline"]
    hs["y"], hs["h"], ss["y"], ss["h"] = 0.30, 0.15, 0.50, 0.05
    assert tools.reading_order(below) == "headline_first"
    ctx = make_ctx(tmp_path, below, fonts, logo_files)
    key = below["key"]
    out = tools.plan(ctx, [option(key, headline="ruin summers some sense", subline=None)])  # lower-case start: still the copy's words
    assert out["accepted"] == ["o1"]
    kicker = deepcopy(family)
    kicker["key"] = key + "|kicker"
    hs, ss = kicker["template"]["slots"]["headline"], kicker["template"]["slots"]["subline"]
    ss["y"], ss["h"], hs["y"] = 0.05, 0.04, 0.30
    assert tools.reading_order(kicker) == "subline_first"
    ctx2 = make_ctx(tmp_path / "k", kicker, fonts, logo_files)
    with pytest.raises(tools.ToolRefused, match="kicker"):
        tools.plan(ctx2, [option(kicker["key"], headline="Some injuries", subline="ruin summers")])


def test_carousel_chain(tmp_path, family, fonts, logo_files, browser):
    """A carousel option: slides as children, one picture per slide, the set check, submit by the carousel's id."""
    ctx = make_ctx(tmp_path, family, fonts, logo_files, browser=browser, pictures=[dark_png(1), dark_png(2), dark_png(3)])
    ctx.post["format"] = "Carousel"
    key = family["key"]
    ctx.profile["carousel"] = {"albums": 4, "slide_count": {"p25": 3.0, "p50": 3.0, "p75": 4.0},
                               "roles": {"cover": [{"key": key, "n": 4}], "body": [{"key": key, "n": 6}], "closing": []}}
    brand = tools.read_brand(ctx)
    assert brand["carousel"]["role_families"]["cover"] == [key]
    slides = [{"family_key": key, "headline": "Some injuries", "picture_brief": CONCEPT},
              {"family_key": key, "headline": "ruin summers", "picture_brief": CONCEPT + " at dusk"},
              {"family_key": key, "headline": "Some sense in rumours", "picture_brief": CONCEPT + " at dawn"}]
    with pytest.raises(tools.ToolRefused, match="slide-count band"):
        tools.plan(ctx, [{"id": "K", "slides": slides[:1]}])
    with pytest.raises(tools.ToolRefused, match="copy's order"):
        tools.plan(ctx, [{"id": "K", "slides": [slides[1], slides[0], slides[2]]}])
    family["parameters"]["headline_chars"] = {"p25": 40.0, "p50": 44.0, "p75": 48.0}
    with pytest.raises(tools.ToolRefused, match="under the family's measure"):
        tools.plan(ctx, [{"id": "K", "slides": slides}])
    family["parameters"]["headline_chars"] = {"p25": 12.0, "p50": 14.0, "p75": 28.0}
    out = tools.plan(ctx, [{"id": "K", "slides": slides}])
    assert out["accepted"] == ["K"] and ctx.options["K"].kind == "carousel" and ctx.options["K"].slides == ["K.1", "K.2", "K.3"]
    assert ctx.options["K.1"].slide_role == "cover" and ctx.options["K.2"].slide_role == "body"
    pic = tools.picture(ctx, "K")
    assert pic["status"] == "ok" and ctx.spent["credits"] == 18.0  # one picture per slide
    comp = tools.compose(ctx, "K")
    assert comp["set"]["passed"], comp["set"]
    meas = tools.measure(ctx, "K")
    assert meas["status"] == "passed", meas
    with pytest.raises(tools.ToolRefused, match="own id"):
        tools.submit(ctx, ["K.1"])
    sub = tools.submit(ctx, ["K"])
    assert sub["accepted"] == ["K"] and ctx.options["K.2"].status == "offered"
    result = loop.result_from(ctx, turns=0, transcript_path=ctx.run_dir / "transcript.jsonl")
    record.write(ctx.run_dir, result)
    recs = {r["id"]: r for r in json.loads((ctx.run_dir / "options.json").read_text())}
    assert recs["K"]["kind"] == "carousel" and recs["K"]["slides"] == ["K.1", "K.2", "K.3"] and recs["K.3"]["parent"] == "K"


def test_pictures_for_several_options_in_one_call(tmp_path, family, fonts, logo_files, browser):
    """One picture call with option_ids makes every option's pictures at once; the budget is charged once per picture."""
    ctx = make_ctx(tmp_path, family, fonts, logo_files, browser=browser, pictures=[dark_png(i) for i in range(1, 5)])
    key = family["key"]
    tools.plan(ctx, [option(key, id="o1"), option(key, id="o2", concept="a brass scale on a desk")])
    out = tools.pictures(ctx, option_ids=["o1", "o2"])
    assert set(out["options"]) == {"o1", "o2"}
    assert all(len(v["pictures"]) == 2 for v in out["options"].values())
    assert ctx.spent["credits"] == 24.0 == out["credits_spent_total"]
    assert ctx.options["o1"].credits == 12.0 and ctx.options["o2"].credits == 12.0
    with pytest.raises(ToolRefused, match="option_id"):
        tools.pictures(ctx)
