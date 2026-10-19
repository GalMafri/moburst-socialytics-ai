# Weekly content calendar

Status: draft for Lital's review, 19 Oct 2026. Nothing is built yet.
Replaces the four-week planner from commit 6e0c724, the calendar import from monthly reports, and trend posts.

## What it has to do

- Plan from the client's own performance and from what's working for relevant competitors, and keep up as the client's landscape shifts.
- One calendar a week, made from the latest evidence. Anyone can ask for the next week early, so a month is a few presses away.
- Let people revise a week when the copy is off.
- Write copy in the client's real social voice, learned from their published posts, and use a preference memory that stays current.
- No new tabs, no timers on the client, and keep the cost down.

## How it works today (checked 19 Oct)

- Four things write posts onto the calendar:
  - the monthly report (n8n writes a 7-day plan, which update-report imports);
  - the planner, which keeps four weeks planned (one Opus call per week);
  - trend posts, left empty and filled about 10 days ahead (one Opus call each);
  - people (New post, drafts from the competitor feed).

  Moburst's duplicate week (7 and 16 Oct plans) came from two of these writing the same week.
- The planner writes copy from one tone line in the brand profile. Bader has no tone line. The planner never reads the learned preferences or the client's published posts.
- Learned preferences merge only on an exact text match. Moburst has 10, all at the starting confidence, some contradicting each other. Bader has none, from 45 copy edits.
- Copy comes from four writers on three models with different inputs:

  | Writer | Model | Voice inputs |
  |---|---|---|
  | Planner, trend posts | Opus 5.5 | Tone line only |
  | Single-post rewrite | Haiku 4.5 | Learned preferences only |
  | New one-off post | Sonnet 4.6 | Tone line and preferences |
- The planner copies the posting rhythm from the report's week, and it doesn't match what clients publish:

  | Client | Planned per week | Published per week (Sprout, via the weekly feed) |
  |---|---|---|
  | Moburst | 11 | 2 to 5 (four windows, 23 Sep to 15 Oct) |
  | Bader | 13 | 7 to 18 (three windows, 29 Sep to 16 Oct) |
- Bader's trend posts aren't being written. All 20 from 19 Oct to 15 Nov are empty, five of them this week (23 to 25 Oct). The fill job runs every morning and Bader has the inputs it needs (12 competitor topics in the last 14 days, trend findings in the 7 Oct report). The cause isn't visible in the database because request results are only kept for six hours.

## The design

### One plan per client per week, made once

- A new table, `calendar_plans`, holds one row per client and week (weeks start Monday), unique on `(client_id, week_start)`. It has these columns:
  - `status`: planning, ready or failed
  - `trigger`: monday or button
  - `requested_by`
  - `evidence`: the scored inputs the plan used
  - `rhythm`
  - `model`, plus input and output tokens
  - `revisions`: each Revise note with the copy it replaced
  - `created_at`
- `calendar_posts` gets `plan_id`. The planner is the only code that writes plan posts. People can still add their own posts, which have no plan.
- Because of the unique key, a week can never get a second plan, whoever asks. Plans are never regenerated. People edit from a plan or use Revise.
- The calendar reads `calendar_posts` directly. There is no view, no ownership rule and no hidden posts.

### When plans are made

- **Every Monday.** The existing daily enqueue (07:15 UTC, which is 10:15 Israel time in summer and 09:15 in winter) adds one `week_plan` job per active client for the following week. The existing job worker runs it, with its leasing, retries and alert email.
  - If that week already has a plan, the job does nothing and costs nothing.
  - An active client is not archived, not excluded from reporting, and has Sprout profiles or a linked RivalIQ landscape.
- **"Plan next week."** A button on the calendar for staff and client users. It plans the earliest week without a plan, anywhere from the current week to four weeks ahead, through the same job. The week shows "Planning" until the plan is ready. When the current week has no plan (a new client, or a gap), the button plans the days left in it.

### Revise this week

- Staff and client users can revise any planned week that hasn't ended. They press "Revise this week" and write what's off, for example "too formal" or "no emojis on LinkedIn".
- One model call rewrites the week's posts that nobody has worked on. "Worked on" means the copy was edited, the post was moved or designed, or it was scheduled to Sprout. Rewritten posts keep their day, platform and format. Posts someone worked on stay as they are, and the result lists them.
- The replaced copy is saved in the plan's `revisions`, so nothing is lost.
- The note also goes into the client's memory (see below), so later weeks follow it.

### What a plan is built from

Code puts together an evidence pack before the model call. The scoring uses no AI.

| Input | Source | How it's judged |
|---|---|---|
| The client's own posts, last 90 days | Sprout post analytics, all posts (today's function returns only the top 10) | Each post against the client's own median for the same platform and post type, by impressions, once the post is 48 hours old |
| Platforms Sprout doesn't cover | RivalIQ's copy of the client's posts | Engagement against the client's own median on that channel |
| Competitor posts that beat their usual numbers | RivalIQ weekly feed: the newest week against the last four stored weeks | Engagement per follower against that competitor's own median on that channel. Facebook posts RivalIQ marks as likely boosted are left out |
| Topics several competitors post about | This week's competitor topics, leaving out dismissed ones (today's trend fill counts dismissed topics too) | Plus the competitive insights the team accepted or rejected |
| Seasonal moments | Holidays and events in the client's market that week | As today |
| Platform trends | The latest monthly report's TikTok and Instagram trend findings | See open choice 4 |
| Report findings | Latest monthly report: key insights, pillar recommendations, accepted suggested tests | As today |
| Posting rhythm | The client's published posts, last 8 weeks | Posts per platform per week, usual days and times. See open choice 2 |
| Recent posts | First lines of nearby planned posts | To avoid repeats, as today |

- No published threshold defines "outperformed" (research of 19 Oct). The pack ranks posts by how far above their own median they are, and the reason shows the actual multiple.
- The model decides which competitor winners fit the client's pillars, audience and services. It has to cite the post it used.
- Thin data is labeled "early signal", in the pack and on the post. That applies to a platform with fewer than 5 posts in 90 days, or a competitor with fewer than 4 stored weeks. Pay The Pyper's competitors start from zero history today.
- At most one post a week is a test: something the evidence hasn't proven for this client, such as a competitor format the client hasn't tried. Its results feed later weeks like any other post's.

### Copy: the client's real voice and one memory

- **A social voice profile per platform.** One model call reads the client's posts from the last 90 days and records how the client actually posts:
  - how posts open, and how long they run;
  - structure;
  - emoji and hashtag habits;
  - call-to-action style;
  - "we" or "you", and how formal;
  - recurring phrases.

  The profile is stored on the client with its date and post count. It's built when a client has none and rebuilt on the first Monday of each month. Each plan also gets the client's three best-performing recent posts per platform as examples, which code picks at no cost.
- **One preference memory per client.**
  - `brand_voice_learnings` gets four new fields: status (active or replaced), times confirmed, last confirmed, and source (copy edit or Revise note).
  - Every copy edit and every Revise note runs one small merge call against the current active list:
    - a preference confirmed again gets stronger;
    - a new preference that contradicts an old one replaces it, and the old one stays as history;
    - anything else is added.
  - The list stays short and current. This replaces today's exact-text merge in `analyze-post-edits`.
- **One shared loader for every copy writer.** The weekly planner, Revise, the single-post rewrite and new one-off posts all build their prompts from one function. It returns the active preferences, the voice profile, the brief's tone line and the example posts.
  - Every prompt follows the same order of authority: the team's stated preferences first, then the client's real social voice, then the brief.
  - A test fails the build if a copy writer skips the loader.
- The single-post rewrite (Haiku 4.5) and new one-off posts (Sonnet 4.6) move to the planner's model, so all copy reads the same.
- **Starting point.** Bader's 45 copy edits are replayed through the merge once, oldest first. Moburst's 10 preferences go through one merge pass, which settles each contradiction in favor of the newer preference.

### Where people see it (no new tabs)

- **Calendar week header:** "Plan next week" and "Revise this week".
- **Post card:** the reason tag (Performance, Competitor, Trend, Seasonal, Test) shows a one-line reason on the card, which today only appears as a tooltip. An example shape: "[Competitor]'s [format] got [3.1]x their usual engagement and fits [pillar]."
  - The numbers come from the evidence pack. The model only picks which evidence a post uses and writes the "fits" part, so a reason can't contain a number the data doesn't have.
  - Opening the post shows the source post's link, date and numbers. Thin evidence says "early signal".
- **Memory:** the existing list of learned preferences in client settings shows the merged preferences, how often each was confirmed and where it came from. Staff can remove one.
- **Monthly report:** keeps its recommendation cards and the "Open the calendar" link. See open choice 1.
- The sign-in page line "A month of post ideas" stays true through the button.

### What goes away

- `calendar_weeks`, `calendar_assign_week()`, the `calendar_posts_current` view, `CALENDAR_VIEW`, and the read-path guard test written for that view.
- The calendar-posts actions `keep_planned`, `plan_weeks` and `fill_trend_slots`, the trend-post prompt and parsing in `planner.ts`, and `plans.ts`.
- The cron jobs `calendar-keep-planned` and `calendar-fill-trend-slots`.
- If open choice 1 is approved: the report import (`fromReport.ts`) and its two calls in update-report.
- Kept: `calendar_post_worked()` and `touched_at`, which Revise uses to tell what someone worked on.

## Pay The Pyper

- RivalIQ tracking was connected on 19 Oct: landscape 659648 tracks Pay The Pyper, BenchApp, TeamSnap and TeamLinkt. RivalIQ doesn't load posts from before that date, so competitor history builds up week by week.
- Sprout has its Instagram and Facebook. TikTok, one of its three main platforms, isn't in Sprout, so TikTok results depend on RivalIQ finding the account. I'll check after the first weekly feed.
- It has no calendar yet. Its first plan comes from the first Monday run after launch, or from a button press.
- Design settings (logo, placement, reference posts) aren't confirmed, so it can't get designs yet.

## Cutover

- Weeks already planned keep their posts. Each one gets a `calendar_plans` row, and the posts the calendar shows today get its `plan_id`.
- Posts the calendar hides today are exported to a file in storage, then deleted, so nothing needs filtering again. These are untouched posts from replaced plans, including Moburst's posts that stay hidden.
- Empty trend posts in weeks already planned (Bader 20, Moburst 8) are written once with the new copy path: one call per week that has them, 7 calls in total. I'll ask before running it.
- If cutover lands after Monday 26 Oct, `calendar-keep-planned` will already have planned the week of 16 Nov for Bader and Moburst (one Opus call each). Those weeks stay as plans.

## Cost

Model calls per client per week:

| | Today | New |
|---|---|---|
| Weekly planning | 1 Opus call per newly planned week, plus re-planning of up to 3 weeks after each monthly report | 1 Opus call (Monday or button) |
| Trend posts | 1 Opus call per trend post (Bader has 5 a week) | None, part of the weekly call |
| Report's 7-day plan | Written inside the n8n report call each month | None (open choice 1) |
| Revise | Doesn't exist | 1 Opus call per press |
| Voice profile | Doesn't exist | 1 call a month |
| Memory | 1 Haiku call per copy edit | 1 small call per copy edit or Revise note |

Token counts aren't logged anywhere today. Plan rows store input and output tokens, so the first runs give the real cost per client.

## Proof before go-live

1. Unit tests:
   - scoring on stored Sprout and RivalIQ data;
   - one plan per week, even with two simultaneous requests;
   - Revise skips posts someone worked on;
   - the memory merge (confirm, contradict, new);
   - the loader guard.
2. Evidence packs for Bader, Moburst and Pay The Pyper, built from live data with no model call. Lital reviews what the planner would see.
3. With Lital's OK on credits: one real plan each for Moburst and Pay The Pyper, and one Revise on a Bader week. The copy is read side by side with each client's own recent posts.
4. A check in the app, as staff and as a client user: the buttons, the reason lines, and nothing developer-facing on screen.

## Open choices

1. **Trend posts and report posts.** Trend posts stop being a separate mechanism. The monthly report stops writing posts, and its findings feed the weekly plan. Three things change with it:
   - the n8n report prompt drops its 7-day plan;
   - the deck loses its calendar slide;
   - the API's calendar field returns the planned posts.

   Older reports keep their boards.
2. **Posting rhythm.** Option A: follow what each client actually publishes. Moburst would go from 11 posts a week to about 2 to 5, and client settings would get a posts-per-week field per platform for staff who want more. Option B: keep today's rhythm.
3. **Hidden posts at cutover.** Export and delete (proposed), or keep them stored and hidden.
4. **Platform trends.** TikTok and Instagram trends are scraped once a month inside the report's n8n workflow. Fresh platform trends every week would mean running those scrapers weekly. I'd measure their cost before proposing that. Until then, the weekly freshness comes from competitor topics and seasonal moments.
