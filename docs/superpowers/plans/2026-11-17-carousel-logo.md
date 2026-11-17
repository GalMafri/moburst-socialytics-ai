# One logo file per carousel: the plan as built

This is the final plan. It replaces the first version of this file (commit f44d1237), whose rule made a slide again when its ground hid the cover's file and whose cover waited at `finish` before its own checks. Section 11 says what changed and why.

File references are to the branch `qafix/carousel-logo`. Lines of unchanged code are those of `origin/main` at 7d41f07e.

## 0. Constraints

- No prompt text changes anywhere. `supabase/functions/_shared/canva/options.ts` and `supabase/functions/_shared/canva/brief.ts` stay byte-identical to main.
- No migration, no new table, no new column, no flag, no manual product step.
- No client named in code, comments, tests or fixtures. Tests use an invented brand ("Brand") and made-up colors.
- A single image, a video and a legacy video card behave exactly as today: same calls, same statements, same state keys, same file.
- The logo file is never redrawn. Only the existing files of the stamp list are used.
- Every decision rests on exact facts: the stamp list, the files' own ink colors, the measured ground pixel under a known rectangle.
- A carousel never loses a slide, an option or a request because of this rule. The worst the rule does is leave a slide as it was.

## 1. Behavior before the rule

**One job row per slide.** `startOption` builds every slide of an option from one `start` (`supabase/functions/_shared/canva/jobs.ts:195-225`), so all slides share `input.logo_path`, `input.logos` and `input.stamp`. Slides are tied by `design_request_id`, `option_index`, `slide_index`, `slide_count`. A single image has `slide_index` and `slide_count` null. A carousel has five slides (`CAROUSEL_SLIDES`, `_shared/canva/options.ts:108`).

**Cover and slides.** A slide after the cover waits in `generate` for the cover's `state.design_path` and keeps it as `state.cover_path`. A cover made again restarts its slides with `startAgain` (`_shared/design/coverDesign.ts`). Each slide row carries `state.for_cover`, and every write a run makes to a slide row is compared with it in the same UPDATE, so a run that lost its row cannot write.

**The choice, per slide.** In `marks` the service reads the ground under the slot (one pixel, `logoSlot.ts` `groundUnder`) and `pickStamp` picks on that one ground: files not marked `last` first; in a group, the first file with every whole part at 3:1, else the first with no whole part under 1.5:1. `stampOutcome` writes `logo_file`, `logo_named`, `logo_rect`, `logo_ground`, `logo_flat`, `logo_shows` on that slide's own state. `finish` stamps that file, `verify` checks the stamped picture (words, a Story's band, whether something touches the logo) and the job is done.

**The defect.** Nothing in this path read a sibling slide. Two slides with similar grounds could land on opposite sides of the 1.5:1 line (or the 3:1 line) and take different files, so one post showed the logo in two tones.

## 2. The rule

When one file shows on every slide's ground, the whole carousel is stamped with it: the first such file in the client's stamp order, by today's two lines (every whole part at 3:1 on every slide, else no whole part under 1.5:1 on any slide), with `last` files after the others as today. The weakest slide decides.

When no file shows on every slide's ground, the grounds really differ (light slides and dark slides), and a different ink per slide is what a designer would do. Each slide keeps the file its own ground took, as before the rule. The cover records that there is no one file (`by: "own"`).

Nothing is made again, stopped or failed for this rule. A single image is no carousel and runs today's code unchanged.

## 3. Shape of the solution

Every slide runs `marks`, `finish` and `verify` with its own file, exactly as today. A design that has to be made again (wrong words, something touching the logo) is therefore made again as early as it always was, and the image model is called no more often than today.

The agreement comes after a slide's own checks, where a single design is done:

- `marks` also keeps, for a carousel job, two facts the service computes for every listed file: its ink colors and the rectangle it would be stamped at in this slot (`logo_inks`, `logo_fits`), and the file the slide's own ground took (`logo_alone`).
- `verify`, once its checks have passed, notes that on the slide (`checks_passed`, the finished file that passed) and runs once more. That second run is the agreement, and it reads nothing again.
- The cover waits until every other slide's checks have passed for the cover design it is on, decides once, and keeps the decision on its own state (`carousel_logo`, keyed by its design path in `of`). The cover's run is the only writer of the cover's row.
- Every other slide waits until the cover's row holds a decision for the cover design the slide was drawn from. When no such decision can come any more it is done as it is.
- A slide whose own file is another than the carousel's is stamped again with the carousel's file by the picture service (the `finish` route, no model). What it did is kept on its state (`logo_follows`).

The decision is made from pictures that have all passed their checks, so nothing is made again after it, and it is made once for a cover design. All keys above are in `OF_THE_DESIGN` and go when a design is made again.

## 4. What was built

### 4.1 `supabase/functions/_shared/design/logoSlot.ts`

- `pickStampOn(files, grounds)`: `pickStamp`'s order and two lines, each held on every ground. `shows` is each file's weakest whole part on its weakest ground, to two places.
- `pickStamp(files, ground)` delegates to `pickStampOn(files, [ground])`. With one ground the answer is the earlier one, field for field (tested against a copy of the earlier body).
- `carouselStamp(files, grounds)`: `{ file, by: "every" }` when a file shows on every ground, else `{ file: null, by: "own" }`, with the same `shows`.

### 4.2 Service answer, additive

`_shared/picture/contract.ts`, `SlotFileResult` gains `inks` (each listed file's whole exposed ink colors, `wholeInksOf`) and `fits` (where each listed file would be stamped in this slot, `fitRect`). `server/src/picture/slot.ts` answers both in `slotFileSteps`. No request field, no schema change, no route change. The worker needs them because `logo_shows` is rounded to two places and because a brand's own second file can have another shape than the stored file.

### 4.3 `supabase/functions/_shared/design/modelSteps.ts`

`OF_THE_DESIGN` gains `logo_inks`, `logo_fits`, `logo_alone`, `checks_passed`, `logo_follows`, `carousel_logo`.

`_shared/design/logoChoice.ts` is unchanged from main. There is no reason text for the rule, because the rule never makes a design again.

### 4.4 `supabase/functions/_shared/design/carouselLogo.ts` (new)

Free of Deno and network imports. The worker hands in its two reads, its save and its two picture calls (`AgreeDeps`), so the tests run the whole agreement over plain rows.

- `inCarousel(job)`: `slide_count > 1`, a `design_request_id`, and `input.kind` other than `video_card`.
- `slotFacts(answer)`: `logo_inks`, `logo_fits`, `logo_alone`; null when the service answered no facts.
- `OF_THE_MEASUREMENT` and `measuredAgain(state)`: the keys one measurement of the cleaned slot leaves (`logo_ground`, `logo_flat`, `logo_shows`, `logo_clean`, `logo_inks`, `logo_fits`, `logo_alone`), cleared when a carousel's slide is measured again. `stampOutcome` keeps a ground only when there is one, so without this a measurement with no ground left the older ground for the decision to read.
- `siblingStands(row, coverDesign)`: `over` for a failed or canceled row; `ready` for a done row, whatever it holds, and for a row drawn from this cover design whose `checks_passed` is set; `waits` otherwise.
- `decideCarousel(cover, siblings, expected, files)`: `over` when a sibling is over; `wait` with fewer rows than expected or a sibling that waits; else the decision. The grounds are the cover's own and those of siblings read for this cover design with the files' facts. The candidates are the job's listed files that have inks in the cover's answer, with their `last` flags. The decision is `{ of: cover.design_path, by, file?, shows, grounds }`.
- `coverDecision(cover, coverPath)`: `decided` when the cover's row holds a decision whose `of` is the slide's `cover_path`; `never` when the cover is gone, failed, canceled, done without one, or on another design; `wait` only for a cover that is alive, on that design and has not decided.
- `followCarousel(state, logo, files)`: `keep` with why (`own`: no one file; `same`: the slide has it; `unlisted`: the job does not list the file or has no rectangle for it; `hidden`: the slide's ground hides a whole part of it, under 1.5:1), else `stamp` with the file, its path and `logo_fits[file]` as the rectangle, and `recheck` when that rectangle is another than the one the slide's checks saw. There is no outcome that makes a design again.
- `agreeOnLogo(job, files, deps)`: the whole agreement. It answers `"done"` or `"wait"` and nothing else.

### 4.5 `supabase/functions/design-worker/index.ts`

- `marks`: for a carousel job, `measuredAgain(s)` as soon as the slot's answer is in hand, and the slide's facts kept beside `stampOutcome`'s state. A service that answers no facts is logged and not waited for.
- `finish`: unchanged in what it does. Its one call to the picture service moved into `stampLogo`, which the agreement uses too.
- `verify`: one line at the top (a carousel slide whose `checks_passed` is set goes to the agreement) and three at the end (where a single design returns `"done"`, a carousel slide sets `checks_passed` and returns `"next"`). The checks between them are untouched.
- `agreeOnLogo` (the worker's adapter): the two reads of the option's rows, `saveJobProgress`, `stampLogo` after a lease renewal, and `logoClearAt`, the `verify` step's own look at the area around the logo for a slide stamped again at another rectangle.

## 5. Decisions inside the agreement

1. **A slide measured again after the decision** (the only way is a design dropped as stale for its page size, since every check precedes the decision). It follows the decision the cover's row holds. If its new ground hides the carousel's file it keeps its own file (`kept: "hidden"`). The decision is not taken again: the cover may be done, and the other slides are delivered with the decided file. This always ends and always delivers.
2. **A file of another shape.** The slide's checks saw its own file's rectangle. Stamped again at another rectangle, the area around the logo is read once more (one picture read, one reading-model call). When something touches the logo there, the slide stays as it passed its checks (`kept: "touched"`).
3. **A second stamp or look that fails**, for any reason, leaves the slide done with the finished picture it has (`kept: "unstamped"`). The state is changed only once the new picture is stamped and looked at, so a run that stops in between leaves the slide as it was.
4. **A slide failed or was canceled.** The option is over. The cover is done as it is, as it would have been before the rule.
5. **The decision is saved before it is used**, so no slide can read a decision the cover's row does not hold. A save that fails is no decision: the cover waits and decides again from the same rows.
6. **A slide that settled** has `logo_follows`, and a run that comes back after it does nothing more.

## 6. Every wait and what ends it

The rule adds two waits. Neither spends a try, both release the lease, and the per-minute tick hands the job out again.

| Who waits | For what | What ends it |
|---|---|---|
| The cover, at `verify` with `checks_passed` | every other slide's checks to pass for this cover design | each sibling goes on by itself to one of: checks passed (ready), done (ready, whatever its row holds), failed or canceled (the cover is done as it is). A sibling whose row is for another cover design is either started again and comes through its own checks, or ends by itself (next row) and is then done. |
| A slide, at `verify` with `checks_passed` | the cover's decision for the slide's `cover_path` | the cover decides (follow it); the cover is made again (this slide's row is started again); the cover is gone, failed, canceled, done without a decision, or on another design (done with its own file). |
| Either, for one pass | a read of the option's rows that failed | the next pass reads again. |

Waits that existed before are unchanged: a slide in `generate` for the cover's design, a busy image model, an unavailable picture service. The request's 90-minute limit is unchanged and is no longer the end of any wait of this rule.

A slide measured without the files' facts (a service or a worker from before the rule) waits for nothing: it is done with its own file, and it adds no ground to the cover's decision.

## 7. Image calls

Image model calls (the paid ones) are `generate` and `unlogo`, one each per design.

| Case | main | first version (f44d1237) | as built |
|---|---|---|---|
| A clean 5-slide carousel | 10 | 10 | 10 |
| The cover made again once for words | 12 + w | 20 | 12 + w |

`w` is what the four slides had drawn from the cover's first design when the cover's `verify` failed, between 0 and 8. The cover is one removal ahead of its slides, so `w` is usually the four designs, made or in flight, and few removals. The first version held the cover's `verify` back until all four slides had passed `marks`, so `w` was always 8. As built, the cover's `finish` and `verify` run where they always did.

Added calls with no image model: one more `finish` call for each slide whose own file is another than the carousel's (none when the slides agree or when there is no one file), and for a file of another shape one more `read` call and one reading-model call for that slide.

## 8. Deploy order

1. Push to main. Vercel serves the picture service with `inks` and `fits`. The deployed worker ignores them.
2. Check that no carousel is in flight: `select count(*) from canva_finish_jobs where status in ('queued','running') and slide_count > 1;` should be 0.
3. Deploy `design-worker`. No other edge function needs redeploying: `design-request`, `video-worker`, `api` and `run-scheduled-jobs` reach the changed modules only through `contract.ts` types.

Nothing depends on this order for safety. A worker deployed before the service finds no facts and delivers every slide with its own file, as before the rule. A carousel caught mid-flight in step 2 cannot wait for a decision that will not come (section 6); it is delivered as before the rule, and may show two files, which is why step 2 exists. Rolling the worker back alone is safe: the old worker reads a waiting slide's finished file again and is done with the slide's own file.

## 9. Tests (invented brand and colors only)

- `supabase/tests/_shared/design/logoSlot.test.ts`: `pickStamp` and `pickStampOn` on one ground against a copy of the earlier body, for every existing case and a sweep of grounds; five grounds with one hiding ground; the 3:1 line across grounds; `last` at both lines; no common file gives `by: "own"` and no file; `shows` is the per-file minimum.
- `supabase/tests/_shared/design/carouselLogo.test.ts`: `inCarousel`; `slotFacts`; a measurement taken again leaves no older ground; `siblingStands`; `decideCarousel`; `coverDecision`; `followCarousel`; the agreement run over whole carousels of rows (one file for five slides, slides that already agree, light and dark slides, a decision made once, another shape and a touched logo, a failed second stamp, a failed save, failed reads); every state in which a decision can no longer arrive; a sweep of 8 cover states by 45 pairs of slide states in 3 hand-out orders in which every active job must end done; and the worker's `marks`, `finish`, `verify` and agreement read as source, since `design-worker/index.ts` cannot be imported outside Deno.
- `supabase/tests/_shared/design/coverDesign.test.ts`: a slide's wait at the agreement lands only while `for_cover` matches.
- `supabase/tests/_shared/design/modelSteps.test.ts`: `runGenerate` clears the six keys.
- `supabase/tests/_shared/design/logoChoice.test.ts`: `stampOutcome` keeps the same state keys for a single design when the answer carries the two new fields.
- `server/test/routes.test.ts`: `slot-file` answers `inks` and `fits` for every listed file, whichever is named.
- `supabase/tests/_shared/picture/contract.test.ts`: the result type compiles with the two fields.

## 10. Risks, and what a real carousel must show

**Risks.**
- Pass capacity. Waiting jobs are due every tick, and a pass takes 12 due jobs by `created_at`. A carousel has five jobs, so the oldest option always fits in one pass and goes on; several carousels waiting on one slow slide can hold newer jobs back for longer than slides waiting on a cover do today.
- One pixel decides for all. The ground is one pixel per slide. One slide just under 1.5:1 moves the whole carousel to the next file. That is the approved rule.
- Latency. The option is ready one to two ticks after its last slide's checks pass: one for the cover to decide, one for the slides to follow.
- A slide that could not take the carousel's file (`hidden`, `touched`, `unstamped`, `unlisted`) is delivered with its own, so such a carousel can still show two files. Each case is on the slide's row.

**A real carousel's job rows.**
- Every slide has `state->>'checks_passed'` and `state->>'logo_alone'`. The cover has `state->'carousel_logo'` with `of` equal to its `state->>'design_path'`.
- `by` is `every`: all slides have the same `logo_named` and `logo_file`, equal to `carousel_logo.file`. A slide whose `logo_alone` is another file has `logo_follows = { of, file }`, a `final_path` other than its `checks_passed`, and `logo_rect` equal to `logo_fits[file]`. A slide that already had the file has `logo_follows.kept = "same"` and `final_path` equal to `checks_passed`.
- `by` is `own` (light and dark slides): `carousel_logo` has no `file`; every slide has `logo_named` equal to `logo_alone`, `logo_follows.kept = "own"` and `final_path` equal to `checks_passed`.
- For five similar photo grounds and a two-color logo: `by` is `every`, and `carousel_logo.shows` explains the file.
- `output_path` equals `state->>'final_path'` on every slide.
- No `state->'redesigns'` entry comes from this rule: it has no reason text.
- A single image made after the deploy has none of `logo_inks`, `logo_fits`, `logo_alone`, `checks_passed`, `logo_follows`, `carousel_logo`.

## 11. What changed from the first version, and why

- **No common file.** The first version stamped the cover's file on every slide and made a slide again when its ground hid it. A carousel of light and dark slides could then spend its three designs and end a request that used to deliver. Each slide now keeps its own file, and the rule makes nothing again.
- **The cover's checks.** The first version decided at the top of `finish`, so the cover's `verify` ran only after all four slides had been drawn and cleaned, and a cover made again for its words threw all of that away. The agreement now comes after each slide's own `verify`.
- **Deadlock at deploy.** A slide could wait at `finish` for a decision from a cover that an older worker had already finished. Every state in which no decision can come now ends the wait.
- **Stale ground.** A slide measured again with no ground kept the older `logo_ground`. A carousel's slide now clears its measurement when it is measured again.
- **No wait for the service.** The first version made a carousel slide wait at `marks` for a service that did not answer the files' facts. It now goes on with its own file.
- Kept from the first version: `pickStampOn`, the service's two fields, a read of the cover's row that fails is a wait and never a stop, and a row at a step of an older method counts as still on its way.
