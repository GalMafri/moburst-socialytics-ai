# Video posts: one paid clip per video

Status: design for Lital's review, 10 Nov 2026. Nothing is built.

## Why

Lital, 10 Nov: "socialytics spend on video for the past few months has been extensive", and the fix must be "something that doesn't put a bandaid on an issue, but fixes it from the core, without creating spaghetti code".

What the data says (canva_finish_jobs, video jobs, read 10 Nov):

- A finished video in November cost about 457 Higgsfield credits (about $27). The 8-second clip itself costs 128 to 144. The rest is a second paid pass that removes writing the model put in the clip (161 to 181 credits, more than the clip), run on 4 of the 5 November clips, plus clips paid for and then thrown away.
- 2 of 5 November runs paid for a clip, then failed because the title could not be drawn with the exact words. The clip was already bought.
- The week's quote prices a video as one clip at the last recorded price. Moburst's week of 9 Nov was quoted 300 credits and used 1,372.
- 13 to 14 Oct, while the feature was built and tested: 81 runs, 69 finished, an estimated 6,700 credits.

## The causes, in the code

1. **The model copies text from its references.** `_shared/video/steps.ts` cuts short clips from the client's own published videos (`references` step) and hands them to the video model as `video_references`. Those videos carry text: Bader Law's have 2 to 4 word captions throughout, Moburst's have narration subtitles and dashboards full of words (`clients.video_style.profile.on_screen_text` is "captions" for both). The model reproduces text, the app reads it on four stills after assembly, and pays the video model's edit mode to take it out (`clean` step).
2. **The paid clip is ordered before the parts that can fail.** The clip is submitted in `footage`, and only then is the title drawn and read back (`hook`, `hook_check`). A title that fails three times ends the video with the clip already paid.
3. **Several paths order another paid clip on their own:** a clip not back after 30 minutes (`FOOTAGE_WAIT_MS`), a clip with no sound, a clip still written on after two cleanings, and a provider failure. Each has its own counter and cap (`MAX_FOOTAGE`, `MAX_CLEANS`, `MAX_COMPOSE`, `MAX_HOOKS`); together they allow up to six paid submissions for one video, and the person who pressed the button never approved more than one.
4. **The quote is not the price.** `creditsPerClip` averages past records and multiplies by the number of video posts. Nothing holds a run to the quote.

Fixing any one of these in place (a cheaper repair, a cap, a better average) leaves the others and adds another counter. The fix below changes what a video is made from and the order of work, and removes the repair and the re-orders instead of tuning them.

## Goals

- One paid clip per video in the normal case, and never more credits than the person approved at the press.
- The quote before the press is Higgsfield's own price for exactly what will be ordered.
- Quality kept: the video follows the client's own videos in look, carries the exact copy and the logo file, and is never silent (the 13 Oct rules).
- General: every client from its own published videos; nothing set by hand; no per-client switch.
- Less code than today, with one straight line of steps.

## Non-goals and anti-goals

- Not changed: videos made from filmed footage (`footage_upload`), the statics pipeline, demo videos, the Pay The Pyper logo fix (its own change).
- No new video model, no music or voice-over, no 480p or 720p finals to save credits (quality is not the lever).
- No second "fallback" pipeline beside the first, no per-client flags, no step a person must trigger.

## The design

### 1. A clean style kit per client, made once

The style step already exists (`style_cut`, `style_wait`, `style_read`): it takes 8 stills from each of up to 3 of the client's published videos and writes `clients.video_style` (the profile text and the still paths). The kit extends it with one more step, `style_kit`:

- The vision model picks the stills that best show the client's look (up to 6, my call), from the stills the style step already stored.
- Each chosen still goes through the image edit the design worker already uses to take logos out of a design (`imageEdit`, OpenAI image edits): captions, subtitles, lettering, logos, watermarks and screens removed, everything else kept. The result is read back with the existing writing check; a still that still shows writing after one retry is dropped.
- The clean stills are stored beside the originals and listed in `video_style.kit`. A kit needs at least 2 clean stills; with fewer, the client's videos are not generatable, which is a state the profile already has (`generatable`).
- The kit is made when the style is made and remade only when the style is remade (same trigger as today). A client whose style exists but has no kit gets the kit as the first step of its next video; no one does anything by hand.

Cost: a few image edits per client, paid in cents on OpenAI, zero Higgsfield credits. The video model never again sees a reference with text in it, so there is nothing to repair.

### 2. One video, in this order

Each video post is still one job in `canva_finish_jobs`, run by the video worker. Its steps, in order:

1. **plan** (exists): the brief, from the post and the client's video style.
2. **title**, **title_check** (exist as `hook`, `hook_check`): the title drawn on its layer and read back until it is the copy's words exactly. Cents per try; the cap stays.
3. **frame**, **frame_check** (new): the image model draws the clip's opening frame from the brief's shot, with the kit stills as references and the same rules the clip has today (no text, no screens, no makers' marks, people as the client's videos have them). The frame is read back with the existing writing and marks checks. A frame that fails is drawn again (cents); the cap is the builder's call.
4. **clip** (replaces `footage`): one submission to Higgsfield, Seedance 2.5, 8 seconds, 1080p, 9:16, sound on, with the opening frame as `start_image` and the kit stills as `image_references`, and no `video_references`. The request's live price (`get_cost`) is read and recorded on the job before the submission. The plumbing exists (`VideoRequest.startImageId`, `referenceIds`).
5. **clip_wait** (replaces `footage_wait`): the one job id is asked about until Higgsfield reports a final state. Nothing is re-ordered on time: the job exists until the provider ends it.
6. **assemble**, **assemble_wait** (exist as `compose`, `compose_wait`): title, logo file and sound joined as today, four stills read once for writing as a final gate.
7. **done**, or **not made**.

### 3. What ends a video, and what it costs

- Title or frame that cannot be drawn: the video is not made. Cost: cents. No clip was bought.
- Provider failure (Higgsfield reports failed, canceled, timed out or no file, or the clip has no sound): the video is not made, the reason is kept, and Higgsfield's record of that job is kept with it. One clip was bought at most.
- Writing in the finished clip (the final gate): the video is not made. One clip was bought. With text-free references and a checked opening frame this should be rare; the quality check below measures it.
- Nothing orders a second paid clip. A video that is not made shows as such on the post, and the week's button counts the post again at the next press, as closed requests already do (`weekDecision`, `_shared/design/requestRules.ts`). That is the app's existing rule, and it keeps the decision to spend again with a person.

So the most a video can ever spend is its one clip, and the approved amount for a week is the number of video posts times the live price.

### 4. The quote is the price

"Design this week" and the week preview read Higgsfield's live price for the exact clip settings once per press (`get_cost` costs nothing) and quote `video posts x that price`. `credits_per_clip` shows that number. `credits_used` keeps reading the records on the jobs. If the price cannot be read, the press does not start video posts and says so plainly; it never guesses. The historical average (`creditsPerClip`) and the `CLIP_CREDITS` fallback go away.

### 5. What is removed

- The `references` and `references_wait` steps and the sandbox script that cuts the client's videos (`clipScript`), with their counter.
- The `clean` and `clean_wait` steps, the video edit call (`editVideo`, `quoteEdit`) and `MAX_CLEANS`.
- The 30-minute re-order, the silent-clip re-order, the writing re-order and `MAX_FOOTAGE`.
- The compose re-order stays (it is a join in a sandbox, not a paid clip).

The step list becomes: plan, title, title_check, frame, frame_check, clip, clip_wait, assemble, assemble_wait. Each step keeps its own counter and only ever moves forward, except title and frame redraws. One spend record per job.

## Constraints

- Design fully before building; nothing built until Lital approves this document.
- No credits are spent without her OK, including the quality check below.
- Client-facing copy: plain American English, no em or en dashes, no developer words; a video that is not made says why in one plain line.
- Solutions general across clients; nothing set by hand; no n8n.
- Tests live under `supabase/tests` at the code's path; the API core is untouched; the release routine applies (merge to main, deploy `video-worker` and `design-request`, replay guard if `run-scheduled-jobs` changes, which this design does not).

## Quality check before release (needs Lital's OK: about 260 credits)

On one client whose videos carry text (Moburst), one brief, two clips: today's way (video references, no start frame) and this design's way (kit stills and a checked opening frame). Compared at full size for look, motion and writing. The builder reports both clips and the counts; Lital judges. If the new way loses the feel of the client's motion, the finding comes back here as a decision, with its options and prices; nothing is changed quietly.

## What is left to the builder

- The exact prompts for the kit cleaning, the opening frame and the clip; how many kit stills (up to 6) and the redraw caps.
- How a job left at an old step name is ended (there are none running on 10 Nov).
- How long a provider job is waited for before it is asked about as lost, and what Higgsfield's record shows for a failed job.
- Storage paths, tests, and the plain-English reasons shown for a video that is not made.

## Decisions for Lital

1. One paid clip per video, and a video that fails after it is "not made" until a person presses again. Right?
2. The quality check above (about 260 credits) before anything is released. OK to spend when the build reaches it?
