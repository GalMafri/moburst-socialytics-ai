# Socialytics: social strategy for any client the Social team adds, on Sprout or not

**Status: Proposed 12 Nov 2026, awaiting Lital's approval.** Nothing in this spec has been built, deployed, called or paid for.

Depends on: `2026-11-12-competitor-analysis-in-house-design.md` (called "spec 1" below), which defines the shared public profile reader, profile confirmation, the tables `social_profiles`, `brand_profiles`, `social_profile_snapshots`, `social_posts`, `social_post_metrics`, `social_reads`, the fact module, the lifecycle steps `profiles` and `competitor_profiles`, and the readiness rule. This spec uses them by reference and does not repeat them.

How this spec was made: from `proposal-documented-first.md` section 4 (the judges' best pick, which ships the strategy directive right after the reader), with the progress states and plain end result from `proposal-reuse-first.md` 4.1, the name-first dialog and "Write again" allowed-list change from `proposal-quality-first.md` C.1 and C.3, and the corrections listed in section 13. A builder then read both specs against the code on main 7b8397b; every answer, call and rule fix from that check is in the text, and section 10 lists the calls. Repos: `moburst-socialytics-canva` is main at 7b8397b (live). `fn/` means `supabase/functions/`. Code facts come from `understand-strategy.md` (file:line), rechecked where marked.

---

## 1. Intent

Lital, 12 Nov 2026: "social strategy should be available for any client the social team adds even if they're not on sprout, meaning they will be able to ask who they want to set up the strategy for and create it within the app."

Why it is needed today (`understand-strategy.md`):

- There is no "create a strategy" action anywhere. A strategy is a by-product of the client lifecycle (brand read, brief and pillars, competitors, trend profile, then `content_strategy`). Staff cannot start it, rerun it or watch it. The page shows a static "No strategy yet. Written once the client's brief and trend profile are ready." (`src/pages/ClientStrategy.tsx:186`).
- `lifecycle_request` refuses `content_strategy` and `trend_profile` (latest definition `supabase/migrations/20261109120000_claude_connector.sql:225-250`, allowed list at 238; rechecked 12 Nov).
- Without Sprout, the chain starts only if the brand has a website, a typed brief or an uploaded strategy document; otherwise `brief_pillars` waits forever (`fn/_shared/lifecycle/steps.ts:490-491`) and `website` never starts (`steps.ts:301-307`).
- Without Sprout the starting numbers are weak: Facebook, YouTube and X have no reader, Instagram is read 12 posts deep, hidden likes become 0 (STRATEGY-01), handles come only from homepage links or hand entry on a tab named "Sprout Social", and planned cadence ignores the brand's public pace.
- All 14 active clients have Sprout profiles and a strategy, so the no-Sprout path has never run in production; it is proven only by two tests and two single platforms (Olo LinkedIn, European Wax Center TikTok).

---

## 2. Goals, non-goals, anti-goals

Goals

- G1. From the Strategy page, staff name who the strategy is for (an existing client or a brand not yet in the app) and the app produces it with no further input.
- G2. A brand with no Sprout profile gets a strategy built from its website, its confirmed public profiles, its competitors and trends, at the same quality bar as a Sprout client wherever public data allows.
- G3. Staff always see where a strategy stands, and can ask for a rewrite.
- G4. When the brand later appears in Sprout, the strategy upgrades to measured numbers by itself and keeps people's edits.
- G5. No vendor, pipeline or developer words on the page, PDF or deck.

Non-goals

- A strategy for a prospect that is not a client, a second strategy per client, or a history of earlier versions (`content_strategies.client_id` stays the key).
- Designs, videos and publishing for a client with no Sprout profile: design references are learned from Sprout posts with media and publishing goes through Sprout. They start by themselves when Sprout data arrives (section 4.2). Design references from stored public post images are a later follow-up.
- A monthly social performance report built from public data (decision 1).
- Client users opening the strategy page. It stays staff only, as the routes already are (`src/App.tsx:78-79`); clients get the PDF or deck as today.
- The exports' internals (STRATEGY-05, -06, -08) beyond wording.

Anti-goals

- A required form beyond identifying the brand.
- Any state that waits forever or shows nothing. Every chain ends in a strategy or in a plain result on the page.
- A strategy written from unconfirmed profiles.
- A number written by a model; a "0" where the value is unknown.
- "Sprout", "RivalIQ", "Apify" or pipeline words outside the Sprout integration's own settings.

---

## 3. What exists today

| Part | Where | State |
|---|---|---|
| Strategy index | `src/pages/StrategyIndex.tsx:17, 27, 30-45`; `src/lib/activeClients.ts:20` | Cards "View strategy"; no create control; API demo copies listed among the clients. `activeClients.ts` is the one list every screen reads, and the dashboard shows demo copies on purpose with a "Demo" badge (`AdminDashboard.tsx:236`) |
| Strategy page | `src/pages/ClientStrategy.tsx:47-60, 145, 161, 177, 186`; routes staff only (`src/App.tsx:78-79`) | Client switcher, exports, pencil per card; no write or rewrite control |
| Chain | `fn/_shared/lifecycle/steps.ts`: `website` 301-349, `brand_read` 381-387, `brief_pillars` 486-593, `accounts` 631-687, `social_read` 697-700, `competitors` 778-830, `trend_profile` 845-861, `content_strategy` 919-962 | Rewritten when the inputs key moves and every 30 days (`steps.ts:920`); newest client took 97 minutes from creation to a strategy |
| Site search by name | `deps.searchWebsiteByName` (`steps.ts:344-349`, `fn/_shared/sprout/website.ts:335`) | Counts a site only when it links one of the client's Sprout profiles |
| Profile search by name | `searchProfiles(name)` (`fn/_shared/competitive/detectHandles.ts:74-83`) | One Firecrawl search across the six platform sites |
| Writer | `fn/_shared/strategy/write.ts` (evidence 209-303, write on `STRATEGY_MODEL` `claude-opus-5-5`, code checks, fact check on `CHECK_MODEL` `claude-sonnet-5-5` at 753-794, save 810-829); pillars on `claude-sonnet-5` (`pillars.ts:262`) | Numbers in code, short fields by the model; last good strategy stays |
| Data basis | `fn/_shared/strategy/basis.ts:22-39, 55-63` | `measured`, `public` (12 or more posts, counted whether or not they have figures), `thin`, `none` |
| Public read | `fn/_shared/strategy/publicRead.ts:11-20, 105-106, 160` | Apify LinkedIn, Instagram (12 posts), TikTok; hidden likes become 0; the profile sync runs inside `content_strategy` (`publicRead.ts:413`) |
| Handles | `fn/_shared/strategy/profiles.ts:24-46`; `src/pages/ClientSetup.tsx:516-541` | From RivalIQ's record or homepage links; typed on a tab named "Sprout Social" |
| Cadence | `fn/_shared/strategy/platforms.ts:170-179` | Staff's setting or the learned rhythm, then the competitors' rate, then the median of every tracked company (`all_tracked`), else none |
| Competitors with no website | `steps.ts:804-806` | Reads Sprout's top post text and follower countries in place of the site |
| Sprout followers | `fn/_shared/sprout/audience.ts` (`lifetime_snapshot.followers_count`) | Already read; the strategy takes followers only from its public read today (STRATEGY-03) |
| Add client | `src/components/dashboard/AdminDashboard.tsx:159-163`; `ClientSetup.tsx:146, 333-335, 350` | Only a name is required; insert triggers `clients_default_schedules` (both monthly schedules), `clients_field_sources`, `clients_lifecycle` (whole chain). No duplicate check: two clients may share a name (`understand-strategy.md` section 7 item 17) |
| First output | `lifecycle_first_output` (`20261019220000_lifecycle_steps.sql:250-310`); inputs key at `steps.ts:1093` | Answers `no_active_schedule` for a client with no schedule; the key carries the schedule count |
| Sprout match | `fn/run-scheduled-jobs/sproutOnboarding.ts:206-212`; `fn/_shared/lifecycle/accounts.ts:86-100` | By brand name or homepage link, every 12 hours. Sprout profiles carry `native_name` and `native_link`, no native id |
| Staff integration settings | `/settings` (`src/pages/Settings.tsx:79`) | Exists; the one place vendor names belong |

---

## 4. The design

### 4.1 The entry point

On `/strategy`, a primary button **New strategy** (staff only). It opens one field:

> **Who is the strategy for?**

- Typing searches the active clients. The Strategy index and this search leave out archived clients and API demo copies. That filter lives on the Strategy index only: `activeClients.ts` stays as it is, because the dashboard shows demo copies on purpose.
- **An existing client** is picked from the list. The app opens its strategy page and, if it has no strategy or its inputs are newer than its strategy, asks for one (`lifecycle_request(client, 'content_strategy')`, section 4.5).
- **No match**: the dialog offers **Add "{typed name}"** with one optional field, **Website or any social profile link**. Save creates the client and starts the chain.

Before creating, the app checks for a duplicate, which nothing does today (`understand-strategy.md` section 7 item 17: two clients may share a name).

- The link's host equals an existing client's `website_url` host or a confirmed profile of a non-archived client: that client opens.
- The typed name matches an existing client's name (`normName`) and no link was given: the existing client is listed first, with a second choice, **A different {name}**, that asks for the link. A link is the only data that tells two brands with one name apart.
- The name matches and the link is on a different host: it is a different brand and is created.

When only a name was typed, the app identifies the brand by itself, in the `website` step:

1. Site search by name, through `deps.searchWebsiteByName` (`steps.ts:344-349`, `fn/_shared/sprout/website.ts:335`). Today it counts a site only when the site links one of the client's Sprout profiles, which a brand without Sprout never has. The new rule: a site counts when its page title or Open Graph site name matches the brand name (`normName` containment, the rule of spec 1 signal S3), and it links at least one profile whose own record matches the brand by name or carries this site's domain as its website. The record comes from the reader's profile call (spec 1 4.7). The site vouches for the profile and the profile's own record vouches for the brand, so neither leans on the other alone.
2. One result: used. More than one: the top three by search rank are shown as cards, each with the site's own icon and its domain, under "Which one do you mean?", with a fourth card, **None of these**, that opens the link field. This is the identification the owner described ("ask who they want"), and it is asked only when the data has more than one real answer.
3. No site: profiles are searched by name with `searchProfiles(name)` (`detectHandles.ts:74-83`) and confirmed by spec 1's signals, the pair rule included: two profiles that match by name and link each other, or carry the same website domain, confirm together. Confirmed profiles are enough to start.
4. Nothing confirmed: the page shows a plain result, "We could not find {name}'s website or social profiles. Add a link and we will start from there.", with the link field. The chain never waits in silence and never writes a strategy from unconfirmed profiles.

A client that is not yet identified costs nothing: no post is read, no trend search runs and no model is called before identification. Only the profile record calls of step 1 or 3 are spent.

A typed link is a person's entry: a website becomes `clients.website_url` (marked theirs in `field_sources`); a profile link becomes a confirmed `brand_profiles` row with source `person`, and its own website field, when present, becomes the website candidate.

"Add client" on the Clients dashboard keeps its full setup form, and its save goes through the same create function and duplicate check, so there is one way a client is made by hand.

### 4.2 What the new client record gets

One kind of client (decision 1). Services follow from data, with no toggle:

| Service | Starts when |
|---|---|
| Strategy, trend profile, weekly trends | Once the brand is identified |
| Competitor set, profile reads, competitive report and feed | Once the brand is identified. The competitive schedule is created at insert as today; the scheduler skips it until the set is ready, and queues the first report when it is (spec 1 4.13) |
| Weekly calendar plans (`first_output`) | As today; planning reads own posts from Sprout, else from the stored public posts. On a plan for a client with no Sprout data, the Design and Schedule controls are hidden: designs need design references and publishing goes through Sprout |
| Monthly social performance report | When the client's first Sprout profile is attached. `clients_default_schedules` stops creating the social schedule at insert; a trigger on `sprout_profiles` insert creates it when missing. The sentence "No Sprout Social profile is connected for this brand yet..." (`fn/_shared/pipelines/social/nodes.ts:287`) can then never be written and is removed |
| Design references, designs, videos | When design references exist, which today needs Sprout posts with media (`steps.ts:737-741`) |
| Portal access (`access` step, company slug) | As today |

Leaving the social schedule out at insert does not break `first_output`: `lifecycle_first_output` answers `no_active_schedule` for a client with none (`20261019220000_lifecycle_steps.sql:250-310`), and the step's inputs key carries the schedule count (`steps.ts:1093`), so the first social report starts by itself when the Sprout trigger creates the schedule.

### 4.3 The chain without Sprout: every dependency and its change

The chain's order with the new step: `website`, `profiles` (the client's own profiles confirmed and read 90 days back, spec 1 4.7), `brand_read`, `brief_pillars`, `accounts`, `competitors`, `competitor_profiles`, `trend_profile`, `content_strategy`. The profile sync that runs inside `content_strategy` today (`publicRead.ts:413`) is gone: by the time the brief is written, the brand's profiles are already confirmed and read.

Numbering from `understand-strategy.md` section 2.

| # | Dependency today | Change |
|---|---|---|
| S1 | `website` runs only with Sprout profiles (`steps.ts:303-306, 320-321, 344-349`) | Runs for every client without a website: the name search and rule of 4.1, and the website field of any confirmed profile |
| S2 | `brief_pillars` waits forever with no site, document, brief or Sprout (`steps.ts:202-205, 490-491`) | Confirmed profiles' bios (the `bio` field of the profile record) and the reader's stored public posts count as input. With nothing confirmed, the step ends with the plain result of 4.1 step 4 |
| S3 | Brief is the raw first 2,500 characters of site text (`steps.ts:547-561`) | A written brief (4.4) |
| S4 | `accounts` writes `primary_platforms` only from Sprout (`steps.ts:642, 662-678`) | Also from confirmed public profiles with a post in 90 days. The Setup line "Accounts added to Moburst's Sprout account are picked up within a day." (`ClientSetup.tsx:929`) is removed |
| S5 | `social_read` only with Sprout (`steps.ts:697-700`) | With no Sprout: the logo fallback is the stored profile picture, location comes from the profile record, and languages from stored post text; follower regions stay Sprout only |
| S6 | Design references and settings need Sprout (`steps.ts:737-741, 1033-1035`) | Unchanged in this spec (non-goal) |
| S7 | Own posts: Sprout, else the RivalIQ feed (`ownedSource.ts:151-155`, `runWeek.ts:130-159`) | Sprout, else the client's `social_posts` |
| S8 | Public read of three platforms, Instagram 12 deep (`publicRead.ts:17-20, 106`) | `publicRead.ts` becomes a query on spec 1's tables: 90 days, every platform the reader reads. This switch is built here, in slice B, and nowhere else |
| S9 | Handles from RivalIQ or homepage links, typed on the "Sprout Social" tab (`profiles.ts:29-46`, `ClientSetup.tsx:533-541`) | Spec 1 discovery and confirmation on `brand_profiles`; the RivalIQ source is removed; public profiles move to a Setup tab named "Social profiles" |
| S10 | "Posting now" only where public posts were read (`platforms.ts:133-137`) | Same rule, now true on every platform the reader reads |
| S11 | Cadence: staff's setting or learned rhythm, then the competitors' rate, then the median of every tracked company (`platforms.ts:170-179`, `write.ts:243`, `runWeek.ts:287-296`) | Staff's setting, then the brand's own pace from all its stored posts, then its competitors' median, else no figure; the `all_tracked` fallback is removed (STRATEGY-12) |
| S12 | Followers only from the public read; none for LinkedIn (`write.ts:188-189`, `publicRead.ts:136`) | From `social_profile_snapshots`; for Sprout platforms from the count the product already reads, `lifetime_snapshot.followers_count` in `fn/_shared/sprout/audience.ts` (STRATEGY-03) |
| S13 | Voice from Sprout or feed posts (`runWeek.ts:779-787`) | From all the brand's own posts, public included |
| S14 | Inputs key includes Sprout networks and reads the `tracking` step's result (`steps.ts:927-932`) | Sprout networks kept; `tracking` replaced by a hash of the set of the client's confirmed profiles that have a finished first read. No read date is in the key: a date would move every week and rewrite every strategy weekly, against the 30-day rule |
| S15 | "From Sprout", "Instagram from Sprout", "Impressions, reach and engagement from Sprout" (`strategyView.ts:75, 119`, `basis.ts:76-86`, `Baseline.tsx:77`, `sections.ts:78`) | Source-neutral words (4.7) on page, PDF and deck |
| S16 | Monthly report sentence about Sprout (`social/nodes.ts:287`) | Never written (4.2) |
| S17 | `competitors` for a brand with no website reads Sprout's top post text and follower countries (`steps.ts:804-806`) | The post text comes from the brand's stored public captions; follower countries stay Sprout only, and without them the brand's own `geo` is used as today |

Also removed from the strategy path: the feed and "tracked" set reads (`publicRead.ts:192-223, 383, 395`), the tracking wait lines (`display.ts:594-596`), "From RivalIQ" and "None found yet. They are read from RivalIQ and the client's website within a day." (`PublicProfiles.tsx:25, 87`), "An admin connects it once in Settings." (`StrategyExports.tsx:107`).

### 4.4 What the strategy is built from without Sprout

| Part | Source | Code or model |
|---|---|---|
| Platforms in play | "Posting": a confirmed profile with a post in 90 days. "New": the trend profile's suggestions where the brand is absent (at most two, as today). Threads and Pinterest are not listed | Code |
| Where we start | The per-brand facts of spec 1's fact module over 90 days: posts per week, consistency, median settled engagement, engagement per 1,000 followers, per 1,000 views on video, followers and change, format mix. This slice builds that per-brand part of the module (spec 1 4.11) | Code |
| YouTube before Google's grant | Only what YouTube's API returns as it is: subscribers, total videos, and each recent video's views, likes and comments. No rate, no median and no count worked out by the product. The figures are read from the tables when the page loads and are never stored in the strategy, so the 30-day rule holds (spec 1 4.3 and 4.10). Planned YouTube cadence is staff's setting, else no figure | Code |
| Data basis per platform | Six values. `measured` (Sprout). `public` (12 or more posts with figures in 90 days; today's code counts posts, and a post with hidden likes has no figure, so the count changes to posts with a figure, `basis.ts:22`). `thin` (1 to 11). `no posts found` (a confirmed profile read in full, with no posts in 90 days). `not measured` (candidates and none confirmed, or a read that did not finish). `absent` (spec 1's meaning: every discovery source answered and found no profile) | Code |
| Planned cadence | S11 | Code |
| Competitor bars | Per-brand facts for the three competitors, same window and definitions, spec 1's minimum samples | Code |
| What worked | The brand's own outperformers (spec 1), stored as post ids and drawn with stored images | Code |
| Goals | Model picks platform, metric and direction; code allows only metrics the platform's basis supports (existing `basis.ts:55-63`). Engagement per 1,000 followers becomes an allowed public metric. YouTube before the grant allows only subscribers | Model picks, code checks |
| Brief | Written in the call that already derives pillars (`claude-sonnet-5`, `pillars.ts:262`), from site text, profile bios and up to 60 recent captions. Code checks: no word from spec 1's vendor word list, American spelling, no dash as punctuation; then one fact check against the inputs on `CHECK_MODEL` (`claude-sonnet-5-5`, `write.ts:56`), as the strategy writer does | Model, checked |
| Voice | From the brand's public captions | Model, existing |
| Audience, positioning, avoid | Brief, site text, trend profile, competitor facts | Model, existing |
| Industry trends | Trend profile and weekly themes | Existing |

The model computes no number; the writer's existing number check and fact check stay (`write.ts:14-31, 753-794`).

### 4.5 Progress, and asking for a rewrite

**Page state**, derived from `client_lifecycle_steps` and `social_reads`, shown on the strategy page and on each index card in place of "No strategy yet":

| Chain position | Words on the page |
|---|---|
| `website` running (brand identification) | "Finding {brand}'s website" |
| `profiles` running | "Finding {brand}'s profiles", then "Reading the last 90 days of posts" |
| `brand_read` running | "Reading {brand}'s website" |
| `brief_pillars` running | "Writing the brief" |
| `accounts` running | "Choosing platforms" |
| `competitors` running or waiting on its own draft | "Choosing competitors" |
| `competitor_profiles` running | "Reading competitors' posts" |
| `trend_profile` running or waiting | "Reading industry trends" |
| `content_strategy` running | "Writing the strategy" |
| A rewrite running | The current strategy stays visible with "Updating" beside its date |
| A rewrite that failed | "Updating" goes and the old written date stays; the lifecycle tries again the next day. Nothing else changes on the page |
| Done | The strategy, with "Written November 12" |
| Ambiguous name | "Which one do you mean?" cards (4.1) |
| Nothing found | "We could not find {name}'s website or social profiles. Add a link and we will start from there." |
| A step failed and is retrying | The last state stays; a step that keeps failing past the runner's tries shows "We could not finish this strategy yet. We try again tomorrow." and the lifecycle retries daily |

**Write again**: one button on the strategy page. It calls `lifecycle_request(client, 'content_strategy')`. A new migration redefines `lifecycle_request` from its latest version (`20261109120000_claude_connector.sql:225-250`), keeping the connector guard, the staff check and the 30-minute running guard, and adds `content_strategy` and `trend_profile` to the allowed list. Without this, the call raises "Unknown step". Spec 1's slice 1 migration changes the same function to swap `tracking` for `profiles` and `competitor_profiles`; whichever ships second starts from the other's definition. People's section versions (`content_strategy_edits`) stay; numbers are always the product's current ones (STRATEGY-04). No other control is added.

### 4.6 When the brand later appears in Sprout

No step by anyone:

1. The weekly Sprout job and the `accounts` step already attach profiles by brand name or homepage link (`sproutOnboarding.ts:206-212`, `accounts.ts:86-100`). A third match is added and checked first: the Sprout profile's handle (`native_name`) or link (`native_link`) equals the handle or URL of one of the client's confirmed profiles. Sprout profiles carry no native id in the code or the table, so handle and link are the match.
2. The inputs key includes the Sprout networks (`steps.ts:927-932`), so the strategy rewrites; those platforms move to `measured`, with followers from Sprout.
3. The reader stops reading the client's own profile on a platform Sprout now covers, except X, which Sprout does not feed for the client (`fn/_shared/competitive/ownedSource.ts:153`, rechecked). Stored public history stays.
4. The monthly social report schedule is created (4.2); `social_read` and design references start because their inputs now exist; Design and Schedule appear on the calendar plans.
5. People's edits stay.

### 4.7 Screens and words

- **Strategy index**: New strategy button; cards show the state from 4.5 or "Written {date}". No demo copies.
- **Strategy page**: state, Write again, the strategy. Basis chips, one per value in 4.4: "Measured", "Public posts", "Few public posts", "No public posts found", "Not measured", "Not on this platform".
- **PDF and deck**: the same chip words; no source names.
- **Client setup**: the public profiles box moves from the "Sprout Social" tab to a tab named "Social profiles", listing each confirmed profile with its evidence in plain words (the lines in spec 1 4.14, for example "Linked from their website"). Staff can add, replace or remove one; their entry wins. The Sprout profile picker stays on the "Sprout Social" tab, which is that integration's own settings.
- **Calendar plans** for a client with no Sprout data: the plan and its posts, without the Design and Schedule controls (4.2).
- Vendor names appear only on `/settings` (`Settings.tsx:79`).

### 4.8 Failure handling

| Case | What happens |
|---|---|
| Name matches nothing | Plain result with the link field (4.1). Chain stops there and resumes when a link is added |
| Website found but refuses to be read | The chain continues from confirmed profiles; brand read fields stay default and are marked default (DS-21) |
| No competitor with a confirmed profile | `competitors` swaps in the next candidates (spec 1 4.7); if none qualifies, it settles with what it has, the trend profile and strategy proceed, and the strategy's competitor section reads "Competitor comparison is not available yet" |
| Reader route failing | Spec 1 4.8: the strategy uses the last good stored data with its date; a read that failed is never "no posts" |
| Model call fails checks | The existing writer rule: re-ask, fix, re-check; the last good strategy stays; a new client with no strategy yet shows the retry state of 4.5 |
| The brief fails its checks twice | The brief step retries on the lifecycle's daily retry; the strategy is not written from an unchecked brief |

---

## 5. Migration and what is retired

- Existing 14 clients: their inputs key gains the confirmed profile set, so each strategy rewrites once when slice B ships, with public figures on every platform read and source-neutral words. People's section versions stay.
- Public profile rows move into `brand_profiles` (spec 1 5.1). The "Sprout Social" tab loses the public profiles box.
- `clients_default_schedules` stops creating the social schedule at insert; existing schedules are untouched.
- Retired: `publicRead.ts`'s three readers and its profile sync inside `content_strategy`, the RivalIQ source in `profiles.ts:35-40`, the `all_tracked` fallback (`platforms.ts:178`, `runWeek.ts:205-208, 289`), the copy listed in 4.3, the 2 Nov text paths no stored strategy uses (`Baseline.tsx:21-28, 80-117`, STRATEGY-28).

---

## 6. Cost

Per client added through New strategy, at the planning pace (sources in spec 1 section 6; Anthropic prices rechecked 12 Nov 2026 at https://platform.claude.com/docs/en/about-claude/pricing: Opus 5.5 USD 4 in and 20 out per million tokens, Sonnet 5.5 and Sonnet 5 USD 2 and 10):

| Line | Per month | Source |
|---|---|---|
| Profile reads for the brand and its competitors | About USD 2.20 while Meta is interim, USD 1.30 after approval | Spec 1 6.5 |
| Competitive analysis, fact check and weekly labels | About USD 0.50 to 0.75 | Spec 1 6.2 and 6.5 |
| Weekly trends (existing feature, now also for this client) | About USD 5.15 (USD 1.19 a client week measured, x 4.33) | `understand-readers.md` section 5 (`trend_weeks.cost`) |
| Weekly calendar plan (existing feature, now also for this client) | About USD 0.48 (USD 0.112 a plan x 4.33) | Database, read today: 41 `week_plan` jobs for 15 clients, 19 Oct to 11 Nov, average 7,056 tokens in and 4,170 out on Opus 5.5 (`COPY_MODEL`). Plan revisions and the voice profile store no token use; unconfirmed |
| Strategy rewrite (at least every 30 days) | At most about USD 0.15 to 0.70 a write | Stored usage per write (`proposal-reuse-first.md` 5.1), computed there at Sonnet 4.6's price for the check; the code's check model, Sonnet 5.5, costs less |
| **Total per added client** | **About USD 7.60 to 9.30 a month** | Of it, about USD 6.40 lands on the shared Apify account while Meta is interim (trends plus reads), about USD 5.50 after |
| One time: first 90-day read, first theme labels, brief with its check, discovery | About USD 2.80 + 0.25 + 0.09 + 0.03 = about USD 3.20 | Spec 1 6.3 and 6.4; brief assumed 15,000 tokens in and 2,000 out on Sonnet 5 (USD 0.05) and its check 15,000 in and 1,000 out on Sonnet 5.5 (USD 0.04) |

One time at release: the 14 existing strategies rewrite once, about USD 2 to 10 in model use (14 x 0.15 to 0.70).

Storage and Vercel use grow with each client in proportion to spec 1 6.4 (about 0.015 GB of thumbnails a month per client; the storage price is unconfirmed there).

---

## 7. Risks

1. The no-Sprout chain has never run in production. Slice C is its first real run, on the live app.
2. A name can match the wrong brand. The site must match by title and link a profile whose own record matches; more than one real answer is shown as cards; the duplicate check stops a second client for the same brand.
3. Brands with very little public activity get thin strategies. Basis chips say so; goals use only supported metrics; nothing is filled with zeros.
4. Each added client adds about USD 7.60 to 9.30 a month, mostly weekly trends, and about USD 6.40 of it on the shared Apify account. Stated in decision 2.
5. The strategy reads spec 1's tables, so spec 1's risks apply (Meta review, YouTube amendment, public collection terms, Apify token and headroom, Vercel dependency).
6. A brand added for a strategy gets calendar plans and a competitive report too, so spend and staff lists grow with every strategy request. Decision 1 is where this is chosen.
7. Two states wait on a person: the "Which one do you mean?" cards and the "Add a link" result. Both are identification, both cost nothing while they wait, and decision 3 is where they are accepted or refused.
8. YouTube before Google's grant gives the strategy less: no rate, no pace worked out from uploads, and no planned YouTube cadence unless staff set one. This is the price of staying inside YouTube's policy as written.

---

## 8. Build order

Each slice ships something working. Durations are my estimates from 12 Nov 2026.

| Slice | Builds | Ships | Depends on | Estimate |
|---|---|---|---|---|
| A. Entry, states, rewrite | New strategy dialog for existing clients, page and card states, Write again, the `lifecycle_request` migration, demo copies off the Strategy index | Staff can start, watch and rerun any existing client's strategy | Nothing; can run during spec 1 slice 1 | About 3 days |
| B. Any brand, without Sprout | Add by name or link with the duplicate check, name identification, the per-brand part of the fact module, `publicRead.ts` switched to the tables, S1 to S17 changes, written brief, six basis values and their words, Setup "Social profiles" tab, social schedule rule, calendar controls hidden without Sprout data, copy removals | A strategy for a brand that is not on Sprout, from one field | Spec 1 slice 1 (reader, confirmation, `profiles` step) | About 1.5 weeks after spec 1 slice 1, to about 9 Dec |
| C. Sprout upgrade and first real run | Handle and link match, reader stop on Sprout platforms, end-to-end proof | The upgrade path, and the first production run of the no-Sprout chain | Slice B | About 2 days, to about 11 Dec |

---

## 9. Tests, and how each slice is proved

| Slice | Tests | Proof |
|---|---|---|
| A | `lifecycle_request` accepts `content_strategy` and `trend_profile` for staff and refuses connector sessions; state mapping from lifecycle rows for each position in 4.5, the failed rewrite included; the Strategy index excludes demo copies and the dashboard still shows them | On the live app: Write again on one existing client produces a new written date and keeps a person's section edit |
| B | Name with one matching site; a site whose title matches and whose linked profile's record does not match is refused; ambiguous name with two sites and with five (top three plus "None of these"); name with no site and two profiles that confirm as a pair; name with one lone name match (plain result, no wait, no read); a typed profile link whose website becomes the site candidate; duplicate check by host, by name alone, and a same-name brand on a different host; full chain from an insert with a name only to a stored strategy on recorded reader fixtures (today's tests start from an existing trend profile); hidden likes stay unknown and do not count toward `public`; a confirmed profile with no posts gives "No public posts found"; YouTube shows only the API's own figures and none is stored in the strategy; cadence from the brand's own pace; the inputs key does not move when a weekly read lands; `competitors` for a brand with no site uses stored captions; no vendor word in page, PDF or deck strings; no social schedule at insert, one created on the first Sprout profile, and `first_output` starts the first social report then; a plan without Sprout data shows no Design or Schedule control | A brand the Social team serves that is not on Sprout (decision 4), added from New strategy on the live app, reaches a written strategy; numbers checked against the tables; PDF and deck checked for words |
| C | A Sprout profile whose handle or link equals a confirmed profile attaches first; basis moves to measured; people's edits kept; reader stops reading that platform except X | The same brand, once connected in Sprout by the team in their normal work, upgrades without anyone acting in Socialytics |

---

## 10. Calls I made

### From the proposals and the judges

1. Strategy ships right after the reader (judges 1 and 3 faulted quality-first for putting it last); slice A does not even wait for the reader.
2. One dialog: search existing clients first, then add by name with one optional link (quality-first C.1), shared with "Add client" (reuse-first 4.1).
3. Ambiguous names are shown as at most three cards plus "None of these", the only question asked, because it identifies the brand.
4. No strategy from unconfirmed profiles (judges faulted documented-first's "thin" case); the plain result replaces it.
5. A duplicate check by name and host before any client is created.
6. The brief is written in the pillars call (`claude-sonnet-5`) and fact-checked on `CHECK_MODEL` (`claude-sonnet-5-5`), the constants the code already has. My first draft named `claude-sonnet-4-6`, which the writer does not use.
7. YouTube before the grant shows only the API's own figures, with subscribers as the only goal metric and no figure worked out by the product, so the design rests on YouTube's policy as written and on no reading of mine.
8. The social report schedule is created by the first Sprout profile and never at insert, so the "not connected" sentence cannot occur.
9. The strategy page stays staff only.
10. Public profiles move to a Setup tab named "Social profiles"; the Sprout picker keeps its own tab.
11. "Write again" is the only new control on the strategy page.
12. The 14 existing strategies rewrite once on release because their inputs change; no separate migration job.

### Settled after the builder's check (12 Nov)

13. The per-brand facts are built here, in slice B, because the strategy is their first user; spec 1 slice 2 adds the set-level part. The `publicRead.ts` switch is built here and nowhere else.
14. The client's own profiles are confirmed and read by spec 1's `profiles` step, which runs before `brief_pillars` and `accounts`. The sync inside `content_strategy` goes.
15. Demo copies are filtered on the Strategy index only. `activeClients.ts` is the list every screen reads and the dashboard shows demos on purpose. My first draft cited STRATEGY-23 for this; that finding is about rewrite state.
16. The Sprout match uses handle and link (`native_name`, `native_link`); Sprout profiles carry no native id.
17. `competitors` for a brand with no website takes its text from stored public captions (S17), a dependency my first draft's table left out.
18. A site counts for a brand only when a profile it links matches the brand by its own record. The first draft's rule was circular: the site counted because it linked a profile, and the profile confirmed because the site linked it.
19. With no site, two name-matching profiles that link each other or share a website domain confirm together (spec 1's pair rule). Without it nothing could confirm.
20. More than three sites: the top three by search rank. A "None of these" card leads to the link field. The card's logo is the site's own icon. A same-name brand on a different host passes the duplicate check; a same-name brand with no link is offered as "A different {name}" and must give a link.
21. The inputs key holds the set of profiles with a finished first read and no read date, so strategies keep the 30-day rhythm.
22. Every chain position has words (4.5), and a failed rewrite returns to the old date.
23. A sixth basis value, "No public posts found", covers a confirmed profile with no posts; `public` counts posts with figures.
24. Calendar plans for a client with no Sprout data hide Design and Schedule until Sprout data exists.
25. An unidentified client runs nothing that costs money beyond the profile record calls.
26. Costs: the weekly calendar plan now has a measured line (USD 0.48 a month per client), and the brief and its check are priced at the code's models.

## 11. Decisions for Lital

The spec is written to each recommendation.

1. **What a brand added for a strategy becomes.** Recommendation: a client like any other, with strategy, trends, competitor analysis and weekly calendar plans from public data at once; the monthly social report, designs and videos start by themselves when the brand's Sprout profiles appear; no monthly performance report built from public data. The alternative is a strategy-only record with no calendar, trends or competitive report until a second service is added, which needs a services field and splits every list in the app.
2. **Spend per added client, and the shared Apify limit.** Recommendation: approve about USD 7.60 to 9.30 a month per client added this way (USD 5.15 of it is weekly trends) plus about USD 3.20 once, and the one-time rewrite of the 14 existing strategies (about USD 2 to 10). About USD 6.40 of each client's month lands on the Apify account all your products share, whose limit is USD 590. Keep the limit and put no cap on added clients for now: the headroom in a normal month covers roughly 23 to 33 more (spec 1 decision 3). The alternative is a cap on added clients, which the product would have to refuse by, and I do not recommend it.
3. **The two moments the dialog asks a person.** "Which one do you mean?" appears when a name has more than one real website, and "Add a link" when nothing can be confirmed. Both wait on staff. Recommendation: accept both. They are the identification you described ("ask who they want"), they appear only when the data cannot tell, they cost nothing while they wait, and the alternative is the app guessing which brand was meant.
4. **The first real brand.** The no-Sprout path has never run in production. Slice C proves it on one brand the Social team serves that is not on Sprout, and that brand becomes a full client at about USD 7.60 to 9.30 a month. Recommendation: name a brand the team is about to onboard, so the proof is also real work. I cannot pick it; the 14 active clients all have Sprout profiles.

## 12. Unconfirmed

1. The no-Sprout chain end to end in production (never run).
2. What `identifyCompetitors` returns for a brand with no website and few captions (`steps.ts:806`, not traced).
3. Token use of the brief writer, plan revisions and the voice profile; Firecrawl's plan and so its cost; the storage price.
4. Whether each route's profile record returns a bio and a location (spec 1 section 12 item 6).
5. Slice durations.
6. Everything listed unconfirmed in spec 1 section 12 that the reader carries.

## 13. Corrections made against the proposals and the first draft

| Claim | Correction | Rechecked in |
|---|---|---|
| Documented-first 4.1 "Write again" queues the step | `content_strategy` is not in `lifecycle_request`'s allowed list, so it would raise "Unknown step"; this spec adds it and `trend_profile` | `20261109120000_claude_connector.sql:238` |
| Quality-first C.3 cites `20261019220000_lifecycle_steps.sql:327` as the definition to change | The latest definition is `20261109120000_claude_connector.sql:225-250`; the new migration starts from it | File read 12 Nov |
| Documented-first 4.1: name with no match proceeds from candidate profiles as a thin strategy | Unconfirmed profiles are never read; the page shows a plain result with a link field | Spec 1 4.7 |
| Quality-first C.1: non-Sprout clients get a monthly performance report from public profiles | Not built; the social report starts with the first Sprout profile (decision 1) | `social/nodes.ts:285-289` is Sprout-based |
| Quality-first D.4: strategy last among features | Slice A ships first and slice B right after the reader | This spec, section 8 |
| Reuse-first: 4 client X profiles | 5 active clients have X, and Sprout does not feed the client's X, so the reader keeps reading X after a Sprout upgrade | `ownedSource.ts:153`; database, 12 Nov |
| Proposals: per-client cost without trends | An added client also gets weekly trends, about USD 5.15 a month, which dominates its cost | `understand-readers.md` section 5 |
| First draft: the name search is "the search `detectHandles.ts` already uses" | The site search is `deps.searchWebsiteByName` (`steps.ts:344-349`, `fn/_shared/sprout/website.ts:335`); `detectHandles.ts:74-83` holds the profile search | Builder's check; files read 12 Nov |
| First draft: `activeClients.ts` gains the demo filter, "fixing STRATEGY-23" | The filter sits on the Strategy index only; STRATEGY-23 is about rewrite state | `AdminDashboard.tsx:236`; `.agents/qa-full/strategy.md` |
| First draft: Sprout match by "native id or handle" | Sprout profiles carry `native_name` and `native_link` only | Builder's check |
| First draft: brief and checks on `claude-sonnet-4-6` | Pillars call `claude-sonnet-5`, check model `claude-sonnet-5-5` | `pillars.ts:262`, `write.ts:56` |
| First draft: weekly calendar planning "not on record" | `week_plan` jobs store their token use: 7,056 in and 4,170 out on average | Database, 12 Nov |

## 14. Sources

- Owner's words and directives: memory note `socialytics-directives-nov12.md` (12 Nov 2026).
- Code: as cited, main at 7b8397b; `understand-strategy.md` (12 Nov 2026).
- External facts: as cited in spec 1 section 14 (all read 12 Nov 2026); Anthropic pricing rechecked 12 Nov 2026 at https://platform.claude.com/docs/en/about-claude/pricing ; YouTube policies https://developers.google.com/youtube/terms/developer-policies and https://developers.google.com/youtube/terms/derived-metrics-policy.
