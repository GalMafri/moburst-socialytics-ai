# Socialytics runs itself: self-serve design

19 Oct 2026. Approved by Lital with the four decisions below. Build in progress.

## What Lital asked for

> "NEVER SUGGEST FIXES LIKE THIS, THE USER SHOULD NOT HAVE TO DO ANYTHING MANUALLY, stop disguising bad builds with flags inside the app and fix it from the core, QA EVERYTHING and fix structurally"

> "you're building a self-serve app, not something i will be controlling from a claude session, what don't you get? stop patching fixes per client"

## The rules this design follows

1. Every client goes through one lifecycle that the server runs. Each stage has an automatic producer, a stored result, and a rule that moves it forward or recovers it.
2. People can change anything the product produced. Nothing waits for them.
3. Screens show what exists. No screen tells anyone to set something up.
4. Work runs when its inputs change. Opening a page never starts paid work.
5. Every number has one definition and one source, shared by every screen.
6. Every stored value reaches a screen through one display layer.
7. The daily alert reports product outages only (a provider down, the worker not running). Setup gaps can no longer exist, so nothing alerts on them.

## What the audit found

Five read-only audits on 19 Oct: a new client's full lifecycle, every pipeline's stuck states, every wrong number, every raw label, and every operation run from a session.

### A new client depends on people at every stage

Pay The Pyper was created on 13 Oct through the normal setup screen. Six days later it has no reports, no plans, no voice profile, no design settings, and its own users cannot reach it.

| Stage | What waits for a person today |
|---|---|
| Brand research, brief, pillars | Buttons on the setup page. Bader still has no brand identity or logo after 4.5 months. Five generic pillars are saved by default. |
| Timezone, geo, language, platforms | Saved as UTC, US, en and four platforms by default. Bader and Moburst are on UTC. |
| Sprout accounts | Staff tick boxes in a list of every profile on the agency account. |
| Competitors | "Identify", pick three, "Confirm top 3". Nothing is preselected. |
| RivalIQ tracking | A staff dialog that advances at most three steps per click. Pay The Pyper waited six days. |
| First report | Scheduled for the 7th of next month. Pay The Pyper's first is 7 Nov. |
| Weekly calendar | Readiness gate, posting rhythm only from the last 8 weeks, no plan until the Monday after next. |
| Designs | Staff confirm design settings once. Automatic designs are off on all three clients, so the 2-minute design cron ran 844 times in 7 days and made nothing. |
| Videos | 12 filming requests sit on posts dated 12 to 18 Oct with no footage and nothing that closes them. |
| Publishing | Every post is scheduled to Sprout by a staff click. 0 scheduled posts across all clients. |
| Client access | Nothing sets the company slug or hub name. Pay The Pyper's users see "Your dashboard is being set up". |

The API demo already runs most of this chain on the server from a name and a website (brand research, site brief, pillars, design references, competitors with a confirmed top three). Normal client creation does not use it.

### Dead ends and stuck paths

- A failed monthly report is final. The month is lost unless someone presses Retry. 5 failed competitive runs have no later run for the same range.
- A failed weekly plan is final. Only the button re-queues it.
- A design request that dies while planning stays "preparing" forever. Automatic video requests are replanned with an empty user header, get rejected, and stay "preparing". Two stuck automatic requests block automatic designs for every client.
- RivalIQ setup advances only while a staff dialog is open.
- 22 report schedules on archived clients are still active. 6 are past due and would fire at once if the client came back.
- The automatic-designs cron acts as Lital through a hard-coded user id.
- 7 finished media jobs from September were never attached to posts; the sweep only looks back 6 hours.

### Numbers with more than one definition

- Bader's "28.58%" engagement rate: the client is scored per follower and weighted by post count (a 42-follower TikTok dominates), while peers use RivalIQ's cross-channel rate. The provider's own figure for Bader is 1.42%. Top posts show 1972%, 225.88%, 156.89%. LegaBot shows 153.39% with a top post at 12,914%. One shared normalizer feeds every competitive screen and the public API.
- 29 of Bader's 42 Facebook posts have 0 impressions and 0 engagement (ad variants, same caption seconds apart). They inflate post count (94 vs 67 in the monthly report), share of voice (41%) and cadence (21.9 a week).
- "Sprout posts analyzed 10" is the length of the top-10 list. "Recommendations 13" is the number of calendar posts. "6 recommendations" is capped at 6.
- "Top posts by engagement" ranks by total engagements including clicks, and the card hides clicks, so a 210-click post looks like 0.
- "12 topics" on the dashboard vs 8 and 3 on the feed: three screens each define open topics differently, and a topic's identity is the model's wording, so one theme counts twice across weeks.
- "N planned" on the dashboard counts the next 7 days; the calendar counts Monday to Sunday.
- One competitive run shows "complete", "Awaiting review" and "Ready": whether a run is held is never stored.
- Analytics lists all 16 clients; the dashboard says 3 active. Each list filters archived clients its own way.
- /usage: "Failures 0 across 346 actions" counts a different source than the Features tab (36 failures) and the trend chart (477 actions). "Page views not tracked" is stale text; 1,788 page views are recorded.

### Raw stored values on screens

- 281 of 814 TikTok trend captions are stored with escaped emoji and `\u0026` codes, in 61 of 63 reports across 13 clients.
- Report headers print raw ISO dates and "US · en". Report statuses print "completed" or "complete".
- Competitor LinkedIn and YouTube handles show as numeric or channel ids (12 and 59 rows). 272 handles guessed from website scrapes before 16 Sep still carry 0.90 confidence and look trusted, including Gary Martin Hays's TikTok "b985fm".
- The Schedule tab prints "Latest: triggered social report &lt;uuid&gt;". Settings prints "SPROUT_SOCIAL_ACCESS_TOKEN" and "No Hub token in session". Server error strings pass to the screen unchanged.

### Paid work started by page views

The setup page asks for a full design-reference discovery on every visit and every Save. The server answers from a 7-day cache. For Bader, Moburst and Pay The Pyper that window ends on 20 Oct at 14:35, 19:37 and 20:21 Israel time; after that, the next visit pays again (Sprout reads, up to 24 image checks, a synthesis call) and silently replaces the client's references. Clients with too few posts pay on every visit.

### Operations run from this session

| When (19 Oct, Israel time) | What | Client |
|---|---|---|
| 14:01 | Connected RivalIQ tracking through the UI | Pay The Pyper |
| 15:36 | 7 empty-post revisions and 1 plan through the operational secret | Bader, Moburst |
| 15:38 | Merged the preference memory | Moburst |
| 15:48 | Wrote posting rhythm into the voice profile by SQL | Bader, Moburst |
| 15:50 | Rebuilt 26 stored post reasons | Bader, Moburst |

Also: every migration since 10 Sep (51 files) was applied by hand, so the database's migration history stops at 10 Sep.

## The design

### 1. One client lifecycle, run by the server

A client's lifecycle starts when the client is created (in the app or through the API) and re-runs a step whenever that step's inputs change. A daily sweep catches anything new, such as profiles added to Sprout later. Each step stores what it produced and the inputs it used, so it never re-runs for nothing and never stops the steps after it.

1. **Read the website.** Brand identity, logo, colors, tone, language and the business location. The timezone comes from, in order: schema.org addresses (Bader's site lists eight Georgia offices), a street or ZIP address in the page text (Moburst's footer), the headquarters the research model reads from the site in the same call that reads the brand (no extra call), then the country's main zone. The source is stored with the value, so a better source replaces it later and staff can override it. Proof on 19 Oct: Bader and Moburst resolve to Eastern from their own sites; Pay The Pyper's homepage has no address, so it depends on the research read.
2. **Brief and pillars.** When no brief or strategy doc is uploaded, the brief is drafted from the site, then pillars and keywords are derived from it. The five generic default pillars go away. Uploading a brief or doc later re-runs this step.
3. **Social accounts.** Sprout profiles are matched to the client from two exact sources, used together: Sprout's own brand name for the profile, and the profile handles the client's website links to. Proof on 19 Oct: the two together reproduce all 10 hand-made assignments with no wrong pick among the other 67 profiles; either alone misses some. Bader's site links its Facebook, Instagram, LinkedIn and YouTube; Pay The Pyper's site links none, so its match comes from Sprout's brand name. A profile a person removes stays removed. Platforms with no Sprout profile are covered by RivalIQ's copy of the client's posts.
4. **Client access.** The company slug is set at creation with the portal's slug rule. At portal sign-in, a slug that matches no client is matched to a client by exact normalized name, and the hub company name comes from the portal's organization name.
5. **Competitors.** Identify, look up handles, pick the three closest with a verified profile and a website, confirm. This is the demo's existing rule. Staff can change the set at any time.
6. **Tracking.** RivalIQ tracking for the confirmed set is connected by a server job with retries. No dialog. (Decision 1.)
7. **Design.** Design references and design language from the client's own posts, then design settings. (Decision 2.)
8. **First output.** Voice profile, then this week's remaining days and next week planned, and the first monthly report for the last full month.

After that, the steady state already exists: Monday plans, monthly reports, weekly competitor feeds, a monthly voice rebuild.

The API demo becomes a caller of this same lifecycle, so there is one onboarding path. The setup page becomes a view of what the lifecycle produced, with edit controls. A step that cannot produce anything yet (a brand-new account with no posts) waits for its input and runs when the input appears; it never shows a "set up" message.

### 2. The weekly calendar never needs a setting

- **Cadence always resolves.** Per platform, in order: the client's own posting in the last 8 weeks, its own posting over 90 days, the median of its confirmed competitors on that platform, then the median of every company the app tracks on that platform. A platform with no rate from any source (X, whose tracked posts carry no dates) is left out; a client always gets the platforms that do resolve. Staff can still override per platform; it is never required. Rates under one a week plan posts by a fixed, stateless rule (a rate of 0.25 gets one post every fourth week). Proof on 19 Oct: every client resolves; Bader and Moburst keep exactly their current rhythm.
- **No readiness gate.** Every active client is planned. A client with no posts and no tracking is planned from its brief, pillars and dated moments.
- **No final failure.** A plan that fails for a passing reason (an API error) is re-queued by the next daily run until its week starts. The screen shows the week as not planned yet, with the Plan button.
- **Reasons are worded when shown,** from the stored evidence. A wording change never needs a stored rebuild, so the rebuild action is deleted.
- **Memory stays short for every client.** The monthly voice job merges the preference list whenever it has more than 8 active entries.
- **No empty posts.** The daily run writes copy for any upcoming post that has none.
- **The planner knows what can be produced.** It plans on-camera ideas only for clients that uploaded footage in the last 60 days. When footage has not arrived 24 hours before a filmed post's time, the post gets a design the product makes from the same idea and the filming request closes.
- **Topics have one definition:** open topics are the newest feed window's topics that nobody dismissed. Each weekly refresh is given the previous weeks' topics and reuses a topic's key when the theme is the same, so a theme is counted once and a dismissed theme stays dismissed.

### 3. Every pipeline finishes or recovers on its own

- A failed monthly or competitive report retries automatically (3 attempts over 24 hours). A month is never lost to one bad run.
- A design request with no progress for 30 minutes is replanned. Automatic work runs as a system actor; nothing acts as Lital. The automatic-designs limit counts only requests that are moving.
- Design options that fail are regenerated the next day, until 3 days before the post date. The root causes in the current pipeline get fixed: carousel covers (10 failures), headline and logo placement (6), reading the area around the logo (4), and 2 code errors. The 41 failures from the retired Canva path stop with that path.
- RivalIQ setup is advanced by the worker. A landscape that disappears is set up again by the lifecycle.
- Archiving a client pauses its schedules; unarchiving schedules from today.
- The old creative-plan media path (no jobs since 30 Sep, 7 orphaned results) is retired.
- The daily alert keeps only outage checks: the worker or cron not running, a provider failing for every client. The waiting, blocked and needs-setup lists go away with their causes.

### 4. One definition per number

- **Engagement rate (Lital's decision, 19 Oct: per impression).** Every screen uses one definition: engagements divided by impressions (views on video platforms). Comparisons read every company, the client included, from RivalIQ; the client's own performance reads Sprout with the same definition. Where a source has no impressions for a platform, the screen shows nothing for it, never another formula. Per-follower rates leave the product. Proof on 19 Oct: Bader 0.12% against competitors from about 1.3% to 2.9%, where it showed 28.58% against 0.15%.
- **Post counts** exclude ads and dark posts using Sprout's own fields (to be identified in the proof on Bader's 29 zero-impression posts).
- **Labels match their fields:** posts analyzed is the real count, recommendations is the number of actions, the calendar count gets its own name.
- **Top posts** show the number they are ranked by.
- **This week** means Monday to Sunday in the client's timezone on every screen.
- **Held** is stored on the competitive run when it is written, and the status helper takes the whole row, so no screen can skip it.
- **Active clients** come from one shared query. Archived clients appear only in the archive view.
- **/usage** counts actions and failures from one source for every tile and chart. The stale text goes.

### 5. One display layer

- One module turns stored values into words: platform names, date ranges, statuses for both report types (with held), country and language names, event names, roles.
- Every server error carries a plain message written for people and a code. Technical detail goes to the logs.
- Captions are decoded when the report workflow stores them, and the stored reports are decoded once (all 281 rows, every client).
- The Schedule tab stores a structured last result and shows "Report ran on 7 Oct", with a link.
- Competitor handles show a readable name (from the profile page or RivalIQ, else the competitor's own name with a link), never a raw id. Handles are trusted from exact sources (RivalIQ's record of a tracked company, the profile page itself) rather than from where a link sits on a page: the 19 Oct proof showed re-scoring by link position would demote two-thirds of the correct legacy handles.
- Developer text on Settings is rewritten.

### 6. Paid work runs only when inputs change

Design discovery becomes a lifecycle step keyed on its inputs (assigned profiles and newest post). No time-based expiry, failures are stored with a retry schedule, and references a person added are never replaced. The setup page only reads what is stored. This lands first, before 20 Oct 14:35 Israel time.

### 7. What is removed

The readiness gate, "Your calendar is being set up", the staff note linking to setup, every failed-plan message, the posts-per-week requirement (the field stays as an optional override), the needs-setup alert, the rebuild-reasons and merge-memory actions, the "Needs tracking" and "Connect RivalIQ tracking" steps, the required "Confirm top 3", the default pillars, the UTC default, "Your dashboard is being set up", and every empty state that asks for setup. Guard tests stop them coming back: the planner can never fail for missing cadence, and no component may render a raw status, platform, date or error string.

### 8. What stays with people

- Creating a client: a name and a website.
- Adding the client's accounts to Moburst's Sprout account, outside the app. The app picks them up within a day.
- Changing anything the product produced: competitors, pillars, accounts, cadence, design settings, copy.
- Revise notes and copy edits, which teach the memory.
- Workspace connections, once per workspace (n8n links, Higgsfield and Canva sign-in). Tokens refresh on their own; a revoked token is an outage alert.
- Scheduling each post to Sprout (Decision 4).

## Lital's decisions (19 Oct)

1. **RivalIQ tracking connects automatically** when a client's competitor set is confirmed, using paid company slots for the client and its three competitors.
2. **Design settings are derived automatically** (logo from the site, placement measured from the client's own posts, brand colors). Staff can change them. This replaces the 12 Oct one-time staff confirmation.
3. **Every planned post gets a design automatically.** Automatic designs are on by default for every client.
4. **Staff keep scheduling each post to Sprout.** Publishing stays a staff action; the product prepares everything up to it.

## Proof before building

Run on Bader, Moburst, Pay The Pyper and the archived clients that have data. Nothing is written to client data.

| Piece | Pass bar |
|---|---|
| Cadence | A non-empty plan rhythm for every client; Bader and Moburst unchanged |
| Sprout matching | Reproduces all 10 hand-made assignments, no wrong picks |
| Timezone | Bader resolves to Eastern from its Georgia offices; Pay The Pyper matches its hand-set New York |
| Engagement rate | Report 1c4f4805 recomputed with one formula for every company; the Sprout field that marks the 29 posts identified |
| Topics | Stored topics re-keyed; known duplicate pairs merge (about 3 Sonnet calls) |
| Captions | All 281 decoded, no other text changed |
| Handles | The 272 legacy rows re-scored; "b985fm" rejected |

The full lifecycle for a new client (brand research, brief, pillars, competitors, voice, two plans, first report) costs model and Firecrawl credits that I will measure on one test client, with your OK first.

## Build and release order

1. Design discovery off page views (before 20 Oct 14:35 Israel time).
2. Shared layers: metrics, display, counts, statuses, active clients.
3. Calendar: cadence, no gate, retries, worded-when-shown reasons, daily sweeps, production rules.
4. Pipeline recovery: retries, timeouts, system actor, worker-driven RivalIQ setup, archived schedules.
5. The client lifecycle, and the setup page as its view.
6. One-time data passes over every row: captions, handle re-score, held state, structured last result.
7. Removals and guard tests.
8. Release through the recorded migration path, so the database history matches the repo again.

**Verification after release:** Pay The Pyper goes from nothing to matched accounts, client access, planned weeks and a first report, with nobody touching it. That is the test of the whole design.

## Session-run operations and what replaces each

| Operation | Replaced by |
|---|---|
| Pay The Pyper RivalIQ connect | Lifecycle step 6 (Decision 1) |
| Empty-post revisions | Daily copy sweep |
| Moburst memory merge | Monthly voice job merge, every client |
| Rhythm written by SQL | Cadence resolved at plan time |
| Reason rebuild | Reasons worded when shown |
| Hand-applied migrations | Recorded migration path |

The app-wide layout pass Lital asked for comes after this release.
