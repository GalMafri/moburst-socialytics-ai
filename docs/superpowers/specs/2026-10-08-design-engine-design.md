# Socialytics design engine: design

Date: 2026-10-08. Branch `design-engine`. Status: for Lital's review before the implementation plan.

## 1. What this is

A self-serve design feature inside Socialytics. A client-role user opens a post in the calendar and gets finished, on-brand options for that platform's sizes (statics, carousels, videos), picks one, and the pick flows into the existing Sprout scheduling path. Nobody at Moburst is in the loop per post.

"On brand" means: the client's exact logo and font files; a design language learned from the client's own published posts (through Sprout), its website and its uploads; platform sizes, safe zones and practices that refresh without manual edits; and every design distinct from the client's earlier posts and from earlier deliveries.

The method is Lital's Creative Production agent, rebuilt for organic social and self-serve: a brand profile with a source on every token; layout read off the client's own designed work as measured geometry; exact assets placed by code; the picture made for the slot; a measured gate with floors from the client's own posts that code enforces and the model cannot waive; feedback distilled into standing rules per client. The code research of 2026-10-08 (open-source generators, commercial products, template APIs, video engines, agentic systems) confirms this shape and adds four things, all in section 6: measure the picture before placing on it, rank several candidates by measurement, one fix round, and a vision pass that ranks but never passes or fails.

### Acceptance test

Before product wiring: designs for Bader Law and LegaBot (two Socialytics clients whose brands look nothing alike) that pass the measured gate with floors from each client's own posts, shown to Lital as one sheet per client. Her verdict decides whether the build continues. A no changes the structure, never the pixels. Only passing work is ever shown.

### Rules

- No bandaid fixes: when something fails, the structure that produced it changes.
- Nothing client-facing says AI, prompt, score, pipeline, model or gate. The client sees "designs", "options", "your brand", "checks passed".
- Everything client-specific is data in the brand profile. No client value is a constant in code.
- The logo is always the file. Text is always typeset by code in the brand's font file. A picture never carries a logo or text.
- Lital's yes before any Higgsfield spend beyond 100 credits per step and before any deploy. No time estimates anywhere.
- RivalIQ is not a source. Client posts come from Sprout through the existing `analytics/posts` path only.
- The Creative Production agent at `~/Documents/AI Workflows/Claude Skills/Creative Static Design - Sep 2026/creative-production-agent/` is read only. Its measurement scripts are ported, never imported or run.

## 2. Non-goals

- No Figma. No designer-authored template library shipped with the product. No paid third-party design tools. The only paid services are Higgsfield (pictures, b-roll) and the model.
- No whole-post image generation, no editing of the client's own posts in place, no code reconstruction of the client's brand elements as drawn shapes.
- No per-post approval by Moburst. The one human step is the client confirming its brand once in Setup.

## 3. Architecture

Four parts, one package.

```
packages/design-engine/           TypeScript, runs in the worker and in the offline proof (same code)
  learner/      brand profile + families from Sprout posts, website, uploads
  compose/      HTML/CSS templates per family, typesetting, Satori + resvg render
  measure/      the ported gate (measure_qa + calibration + near-copy + saliency)
  run/          the per-post agent loop (tools, budget, candidates, ranking)
  video/        Remotion compositions, captions, assembly
worker/                            Node process on the Socialytics box; leases design_runs from Supabase
supabase/functions/design-*        thin edge functions: enqueue a run, read options, pick, confirm brand
src/components/design/             the client screens (Setup "Your brand", post panel "Design" tab)
```

The model plans, authors and interprets renders through tools. Code owns rendering, measurement, acceptance and the iteration budget. The worker gate refuses anything that fails measurement; the model gets the failure list and one fix round.

## 4. Brand learner

Runs once per client (triggered from Setup), then on demand and whenever the Sprout harvest finds new designed posts. Output is a versioned row in `brand_profiles` with `status` `draft` until the client confirms, then `confirmed`. Every token carries `source`: the file, post or measurement it came from. A token without a source is not written.

### Inputs, in fidelity order

1. Client uploads: logo files (SVG preferred), font files (TTF/OTF/WOFF), brand book PDF (fonts embedded in it are read with their real names).
2. The client's website: logo by the documented selector order (inline SVG in header or nav, `img` with logo class or alt, apple-touch-icon, og:image); `@font-face` files downloaded and their family read from the font's own name table; colours from computed styles weighted toward buttons, headers and `theme-color`, greys and near-white dropped.
3. The client's published posts from Sprout: `analytics/posts` for the assigned profiles, last 180 days, `PHOTO` and `ALBUM` posts, every slide of an album, fetched and stored in `design-references/{client_id}/post-{sha256}.{ext}` with `source_post_id`, `platform`, `posted_at`, `slide_index`, `impressions`. The existing cap of 8 is removed. The classifier that keeps designed posts and drops plain photos, video frames and screenshots stays (vision model, confidence 0.8). Video posts are kept as a separate list for the video learner (section 8).

### What is learned

| Token group | How it is measured | Source recorded |
|---|---|---|
| Palette | Colour clusters across the designed posts (quantised, area-weighted), reconciled with website colours and brand book; role per colour (ground, ink, accent) from where it appears | post ids, URL, PDF page |
| Type | A measured match of headline lines cut from the posts against the font files from the website, uploads and brand book (render the same words in each candidate, normalised correlation of ink masks, as `type_evidence.py` does). A face read off a picture is never the type. If no file matches, the profile records `type: unresolved` with the closest library family named as a candidate, and no run starts for the client until the client uploads the file or explicitly accepts the named stand-in on the Setup screen. There is no silent substitution anywhere in the engine; a missing font fails the run | font file, match score |
| Observed pairs | Every text-on-ground pair seen in the posts (ink colour, ground colour, measured contrast) and the logo variant used on each ground, so compositions reuse pairs the brand has published rather than new combinations | post ids |
| Logo | The uploaded or website file; light and dark variants; the lockup as it appears in posts (width share, corner, clear space) measured by template match of the file against the posts | file, post ids |
| Composition grammar | Side, top and bottom margins; logo slot; text column position and width; alignment; headline and subline size as a share of the short edge; type scale ratios; from OCR line boxes and the logo match per post, reported as bands (p25, p50, p75) | post ids |
| Layout families | Section 5 | post ids |
| Imagery language | What the posts actually show: people (real headshots, never generated), devices and app screens, photography kind, illustration, flat colour grounds, ghost marks, accent devices (bars, tabs, chevrons, bolts); described in words with the posts that evidence each item | post ids |
| Voice | From the client's copy and content pillars already in `clients` | existing fields |
| Calibration floors | Dead space, edge bands and logo height measured on the designed posts, floors derived as the reference does (p75 + margin inside sane bounds; provisional defaults when fewer than 6 designed posts), stored in `brand_profiles.calibration` | post ids |

### Confirmation

Setup gets a "Your brand" screen: the posts the brand was learned from, the palette, the type with its evidence, the logo variants, the families drawn as outlines over the posts they came from, and the imagery language in plain words. The client can upload a font or logo file, correct the family name, and confirm. Confirmation stamps `confirmed_by`, `confirmed_at`. A changed input creates a new version; runs always use the latest confirmed version.

## 5. Layout families

A family is a parametrised layout the client has published, not its pixels: slots for logo, headline, subline, picture, device or object, accent device and badge, each as a box in fractions of the frame with the band observed across the family's posts; the ground type (flat colour, gradient, photograph, card over photograph); the alignment; and the roles of the brand's accent devices. Each family also records its parameters and their observed ranges: alignment (left or centred), colour-role assignment (which palette colour is ground, ink, accent), picture-to-text ratio, device on or off, logo variant, and the headline length band (characters and lines) it has carried. A family is chosen for a post because its parameters fit the post (headline length, picture ratio, message), never by rotation alone; rotation only breaks ties.

### Induction

1. Each stored post is read into layers and boxes: text lines by OCR (Apple Vision locally in the proof, the same interface backed by a server OCR in the worker), the logo by template match of the file, the picture and devices by matting and inpainting as LayerD does (foreground peel, inpaint, repeat), ground by residual.
2. Posts are clustered by layout signature (text block thirds, logo corner, accent side, picture role, ground type). A cluster with at least two posts is a family; singletons are kept as "seen once" families usable only when the calendar needs variety.
3. Each family becomes one HTML/CSS template with named slots and the measured bands, plus a variant per platform size from `platform_specs` (reflow rules: margins and type sizes as shares of the short edge, logo and copy inside the safe box, picture edge to edge).
4. For carousels, families carry slide roles: cover, body, closing (section 7).

### Variety beyond the feed

The learner also records the parts (slots, devices, grounds) and their bands. The engine may compose a new arrangement from those parts within the bands. Every design records `family_id` or `arrangement: new`; the proof sheet labels both so Lital can judge whether new arrangements still read as the brand. A client's feed with four families and no new arrangements yields exactly those four skeletons rotated; this is stated to the client in Setup as "your looks".

## 6. Per-post run

Trigger: the client presses Create in the post panel. An edge function inserts `design_runs` (client, post key, platform, format, copy, pillar, requested sizes from `platform_specs`, budget). The worker leases it.

### The loop

The model (Opus for planning, a cheaper model for mechanical turns; the proof measures whether quality holds) runs with these tools and a turn and dollar budget per run:

- `read_brand(client)`: the confirmed profile, families, calibration, standing rules, and the client's last three runs (families and pictures used) for rotation.
- `nearest_posts(copy)`: the client's own posts closest to this post's message, with their measurements, as exemplars.
- `plan(options)`: records the plan: for each option, the family or new arrangement, headline and subline from the post copy, the picture brief in the brand's imagery language, which devices to carry. The worker refuses a plan that repeats a family or picture used in the client's last three posts, or that names a logo or text inside a picture brief.
- `picture(brief, slot)`: Higgsfield image generation with the quiet zone named for the slot, the brand's rendering style and palette as references, never the logo or text. Returns the file plus a saliency map and the free rectangles measured on it; a picture whose measured salient share inside the declared zone exceeds the client's occlusion floor is regenerated once with the zone masked, then dropped. Outpainted or inpainted regions are recorded on the option so the sheet can mark them.
- `compose(option, picture, arrangement)`: typesets copy and places the logo into the family's slots on the picture, in the real fonts and the exact file, choosing the arrangement with the least occlusion among the family's allowed arrangements; returns the render per size. Typesetting rules: wrap at brand size before shrinking; shrink only to the client's own floor (the smallest text size observed in its posts as a share of the short edge, never below the platform floor); below that floor the headline is rejected and the model must shorten the copy; never ellipsis, never grow the box by pushing neighbours; balanced wrap; a block clears the logo only when they share a side; the logo variant and the ink colour come from an observed pair whose ground matches what is under the text.
- `measure(renders)`: the ported gate (section 6, gate). Returns pass or the failure list with numbers.
- `submit(options)`: accepted only when every size of every option passed. Posting ends the run.

Candidates: per option, two pictures and the family's allowed arrangements are rendered and measured; the best by the gate's margins is kept. One fix round: the model sees the failure list and may change copy length, picture brief or arrangement; a second failure drops the option. No second fix round.

Vision pass: after the gate, a vision model compares the passing options pairwise against each other and against the client's own nearest posts with narrow questions (which reads more like this brand; which is cleaner on a phone). It orders the options; it never passes or fails one.

### The gate (ported from `measure_qa.py` and `calibrate`)

Per render, in export pixels, with floors from the client's calibration:

- Logo present, from the file, transparent; height at least the client's floor (×1.15 on tall frames); contrast against its ground at least 3:1; inside the safe box.
- Headline and subline: contrast at least 4.5:1; busy ground under text at most 0.11 (median-filtered, blurred, trimmed std); smallest text at or above the platform floor; headline at least 8% of the short edge; inside the safe box; no overlap with the device or picture subject.
- Empty top or bottom bands at most the client's floor; largest free rectangle at most the client's floor; content span at least 55%.
- Near-copy: dHash whole and half frames against every stored client post and every earlier delivery for the client; refuse at distance 40 whole or 20 half (the reference's thresholds).
- Distinctness across the set: no two options share family and picture; layout signature differs from the client's last three posts.
- Copy exactness is by construction (typeset from the post copy) and verified once by OCR on the final render.

The worker runs the gate itself before accepting a submit, whatever the model reported, and keeps the measurements on `design_options.measurements`.

### Output

`design_options` rows per option: one file per requested size in `generated-media/{client_id}/design-{run}-{option}-{WxH}.png`, the family or arrangement, the picture job ids, the measurements, the rank, `status` `offered`. The client sees them in the Design tab. A pick writes `post_iterations` with `media_urls`, `variant_group_id`, `is_selected` the way the current generators do, so the Schedule tab and the calendar status work unchanged.

## 7. Carousels

Carousel families are induced from the client's album posts with slide roles: cover (headline, logo), body (one idea per slide, numbered or chevroned as the brand does), closing (the brand's own closing device). The plan splits the post copy into slides at the client's observed slide count band. Each slide is composed and measured like a static; the set must share one grid, one type scale and one picture treatment (checked across slides) and must pass as a set.

## 8. Video

Order: statics first, carousels second, video last, each with its own passing sheet.

Sources: the client's own published videos (Sprout `VIDEO` posts, fetched and stored), which teach the client's video language (talking head, text cards, captions style, pacing) and supply footage of the client's own people; generated b-roll from Higgsfield (Seedance) in the brand's imagery language, never faces; text cards typeset in the brand's font with the family's geometry; captions from Whisper word timestamps rendered in the brand's type with the platform's safe zone.

Assembly: Remotion compositions on the worker (frame-indexed, real fonts, `fitText` per caption page, Chromium render, FFmpeg encode). Remotion requires a company licence for Moburst; the fee is fixed, not per video. Creatomate is the fallback if the licence is refused.

Gate for video: sampled frames go through the static gate (text contrast, busy ground, safe zone, logo), captions are checked against the transcript, and no generated clip may contain a face.

## 9. Platform specs

Table `platform_specs`: per platform and placement, sizes, aspect, safe insets, text floor, max file size, duration limits, and practice rules in words, with `source_url`, `fetched_at`, `snapshot` and a diff against the previous snapshot. A weekly job on the worker refetches the official spec pages and the platform help pages; a change creates a new row and a note on the Setup screen ("Instagram changed its story safe zone on …"). Practice signals: what performs for this client in Sprout impressions by family and format, kept as a hint to the planner, never as a rule.

## 10. Feedback memory

A client's rejection of an option carries an optional note. Notes and picks are distilled (low-effort model call, no tools) into at most three standing rules per note, scoped to the client, stored in `design_rules` with `source_option_id`, `created_at`, `status`. Rules are injected into `read_brand` and shown on the Setup screen as "What we keep in mind for you" with a remove control. A rule that would relax a gate check is refused at distillation.

## 11. Data model

```
brand_profiles      id, client_id, version, status (draft|confirmed|retired), profile jsonb, calibration jsonb,
                    families jsonb, sources jsonb, confirmed_by, confirmed_at, created_at
brand_assets        id, client_id, kind (logo|font|brand_book|post|video|website_capture), path, provenance jsonb,
                    native_px, sha256, created_at           -- one row per file the learner used
layout_families     id, client_id, profile_version, family_key, template jsonb (slots, bands, ground, devices),
                    source_post_ids text[], seen_count, kind (static|carousel|video_card)
design_runs         id, client_id, post_key, report_id, platform, format, copy, pillar, sizes jsonb,
                    status (queued|running|offered|picked|failed|dropped), lease_until, attempts,
                    budget jsonb, spent jsonb, plan jsonb, failure text, created_by, created_at, finished_at
design_options      id, run_id, client_id, rank, family_id, arrangement, files jsonb ({WxH: path}),
                    picture_jobs jsonb, measurements jsonb, status (offered|picked|rejected), rejection_note,
                    picked_iteration_id, created_at
design_rules        id, client_id, text, source_option_id, status (active|retired), created_at, retired_at
platform_specs      id, platform, placement, spec jsonb, source_url, fetched_at, snapshot_sha, previous_id
```

RLS: client members read their client's rows and may insert `design_runs` and update `design_options.status` for their client; everything else is the worker (service role). Restrictive client-scope guard as on the other tables.

## 12. Authorization

A new SQL helper `can_act_for_client(client_id)`: true for staff with write access and for a client-role member of that client. Used by the new tables' policies and by the new edge functions. `schedule-sprout-post` accepts it in place of `requireStaff` so client members schedule their own client's posts; the profile and report ownership checks stay. `can_write_client` is unchanged for everything else.

## 13. Screens

- Setup, "Your brand" (staff and client): evidence board, tokens with sources, logo variants, families over posts, imagery language, standing rules, upload controls, Confirm.
- Post panel, Design tab (client and staff): Create; progress; options grid per size; pick; rejected options ask for an optional note. Wording: "Create designs", "Your options", "Checks passed", "Use this one". The Schedule tab is open to client members for their client.
- Both in the Intercept design system (glass surfaces, Geist, lime primary action, one primary action per screen).

## 14. Worker and hosting

Node process on the Socialytics box (the host that serves the app on port 3003, deployed by `deploy.sh`, kept alive by `forever`). It polls `design_runs` with a lease (`for update skip locked`, same pattern as `scheduled_jobs`), runs one run at a time per process, writes progress to the run row, and reports `{"mode":"status"}` on an HTTP endpoint the existing n8n check can read. Secrets from the box environment: Supabase service key, Anthropic key, Higgsfield OAuth through the existing `integration_tokens` row. ffmpeg and Chromium installed on the box for video. Budgets: per run `max_turns` and `max_budget_usd` from `design_runs.budget`; a run that exceeds them is `dropped` with the reason and nothing is shown.

## 15. Costs (estimates, replaced by measured numbers in the proof)

| Output | Higgsfield | Model | Total |
|---|---|---|---|
| Static (3 options, platform sizes) | 12 to 25 credits | $0.80 to $2.50 | about $1.50 to $4 |
| Carousel (5 to 7 slides) | 20 to 45 credits | $1.50 to $4 | about $3 to $7 |
| Video (20 to 30 s, one or two b-roll clips) | 50 to 150 credits | $1 to $3 | about $4 to $12 |

Every run records `spent` (credits by job, model dollars by turn).

## 16. Legacy removal

After switchover, in one migration: drop `creative_directions`, `client_design_systems`, `design_learnings`, `design_states`, `media_jobs`; drop `clients.design_references`, `harvested_design_references`, `design_refs_harvested_at`, `design_style_synthesis`, `media_backend`; remove the `advance-creative-plans` cron; delete the edge functions `generate-post-image`, `generate-post-video`, `media-job-status`, `higgsfield-webhook`, `propose-design-angles`, `propose-carousel-slides`, `validate-design-output`, `adapt-creative-prompt`, `plan-social-creative`, `advance-creative-plan`, `get-creative-plan`, `agent-brief`, `record-design-feedback`, `synthesize-design-language`, `build-design-system`, `build-social-templates`, `read-social-template`, `render-design`, `preview-brand-design`, `higgsfield-probe`; remove `_shared/design-prompts`, `_shared/design-system`, `_shared/render`, `_shared/brand-references` (its Sprout fetch moves into the learner); remove `CreatePostDesignButton`, `CreatePostVideoButton`, `GenerationStages`, `GenerationContext`, `DesignEditor`, `DesignReferencesUpload`, `DesignSynthesisCard`, `AutomaticBrandReferences`, `useMediaBackend`, and the libs under `src/lib` they alone use; re-point the public API's design-system routes and demo steps to `brand_profiles`; update `docs/api/SOCIALYTICS-API.md`. `upload-generated-media`, `proxy-media`, `post-preview`, `higgsfield-auth`, `research-brand-identity` and `extract-brand-from-file` stay. Tests for removed code go with it.

## 17. Proof

Same package, run locally against the live database read-only and the two clients' Sprout posts.

1. Learner on Bader Law and LegaBot. Deliverable: one evidence board each.
2. Statics on six real calendar posts per client across their families and the platform's sizes. Deliverable: one sheet per client of passing designs, each with its measurements and family label. Credits: about 150 to 250 for both clients including retries; Lital said yes to this on 2026-10-08.
3. Carousels, then video, the same way, each with its own sheet and its own credit ask.

No product wiring starts before Lital's yes on step 2.

## 18. Testing

- Unit: the gate against the reference's fixtures ported from its calibration and QA runs (same inputs, same numbers), typesetting rules, family clustering, near-copy thresholds, reflow per size, RLS guards (PGlite), lease logic.
- Offline: the proof sheets are the integration test for the engine.
- Live: a run as a client-role user through the real screens into a scheduled Sprout post, before deploy.
- The existing Vitest suite and typecheck stay green on the branch; `scripts/smoke-prod.sh` after deploy.

## 19. Decisions taken on 2026-10-08

- Second proof client: LegaBot (LandGlide is not a Socialytics client).
- Posts come from Sprout only.
- Worker on the Socialytics box; client members schedule their own posts; Remotion for video; agent loop with a code gate; proof spend approved.
