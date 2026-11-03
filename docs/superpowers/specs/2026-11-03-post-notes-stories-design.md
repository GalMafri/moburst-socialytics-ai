# Notes on regenerate, and Stories you can find

Status: design, 3 Nov 2026. No code changed. Lital approved both on 3 Nov: "the goal was to allow users to leave a note for regenerating a design/post copy", and for Stories, "make it much clearer".

## Decisions for Lital

1. **Who can rewrite copy with a note.** Copy Regenerate is Moburst staff only (`CopyEditor.tsx:257`, `regenerate-post-copy/index.ts:21`); design Regenerate is open to the client's own users. Recommended: open copy rewrites to the client's users too. Each press is one Opus call on Moburst's key.
2. **Who decides that a note is a lasting preference.** Recommended: the existing memory merge decides, and the post shows what it learned with Undo. Alternative: a "Remember this for future posts" tick the person sets on each note.
3. **Instagram Stories for a client that posts none.** When Sprout reads a client's Instagram and it posted no Story in 90 days, recommended: suggest none (its own history says otherwise). Alternative: one per Instagram feed post anyway. I made no database calls, so I don't know how many clients this covers.

Sources: the files cited below. The Stories spec (`docs/superpowers/specs/2026-11-02-stories-design.md`) lives on `feat/stories`, not in this branch's docs; its code is on main.

## Part 1. A note when regenerating

### Today

- **Copy.** Regenerate sends concept, pillar, current copy and CTA, no note (`CopyEditor.tsx:130-150`), and is hidden on Stories. The version is saved as `source: "regeneration"`, which never teaches the memory; only a person's own edit does (`calendar-posts/index.ts:116-121`).
- **Design.** Regenerate (`PostDesign.tsx:142`) takes no note. "Not right" (`PostDesign.tsx:232-280`) takes a reason, a note and "Make a new design with this feedback", but the server always turns reason and note into rules in `design_learnings` (`feedback.ts:56,80`) and starts the new design without the note (`design-request/index.ts:218-243`). The specific ask arrives only as a rule written "general enough to apply beyond this one post", which then shapes every later design unseen.
- Calendar and report view share one `PostPanel` (`ContentIdeasTab.tsx:274`, used by `ReportView.tsx:610` and `ClientCalendar.tsx:160`). `record-design-feedback` (`ContentIdeasTab.tsx:295`) serves the older tiles under "Other media for this post".
- `brand_voice_learnings` is listed in Client setup > Brief with source and Remove (`ClientSetup.tsx:705-717`). `design_learnings` feeds every design (`design-request/index.ts:326`) and appears on no screen. Client notes are what the client told the team; nothing here writes to them (`voice.ts:22`).

### Where the note box is

- Copy and Design tabs: pressing Regenerate opens a box in place, "What should change? (optional)", with Regenerate and Cancel. An empty box regenerates as today. (My call: the tab looks as it does now until pressed.)
- Create design, the first design, stays one press: there is nothing yet to react to. (My call.)
- "Not right" keeps its reasons; "Make a new design with this feedback" hands its note to the new design the same way, so a note means one thing on both buttons. (My call.)
- One component, so the calendar post panel and the report view change together.

### How the note is used for this regeneration

- **Copy:** `regenerate-post-copy` takes `note` (up to 500 characters). After the voice block the prompt says the person asked for this rewrite; follow it for this post, and where it differs from a stated preference, the note wins for this post. (My call: the person asked now.)
- **Design:** `design-request` `create` stores `note` on the request. Each planner prompt (`plannerPrompt`, `carouselPlannerPrompt`, `videoPlannerPrompt`, `options.ts`) gets one line: every option follows the note. `startOption` copies it into the job (`generate.note`) and `designPrompt` (`brief.ts:44`) adds it as one sentence, so the image model sees it and retries keep it. The logo stays the brand's file in its spot.

### Whether it teaches the client's memory

Exact rules: no note, nothing learned (as today); the note is the only part of a regenerate that can teach; edits keep teaching as now.

- **Copy note:** sent to the existing merge as a new signal, `rewrite_note`, with the note and the copy before and after (`voice.ts:273,285`). The merge already does nothing when a signal "says nothing general (a typo fix, a one-off fact)" (`voice.ts:300`); one line adds that a note about this post's topic, offer or date is a one-off. It runs alongside the rewrite, so the answer carries what was learned.
- **Design note:** the existing learner (`recordFeedback`) runs on the note, told to write no rule when the note is about this one post; its rules carry `source: 'regenerate_note'`. "Not right" reasons teach as today; their note joins only when lasting. The result is written on the request (`note_learned`).

### How a person sees what was learned

- Under the new copy: "Rewritten with your note. Learned for [Brand]: '[preference]'. Undo", or "Used for this post only." A confirmed preference reads "Matches what [Brand] already prefers." with no Undo.
- Design tab: the progress card shows "Your note: '...'", then the learned line with Undo, or "Used for this design only." The finished design keeps "Made with your note".
- Undo restores the memory as it was before the note (removes an addition, brings back a replaced preference), through `calendar-posts` and `design-request` after a membership check, since only staff can write these tables.
- Client setup > Brief labels these "From a rewrite note"; Client setup > Designs gets a new "Learned design preferences" list with source, date and Remove.

### Stories, failures, costs

- A Story's Message tab gets the same Regenerate with a note (it has none today), written as `generate-ad-hoc-post` writes Stories: one or two short sentences, no hashtags (`format.ts:28-36`). The merge is told it was a Story message, so a short-message rule is not added for every post. Story designs use the Design tab box.
- Failures stay quiet: a rewrite or design that does not start keeps the note in its box ("Not rewritten yet. Your note is kept here.") and is sent again only when it never reached the server (`sendQuietly`). A learning step that does not finish shows no learned line.
- Copy with a note: today's Opus 5.5 rewrite plus one Sonnet 5.5 merge call (up to 1,200 tokens), the call every copy edit already makes. Design with a note: no added design calls or images (still up to `MAX_GENERATIONS = 3` per option), plus one Haiku 4.5 call (up to 400 tokens), the call "Not right" already makes. No note: no change. Undo and lists: no model calls.

## Part 2. Stories you can find

### Today

- The only Story button sits under the post's design (`StoryLinks.tsx`, at `PostPanel.tsx:353`, inside the `designsReady` branch at `:319`): never on the calendar, never for a client whose designs are not set up.
- New post lists Story only after Instagram or Facebook is chosen, and the platform starts empty (`NewPostDialog.tsx:32-35,60`).
- Cards use a 16:10 frame (`PostCard.tsx:93`), so a Story differs only by its badge; the board does place it after its post (`calendarPosts.ts:188-201`). The all-clients week uses 4:5, sorts by client then time and shows no format (`AllClientsWeek.tsx:83,101`).
- The planner adds Stories only from Sprout `INSTAGRAM_STORY` history, at the client's own weekly rate, one per soonest Instagram feed post (`evidence.ts:346`, `weekPlan.ts:231`, `runWeek.ts:482`). No history, no Stories; Facebook never.

### Where Story options appear

- **Post panel header**, which is also the post's menu (Move and Delete live there): every Facebook or Instagram calendar post shows "Add a Story" beside its format, on every tab, for staff and the client's users. With a Story, a "Story" chip opens it; on a Story, "Open the post". The block under the design goes. (My call.)
- Before the brand's designs are set up, "Add a Story" adds the Story with its message and no design; today the action stops first (`design-request/story.ts:64-65`). (My call.)
- **Calendar card:** a post with a Story shows a "Story" chip. No create button on the card: the card is one button that opens the post, and a second target on most Instagram and Facebook cards is clutter for a one-click saving. (My call.)
- **New post:** formats become a row of choices, Story always visible when the client has Instagram or Facebook; choosing it narrows the platforms to those and picks the only one when there is one. (My call.)
- **All-clients calendar:** a Story shows a "Story" label and a 9:16 frame, right after its post. (My call.)

### How a Story looks on the calendar

A compact card under its post: a narrow 9:16 thumbnail on the left (an empty 9:16 outline before it has a design), "Instagram Story" and the message beside it, and a thin rail to its post. A full-width 9:16 frame would be the tallest card of the day. Status never reaches Scheduled (`postStatus.ts`). The day header counts it apart: "3 posts and 1 Story". A Story made from New post has no rail.

### What the planner suggests

- **Instagram:** one Story per planned Instagram feed post, unless the client's own history says otherwise. When Sprout reads the client's Instagram over 90 days, its own weekly rate decides, capped at one per feed post (today's rule). When Sprout does not read it, one per feed post. Decision 3 settles zero Stories.
- **Facebook:** none. Sprout reports no Facebook Story type, so a count would not come from the client's data; "Add a Story" is one press on any Facebook post. (My call.)
- Each Story's reason says where its count came from ("[Brand] posted [N] Instagram Stories in the last 90 days" or "One Story with each Instagram post"). No model call, no design until a person presses, Stories outside the feed rhythm.

### The week's design button

The line names Stories apart: "9 posts this week have no design yet: 6 designs, 1 video and 2 Instagram Stories." A press designs them with the rest, as today; a Story nobody wants is deleted from the post's menu and leaves the count. (My call.)

### Costs

No model calls and no new reads: the board and the all-clients week already load `format` and `story_of`. Suggested Stories cost nothing until designed; a designed Story costs what a still costs with 1.4 times the image pixels (Stories spec, Costs).

## Tests

- `voice.test.ts`: `mergePrompt` for `rewrite_note` (note, both copies, one-off line, Story line). New `load.test.ts` with a fake database: `learnFromSignal` reports what it added, replaced or confirmed; Undo restores the list.
- New `regenerate-post-copy/prompt.test.ts`: note line only with a note; Story rules; no note matches today. `copyWritersUseVoice.test.ts` still passes. `calendar-posts`: a noted regeneration teaches through `rewrite_note`, an un-noted one never.
- `options.test.ts`, `brief.test.ts`, `jobs.test.ts`: the note reaches every planner, the job and the design prompt (single, carousel, Story, video card). New `feedback.test.ts`: one-off note, no rule; lasting note, one `regenerate_note` rule; reasons still teach. `design-request`: `create` stores the note, `make_new` passes it, Undo works. `noAutomaticDesigns.test.ts` still passes.
- `design-request/story.test.ts`: a Story is added with no request before set-up, with one after. `weekPlan.test.ts`, `runWeek.test.ts`: read history decides (zero per Decision 3), unread gets one per feed post, Facebook none, reason names its source.
- App: `stories.test.tsx` (header button on every tab for client users, chip, compact card after its post, day count, New post choice and narrowing, all-clients label and order); CopyEditor and PostDesign box, kept note, learned line and Undo; `clientSetup.test.tsx` label and design list; `designWeek.test.tsx` line; `displayGuard.test.ts` over every new string.

## Files

Create: `supabase/migrations/20261109160000_post_notes.sql` (`design_requests.note`, `note_learned`; `design_learnings.source`, `evidence`; `rewrite_note` in `brand_voice_learnings_source_check`); `regenerate-post-copy/prompt.ts` and test; `_shared/design-prompts/feedback.test.ts`; `_shared/voice/load.test.ts`.

Change (functions): `regenerate-post-copy/index.ts`, `calendar-posts/index.ts`, `_shared/voice/voice.ts`, `load.ts`, `design-request/index.ts`, `story.ts`, `_shared/design-prompts/feedback.ts`, `learnings.ts`, `_shared/canva/options.ts`, `brief.ts`, `jobs.ts`, `_shared/calendar/weekPlan.ts`, `runWeek.ts`.

Change (app): `src/components/reports/calendar/CopyEditor.tsx`, `PostDesign.tsx`, `PostPanel.tsx`, `StoryLinks.tsx`, `DesignProgressCard.tsx`, `PostCard.tsx`, `CalendarKanban.tsx`; `src/components/calendar/NewPostDialog.tsx`, `AllClientsWeek.tsx`; `src/lib/designRequests.ts`, `calendarPosts.ts`, `designWeek.ts`; `src/pages/ClientSetup.tsx`.
