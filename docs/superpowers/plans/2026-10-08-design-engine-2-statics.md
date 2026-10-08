# Design Engine, Plan 2: statics composer, gate and per-post run. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a confirmed brand profile (Plan 1) and a calendar post, produce finished static options in the platform's sizes that pass a measured gate with the client's own floors, through a bounded model-operated loop whose acceptance is owned by code; prove it on real Bader Law and LegaBot posts and show Lital one sheet per client of passing designs with their measurements.

**Architecture:** Three new engine packages. `compose/` turns a family template plus a picture, copy and the exact logo file into a rendered PNG with element boxes (HTML/CSS rendered by Chromium through Playwright at exact pixel size; every text node is set in the brand's font file). `gate/` composes Plan 1's measurements into one `check()` that returns pass or a named failure list, plus near-copy and distinctness. `run/` is the per-post loop: the model plans options and operates `read_brand`, `nearest_posts`, `plan`, `picture`, `compose`, `measure`, `submit`; the worker enforces the plan rules, the gate and the budget; a vision pass ranks passing options pairwise. `picture/` is the Higgsfield MCP client with the saliency read of every returned picture.

**Tech Stack:** Python 3.12 (engine), Playwright Chromium (render), `mcp` streamable-HTTP client (Higgsfield), `anthropic` tool runner (the loop), numpy/Pillow/scikit-image (measurements), pytest.

**Spec:** `docs/superpowers/specs/2026-10-08-design-engine-design.md` sections 5, 6, 9 (static part), 15, 17. Rendering note: the spec names Satori and resvg; this plan renders with Chromium through Playwright because the code research found Chromium pipelines carry the strongest evidence (DesignAsCode, PPTAgent) and Satori lacks WOFF2, balanced wrap and full CSS; the contract (HTML/CSS, real font files, exact logo file, element boxes) is unchanged.

## Global Constraints

- The logo is always the file; text is always typeset from the post copy in the brand's font file; no picture may carry a logo or text, and the picture brief never names them (worker refuses).
- No run starts for a client whose profile `type.status` is not `resolved` unless the client has accepted a named stand-in (`type.accepted_stand_in` set on the profile); the proof passes `--accept-stand-in <file>` explicitly and the sheet says so.
- Overflow policy: wrap at the brand size, shrink only to the client's own floor (`grammar.subline_h_share.p25` for sublines, `headline_h_share.p25` for headlines, never below the platform text floor), below that reject the line and ask the model to shorten; never ellipsis, never push neighbours.
- Every option carries `family_id` or `arrangement: new`, its measurements, its picture job ids and the credits spent. Nothing unmeasured is offered.
- Candidate count per option: 2 pictures × the family's arrangements; one fix round; a second failure drops the option.
- Spend: the proof asks before exceeding 100 credits per step; every Higgsfield call goes through `picture.cost_preflight` and records credits.
- Client-facing strings (future UI) never say AI, prompt, score, pipeline, model or gate; the proof sheet is for Lital and may name measurements.
- Tests never touch the network; Playwright tests render local HTML; the Higgsfield and Anthropic clients are interfaces with fakes.

## Review Focus

1. A headline that cannot fit at the client's floor must be rejected, not shrunk further or clipped (Task 2 `test_overflow_rejects_at_floor`).
2. A picture whose declared quiet zone is busy must be regenerated once and then dropped, never placed (Task 4 `test_busy_zone_regenerates_then_drops`).
3. A plan that repeats a family or a picture used in the client's last three posts, or names a logo or text in a picture brief, must be refused by the worker before any credit is spent (Task 6 `test_plan_rules_refuse_before_spend`).
4. The model reporting "measured, all passed" must not bypass the gate: `submit` re-measures every file (Task 6 `test_submit_remeasures`).
5. Two options that share family and picture must not both be offered; the set-level distinctness check drops the lower-ranked (Task 5 `test_set_distinctness_drops_duplicate`).

---

### Task 1: Platform specs (static table for now) and size selection

**Files:**
- Create: `engine/design_engine/platform/__init__.py`, `engine/design_engine/platform/specs.py`, `engine/design_engine/platform/platform_specs.json`, `engine/tests/test_platform.py`

**Interfaces:**
- Produces: `specs.sizes_for(platform: str, format: str) -> list[Size]` where `Size(name, w, h, aspect, safe: dict(top,bottom,left,right) px, min_text_px, max_file_kb, placement)`; `specs.all_platforms()`; the JSON seeded from the reference catalog's organic social and platform entries (Instagram feed 1080×1350 and 1080×1080, story 1080×1920 with top 250 and bottom 340 insets, Facebook feed 1080×1350 and 1200×630, LinkedIn 1080×1350 and 1200×627, X 1600×900 and 1080×1080, TikTok 1080×1920 with top 150, bottom 480, right 120; `min_text_px` 24 for Meta, LinkedIn and X, 28 for TikTok) with `source_url` and `fetched_at` per platform (the official help pages, recorded by hand on 2026-10-08; the weekly refresh job is Plan 4).

- [ ] Step 1: failing test: `sizes_for("Instagram", "Single Image")` returns feed 4:5 first and 1:1 second; `sizes_for("TikTok", "Single Image")` returns 1080×1920 with the TikTok insets; an unknown platform raises `KeyError` naming it.
- [ ] Step 2: run, fail. Step 3: implement (`json` load once, `Size` dataclass). Step 4: run, pass. Step 5: commit `feat(engine): platform specs table`.

### Task 2: Typesetting and the family template renderer

**Files:**
- Create: `engine/design_engine/compose/__init__.py`, `engine/design_engine/compose/template.py`, `engine/design_engine/compose/typeset.py`, `engine/design_engine/compose/render.py`, `engine/design_engine/compose/base.css`, `engine/tests/test_typeset.py`, `engine/tests/test_render.py`

**Interfaces:**
- `typeset.fit_block(lines_text: str, font_path: Path, size_px: float, floor_px: float, box_w: int, box_h: int, max_lines: int, balance=True) -> Fit(lines: list[str], size_px, overflow: bool)`: measures with Pillow `ImageFont.truetype(font_path, size)` and `getlength`, wraps greedily at `size_px`, balances the last line (reflow at 0.9 width when the last line is under a third), shrinks by 2 px steps to `floor_px`, returns `overflow=True` at the floor instead of going lower.
- `template.build_html(family: dict, size: Size, spec: ComposeSpec, fonts: dict[str, Path], logo_path: Path, picture_path: Path | None, fit: dict[str, Fit]) -> str`: absolute-positioned slots from `family["template"]["slots"]` scaled to the size, ground from the family (`flat` colour, `gradient` from the observed pair's ground, `photo` = the picture as a full-bleed `<img>`), the device (accent bar or tab at the family's side in the accent colour), the logo as `<img src="file://…">` in its slot, headline and subline as `<div>`s with `@font-face` pointing at the font files, `white-space: pre` with the fitted lines, colours from the chosen observed pair; every element has `data-slot` for box extraction.
- `render.render_html(html: str, w: int, h: int, out_png: Path, browser=None) -> dict[str, Box]`: Playwright page at exactly `w×h`, device scale 1, waits for `document.fonts.ready`, screenshots to PNG, returns `{slot: [x, y, w, h]}` from `getBoundingClientRect` of each `[data-slot]`.
- `ComposeSpec(headline: str, subline: str | None, logo_variant: str, pair: dict(ink_hex, ground_hex), device: bool, arrangement: str)`.

- [ ] Step 1: failing tests: `test_overflow_rejects_at_floor` (a 180-character headline in a 600 px box with floor 40 px returns `overflow=True` and `size_px == 40`); `test_balanced_wrap` (a two-line fit has no orphan word on the last line when a balanced split exists); `test_render_boxes_match_slots` (render the Plan 1 synthetic family at 1080×1350 with the test font: the returned headline box lies inside the slot's band, the logo box is at the slot, the PNG size is exact); `test_logo_is_the_file` (the logo pixels in the render equal the file's pixels resampled to the slot, NCC ≥ 0.95).
- [ ] Step 2: run, fail. Step 3: implement. Step 4: run, pass. Step 5: commit `feat(engine): typesetting with the client's floor and Chromium family renderer`.

### Task 3: The gate

**Files:**
- Create: `engine/design_engine/gate/__init__.py`, `engine/design_engine/gate/check.py`, `engine/design_engine/gate/distinct.py`, `engine/tests/test_gate.py`

**Interfaces:**
- `check.check(png: Path, boxes: dict, profile: dict, size: Size, references: list[Path], prior: list[Path], copy: dict(headline, subline), ocr=read_lines) -> GateResult(passed: bool, failures: list[str], warnings: list[str], measurements: dict)` with, in order: logo present and from the file (box present; NCC of the logo region against the file ≥ 0.9), logo height ≥ `calibration.floors.logo_height_min` (×1.15 when aspect < 0.7), logo contrast ≥ 3:1 (`ink_vs_ground`), logo inside the safe box; headline and subline contrast ≥ 4.5:1, `busy_ground` ≤ 0.11, smallest text ≥ `size.min_text_px`, headline height ≥ 8% of the short edge, inside the safe box, no overlap with the picture subject box; `empty_bands` ≤ `edge_band_max`; `largest_free_rect` ≤ `dead_space_max`; `content_span` ≥ 0.55; near-copy against `references` and `prior` (dHash 40 whole / 20 half); OCR copy check: the OCR'd text inside the headline and subline boxes equals the copy ignoring whitespace, case of the first letter and line order; file size ≤ `size.max_file_kb`.
- `distinct.signature(boxes, size) -> str` (text third, alignment, logo corner, device side, picture role as in Plan 1's families) and `distinct.filter_set(options: list[Option]) -> list[Option]` dropping lower-ranked options that share `(family_id, picture_sha)` or whose signature equals one of the client's last three delivered posts.

- [ ] Step 1: failing tests on synthetic renders: a clean render passes; a render with the headline over a noisy picture fails on busy ground naming the box; a render whose logo was replaced by a drawn shape fails on "logo is not the file"; a copy of a client post with new text fails near-copy; `test_set_distinctness_drops_duplicate`.
- [ ] Step 2: run, fail. Step 3: implement using Plan 1's measurement modules. Step 4: pass. Step 5: commit `feat(engine): the measured gate`.

### Task 4: Picture tool (Higgsfield MCP client, brief, saliency read)

**Files:**
- Create: `engine/design_engine/picture/__init__.py`, `engine/design_engine/picture/higgsfield.py`, `engine/design_engine/picture/brief.py`, `engine/design_engine/picture/zone.py`, `engine/tests/test_picture.py`

**Interfaces:**
- `higgsfield.Client(url="https://mcp.higgsfield.ai/mcp", token: str)` with `import_url(url) -> media_id`, `cost(model, params) -> credits`, `generate(requests: list[dict]) -> list[JobRef]`, `wait(jobs, timeout=15) -> list[JobOutcome]`, `download(url, out) -> Path`; the exact call shapes of the app's `generate.ts` (`use_unlim: false`, `medias[].value` ids, `generate_image_batch`, `jobs_wait` ≤ 12 jobs, 15 s polls); `FakeClient` for tests. Token from `HIGGSFIELD_MCP_TOKEN` in `engine/.env` (Lital supplies it; the worker reads `integration_tokens` in Plan 4).
- `brief.build(profile: dict, family: dict, slot_zone: dict, concept: str, platform: str) -> Brief(text, reference_paths: list[Path], model, params)`: the picture brief in the brand's imagery language from `profile.imagery` (kind, grounds, never), the palette as words, the quiet zone as a plain instruction ("keep the upper 45% calm and uncluttered: no objects, no texture, a plain or softly graded field"), the aspect from the family, references = up to 3 crops of the client's own picture regions (from reads: picture boxes that do not overlap text or logo boxes), and the worker-checked prohibition: the brief text may not contain "logo", "text", "headline", "wordmark", "caption", "letters" or the brand name as a thing to draw. `model` is `nano_banana_pro` at `2k` by default, `gpt_image_2_5` high when `profile.imagery.people != "none"` is false and the brief needs legible objects (both ids and credit costs recorded per call).
- `zone.read(png: Path, zone_box: Box, floor: float) -> ZoneRead(salient_share, quiet_rects, ok)` using Plan 1's `saliency_map`, `quiet_rects`, `salient_share`; `ok` when `salient_share ≤ floor` (floor = the client's `calibration.dead_space` p50 mapped to a saliency share, default 0.35).

- [ ] Step 1: failing tests with `FakeClient`: `test_brief_never_names_logo_or_text` (a concept containing "with the BADER LAW logo" raises before any call); `test_busy_zone_regenerates_then_drops` (the fake returns a busy picture twice: the tool calls generate twice, then returns `dropped` with the two job ids and the salient shares); `test_cost_recorded` (every generate records credits from `cost`).
- [ ] Step 2: run, fail. Step 3: implement. Step 4: pass. Step 5: commit `feat(engine): picture tool with quiet-zone read`.

### Task 5: Placement and option assembly

**Files:**
- Create: `engine/design_engine/compose/place.py`, `engine/design_engine/compose/option.py`, `engine/tests/test_place.py`

**Interfaces:**
- `place.choose(family: dict, size: Size, zone_reads: dict[str, ZoneRead]) -> Arrangement | None`: the family's arrangements are its slot bands (p25 and p75 positions for the text block and logo); the one with the least salient share under the text and logo slots wins; `None` when every arrangement's share exceeds the floor (the caller regenerates or drops).
- `option.assemble(profile, family, size, picture_path, copy, arrangement, pair, logo_variant, fonts, logo_files) -> Rendered(png, boxes, spec)` wiring typeset → template → render; picks the logo variant and ink colour from an observed pair whose ground matches the measured ground under the text slot (`rel_lum` of the picture region).

- [ ] Step 1: failing tests: `test_choose_prefers_quiet_arrangement`; `test_choose_none_when_all_busy`; `test_assemble_picks_pair_by_ground` (dark ground under text → the pair with light ink).
- [ ] Step 2: run, fail. Step 3: implement. Step 4: pass. Step 5: commit `feat(engine): placement by measured free space and option assembly`.

### Task 6: The per-post run (model-operated loop, code-owned gate)

**Files:**
- Create: `engine/design_engine/run/__init__.py`, `engine/design_engine/run/tools.py`, `engine/design_engine/run/loop.py`, `engine/design_engine/run/rank.py`, `engine/design_engine/run/record.py`, `engine/tests/test_run.py`

**Interfaces:**
- `tools.RunContext(profile, families, reads, workspace, size_list, platform, post, prior_runs, budget: Budget(max_turns, max_usd, max_credits), clients: dict(anthropic, higgsfield), fonts, logo_files)` and the seven tools as functions taking the context: `read_brand()`, `nearest_posts(copy, k=4)` (cosine over TF-IDF of post text from `posts_index.json` plus the family and measurements of each), `plan(options: list[dict])` (worker rules: at most 3 options; each names `family_key` or `arrangement: new` with the parts and bands it uses; `headline` and optional `subline` drawn from the post copy; `picture_brief` concept; refuses a family or picture concept used in `prior_runs[-3:]`, a brief naming logo or text, a headline longer than the family's `headline_chars.p75 × 1.3`), `picture(option_id)` (Task 4; two pictures per option), `compose(option_id)` (Task 5 over each size × each picture × arrangements; keeps the best by gate margins), `measure(option_id)` (Task 3 over every size; returns failures), `submit(option_ids)` (re-measures every file; accepts only when all pass; writes `design_options` rows locally as JSON in `work/<slug>/runs/<run_id>/`).
- `loop.run_post(ctx) -> RunResult(options: list[Option], spent: dict, turns, dropped: list[dict], transcript_path)`: `anthropic.beta.messages.tool_runner` with the tools above, system prompt stating the method and the rules in words (the rules are enforced by the tools regardless), `max_iterations = budget.max_turns`, cost accounting from usage, one fix round after a failed `measure` (the model may change copy length, picture brief or arrangement), stop when `submit` accepts or the budget ends.
- `rank.pairwise(options, nearest_posts, client) -> list[Option]`: a vision model compares passing options two at a time against each other and the nearest client posts with two questions (reads more like this brand; cleaner on a phone); Borda order; never passes or fails.
- `record.write(run_dir, result)`: `options.json`, `spent.json`, per-option `measurements.json`, the renders per size, the pictures with job ids.

- [ ] Step 1: failing tests with fakes: `test_plan_rules_refuse_before_spend` (a plan that repeats a family from the last three runs is refused and the fake Higgsfield client has no calls); `test_submit_remeasures` (the fake model claims measurement passed on a file that fails busy ground: `submit` refuses and names the failure); `test_loop_stops_on_budget` (the fake model loops; the run ends at `max_turns` with `dropped` populated and nothing offered); `test_rank_is_an_order_not_a_verdict` (rank never removes options).
- [ ] Step 2: run, fail. Step 3: implement. Step 4: pass. Step 5: commit `feat(engine): per-post run with code-owned gate and pairwise ranking`.

### Task 7: Proof driver and the statics sheet

**Files:**
- Create: `engine/scripts/run_post.py`, `engine/scripts/proof_sheet.py`, `engine/tests/test_sheet.py`

**Interfaces:**
- `run_post.py --client "Bader Law" --post-index N [--accept-stand-in <font file>] [--dry-run]`: loads `work/<slug>/out/profile.json`, the reads cache, `calendar_posts.json`, builds the context (sizes from `platform_specs` for the post's platform and format), runs `loop.run_post`, prints spent credits and dollars, writes the run dir. `--dry-run` uses the fake Higgsfield client with the client's own picture crops as pictures (no credits; renders and gate run for real) to check the whole chain before spending.
- `proof_sheet.py --client "Bader Law"`: one JPEG: for each run, the post copy, the passing options per size with their measurements printed beside (logo height and contrast, text contrast, busy ground, bands, dead space, near-copy distances, family or new arrangement, credits), dropped options listed by name with the failure, and the nearest client posts for comparison. Passing designs only are shown as designs; dropped ones appear as a text line.

- [ ] Step 1: failing test: `test_sheet_lists_dropped_as_text` (a run dir with one passing and one dropped option renders a sheet with one image tile and one text line).
- [ ] Step 2: run, fail. Step 3: implement. Step 4: pass.
- [ ] Step 5: dry run on one Bader post and one LegaBot post (no credits). Fix what the chain reveals.
- [ ] Step 6: the credit ask: six posts per client, estimated 12 to 25 credits per post with retries, within the approved proof budget; stop and ask before passing 100 credits in this step.
- [ ] Step 7: run the six posts per client for real; build both sheets; report to Lital with the measured credits and dollars per post and the type verdict used.
- [ ] Step 8: commit `feat(engine): proof driver and statics sheet`.

---

## Execution notes

- Order: 1 → 2 → 3 → 4 → 5 → 6 → 7. Tasks 1, 2, 3 and 4 are independent after Plan 1 and may run in parallel; 5 needs 2 and 4; 6 needs 3, 4, 5; 7 needs 6.
- Needed from Lital before Task 4's real calls: a Higgsfield MCP token for the engine (`HIGGSFIELD_MCP_TOKEN` in `engine/.env`), or the Supabase service role key so the engine can read the app's `integration_tokens` row as the worker will.
- Costs are recorded per run in `spent.json`; the report to Lital replaces the spec's estimates with these numbers.
