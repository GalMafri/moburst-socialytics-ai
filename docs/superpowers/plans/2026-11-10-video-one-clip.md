# Video Posts, One Paid Clip Per Video: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A video post buys exactly one clip from Higgsfield, at the price the person approved, from references that carry no text, with everything that can fail done before the clip is ordered.

**Architecture:** The video worker (`video-worker`, steps in `_shared/video/steps.ts`) gets a straight step list: kit (once per client), title, frame, clip, assemble. The client's style kit is a set of the client's own video stills with text removed, made by the image edit the design worker already uses and stored on `clients.video_style.kit`. The clip is ordered once, with the approved price recorded on the request and the order recorded in the job's state before the call. The week quote reads Higgsfield's live price for the fixed clip settings.

**Tech Stack:** Supabase edge functions (Deno), Postgres (PGlite in tests), Higgsfield MCP (Seedance 2.5), OpenAI image edits, vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-video-one-clip-design.md` (approved by Lital 10 Nov 2026).

## Global Constraints

- Every clip has fixed settings: Seedance 2.5 (`VIDEO_MODEL`), 8 seconds, 1080p, 9:16, sound on, `start_image` = the opening frame, `image_references` = the kit stills, no `video_references`. Briefs no longer choose a length.
- A video job orders at most one paid clip. The order (`state.clip_order`) is saved to the database before the call to Higgsfield; a step that finds `state.clip_order` never submits again, whatever the worker's retry count.
- The approved price for a video is the live `get_cost` price read at the week press (or at a single post's request) and stored as `design_requests.approved_credits`; the clip step orders only when the live price at that moment is `<=` the approved price.
- Nothing orders a second clip: not a slow clip, not a silent clip, not writing, not a provider failure. Each of those ends the video as not made with a plain reason, and the week's button counts the post again at the next press (existing `weekDecision` rule).
- The kit: up to 6 stills (`KIT_MAX`), at least 2 (`KIT_MIN`); fewer means `video_style.kit = []` and the client's videos take the posts route. The client's `scene_words` stay allowed in the kit, the frame and the clip. `generatable: false` keeps its one meaning (the style needs filming).
- Removed, not kept behind a flag: the `references`/`references_wait` steps and `clipScript`, the `clean`/`clean_wait` steps and `editVideo`/`quoteEdit`, `MAX_FOOTAGE`, `MAX_CLEANS`, `FOOTAGE_WAIT_MS`, `creditsPerClip`, `CLIP_CREDITS`.
- Client-facing text (every `FINAL:` reason, the quote screen): plain American English, no em or en dashes, no developer words, no ids.
- No credits are spent by any task's tests. The quality check (Task 7) runs only after Lital says yes to its credits.
- Tests live under `supabase/tests/` at the code's path; `supabase/functions/_shared/api/` is untouched; `deno check --no-lock` passes for every touched function; the packaging test stays green.

## Review Focus

- A pass retried after an error at the clip step, or a function killed between the order record and Higgsfield's answer, must never buy a second clip. (Task 1 test `clipOrderDecision` with `clip_order` present.)
- Higgsfield's price above the approved price at order time stops the video with the price reason; equal or lower orders. (Task 1 test.)
- A week press when the price cannot be read starts the stills and skips the video posts with a plain reason; nothing is quoted from history. (Task 2 test.)
- A client whose stills cannot be cleaned gets `kit = []`, its video takes the posts route, and the next video for that client does not run the kit again. (Task 3 test `kitState`, Task 4.)
- The client's own scene words survive: the kit cleaning prompt names them, and the writing check on the frame and the finished clip allows them. (Task 3 test, Task 5 step.)

---

### Task 1: The fixed clip, its live price and the one-order rule

**Files:**
- Create: `supabase/functions/_shared/video/clip.ts`
- Modify: `supabase/functions/_shared/video/credits.ts` (remove `creditsPerClip`, `CLIP_CREDITS`; keep `CLIP_CREDIT_FLOOR`, `withCredits`, `creditsUsed`)
- Test: `supabase/tests/_shared/video/clip.test.ts`, `supabase/tests/_shared/video/credits.test.ts`

**Interfaces:**
- Consumes: `VideoRequest`, `quoteVideo`, `VIDEO_MODEL` from `_shared/higgsfield/generate.ts`.
- Produces:
  - `export const CLIP = { aspect: "9:16", seconds: 8, resolution: "1080p", withAudio: true } as const;`
  - `export function clipRequest(prompt: string, startImageId: string | null, referenceIds: string[]): VideoRequest` (model `VIDEO_MODEL`, the `CLIP` settings, `videoReferenceIds` never set).
  - `export const QUOTE_PROMPT = "A short brand clip.";` and `export function quoteClip(mcp: ToolCaller): Promise<number | null>` = `quoteVideo(mcp, clipRequest(QUOTE_PROMPT, null, []))`.
  - `export interface ClipOrder { price: number | null; at: string; job_id?: string }`
  - `export type ClipDecision = { action: "order" } | { action: "wait" } | { action: "stop"; reason: string };`
  - `export function clipOrderDecision(state: { clip_order?: ClipOrder | null }, approved: number | null, live: number | null, balance: number | null): ClipDecision`
  - `export const REASONS` with exactly these strings: `price: "The video's price went up since it was quoted. Press again to make it at the new price."`, `lostOrder: "The clip's order was lost before it was confirmed. Press again to make it."`, `balance: "The video account is out of credits."`, `provider: "The video service could not make the clip."`, `lost: "The video service did not finish the clip."`, `silent: "The clip came back without sound."`, `writing: "The clip shows writing of its own, so it was not used."`, `frame: "The video's opening shot could not be drawn to the brand's rules."`, `quote: "The video's price could not be read, so the clip was not ordered. Press again later."`.
  - `export const QUOTE_WAIT_MS = 30 * 60_000;` (how long the clip step keeps waiting for a readable price before it stops with `REASONS.quote`).

- [ ] **Step 1: Write the failing tests** in `clip.test.ts`:

```ts
it("fixes every clip's settings and never passes video references", () => {
  const r = clipRequest("prompt", "frame-1", ["k1", "k2"]);
  expect(r).toMatchObject({ prompt: "prompt", aspect: "9:16", seconds: 8, resolution: "1080p", withAudio: true, model: VIDEO_MODEL, startImageId: "frame-1", referenceIds: ["k1", "k2"] });
  expect(r.videoReferenceIds).toBeUndefined();
});
it("orders once, at or under the approved price", () => {
  expect(clipOrderDecision({}, 128, 128, 1000)).toEqual({ action: "order" });
  expect(clipOrderDecision({}, 128, 120, 1000)).toEqual({ action: "order" });
  expect(clipOrderDecision({}, 128, 144, 1000)).toEqual({ action: "stop", reason: REASONS.price });
  expect(clipOrderDecision({}, null, 128, 1000)).toEqual({ action: "stop", reason: REASONS.price });
  expect(clipOrderDecision({}, 128, null, 1000)).toEqual({ action: "wait" });
  expect(clipOrderDecision({}, 128, 128, 100)).toEqual({ action: "stop", reason: REASONS.balance });
  expect(clipOrderDecision({}, 128, 128, null)).toEqual({ action: "order" });
});
it("never orders again once an order is recorded", () => {
  expect(clipOrderDecision({ clip_order: { price: 128, at: "x", job_id: "j" } }, 128, 100, 1000)).toEqual({ action: "wait" });
  expect(clipOrderDecision({ clip_order: { price: 128, at: "x" } }, 128, 100, 1000)).toEqual({ action: "stop", reason: REASONS.lostOrder });
});
```

  In `credits.test.ts`, delete the tests of `creditsPerClip` and `CLIP_CREDITS`; keep the rest.

- [ ] **Step 2: Run** `npx vitest run supabase/tests/_shared/video/clip.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `clip.ts`** as in Interfaces. `clipOrderDecision`: an existing `clip_order` with `job_id` is "wait", without it "stop lostOrder"; a null `live` is "wait" (Higgsfield's quote could not be read this pass); a `balance` below `CLIP_CREDIT_FLOOR` is "stop balance"; a null `approved` or `live > approved` is "stop price"; else "order". Remove `creditsPerClip` and `CLIP_CREDITS` from `credits.ts`.

- [ ] **Step 4: Run** `npx vitest run supabase/tests/_shared/video`. Expected: PASS. (`week.ts` still imports `creditsPerClip`; that is fixed in Task 2, so run only this folder here.)

- [ ] **Step 5: Commit** `git commit -m "Video: the fixed clip, its live price and the one-order rule"`.

### Task 2: The quote is the price, and the price is approved on the request

**Files:**
- Create: `supabase/migrations/20261111130000_video_approved_price.sql` (`alter table public.design_requests add column if not exists approved_credits numeric;` with a comment: the Higgsfield price for the video's one clip, approved at the press, held by the clip step)
- Modify: `supabase/functions/design-request/week.ts` (`WeekDeps`, `weekPreview`, `weekStart`, `estimateOf`, `clipCredits` removed), `supabase/functions/design-request/index.ts` (`weekDeps` gains `quoteClip`; `startRequest` takes and stores `approvedCredits`; `startWeekPost` passes the run's price), `supabase/functions/_shared/canva/jobs.ts` (`startVideoOption`: `input.approved_credits`, no `video_refs`, `video: { prompt }`)
- Test: `supabase/tests/design-request/week.test.ts`, `supabase/tests/migrations/videoApprovedPrice.test.ts`

**Interfaces:**
- Consumes: `quoteClip` from Task 1.
- Produces: `WeekDeps.quoteClip(): Promise<number | null>`; `weekPreview` body gains nothing new but `credits_per_clip` is now the live price and `credits` is `counts.video x price`, both `null` when the price could not be read; `weekStart` skips video posts when the price is null, recording each with `state: "skipped"`, `why: "The video price could not be read. Press again to make the videos."`; `design_week_runs.estimate.credits_per_clip` is kept by `estimateOf`; `startRequest(..., p: { ...; approvedCredits?: number | null })` stores `design_requests.approved_credits`; a video job's `input.approved_credits: number | null`.

- [ ] **Step 1: Write the failing tests.** In `week.test.ts` replace the two "clips recorded so far" fixtures with `quoteClip: async () => 128` in the fake deps and assert `credits: 128, credits_per_clip: 128` for one video post; add `it("skips the video posts and says so when the price cannot be read", ...)` with `quoteClip: async () => null`: the still posts start, the video post's run entry is `{ state: "skipped", why: "The video price could not be read. Press again to make the videos." }`, `credits_per_clip` is null; add `it("passes the approved price to each video post it starts", ...)` asserting `startPost` was called with `approvedCredits: 128`. In `videoApprovedPrice.test.ts` (PGlite, like `supabase/tests/migrations/moburstUsersSeeAllClients.test.ts`): the column exists, is nullable, and the migration applies twice.
- [ ] **Step 2: Run** `npx vitest run supabase/tests/design-request/week.test.ts supabase/tests/migrations/videoApprovedPrice.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `week.ts`: remove `clipCredits` and the `creditsPerClip` import; `weekPreview` and `weekStart` call `d.quoteClip()` once; `estimateOf` adds `"credits_per_clip"` to its key list; `weekStart` passes `approvedCredits: price` into `startPost`. `index.ts`: `weekDeps.quoteClip` uses the same Higgsfield client `balance()` uses and Task 1's `quoteClip`; `startRequest` writes `approved_credits: p.approvedCredits ?? null`; a single post's request (the `create` action) reads the live price the same way before `startRequest` when the request's kind is `video` and no `approvedCredits` was passed, and leaves it null for stills. `jobs.ts`: `startVideoOption` sets `approved_credits: req.approved_credits ?? null`, drops `video_refs`, and `video: { prompt: brief.footage ?? brief.picture }`.
- [ ] **Step 4: Run** the two tests, then `deno check --no-lock supabase/functions/design-request/index.ts`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `git commit -m "Video: the week quote is Higgsfield's live price, approved on each request"`.

### Task 3: One image edit for both workers, and the kit's rules

**Files:**
- Create: `supabase/functions/_shared/openai/key.ts`, `supabase/functions/_shared/image/edit.ts`, `supabase/functions/_shared/video/kit.ts`
- Modify: `supabase/functions/design-worker/index.ts` (its private `imageEdit` and `openaiKey` become imports), `supabase/functions/canva-finish/index.ts` and `supabase/functions/_shared/video/steps.ts` (their private `openaiKey` becomes the import)
- Test: `supabase/tests/_shared/video/kit.test.ts`

**Interfaces:**
- Produces:
  - `export async function openaiKey(admin: any): Promise<string>` in `key.ts` (the body of `design-worker`'s, which reads the environment then `app_settings`; the three copies must agree before you merge them: compare and keep the most complete).
  - `export async function imageEdit(apiKey: string, images: { bytes: Uint8Array; name: string }[], prompt: string, size: [number, number], mask?: Uint8Array): Promise<Uint8Array>` in `edit.ts`: the body of `design-worker`'s `imageEdit` with the key passed in.
  - In `kit.ts`: `export const KIT_MAX = 6; export const KIT_MIN = 2;` `export function kitPath(clientId: string, i: number): string` (`${clientId}/style/kit-${i}.jpg`); `export function kitPickPrompt(brand: string, count: number, max: number): string` (asks for the indexes, 0-based, of up to `max` stills that best show the brand's look, as a JSON array); `export function parseKitPick(text: string, count: number, max: number): number[] | null` (unique, in range, at most `max`); `export function kitCleanPrompt(brand: string, sceneWords: string[]): string` (remove captions, subtitles, lettering, logos, watermarks and screens, keep everything else; names in `sceneWords` stay, spelled exactly); `export type KitState = "missing" | "ready" | "none"`; `export function kitState(videoStyle: unknown): KitState` (`missing` when `kit` is absent, `ready` when it has at least `KIT_MIN` paths, `none` when it is an array with fewer); `export function kitPaths(videoStyle: unknown): string[]`.

- [ ] **Step 1: Write the failing tests** in `kit.test.ts`: `kitState(undefined)` is "missing"; `kitState({ kit: ["a", "b"] })` is "ready"; `kitState({ kit: [] })` and `kitState({ kit: ["a"] })` are "none"; `parseKitPick("[3, 0, 3, 9]", 8, 6)` is `[3, 0]`; `parseKitPick("no", 8, 6)` is null; `kitCleanPrompt("Pay The Pyper", ["PAY THE PYPER"])` contains `"PAY THE PYPER"` and the words `captions`, `subtitles`, `logos`; with no scene words it says no lettering stays.
- [ ] **Step 2: Run** `npx vitest run supabase/tests/_shared/video/kit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three new modules; replace the private copies in `design-worker/index.ts`, `canva-finish/index.ts` and `steps.ts` with imports, changing no behavior.
- [ ] **Step 4: Run** the test, then `deno check --no-lock` on `supabase/functions/design-worker/index.ts`, `supabase/functions/canva-finish/index.ts`, `supabase/functions/video-worker/index.ts`. Expected: PASS, exit 0 (the two functions that already had deno type errors before this plan, if any, show the same errors and no new ones; note them in the report).
- [ ] **Step 5: Commit** `git commit -m "Video: one image edit for both workers, and the kit's rules"`.

### Task 4: The kit steps

**Files:**
- Modify: `supabase/functions/_shared/video/steps.ts` (new steps `kit`, `kit_wait`; `hold`; the style job runs them after `style_read`), `supabase/functions/video-worker/index.ts` (`"held"` result), `supabase/functions/_shared/canva/jobs.ts` (`startVideoOption` routes by `kitState`)
- Test: `supabase/tests/_shared/video/kit.test.ts` (the route decision)

**Interfaces:**
- Consumes: Task 3's `kit.ts`, `imageEdit`, `openaiKey`; `footageTextPrompt`/`parseFootageText` from `_shared/video/compose.ts`; `anthropicMessages` from `_shared/anthropic.ts`.
- Produces: `VideoStepResult` gains `"held"`; `function hold(admin, job, work: () => Promise<void>): VideoStepResult` in `steps.ts`, the same shape as `design-worker`'s (lease extended by `MODEL_LEASE_MS = 10 * 60_000`, state saved, work run under `EdgeRuntime.waitUntil`, `error` cleared on success, `recordFailure` on error); `export function videoRouteFor(videoStyle: unknown, requested: string | null): string | null` in `kit.ts`: `"posts"` when `kitState` is `"none"`, else `requested`; `clients.video_style.kit: string[]` written by the kit step (`[]` when fewer than `KIT_MIN` stills clean), and `video_style.kit_at` ISO time.

- [ ] **Step 1: Write the failing tests:** `videoRouteFor({ kit: [] }, null)` is "posts"; `videoRouteFor({ kit: ["a", "b"] }, null)` is null; `videoRouteFor({ kit: [] }, "posts")` is "posts"; `videoRouteFor(undefined, null)` is null (missing: the kit is made first, not routed around).
- [ ] **Step 2: Run** `npx vitest run supabase/tests/_shared/video/kit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `steps.ts`: `case "kit"`: when another job already holds `video_style.kit_started_at` under 15 minutes old, return "wait"; else write `kit_started_at`, pick stills with the vision model (`kitPickPrompt` over the stored `video_style.frames`, `parseKitPick`), then `hold` the cleaning: for each picked still, `imageEdit` with `kitCleanPrompt(brand, scene_words)`, then read it back with `footageTextPrompt(scene_words)`; a still that still shows writing is cleaned once more, then dropped; store the clean ones at `kitPath`, write `video_style.kit` (the paths, or `[]` with fewer than `KIT_MIN`) and `kit_at`, clear `kit_started_at`; `job.step = "kit_wait"`. `case "kit_wait"`: "wait" while the hold runs; when `video_style.kit` exists: a video job goes on to `title` (or switches to the posts route when `kitState` is "none": `input.video_route = "posts"`, no kit references); the style job finishes.
  - `runStyleStep` `style_read`: `job.step = "kit"` instead of finishing.
  - `runVideoStep`: a video job whose client's `kitState` is "missing" and whose route is not "posts" and that has no `footage_upload` starts at `kit`.
  - `video-worker/index.ts`: a `"held"` result leaves the row as the hold saved it (no step/state/lease write); `advanced++`.
  - `jobs.ts` `startVideoOption`: `video_route: videoRouteFor(client?.video_style, req.video_route)` in the input; the posts route still takes nothing from the filmed videos.
- [ ] **Step 4: Run** the test and `deno check --no-lock supabase/functions/video-worker/index.ts`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `git commit -m "Video: the client's style kit, made once from its own stills"`.

### Task 5: One video, in order: title, frame, clip, assemble

**Files:**
- Modify: `supabase/functions/_shared/video/steps.ts`, `supabase/functions/_shared/video/compose.ts` (remove `clipScript`, `parseClipped`, `REFERENCE_SECONDS`), `supabase/functions/_shared/higgsfield/generate.ts` (remove `editVideo`, `quoteEdit`, `editParams`), `supabase/functions/_shared/canva/options.ts` (`DESIGNING_STEPS`), `supabase/functions/_shared/canva/jobs.ts` (`startVideoOption` first step)
- Create: `supabase/migrations/20261111130100_video_worker_steps.sql` (re-schedule cron `video-worker` with `step in ('kit', 'kit_wait', 'title', 'title_check', 'frame', 'frame_check', 'clip', 'clip_wait', 'assemble', 'assemble_wait', 'transcribe', 'transcribe_wait', 'style_cut', 'style_wait', 'style_read')`, same body as `20261014120000_video_worker_schedule.sql` otherwise)
- Test: `supabase/tests/_shared/video/compose.test.ts` (drop the clip script tests), `supabase/tests/_shared/video/steps.test.ts` (new, pure parts), `supabase/tests/migrations/videoWorkerSteps.test.ts`

**Interfaces:**
- Consumes: Task 1's `clipRequest`, `quoteClip`, `clipOrderDecision`, `REASONS`, `withCredits`; Task 3's `imageEdit`, `openaiKey`; Task 4's `hold`, kit paths.
- Produces: `VIDEO_STEPS = ["kit", "kit_wait", "title", "title_check", "frame", "frame_check", "clip", "clip_wait", "assemble", "assemble_wait", "transcribe", "transcribe_wait"]`; `export function clipOutcome(o: { status?: string; error?: string | null; result_url?: string | null } | undefined, startedAt: number, now: number): "running" | "ready" | "failed" | "lost"` (`lost` after `CLIP_LOST_MS = 3 * 60 * 60_000`); `export function framePrompt(brief: string, rules: string): string`; the order of steps for a video job: `kit`? then `title`, `title_check` (skipped when `input.copy` is empty, as today), `frame`, `frame_check`, `clip`, `clip_wait`, `assemble`, `assemble_wait`; for a filmed clip (`footage_upload`): `transcribe`, `transcribe_wait`, `title`, `title_check`, `assemble`, `assemble_wait`.

- [ ] **Step 1: Write the failing tests** in `steps.test.ts`: `VIDEO_STEPS` equals the list above and contains none of `references`, `footage`, `hook`, `compose`, `clean`; `clipOutcome({ status: "completed", result_url: "u" }, 0, 1)` is "ready"; `{ status: "failed" }` is "failed"; `{ status: "running" }` at 1 hour is "running" and at 4 hours is "lost"; `undefined` at 4 hours is "lost"; `framePrompt("a shrimp frying", "RULES")` contains both and the words `opening frame` and `9:16`. In `videoWorkerSteps.test.ts` (PGlite with a `cron` stub schema as in the other cron migration tests, or a text test that the migration names every `VIDEO_STEPS` entry): the migration's step list equals `VIDEO_STEPS` plus the style steps.
- [ ] **Step 2: Run** `npx vitest run supabase/tests/_shared/video supabase/tests/migrations/videoWorkerSteps.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `steps.ts`.**
  - Rename `hook`/`hook_check` to `title`/`title_check` and `compose`/`compose_wait` to `assemble`/`assemble_wait`; delete `references`, `references_wait`, `footage`, `footage_wait`, `clean`, `clean_wait`, `MAX_FOOTAGE`, `MAX_CLEANS`, `FOOTAGE_WAIT_MS`, the `clipScript` use and `importReferences(..., "video")`.
  - A job at a step not in `VIDEO_STEPS` (and not a style step) throws `FINAL: This video was started before the video update. Press again to make it.`
  - `title_check` goes on to `frame` (or `assemble` for a filmed clip).
  - `frame`: `hold`; `imageEdit(apiKey, kit stills as images, framePrompt(input.video.prompt, footageRules(input.people, input.scene_words)), pictureSize([VIDEO_SIZE.width, VIDEO_SIZE.height]))`; on the posts route (no kit) the same call with no images becomes an `images/generations` call like the title's; store at `${base}/frame-${n}.png`, `s.frame_path`; `s.frames = (s.frames ?? 0) + 1`, `MAX_FRAMES = 3`, over it `FINAL: ` + `REASONS.frame`.
  - `frame_check`: read the frame with `footageTextPrompt(input.scene_words)` and `marksPrompt(input.brand_name)`; either positive deletes `s.frame_path` and returns to `frame`; clean goes to `clip`.
  - `clip`: `balance` = `creditBalance(mcp)` (exists), `live` = `quoteClip(mcp)`, `clipOrderDecision(s, input.approved_credits, live, balance)`: "wait" records `s.quote_waiting_since` (first time) and returns "wait", or throws `FINAL: ` + `REASONS.quote` once `QUOTE_WAIT_MS` has passed; "stop" throws `FINAL: ` + reason; "order": write `s.clip_order = { price: live, at }` to the database with `admin.from("canva_finish_jobs").update({ state })` before anything else; import the frame and the kit stills with `importReferences(mcp, urls, "image")` (ids kept in `s.frame_ref_id`, `s.kit_ref_ids` so a retried pass reuses them); `submitVideo(mcp, clipRequest(prompt + footageRules(...), s.frame_ref_id, s.kit_ref_ids))`; then `s.clip_order.job_id`, `s.clip_job`, `s.credits = withCredits(s.credits, { what: "footage", job_id, credits: live, at })`, `s.clip_started_at`; `job.step = "clip_wait"`; return "wait" (the pass ends here, never runs on).
  - `clip_wait`: `awaitJobs` with `budgetMs: 0`; `clipOutcome`: "running" waits; "failed" throws `FINAL: ` + `REASONS.provider`; "lost" throws `FINAL: ` + `REASONS.lost`; "ready" stores the file at `${base}/clip.mp4` as `s.footage_path` and goes to `assemble`.
  - `assemble`/`assemble_wait`: as `compose`/`compose_wait` today, except: `made.audio < 1` throws `FINAL: ` + `REASONS.silent`; writing in the stills throws `FINAL: ` + `REASONS.writing`; `s.footage_first_path` and the `audioUrl` swap go (one footage, never cleaned).
  - Header comment rewritten for the new steps; `footageRules` unchanged.
  - `compose.ts`: remove `clipScript`, `parseClipped`, `REFERENCE_SECONDS` and their tests. `generate.ts`: remove `editVideo`, `quoteEdit`, `editParams`. `options.ts`: `DESIGNING_STEPS = new Set(["generate", "kit", "kit_wait", "title", "title_check", "frame", "frame_check", "clip"])`. `jobs.ts`: `step: req.footage_path ? "transcribe" : "title"` (the worker moves a job to `kit` first when the kit is missing).
- [ ] **Step 4: Run** `npx vitest run supabase/tests/_shared/video supabase/tests/migrations supabase/tests/design-request`, then `deno check --no-lock` on `video-worker`, `design-request`, `canva-finish`, `design-worker` (`supabase/functions/<name>/index.ts`), then the whole suite once: `npx vitest run --maxWorkers=4`. Expected: all PASS, exit 0; no `clipScript`, `editVideo`, `creditsPerClip`, `MAX_CLEANS` or `FOOTAGE_WAIT_MS` left anywhere (`grep -rn` over `supabase src` is empty).
- [ ] **Step 5: Commit** `git commit -m "Video: title, frame, clip, assemble; one paid clip per video"`.

### Task 6: Docs

**Files:**
- Modify: `docs/superpowers/specs/2026-11-10-video-one-clip-design.md` (status line: built on branch `trends`, not released; the step names as built), `docs/superpowers/plans/2026-11-10-video-one-clip.md` (nothing but ticked boxes)

- [ ] **Step 1:** Update the status line and any step name that differs from the build. No em or en dashes.
- [ ] **Step 2: Run** `grep -c "—\|–" docs/superpowers/specs/2026-11-10-video-one-clip-design.md`. Expected: 0.
- [ ] **Step 3: Commit** `git commit -m "Video one clip: docs"`.

### Task 7: Quality check, then release (controller only, gated on Lital)

Not for a subagent. The controller:

- [ ] **Step 1:** Ask Lital, in plain words, for the check's credits: one Moburst brief, two clips (the old way with video references and the new way with kit stills and a frame), about 260 credits. Nothing runs before her yes.
- [ ] **Step 2:** On her yes, run both in a scratch script against the live Higgsfield account (not through the app), store both files, look at them at full size, and report look, motion and writing side by side, with the counts. If the new way loses the client's motion feel, stop and bring the finding back to her with options and prices.
- [ ] **Step 3:** Release in this order: merge to main; apply `20261111130000_video_approved_price.sql` and `20261111130100_video_worker_steps.sql` and record them; deploy `video-worker`, `design-request`, `canva-finish`, `design-worker`; publish the frontend. Confirm no video job is running before the deploy (`canva_finish_jobs` with `input->>'kind' = 'video'` and status queued or running is empty).
- [ ] **Step 4:** Verify live: `weekPreview` for a client with one video post quotes the live price; a kit is made for one client on the first press (with Lital's OK to spend one clip, 128 credits); the job's state shows one `clip_order` and one `credits` entry; Higgsfield's transactions show one Seedance charge for it.
