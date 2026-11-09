# Trends Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the trend scraping inside the monthly social report with a weekly, per-client industry-trends collection that the app steers itself (trend profile), filters for brand fit, groups into themes, and feeds into the calendar, Analytics, Client setup, the monthly report and the API.

**Architecture:** A lifecycle step writes each client's trend profile. A weekly scheduled job starts an in-app pipeline (`trends_v1`) on the existing step runner: six Apify sources, a rule filter in code, one Claude filter pass, one Claude themes pass, and a writer that stores every kept and dropped post with its reason. Every reader (calendar, Analytics, report screen, API) reads the stored weeks; nothing scrapes at read time.

**Tech Stack:** Supabase Postgres + Edge Functions (TypeScript, run under Deno, tested with Vitest), React + shadcn/ui, Apify, Anthropic Messages (Message Batches raced with `claude-direct`).

**Spec:** `docs/superpowers/specs/2026-10-28-trends-redesign-design.md` (approved by Lital on 29 Oct 2026, option A for reports).

## Global Constraints

- n8n is not changed. The three workflows (SZbRTV7yOdXTNHHf, EBiAwSay3H2R8krv, xm3ZFPjysyQCkWsc) stay under the edit freeze.
- Nothing about reports switches before 7 Nov. Any deploy of `run-scheduled-jobs` before 7 Nov must leave `social_v1` and `competitive_v1` behavior unchanged, proved by `npm test` and a free `replay_social` of run ee82b373 plus a free `replay_competitive` of report 6d9f301c, both matching the earlier runs.
- Client screens show no raw errors, IDs or pipeline wording. American English. UI copy follows the org writing standard (no em dashes).
- Models: `claude-opus-5-5` for the profile and the themes, `claude-sonnet-5-5` for the filter and the search rewrite.
- Secrets: `APIFY_API_TOKEN` and `ANTHROPIC_API_KEY`, both already set. No new secrets, no new accounts, nothing from Gal.
- Budgets from the spec: 7-day window; about 25 posts per search; at most 200 posts per platform per week; at most 60 candidates per platform reach Claude; at most 10 kept per platform per week; 3 to 6 themes; coverage floor 5 kept per platform per week.
- Nobody has to fill anything in. A person's add or remove of a topic, hashtag or exclusion is never overwritten.
- Same rules for every client. No client names in code.
- Paid runs: recording source fixtures (a few cents) and the 5 Nov trial are inside the approved design. Any other paid run needs Lital's OK first.
- Release routine: push `canva-finish:main`, wait for Lovable's `latest_commit_sha`, ask Lovable to deploy the named edge functions only, `deploy_project` for the frontend. Apply each migration and record it the way the 20 Oct migrations were.
- Test command for backend tasks: `npx vitest run <path>`. Full suite before every release: `npm test`.

## Spec Corrections Found While Planning

These follow from the code as it is today. None changes what Lital approved.

1. **"Active" clients.** `calendar_client_ready` was dropped on 19 Oct (`20261019190000_calendar_self_serve.sql:286`). The Monday calendar now plans for every client with `archived_at is null` and not `exclude_from_reporting`. Trends uses that rule plus `demo_job_id is null`. Today it gives the same three clients: Bader Law, Moburst, Pay The Pyper.
2. **Feed weekday.** `feed_refresh_weekday(client_id)` is a hash of the client id (0 to 6, UTC), not a column. `trend_refresh` uses the same function for every active client, with or without RivalIQ.
3. **Own posts and site text are not stored.** The profile reads own posts through the calendar's `ownPosts()` (Sprout, 90 days) and competitor posts from the newest 14 `rivaliq_snapshots` feed rows. Site text is read the way `brief_pillars` reads it (`deps.scrapeMarkdown`, `cleanSiteText`, `deps.fetchSiteText`).
4. **Monthly hashtag refresh** runs as its own lifecycle step, `trend_hashtags`, keyed on the calendar month. It does the same job as "the first trend run of each month" and keeps profile writes out of the pipeline.
5. **"Inspired by"** does not exist in the app yet. Competitor evidence shows through `PostReason` ("View the post"). Task 9 adds the "Inspired by" line for trend evidence.
6. **Report screen for every engine.** The report screen and the API read the stored themes for the report's date range directly. That covers reports written by n8n and by the app the same way, so option A needs no n8n-specific code.

## Review Focus

1. **A client with no profile yet** (no brief, no pillars, no site): the profile step waits, and `trend_refresh` queues nothing for that client, so no paid scrape runs. Test in Task 2 and Task 7.
2. **A non-English client** (`language` other than `en`): the rule filter keeps only posts in the client's language, and a week with zero kept posts finishes as a coverage gap, never a failed run. Test in Task 4 and Task 6.
3. **Claude's filter answer is wrong** (unknown post ids, a missing decision, fit outside 0 to 100): it's re-asked once. A second bad answer finishes the week as `partial` with every candidate stored and no posts kept. Test in Task 5 and Task 6.
4. **A person removed a suggested hashtag, then the profile is rewritten:** the term never comes back, and terms a person added survive. Test in Task 2.
5. **One source fails or returns nothing:** that platform is marked `failed` or `empty`, and the other platforms, the filter and the themes still finish. Test in Task 6.

---

## Phase 1: stored only (Thu 29 Oct to Wed 4 Nov, trial Thu 5 Nov)

### Task 1: Trend tables, RPCs and the `trends` pipeline kind

**Files:**
- Create: `supabase/migrations/20261029100000_trends.sql`
- Modify: `supabase/functions/_shared/pipelines/types.ts:19-31` (kinds), `supabase/functions/_shared/pipelines/store.ts:214-221` (`REAL_WRITERS` type), `supabase/functions/_shared/pipelines/secrets.ts:32` (`PIPELINE_SECRETS` type)
- Create: `supabase/functions/_shared/trends/types.ts`

**Interfaces:**
- Produces (TS): `export type PipelineKind = ReportKind | "trends"`; `RealTable` gains `"trend_weeks"`; `PipelineRun.kind`, `PipelineDefinition.kind`, `REAL_WRITERS` and `PIPELINE_SECRETS` are keyed on `PipelineKind`. `SHADOW_TABLE`, `report_engines` and the placeholders stay on `ReportKind` (trends has no shadow mode).
- Produces (`trends/types.ts`): `TrendPlatform = "tiktok" | "instagram" | "linkedin" | "youtube" | "pinterest" | "facebook"`, `TREND_PLATFORMS`, `HashtagPlatform = "instagram" | "tiktok" | "linkedin"`, `TrendFormat = "short_video" | "long_video" | "carousel" | "image" | "text" | "pin"`, `RuleDrop = "duplicate" | "outside_window" | "language" | "own_or_competitor" | "over_cap"`, `DropReason = "off_topic" | "scheme_or_spam" | "job_ad" | "giveaway" | "wrong_audience" | "own_or_competitor" | "low_quality"`, `TrendPost`, `TrendProfile`, `KeptPost`, `Theme` (fields below).
- Produces (SQL): the tables and RPCs below.

```sql
-- Tables (service role writes; RLS select as noted)
trend_profiles (client_id uuid pk -> clients on delete cascade, audience text not null,
  fit_rubric text not null, platforms jsonb not null /* [{platform, reason}] */,
  search_overrides jsonb not null default '{}' /* {platform: [search]} from the coverage rewrite */,
  inputs_key text not null, written_at timestamptz not null default now(), hashtags_at timestamptz)
  -- select: is_moburst_staff()
trend_terms (id uuid pk, client_id uuid -> clients cascade,
  kind text check in ('topic','hashtag','exclusion'),
  platform text null check in ('instagram','tiktok','linkedin'), check ((kind='hashtag') = (platform is not null)),
  term text not null, reason text not null default '',
  source text check in ('lifecycle','person','dismissal'),
  removed_at timestamptz, removed_by uuid, created_at timestamptz default now())
  unique index (client_id, kind, coalesce(platform,''), lower(term))
  -- select: is_moburst_staff()
trend_weeks (id uuid pk, client_id -> clients cascade, week_start date not null,
  status text default 'running' check in ('running','done','partial'),
  platforms jsonb default '{}' /* {platform: {status:'ok'|'empty'|'failed'|'not_watched', searched, candidates, kept}} */,
  filter_status text check in ('ok','failed','skipped') null,
  cost jsonb default '{}' /* {apify_usd, claude:{<model>:{input_tokens,output_tokens}}} */,
  created_at, finished_at, unique (client_id, week_start))
  -- select: is_moburst_staff()
trend_posts (id uuid pk, week_id -> trend_weeks cascade, client_id, platform text, url text not null,
  author text, text text, posted_at timestamptz null, format text null, views, likes, comments, shares, saves bigint,
  engagement numeric, search text, kept boolean not null default false,
  drop_reason text null, fit smallint null check (fit between 0 and 100), why text, lesson text,
  tripwire boolean not null default false, created_at, unique (week_id, url))
  -- select: is_moburst_staff() or (is_client_member(client_id) and kept)
trend_themes (id uuid pk, week_id -> trend_weeks cascade, client_id, position smallint,
  title text, happening text, why_it_matters text, angle text, platforms text[], post_ids uuid[],
  dismissed_at timestamptz, dismissed_by uuid, created_at)
  -- select: is_moburst_staff() or is_client_member(client_id)

-- RPCs, security definer, each raises unless is_moburst_staff()
trend_term_add(p_client uuid, p_kind text, p_platform text, p_term text) returns uuid
  -- source 'person'; clears removed_at if the same term exists
trend_term_remove(p_id uuid) returns void        -- sets removed_at/removed_by; the row stays as a tombstone
trend_theme_dismiss(p_theme uuid) returns void   -- sets dismissed_at/by; adds an exclusion
  -- (kind 'exclusion', term = title, reason = happening, source 'dismissal')

-- Existing constraints widened
report_pipeline_runs.kind adds 'trends'; real_table adds 'trend_weeks';
report_pipeline_runs_app_target adds: kind = 'trends' and real_table = 'trend_weeks' and real_id is not null
```

`TrendPost`: `{ platform: TrendPlatform; url: string; author: string; text: string; posted_at: string | null; format: TrendFormat | null; views: number; likes: number; comments: number; shares: number; saves: number; engagement: number; search: string }`.
`TrendProfile`: `{ audience: string; topics: Term[]; hashtags: Record<HashtagPlatform, Term[]>; exclusions: Term[]; fit_rubric: string; platforms: Array<{ platform: TrendPlatform; reason: string }> }` with `Term = { term: string; reason: string }`.
`KeptPost`: `TrendPost & { fit: number; why: string; format: TrendFormat; lesson: string }`.
`Theme`: `{ title: string; happening: string; why_it_matters: string; angle: string; platforms: TrendPlatform[]; post_urls: string[] }`.

- [ ] **Step 1:** Write the migration. Rebuild the kind constraints the way `20261020110000_inhouse_groundwork.sql:212-229` rebuilds `scheduled_jobs.kind`.
- [ ] **Step 2:** Widen the TS kinds. Run `npx vitest run supabase/functions/_shared/pipelines`. Expected: PASS, with no other test changed.
- [ ] **Step 3:** Apply the migration. Verify with `select table_name from information_schema.tables where table_name like 'trend_%'` (5 rows). Then call `trend_term_add` as the service role and expect the "staff only" error.
- [ ] **Step 4:** Commit: `git commit -m "Trends: tables, staff RPCs and the trends pipeline kind"`.

### Task 2: Trend profile lifecycle steps

**Files:**
- Create: `supabase/functions/_shared/trends/profile.ts`, `supabase/functions/_shared/trends/terms.ts`, `supabase/functions/_shared/trends/profile.test.ts`
- Modify: `supabase/functions/_shared/lifecycle/steps.ts` (two steps after `competitors` in `STEPS`), `supabase/functions/_shared/calendar/runWeek.ts:93,129` (export `ownPosts` and `feedSnapshots`, no behavior change)

**Interfaces:**
- Consumes: `anthropicMessages` (`_shared/anthropic.ts:82`), `deps.anthropicKey`, `deps.scrapeMarkdown`, `cleanSiteText`, `deps.fetchSiteText` (`lifecycle/steps.ts`), `ownPosts`, `feedSnapshots`, `topCounts` (`competitive/postSample.ts:96`), `textHash` (`lifecycle/names.ts`).
- Produces:
  - `TREND_PROFILE_MODEL = "claude-opus-5-5"`
  - `profileEvidence(db, client, now): Promise<ProfileEvidence | null>`: null when there is no brief, no pillars and no site text.
  - `hashtagCounts(texts: string[]): Record<string, number>`, using the regex `/#[\p{L}0-9_]+/gu` and lowercasing.
  - `profileRequest(e: ProfileEvidence)`
  - `parseProfile(text, e): { value: TrendProfile } | { error: string }`
  - `profileProblems(p: TrendProfile, e: ProfileEvidence): string[]`
  - `hashtagsRequest(p: TrendProfile, e)`
  - `parseHashtags(text): { value: TrendProfile["hashtags"] } | { error: string }`
  - `writeTrendProfile(db, clientId, p, inputsKey, now)`
  - `syncLifecycleTerms(db, clientId, kind, platform: HashtagPlatform | null, items: Term[])`
  - `activeTerms(db, clientId): Promise<{ topics: Term[]; hashtags: Record<HashtagPlatform, Term[]>; exclusions: Term[] }>`: rows with `removed_at is null`.
  - Steps `trend_profile` and `trend_hashtags` in `STEPS`.

`ProfileEvidence` holds the brief, pillars, brand book text, `social_voice` examples, site text (at most 2,500 characters), geo, language, location, primary platforms, competitor names, and `hashtags: { own: Array<{key, count}>; competitors: Array<{key, count}> }`. The hashtag counts come from the top 30 own posts and the top 30 competitor posts by engagement in the last 90 days.

`trend_profile.inputs()` returns null until `settled("brief_pillars")` and `settled("competitors")`. Otherwise it returns `textHash` of brief, pillars, brand book text, `social_voice.built_at`, website URL, geo, language, primary platforms and sorted competitor names. `trend_hashtags.inputs()` returns null until `trend_profile` is done, and otherwise `` `${month in Asia/Jerusalem}:${profile.written_at}` ``. Its `run()` ends `done` without calling Claude when `hashtags_at` is already in this month.

- [ ] **Step 1: Write the failing tests** in `profile.test.ts`:

```ts
it("asks for a profile from the brief, pillars, site, platforms, competitors and the hashtags the best posts used", ...)
  // body.model === "claude-opus-5-5"; prompt contains each evidence part; e.hashtags.own[0].key === "#appmarketing" for the fixture
it("refuses a profile that searches for the brand's own name or a lone place name", ...)
  // profileProblems(withTopic("Bader Law"), e) and withTopic("Atlanta") each return one problem; 5 topics or 11 topics return a count problem
it("keeps what a person added and never brings back what a person removed", ...)
  // fake db: person row "#growth", tombstoned lifecycle row "#ads"; syncLifecycleTerms(... [{term:"#ads"},{term:"#aso"}])
  // -> rows: "#growth" (person), "#ads" still removed, "#aso" (lifecycle)
it("waits instead of writing a thin profile for a client with nothing to read", ...)
  // trend_profile.inputs() === null without brief_pillars settled; profileEvidence() === null with no brief, pillars or site
it("refreshes hashtags once a month and leaves the rest of the profile alone", ...)
  // hashtags_at in this month -> done without a Claude call; otherwise only hashtag rows change
```

- [ ] **Step 2:** Run `npx vitest run supabase/functions/_shared/trends/profile.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `profile.ts`, `terms.ts` and the two steps. Use `max_tokens` 4000 and parse the JSON with the `parseAnswer` approach from `competitive/analysis.ts:147`. A bad answer gets one repair call; a second bad answer returns `{ status: "failed", error }`, and the lifecycle backoff retries.
- [ ] **Step 4:** Run the test file plus `npx vitest run supabase/functions/_shared/lifecycle`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Trends: the app writes each client's trend profile"`.

### Task 3: Six sources and the shared post shape

**Files:**
- Create: `supabase/functions/_shared/trends/sources.ts`, `supabase/functions/_shared/trends/sources.test.ts`, `supabase/functions/_shared/trends/fixtures/{tiktok,instagram,linkedin,youtube,pinterest,facebook}.json`

**Interfaces:**
- Produces:
  - `TrendSource = { actor: { id: string; name: string; timeoutSecs?: number }; input(searches: string[], o: SearchOptions): Record<string, unknown>; normalize(row: unknown, search: string): TrendPost | null }`
  - `SearchOptions = { region?: string; language: string; perSearch: number; maxItems: number }`
  - `TREND_SOURCES: Record<TrendPlatform, TrendSource>`
  - `POSTS_PER_SEARCH = 25`, `MAX_POSTS_PER_PLATFORM = 200`
  - `engagementOf(p): number`, computed as likes + 2·comments + 3·shares + saves + views/1000
  - `searchesFor(platform, profile, terms): string[]`: Instagram uses its active hashtags; the other five use `search_overrides[platform]` when present, else the active topics.

Actors:

| Platform | Actor | Notes |
|---|---|---|
| TikTok | `5K30i8aFccKNF5ICs` (apidojo/tiktok-scraper) | dateRange `THIS_WEEK` |
| Instagram | `reGe1ST3OBgYZSsZJ` (apify/instagram-hashtag-scraper) | |
| LinkedIn | `harvestapi~linkedin-post-search` | |
| YouTube | `api-ninja~youtube-search-scraper` | |
| Pinterest | `epctex~pinterest-scraper` | `posted_at` always null |
| Facebook | `scraper_one~facebook-posts-search` | |

- [ ] **Step 1:** Read each new actor's input schema (Apify `fetch-actor-details`). Record one real answer per actor, at most 20 rows, for one Moburst topic, into the fixtures (a few cents in all). Replace the tilde names with the actor ids.
- [ ] **Step 2: Write the failing tests:**

```ts
it.each(TREND_PLATFORMS)("reads a real %s answer into the shared post shape", ...)
  // every normalized post has url, platform, text; engagement === engagementOf(post); rows without a url -> null
it("asks each source for the last 7 days, most engaged first, in the client's region, within the post budget", ...)
  // input(["app marketing"], {region:"US", language:"en", perSearch:25, maxItems:200}) per platform matches the recorded schema fields
it("searches Instagram by the profile's hashtags and the rest by topics, unless a rewrite replaced them", ...)
```

- [ ] **Step 3:** Run `npx vitest run supabase/functions/_shared/trends/sources.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement `sources.ts`.
- [ ] **Step 5:** Run the tests again. Expected: PASS.
- [ ] **Step 6:** Commit: `git commit -m "Trends: six sources, one post shape"`.

### Task 4: Rule filter

**Files:**
- Create: `supabase/functions/_shared/trends/rules.ts`, `supabase/functions/_shared/trends/rules.test.ts`
- Modify: `supabase/functions/_shared/pipelines/social/nodes.ts` (export `matchesAnyTargetLanguage` and the spam word list, no behavior change)

**Interfaces:**
- Produces:
  - `ruleFilter(posts: TrendPost[], o: RuleOptions): { candidates: TrendPost[]; dropped: Array<{ post: TrendPost; reason: RuleDrop }> }`
  - `RuleOptions = { windowStart: string; windowEnd: string; languages: string[]; ownHandles: string[]; ownNames: string[]; competitorHandles: string[]; competitorNames: string[]; capPerPlatform?: number /* 60 */ }`
  - `tripwire(text: string): boolean`: the spam, job-ad and giveaway word lists.

- [ ] **Step 1: Write the failing tests:**

```ts
it("keeps a post found by two searches once")                    // dropped[0].reason === "duplicate"
it("drops posts outside the 7-day window, except undated pins")  // pin with posted_at null stays
it("keeps only the client's language, for a Hebrew client too")  // languages ["he"]: Hebrew post kept, English dropped "language"
it("drops the client's own and tracked competitors' posts")      // by handle and by author name, "own_or_competitor"
it("sends at most 60 per platform, most engaged first")          // 61 posts -> 60 candidates, lowest engagement "over_cap"
```

- [ ] **Step 2:** Run it and expect FAIL.
- [ ] **Step 3:** Implement `rules.ts`.
- [ ] **Step 4:** Run it and expect PASS. Then run `npx vitest run supabase/functions/_shared/pipelines/social` and expect PASS (the exports change nothing).
- [ ] **Step 5:** Commit: `git commit -m "Trends: rule filter"`.

### Task 5: Claude filter and themes

**Files:**
- Create: `supabase/functions/_shared/trends/filter.ts`, `supabase/functions/_shared/trends/themes.ts`, `supabase/functions/_shared/trends/claude.test.ts`

**Interfaces:**
- Consumes: `TrendProfile`, `Term`, `TrendPost`, `KeptPost`, `Theme`, `DropReason`.
- Produces:
  - `TREND_FILTER_MODEL = "claude-sonnet-5-5"`, `TREND_THEMES_MODEL = "claude-opus-5-5"`, `MIN_FIT = 60` (set again from the trial).
  - `filterRequest(profile, exclusions: Term[], candidates: TrendPost[])`: candidates are numbered `P1..Pn`, and each text is cut to 500 characters. The answer is `{ decisions: [{ id, keep, reason?, fit?, why?, format?, lesson? }] }`.
  - `parseFilter(text, candidates): { value: { kept: KeptPost[]; dropped: Array<{ post: TrendPost; reason: DropReason }> } } | { error: string }`
  - `filterProblems(answer, candidates): string[]`
  - `pickKept(kept: KeptPost[], o?: { perPlatform?: number /* 10 */; minFit?: number }): KeptPost[]`: sorted by fit, then engagement.
  - `themesRequest(profile, kept: KeptPost[])`
  - `parseThemes(text, kept): { value: Theme[] } | { error: string }`: every `post_urls` entry must be a kept post. `platforms` are taken from those posts, overriding Claude's. 3 to 6 themes.
  - `THEMES_MIN_KEPT = 3`: below that, no themes call is made.

- [ ] **Step 1: Write the failing tests:**

```ts
it("drops a job ad and a money scheme with their reasons, and keeps an on-brand post with fit, why, format and lesson")
it("flags an answer that skips a candidate, invents an id, or scores fit 120")   // filterProblems length 3
it("keeps at most 10 per platform above the minimum fit, best fit first")
it("asks for themes only when 3 or more posts were kept, and rejects a theme citing a post that wasn't kept")
```

- [ ] **Step 2:** Run it and expect FAIL.
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** Run it and expect PASS.
- [ ] **Step 5:** Commit: `git commit -m "Trends: Claude filter and themes"`.

### Task 6: The `trends_v1` pipeline and its writer

**Files:**
- Create: `supabase/functions/_shared/pipelines/definitions/trends.ts`, `supabase/functions/_shared/pipelines/definitions/trends.test.ts`, `supabase/functions/_shared/trends/writer.ts`
- Modify: `supabase/functions/_shared/pipelines/registry.ts:59`, `supabase/functions/_shared/pipelines/store.ts` (`REAL_WRITERS.trends`), `supabase/functions/_shared/pipelines/secrets.ts` (`PIPELINE_SECRETS.trends`), `supabase/functions/_shared/pipelines/engine.test.ts:122` (names list gains `"trends_v1"`), `supabase/functions/_shared/pipelines/apifyStep.ts` (rows result gains optional `usageUsd` from the run's `usageTotalUsd`), `supabase/functions/_shared/pipelines/claude.ts` (saved answer gains optional `usage`)

**Interfaces:**
- Consumes: `runActorStep`, `claudeBatchStep`, `keptAnswer`, `SOURCE_KEEP_DAYS`, `TREND_SOURCES`, `ruleFilter`, `tripwire`, `filterRequest`/`parseFilter`/`filterProblems`/`pickKept`, `themesRequest`/`parseThemes`, `activeTerms`.
- Produces:
  - `TRENDS_PIPELINE = "trends_v1"` and `trendsPipeline(deps: TrendsDeps = {}): PipelineDefinition`, with kind `"trends"`, modes `["app"]`, appCapable `true`, and secrets `APIFY_API_TOKEN` and `ANTHROPIC_API_KEY`.
  - Run input: `{ week_start: string; replay?: { from_run: string } }`.
  - `TREND_WRITERS.week(db, run, data)` writes posts, themes and the week row. It's idempotent: it deletes the week's posts and themes first. It maps each theme's `post_urls` to the stored `trend_posts` ids and sets `tripwire` on kept posts where `tripwire(text)` is true.

Steps, in order:
1. `start` loads the client, profile, active terms and exclusions, and saves payload `plan` with searches per watched platform and the window `[now-7d, now]`.
2. Six scrape steps: `scrape_tiktok`, `scrape_instagram`, `scrape_linkedin`, `scrape_youtube`, `scrape_pinterest`, `scrape_facebook`.
3. `rules`.
4. `filter` (`claudeBatchStep`, `saveAs: "filter"`), then `read_filter`.
5. `themes` (`claudeBatchStep`, `saveAs: "themes"`), then `read_themes`.
6. `save`, which calls `ctx.output.write("week", …)`.

How the steps behave:
- **Scrape steps:** an unwatched platform records `not_watched` and goes on. Each step keeps its dataset as `source.<platform>` for 90 days. A replay reads `keptAnswer` instead of calling Apify. After `SCRAPE_TRIES = 2` failures the platform records `failed` and the run goes on. Zero rows record `empty`.
- **`read_filter`:** on problems, it goes back to `filter` once (`state.filterTries`). A second bad answer sets `filter_status = "failed"` and keeps no posts.
- **`themes`:** skipped (no call) when fewer than `THEMES_MIN_KEPT` posts were kept.
- **Week status:** `done` when the filter is ok and every watched platform is `ok` or `empty`; otherwise `partial`.

- [ ] **Step 1: Write the failing tests** using `pipelineDb`, `drivePipeline` and `testClock` from `pipelines/testDriver.ts`, with Apify stubbed from the Task 3 fixtures and Claude stubbed with recorded answers:

```ts
it("collects six platforms, keeps at most 10 each, writes 3 to 6 themes and the measured cost")
it("finishes the week without LinkedIn when its scraper fails twice")          // status "partial", platforms.linkedin.status "failed"
it("re-asks once when the filter answer is wrong, then stores every candidate with nothing kept")
it("never calls a source the client doesn't watch")                            // Instagram+Facebook client: 2 Apify starts
it("replays a week from its kept answers without calling Apify")
it("finishes a Hebrew client's week with zero kept posts as a coverage gap")    // status "done", kept 0, no themes call
```

- [ ] **Step 2:** Run `npx vitest run supabase/functions/_shared/pipelines/definitions/trends.test.ts` and expect FAIL.
- [ ] **Step 3:** Implement the definition, the writer, the registry and secrets entries, and the two optional fields.
- [ ] **Step 4:** Run `npx vitest run supabase/functions/_shared/pipelines` and expect PASS, including `engine.test.ts` and the unchanged social and competitive tests.
- [ ] **Step 5:** Commit: `git commit -m "Trends: trends_v1 pipeline and writer"`.

### Task 7: Weekly `trend_refresh` job and harness modes

**Files:**
- Create: `supabase/migrations/20261029100100_trend_refresh_job.sql`, `supabase/functions/run-scheduled-jobs/trends.ts`, `supabase/functions/run-scheduled-jobs/trends.test.ts`
- Modify: `supabase/functions/run-scheduled-jobs/types.ts:3` (`JobKind`), `supabase/functions/run-scheduled-jobs/index.ts` (switch case, `JOB_LABELS`, the modes `trends_now` and `replay_trends`)

**Interfaces:**
- Consumes: `startPipelineRun(db, StartRun)` (`pipelines/store.ts:269`), `TRENDS_PIPELINE`.
- Produces:
  - `weekStartOf(now: Date): string`: the Monday in Asia/Jerusalem, `YYYY-MM-DD`.
  - `startTrendWeek(db, clientId, now, o?: { replayFrom?: string; suffix?: string }): Promise<{ weekId: string; runId: string } | { skipped: string }>`
  - `runTrendJob(db, job, now?): Promise<JobOutcome>`
  - Harness POST bodies: `{ mode: "trends_now", client_id }` and `{ mode: "replay_trends", run_id }`.

The migration adds `trend_refresh` to `scheduled_jobs.kind` and redefines `enqueue_scheduled_report_jobs` as the `20261019190000` definition plus one block:
- **Who:** clients with `archived_at is null`, not `exclude_from_reporting`, `demo_job_id is null`, and a `trend_profiles` row.
- **When:** either no `trend_weeks` row in the last 8 days, or today's UTC dow equals `feed_refresh_weekday(id)` and there's no row for this week yet.
- **Job:** dedupe key `trend_refresh:<client>:<date>`, priority 50.

- [ ] **Step 1: Write the failing tests:**

```ts
it("makes one week row per client per week and starts trends_v1 in app mode on it")  // second job same week reuses the row; dedupe trends:<client>:<week>
it("skips a client without a trend profile and spends nothing")                       // { skipped: "no_profile" }, no run started
it("starts a replay that reads another run's kept answers")
```

- [ ] **Step 2:** Run `npx vitest run supabase/functions/run-scheduled-jobs/trends.test.ts` and expect FAIL.
- [ ] **Step 3:** Implement `trends.ts`, the job case, the two modes and the migration. Don't apply the migration yet (Task 8 does that after the trial).
- [ ] **Step 4:** Run `npx vitest run supabase/functions/run-scheduled-jobs` and expect PASS.
- [ ] **Step 5:** Commit: `git commit -m "Trends: weekly job and harness modes"`.

### Task 8: Release Phase 1, trial, review pack

- [ ] **Step 1:** Run `npm test`. Expected: PASS.
- [ ] **Step 2:** Apply `20261029100000_trends.sql`. Release: push, wait for Lovable's sha, then have Lovable deploy `run-scheduled-jobs` only.
- [ ] **Step 3:** Run a free `replay_social` of ee82b373 and a free `replay_competitive` of 6d9f301c. Expected: both match the earlier runs exactly (the 7 Nov guard).
- [ ] **Step 4:** Let the daily lifecycle look write the three profiles (or force `trend_profile` per client). Check them in SQL: 6 to 10 topics, hashtags per platform, no brand name, every reason present.
- [ ] **Step 5:** On Thu 5 Nov, run `trends_now` for Bader Law, Moburst and Pay The Pyper. Expected: three weeks `done` or `partial`, with each platform's status recorded.
- [ ] **Step 6:** Tune `MIN_FIT` and the budgets from what came back, using `replay_trends` (no Apify cost).
- [ ] **Step 7:** Write the review pack for Lital to `/Users/user/Desktop/Trends trial 2026-11-05.md`. It contains each client's profile; each platform's kept posts (link, why, fit, lesson); 10 dropped posts per platform with reasons; the themes; and the measured cost per client and week.
- [ ] **Step 8:** Apply `20261029100100_trend_refresh_job.sql`. Run `select * from enqueue_scheduled_report_jobs(now(), true)` (dry run). Expected: `trend_refresh` rows only for clients due today.
- [ ] **Step 9:** Commit any tuning: `git commit -m "Trends: trial tuning"`.

## Phase 2: screens (Sun 8 to Thu 12 Nov, after Lital's trial OK), live Sun 15 Nov

### Task 9: Calendar evidence from themes, with "Inspired by"

**Files:**
- Modify: `supabase/functions/_shared/calendar/runWeek.ts:218-225` (trend source), `supabase/functions/_shared/calendar/evidence.ts:43-63, 643-661`, `supabase/functions/_shared/calendar/reasonText.ts:88-105`, `src/lib/calendarPosts.ts:10-26`, `src/components/calendar/PostReason.tsx`
- Test: `supabase/functions/_shared/calendar/evidence.test.ts`, `src/test/calendar/postReason.test.tsx`

**Interfaces:**
- Produces:
  - `latestTrendEvidence(db, clientId): Promise<TrendEvidenceInput[]>`: reads the newest finished week, its themes that aren't dismissed, and up to 2 kept posts per theme with the highest fit. `TrendEvidenceInput = { theme: string; theme_id: string; platform: TrendPlatform; format: TrendFormat; author: string; text: string; link: string; date: string | null; fit: number; engagement: number }`.
  - `EvidenceItem` gains `theme?: string`. Trend items carry `platform`, `format`, `link`, `date`, `metric: "engagement"` and `value`.
  - `scoreTrendItems(items): EvidenceItem[]`: the score comes from fit and engagement relative to that platform's kept median. The weights are the builder's choice. Items are ranked by score, at most 8, with no quota.
  - `evidenceSentence` for trends reads `Inspired by "<theme>": <author>'s <platform> <format> from <date>`.
  - `PostReason` shows "Inspired by <theme>", the quote, and "View the post".
- The planner stops reading `opportunities_for_client`.

- [ ] **Step 1: Write the failing tests:**

```ts
it("gives the planner the newest week's themes with platform, format, link and engagement")
it("leaves out a dismissed theme")
it("plans the week with no trend evidence when nothing is stored yet")      // sources.trends === "none"
// postReason.test.tsx
it("shows Inspired by with the theme and a link to the example post")
```

- [ ] **Step 2:** Run the two test files and expect FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run the two test files plus `npx vitest run supabase/functions/_shared/calendar` and expect PASS.
- [ ] **Step 5:** Commit: `git commit -m "Trends: calendar evidence from weekly themes"`.

### Task 10: Analytics "Trend insights" and staff dismissal

**Files:**
- Modify: `src/components/analytics/TrendInsightsSection.tsx` (rewrite), `src/pages/Analytics.tsx:783-787`
- Create: `src/hooks/useTrendThemes.ts`, `src/test/analytics/trendInsights.test.tsx`

**Interfaces:**
- Produces:
  - `useTrendThemes(clientId: string, from: string, to: string)`: themes for weeks in the range, newest first, each with its kept posts.
  - `<TrendInsightsSection clientId from to />`
- UI pieces: a platform filter (`Segmented`: All plus the platforms present); theme cards (title, what's happening, why it matters for the brand, the angle, platform tags); example posts with a "View" link, using `measuredEngagements` for client users.
- Staff only: a "Dismiss" button behind `confirm-dialog`, calling `trend_theme_dismiss`. Toast: "Dismissed. Next week's trends will leave it out."
- Empty state: "Trends show here after the first weekly collection."

- [ ] **Step 1: Write the failing tests:** renders themes and posts; the filter hides other platforms; a client user sees no Dismiss; a staff Dismiss calls the RPC with the theme id.
- [ ] **Step 2:** Run `npx vitest run src/test/analytics/trendInsights.test.tsx` and expect FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run it again and expect PASS.
- [ ] **Step 5:** Commit: `git commit -m "Trends: Analytics shows weekly themes"`.

### Task 11: Client setup "Trends we track"

**Files:**
- Create: `src/components/clients/TrendsWeTrack.tsx`, `src/test/clientSetup.trends.test.tsx`
- Modify: `src/pages/ClientSetup.tsx:567-591` (place the section after Social keywords; change the keywords help text to "Phrases that describe the brand's space, used for competitor matching and reports.")

**Interfaces:**
- Consumes: `trend_terms`, `trend_profiles`, `trend_term_add`, `trend_term_remove`.
- Produces: the section with Topics; Hashtags for Instagram, TikTok and LinkedIn; and Exclusions. Each chip shows its reason and origin: "Suggested", "Added by your team", or "From a dismissed trend". Each group has an add box, and each chip has a remove X. Removed suggestions are hidden.
- Empty state: "Suggestions appear here once the brand details are read."

- [ ] **Step 1: Write the failing tests:** lists terms with their origin; add calls `trend_term_add` with kind and platform; remove calls `trend_term_remove`; the empty profile shows the empty state.
- [ ] **Step 2:** Run it and expect FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run it plus `npx vitest run src/test/clientSetup.test.tsx` and expect PASS.
- [ ] **Step 5:** Commit: `git commit -m "Trends: Client setup shows what we track"`.

### Task 12: Remove the Run analysis switch; API `industry_trends`

**Files:**
- Modify: `src/pages/RunAnalysis.tsx:42,106-107,135-137,196-212`; `supabase/functions/run-report/index.ts:39,99`; `supabase/functions/run-scheduled-jobs/dispatch.ts:81-99,605`; `supabase/functions/_shared/reports/payloads.ts:203,220`
- Modify (API): `supabase/functions/api/store.ts:40,165-167`, `supabase/functions/api/serializers.ts:27,68-73,181-200`, `supabase/functions/api/schemas.ts:37-41`, `api/client/socialytics-api.ts:40-41`, `api/mcp/socialytics-tools.json`

**Interfaces:**
- The report detail response gains `industry_trends: { themes: Array<{ title; happening; why_it_matters; angle; platforms; posts: Array<{ platform; url; author; text; format; posted_at }> }> } | null`. It's built from the stored themes of the weeks inside the report's date range, whichever engine wrote the report. `trends.tiktok` and `trends.instagram` are unchanged.
- `CLIENT_COLUMNS` and `ClientRow` drop `trends_keywords`.
- `skip_trends` is no longer read or sent. A request that still sends it is ignored.

- [ ] **Step 1: Write the failing tests** (in the existing API and dispatch test files):
  - the detail response has `industry_trends` for a report whose range holds a stored week, and null otherwise;
  - `CLIENT_COLUMNS` has no `trends_keywords`;
  - `dispatch.test.ts` no longer expects `skip_trends`.
- [ ] **Step 2:** Run `npx vitest run supabase/functions/api supabase/functions/run-scheduled-jobs` and expect FAIL.
- [ ] **Step 3:** Implement the changes and remove the switch from the page.
- [ ] **Step 4:** Run the same command again and expect PASS. Then run `npm test`.
- [ ] **Step 5:** Commit: `git commit -m "Trends: no trend switch; API adds industry_trends"`.

### Task 13: Measures and the coverage rewrite

**Files:**
- Create: `supabase/migrations/20261108100000_trend_measures.sql`, `supabase/functions/_shared/trends/coverage.ts`, `supabase/functions/_shared/trends/coverage.test.ts`
- Modify: `supabase/functions/_shared/pipelines/definitions/trends.ts` (steps `rewrite_searches` and `read_rewrite` between `start` and the scrapes), `supabase/functions/_shared/trends/writer.ts` (writes `search_overrides`), `supabase/functions/_shared/trends/profile.ts` (a profile rewrite clears `search_overrides`)

**Interfaces:**
- Produces:
  - `trend_measures(p_client uuid default null)`: security definer, staff only. Per client and week it returns kept per platform, `tripwire_hits` (kept posts with `tripwire`), `dismissed` (themes dismissed), `terms_removed` (topics or hashtags a person removed), `used_share` (that week's `calendar_posts` with `reasons->0->>'type' = 'trend'` over all its posts), cost, and run status.
  - `coverageShort(weeks, platform): boolean`: true when the platform was watched and kept fewer than 5 posts in each of the last two finished weeks.
  - `rewriteRequest(profile, platform, lastSearches, keptCounts)` (`claude-sonnet-5-5`), `parseRewrite(text): { value: string[] } | { error }`.

- [ ] **Step 1: Write the failing tests:**
  - `coverageShort` is true only for two short weeks in a row;
  - the rewritten searches are stored and used by the next scrape;
  - a profile rewrite clears the overrides.
- [ ] **Step 2:** Run it and expect FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run it and expect PASS.
- [ ] **Step 5:** Commit: `git commit -m "Trends: measures and the coverage rewrite"`.

### Task 14: Release Phase 2 and go live (Sun 15 Nov)

- [ ] **Step 1:** Run `npm test`. Expected: PASS.
- [ ] **Step 2:** Apply the measures migration.
- [ ] **Step 3:** Release: push, have Lovable deploy `run-scheduled-jobs`, `run-report` and `api`, then `deploy_project`. Gal's server picks up main through `deploy.yml`.
- [ ] **Step 4:** Check with real data:
  - the next Monday plan cites trend evidence with links;
  - Analytics shows the themes;
  - Client setup lists the terms;
  - `trend_measures()` shows zero tripwire hits.
  - Check the screens in the browser only where a staff session is already signed in. Never enter a password.
- [ ] **Step 5:** Ask Lital for the go-live OK, then tell her the results.

## Phase 3: monthly reports (by Thu 3 Dec, for the 7 Dec reports)

### Task 15: Report screen shows the month's stored trends, for every engine

**Files:**
- Create: `src/components/reports/IndustryTrendsSection.tsx`, `src/test/reports/industryTrends.test.tsx`
- Modify: `src/pages/ReportView.tsx:198-199,260-265,278-281,334,625-631`, `src/lib/reportFigures.ts:30-45`, `src/components/reports/calendar/WeeklyHighlights.tsx:14-15`

**Interfaces:**
- Consumes: `useTrendThemes(client_id, date_range_start, date_range_end)`.
- Produces:
  - When stored themes exist for the range, the Trends tab shows one "Industry trends" section: themes, platform tags, example posts, and `ai_analysis.industry_trends_analysis` when the report has it (Task 16).
  - n8n's `tiktok_trends`, `instagram_trends` and their analyses are not shown for that report.
  - "Where to act next" and Weekly highlights take their trend items from the theme angles.
  - Reports without stored themes for their range keep today's sections.

- [ ] **Step 1: Write the failing tests:**
  - a report with stored themes shows Industry trends and not the TikTok section;
  - an older report shows the TikTok and Instagram sections;
  - a client user sees no `engagement_score`.
- [ ] **Step 2:** Run it and expect FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run it and expect PASS.
- [ ] **Step 5:** Commit: `git commit -m "Trends: report screen shows the month's industry trends"`.

### Task 16: In-app social report reads stored trends

Lands after the 7 Nov comparison. It's needed whether or not social has moved off n8n by then.

**Files:**
- Modify: `supabase/functions/_shared/pipelines/definitions/social.ts:62-74,114-153` (replace the TikTok and Instagram scrape steps with a `stored_trends` step), `supabase/functions/_shared/pipelines/social/prompt.ts:45,122-140`, `supabase/functions/_shared/pipelines/social/analysis.ts:42,59-60`, `supabase/functions/_shared/pipelines/social/nodes.ts` (`generateRunSummary` writes `industry_trends`; deck trend slides at `:1195-1256` built from it; remove `prepareTrendInputs` trend inputs, `trendTargets`, `normalizeTikTok`, `normalizeInstagram`), `supabase/functions/_shared/pipelines/social/replay.ts:29-36` (remove the TikTok and Instagram keys), the social compare (ignore `tiktok_trends`, `instagram_trends`, `trend_status`, `industry_trends` and the trend analyses)
- Test: `supabase/functions/_shared/pipelines/definitions/social.test.ts`; remove the parity tests for the removed nodes in `social/n8nParity.test.ts`

**Interfaces:**
- `report_data.industry_trends = { themes: Theme[]; posts: KeptPost[] } | null`
- `ai_analysis.industry_trends_analysis = { overview; themes: Array<{ title; platforms; note }>; opportunities_for_client: string[]; key_takeaways: string[] } | null`

- [ ] **Step 1: Write the failing tests:**
  - two stored weeks in range put their themes in `industry_trends`, make no Apify call, and add an Industry trends slide;
  - with no stored weeks, `industry_trends` and the analysis are both null.
- [ ] **Step 2:** Run `npx vitest run supabase/functions/_shared/pipelines` and expect FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run it again and expect PASS.
- [ ] **Step 5:** Release `run-scheduled-jobs`. Run one paid Moburst `shadow_now` with Lital's OK (about 52 Gamma credits) and check the deck's trend slide.
- [ ] **Step 6:** Commit: `git commit -m "Trends: the in-app report reads stored trends"`.

### Task 17: Demo copies run one collection

**Files:**
- Modify: `supabase/functions/api/demo/steps.ts:115-438` (add a `trend_profile` step after `competitors` through `runStepNow`; add `collect_trends` and `wait_trends` before `run_social`, using `startTrendWeek`)
- Test: the demo steps test file

**Interfaces:**
- `wait_trends` waits for the week to finish, at most 30 minutes, then lets `run_social` go on with or without trends.

- [ ] **Step 1: Write the failing test:** the demo copy gets a profile and one week before its report; a slow collection doesn't block the report beyond 30 minutes.
- [ ] **Step 2:** Run it and expect FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run it and expect PASS.
- [ ] **Step 5:** Commit: `git commit -m "Trends: demo copies run one collection"`.

### Task 18: Drop `trends_keywords`

**Files:**
- Create: `supabase/migrations/20261203100000_drop_trends_keywords.sql`
- Modify: `supabase/functions/_shared/reports/payloads.ts:203` (send `trends_keywords: ""` while n8n's social workflow is still live, else remove it), `supabase/functions/api/fixtures.ts:4`, `supabase/functions/_shared/pipelines/fixtures/social.ts:63,78`, `n8n/runtime-qa.mjs:20,25`, `scripts/qa-workflows.mjs:42,44`
- `src/integrations/supabase/types.ts` is regenerated by Lovable. Don't edit it by hand.

- [ ] **Step 1:** Run `grep -rn "trends_keywords" supabase src api scripts n8n`. Expected: only the lines listed above.
- [ ] **Step 2:** Update them and run `npm test`. Expected: PASS.
- [ ] **Step 3:** Release the API first. Then apply the migration. Then check `GET /v1/status`. Expected: no schema-check finding.
- [ ] **Step 4:** Commit: `git commit -m "Trends: drop the unused trends_keywords column"`.

## Phase 3 on today's main (9 Nov 2026)

Phase 2 shipped on 2 Nov except Task 12, which was held for the 7 Nov reports and shipped on 9 Nov (main 6bc6f30). Since this plan was written: every report runs in the app (n8n's three workflows are unpublished and kept until the 7 Dec reports run clean), report insights from the figures are live (docs/superpowers/specs/2026-11-03-seasonal-insights-design.md part 2, `_shared/reports/shownFields.ts`), edge function tests live under `supabase/tests/` at their code's path, and `industry_trends` is on the API's report detail. Paths in Tasks 15 to 18 are read against today's code. These points replace the matching ones above.

1. **Task 15, unchanged in intent.** The report screen reads the month's stored themes through the existing `useTrendThemes` hook and `trend_themes_in_range`, and its other sections read the report through `shownSocial` as today.
2. **Task 16, the deck carries the checked wording.** After the analysis is accepted and before the deck, a new `insights` step builds the report data the run will write (the run summary without the deck), works out its facts and words them with the same code and the same input hash as the `report_insights` job (`_shared/reports/insights.ts`). In app mode it stores the row for the real report; the job that `report_text` queues afterwards meets the same input and stamps it confirmed with no model call, since `report_text` changes no figure of a social report (its recount is for older competitive reports only). In shadow mode nothing is stored. The insights answer is kept with the run's provider answers, so a replay makes no model call. The deck is built from `shownSocial(analysis, insights).analysis`, so the deck, the screen, the API and the planner say the same thing; if the insights can't be had, the deck uses the analysis as today.
3. **Task 16, replays.** A replay of a run made before stored trends can't read stored trends the way that run read TikTok and Instagram. Until a new baseline exists, the replay check after a deploy compares the social report with its trend keys (`tiktok_trends`, `instagram_trends`, `industry_trends` and their analyses) left out; the paid Moburst run in Step 5 (Lital's OK, about 52 Gamma credits) becomes the new social baseline.
4. **Task 17, the demo's new steps are an API change.** `trend_profile`, `collect_trends` and `wait_trends` appear in a demo job's `steps[]`, which the gOS demo screen (Fernando) shows as its progress. They go into the integration guide's step table and its section 12 in the same change, with the API doc and the OpenAPI step names if listed.
5. **Task 18, the n8n fallback.** While the unpublished n8n social workflow is kept as a fallback (until Lital's OK to archive after the 7 Dec reports), the payload keeps sending `trends_keywords: ""`; the column itself is dropped.

**Task 17 dropped (Lital, 9 Nov 2026, 13:49 IST: "No trends in demos").** A demo's trend collection measured 15 to 33 minutes (17 weekly runs since 2 Nov, median 24), which would have taken a new-brand demo from about 10 to 35 minutes to about 35 to 75. Demos run no trend collection, so once Task 16 ships a demo's social report has no industry trends; the demo says so with the existing `connected_only` gap, and the integration guide says it. The built work is kept on branch `trends-t17` (1db5a54, d3c7835, ac0d36b), not merged.

**Phase 3 released 9 Nov 2026, 14:25 IST (main 7ad5eac):** Tasks 15, 16 and 18 shipped, each independently reviewed with one fix round; Task 17 dropped. Migrations 20261111100000_drop_trends_keywords and 20261111100100_trend_theme_dashes applied and recorded (0 of 102 stored themes carry a dash). Ten functions deployed; the app is on all three hosts. Replays: competitive identical to its baseline; social differs only in the trend fields this phase changes (tiktok_trends and instagram_trends 15 to 0, the new counts 0, trend_status "none", ai_analysis.industry_trends_analysis null) and run times. Left: Task 16 Step 5, one paid Moburst run (Lital's OK), which becomes the social replay baseline.
