# Socialytics: shared public profile reader and in-house competitor analysis (RivalIQ replacement)

**Status: Proposed 12 Nov 2026, awaiting Lital's approval.** Nothing in this spec has been built, deployed, called or paid for.

Companion spec: `2026-11-12-strategy-any-client-design.md` (strategy for any client, called "spec 2" below) uses the reader defined here by reference.

How this spec was made: it starts from `proposal-documented-first.md` (ranked best by two of three judges), grafts the parts the judges named from `proposal-quality-first.md` and `proposal-reuse-first.md`, and corrects every factual error the judges listed after rechecking each one (section 13). A builder then read both specs against the code on main 7b8397b and on `trends`; every answer, call and rule fix from that check is in the text, and section 10 lists the calls. Repos: `moburst-socialytics-canva` is main at 7b8397b (live); `moburst-socialytics-trends` is branch `trends`. `fn/` means `supabase/functions/`. Every external fact carries its URL; all were read on 12 Nov 2026, either by the research files in this folder or by me today where marked "rechecked" or "read today".

---

## 1. Intent

Lital, 12 Nov 2026: "we also want to replace rivaliq with our own way to do the competitor analysis, since the current method is not sufficient and it's expensive. find out how and replace it."

Why the current method is not sufficient (all from `understand-competitive.md` and the QA audit `.agents/qa-full/competitive.md`):

1. Coverage. RivalIQ's plan holds 40 companies and all 40 were in use on 1 Oct. 14 clients need 56 (client plus three competitors each). Only Bader Law and Pay The Pyper are tracked for their current set; 11 clients have no data at all and Moburst's new set has none. 11 clients are told "The first competitive analysis runs on Dec 7, 2026" and it will not (COMPETITIVE-01).
2. Platforms. RivalIQ returns no LinkedIn data, the B2B clients' main network. Its X posts carry no text, link or date (6 of 6 stored X posts).
3. Rates. Competitor engagement rates are divided by RivalIQ's estimated impressions and sit beside the client's measured Sprout rates.
4. Fragility. One call at a time, 100 an hour; a refused competitor website fails a whole client (DS-20); a newly confirmed set breaks a tracked client (COMPETITIVE-02); 405 lifecycle tracking runs waited or failed in 30 days.
5. Identity. RivalIQ picks profiles from a website; the app's own handle list disagrees with it.
6. Terms. RivalIQ's public Terms limit use to "personal, informational, internal and non-commercial use" (https://www.rivaliq.com/terms/, read 12 Nov 2026 by research-licensed-providers). Whether Moburst's order form allows showing data to clients is unconfirmed.

Why it is expensive: the price Moburst pays is recorded nowhere. Rechecked today on https://www.rivaliq.com/pricing/: Engage Pro is "$559/mo" for "40 tracked companies", every tier lists "(Additional companies: 5 for $50/mo)", and "API access (available as an add-on)" has no published price. 56 companies would be USD 559 + 4 x 50 = USD 759 a month before the unpriced API add-on; 120 companies at 30 clients would be USD 559 + 16 x 50 = USD 1,359. The page says annual plans save 15%.

---

## 2. Goals, non-goals, anti-goals

Goals

- G1. Every active client, and every client added later, gets competitor analysis computed by Socialytics from its own stored data, with no company cap.
- G2. One shared public profile reader for every feature that needs public social data (competitive report, weekly competitor feed, strategy, calendar evidence, trend profile, thumbnails). One post shape, one engagement definition (`engagementsOf`, `fn/_shared/competitive/reportMetrics.ts:85`).
- G3. Each platform is read by its documented official API where one serves accounts Moburst does not own; public collection only where none exists, with the risk named.
- G4. Like-for-like comparison: every compared figure is one every brand has from a public view, counted the same way for the client and competitors, at the same post age.
- G5. Every read is logged with its outcome and cost; nothing fails silently, nothing waits forever, a failed read never becomes "no posts".
- G6. Client-facing text and screens carry no vendor, pipeline or developer words.
- G7. RivalIQ is retired: code, tables, schedule, secret and subscription.

Non-goals

- Reach, impressions (except X, which publishes them), saves, Stories, audience demographics of accounts Moburst does not own. No public route gives them.
- Threads and Pinterest competitor reads (section 4.3).
- Competitors' YouTube channels before Google grants the derived metrics amendment (section 4.3). They join in a later release.
- Moving trends search onto the reader. Trends searches topics, where the reader reads profiles. A follow-up slice puts trends on the same run layer (section 8, slice 6).
- Sprout Listening or Sprout Premium Analytics. Sprout's API excludes competitor data and Listening Topics must be built by hand (`research-sprout.md`).
- Competitor reads and a competitive report for API demo jobs (section 4.15).
- Other QA findings outside this feature's data path (report reruns, chart styling, deck sharing).

Anti-goals (designs this spec must never produce)

- A review queue, an "approve this profile" step, a "set X first" line, or any wait on a person to cover a gap in the automatic method.
- A read that stores an empty week when the route failed.
- A figure built on an estimate, or a hidden count turned into zero.
- A model-made number or score in client-facing text, or a template sentence standing in for a written one.
- A vendor or pipeline name on any client-facing screen, PDF, deck or report text.
- A copy of platform data that retention cannot reach (a stored payload, a snapshot inside a report).
- An old vendor's shape or key kept under a new meaning.
- Anything on n8n or on a laptop.

---

## 3. What exists today

| Part | Where | State |
|---|---|---|
| RivalIQ client and landscape setup | `fn/_shared/competitive/rivaliqConnection.ts`, `rivaliqFetch.ts`, `rivaliqLandscape.ts`, `rivaliqSetup.ts`, `rivaliqSetupRun.ts`, `rivaliqFollowFailure.ts`, `landscapeCheck.ts` | 12 endpoints read, 31 of about 120 metric fields used |
| Competitive report pipeline `competitive_v1` | `fn/_shared/pipelines/definitions/competitive.ts:113-362` | Engine `app` since 8 Nov (`report_engines`); monthly, day 7; next run 2026-12-07 |
| Engine choice | `report_engines` holds kind, client and engine only; `forKind` takes the first app-capable pipeline of a kind (`fn/_shared/pipelines/registry.ts:41-48`) | No place stores "which pipeline version" |
| Weekly competitor feed | `fn/_shared/competitive/refreshFeed.ts` (job kind `feed_refresh`); queued by `enqueue_scheduled_report_jobs()` (latest definition `20261019190000_calendar_self_serve.sql:98`; pg_cron `scheduled-reports-enqueue`, daily 07:15 UTC) only for sets with a landscape; weekday from `feed_refresh_weekday(client_id)` (`20261006150000_scheduled_report_queue.sql:56`) | 3 clients; 41 stored `feed` rows in `rivaliq_snapshots` |
| Seven readers of the stored feed | `fn/_shared/calendar/runWeek.ts:162-305`, `evidence.ts:203-223`, trend profile, strategy `publicRead.ts:191-303`, thumbnails, design references, topics | Read `rivaliq_snapshots` endpoint `feed`, a stored payload in RivalIQ's field names |
| Strategy public read | `fn/_shared/strategy/publicRead.ts:11-20, 105-106` | Apify, LinkedIn, Instagram (12 posts), TikTok |
| LinkedIn company posts | `fn/_shared/pipelines/linkedin/sources.ts:127-179` | `harvestapi/linkedin-company-posts`, with author and repost checks |
| Handle discovery | `fn/_shared/competitive/detectHandles.ts` (site links; `searchProfiles(name)` at 74-83, one Firecrawl search across the six platform sites) | Never checked against the platform |
| Handle tables | `competitor_handles`, `client_public_profiles` | One profile per brand and platform; no state for a second candidate |
| Competitor candidates | `competitors` rows with `similarity_score` and a website, unselected (`steps.ts:814-816`) | 86 such rows across the 14 current sets. `competitor_sets.confirmed_by` is a uuid, null for system-made sets: 3 sets were confirmed by a person, 11 by the system (database, builder's check 12 Nov) |
| Lifecycle step `tracking` | `fn/_shared/lifecycle/steps.ts:970-1013`; key used in `lifecycle_request` (`20261109120000_claude_connector.sql:238`), `src/hooks/useLifecycleStep.ts:7`, `src/pages/ClientSetup.tsx:201`, `src/lib/display.ts:593`, `steps.ts:146, 931, 1017` | Waits `rivaliq_full`, `client_website`, `own_site` |
| API demo step `tracking` | `fn/api/demo/steps.ts:316-321`, message at `:47` | Always skipped, with a message about tracking slots |
| Job kinds | `fn/_shared/scheduled-jobs/types.ts`; `scheduled_jobs_kind_check` and `scheduled_jobs_client_required` (`20261110140000_seasonal_relevance.sql:165-172`) | Only `sprout_onboarding` and `moments_list` may have no client |
| Apify step runner | `fn/_shared/pipelines/apifyStep.ts:1-12` | Reads the whole dataset after a run; no run sends `maxTotalChargeUsd` |
| Engine shadow | `fn/_shared/pipelines/engine.ts:1-19`, `shadow.ts:1-7`; table `shadow_competitive_reports` (`run_id`, `real_report_id`, `set_id`, period, `report_data`) | Shadow means an n8n run with an in-app run beside it; run modes are `shadow` and `app`; per client only |
| Late-report message | `fn/_shared/alerts/slack.ts` | One Slack message when a report is still not ready a day after its first try, one when it is ready. Nothing else sends a message |
| Verdicts on suggested tests | `competitive_insight_feedback`, `competitive_learnings` | 0 rows each (COMPETITIVE-16), so nothing needs re-keying |
| Picture service on Vercel | `server/src/app.ts`, `call.ts`, `storage.ts`, `log.ts`; one function of the app's Vercel project (`api/picture.mjs`, `maxDuration` 90 s in the root `vercel.json`); no secret: a call is opened in the database by the worker and claimed once by the service (`fn/_shared/picture/client.ts`, migration `20261116100000_picture_calls.sql`); helpers `signedRead` and `signedWrite` (`client.ts`); deployed with the site by the `vercel` job of `.github/workflows/deploy.yml` | Design approved 12 Nov; layout and call check as released 16 Nov (picture service spec, "As released 16 Nov 2026") |

Handle facts (database, rechecked today with SELECT): the 42 selected competitors of the 14 current sets hold 156 active handles: Instagram 34, Facebook 33, X 29, YouTube 25, LinkedIn 21, TikTok 14. By source: 134 `auto`, 19 `rivaliq`, 3 `manual`. None has been checked against the platform. Client side: `client_public_profiles` also holds 5 rows with source `rivaliq` (builder's check). Sprout does not feed the client's X (`fn/_shared/competitive/ownedSource.ts:153`: "Sprout does not expose X consistently; RivalIQ remains the X source"); 5 active clients have an X account (4 in `client_public_profiles`, 1 more only in Sprout), so the reader reads 5 client X profiles. Client LinkedIn 2, TikTok 2 and YouTube 4 are not covered by Sprout (`proposal-reuse-first.md` 2.2, database 12 Nov). Total profiles at 14 clients: 169, of which 144 are read before Google's grant (the 25 competitor YouTube channels are confirmed but not read).

Stored report text (database, read today): 45 complete competitive reports; the written analysis of 29 of them contains a vendor or pipeline word (RivalIQ, Sprout, Apify or "landscape").

---

## 4. The design

### 4.1 In one page

1. One reader answers one question: "for this profile on this platform, give me its record now and its posts in this window, with their public counts." It stores dated observations. Every feature reads the stored tables; none calls a platform and none keeps its own copy.
2. Routes per platform follow rule 4: Instagram and Facebook on Meta's official Graph API once Meta approves the app (Apify-maintained actors until then), YouTube and X on their official APIs, TikTok and LinkedIn by public collection with the risk named. Before Google's grant, YouTube is read for the client's own channel only. Threads and Pinterest are left out.
3. The reader's platform calls run on the Socialytics Vercel service (`server/`, branch `trends`), the place the product is moving server work to. The queue, schedules, tables and model calls stay in Supabase.
4. Profiles are found from data and confirmed in code against the platform's own record. Unconfirmed profiles are never read. Nobody is asked to approve a profile; a person's entry still wins.
5. Competitor analysis is a fact layer computed in code (posts, consistency, settled engagement, engagement per 1,000 followers, share of engagement, outperformers, formats, themes, rhythm in the client's time zone, follower growth), gaps found by rule, and a writer bound to fact ids with code checks.
6. The weekly competitor feed is a query over the same stored posts, in the product's own post shape, for every client.
7. RivalIQ runs beside the new source for Bader Law and Pay The Pyper on the 7 Jan 2027 cycle, then is retired.

### 4.2 The reader contract

One file with no imports, `fn/_shared/reader/contract.ts`, shared by the Deno workers and the Node service, the way trends `fn/_shared/picture/contract.ts` is shared.

```ts
export type Platform = "instagram" | "facebook" | "tiktok" | "linkedin" | "youtube" | "x";
export type Count = number | null;            // null = the platform hides it or the route does not give it; never 0 for unknown

export type ReadRequest = {
  job: string; step: string;                  // for the service's one log line
  platform: Platform;
  route: string;                              // one route per call; the worker walks the platform's ordered list (4.3)
  profile: { handle: string; native_id?: string | null };
  since: string; until: string;               // ISO window
  since_id?: string;                          // X only: posts newer than this id
  max_posts: number;                          // hard cap for this call; 0 = the profile record only (confirmation, daily snapshot)
  ids?: string[];                             // re-read these posts by id (settle and keep-current reads)
  out: {
    rows: string[];                           // signed upload URLs, one per page of up to 200 rows (NDJSON)
    media: string[];                          // signed upload URLs for thumbnails, not keyed; the service reports which post went where
    avatar?: string;                          // signed upload URL for the profile picture
  };
  budget_usd: number;                         // Apify maxTotalChargeUsd for this read; 0 for free routes
};

export type ReaderPost = {
  native_id: string; url: string; published_at: string;
  format: "image" | "carousel" | "video" | "reel" | "short" | "text" | "link" | "document";
  text: string | null;                        // caption, up to 2,000 characters
  likes: Count; likes_hidden: boolean; comments: Count; shares: Count; views: Count;
  impressions: Count;                         // X only, the platform's public figure
  paid: boolean | null;                       // the platform's own label only (paid partnership, isAd, isSponsored)
  pinned: boolean | null; repost: boolean;
  media_index: number | null;                 // index into out.media where its thumbnail was written
};

export type ReadSummary = {
  route: string;                              // internal key, e.g. "instagram_business_discovery"; never shown outside Settings
  profile: { native_id: string; display_name: string | null; bio: string | null; location: string | null;
             followers: Count; website: string | null; bio_links: string[]; avatar_written: boolean;
             account_kind: "business" | "creator" | "personal" | "page" | "unknown" };
  pages_written: number; posts: number; media_written: number;
  complete: boolean;                          // false when max_posts or the budget was reached before `since`
  cost_usd: number;                           // 0 for free routes; vendor-reported for paid ones
};

export type ReadAnswer =
  | { state: "done"; summary: ReadSummary; ms: number }
  | { state: "running"; run_ids: string[] }   // Apify routes: one or two runs (posts, profile) under one read; poll with /collect
  | { state: "failed"; class: "not_configured" | "auth" | "not_found" | "not_eligible" | "rate_limited" | "transient" | "invalid" | "spend_limit";
      reason: string; retry_after_s?: number };
```

Engagement is not in the contract. It is computed once in the database layer by `engagementsOf(network, {applause: likes, conversation: comments, amplification: shares})` (`reportMetrics.ts:85`), the owner's 20 Oct definition, so every source counts the same actions and a missing part stays missing.

`bio`, `location` and the stored profile picture are in the summary because spec 2 builds the brief, the logo fallback and the location from them. Language is worked out from stored post text, as the product does today for Sprout posts.

### 4.3 Routes per platform

Licensed providers were checked first, because rule 4 prefers licensed data. None fits: no analytics vendor read publishes a license from the platforms for competitor data, and the two whose terms could be read bar this use. RivalIQ's Terms limit use to "personal, informational, internal and non-commercial use" (https://www.rivaliq.com/terms/), and Socialinsider's bar building its service into a product offered to a third party without permission (https://www.socialinsider.io/tos). The data vendors (Bright Data and others) state that they collect public pages, the same category as Apify. Source: `research-licensed-providers.md` sections 4, 6 and 10, pages read 12 Nov 2026. So each platform is read by its own documented API where one exists.

Profile counts are today's (section 3). "Interim" means until Meta approves the app (decision 2).

| Platform | Profiles | Route, in order | Fallback | What it gives | Unit price | Documented source |
|---|---|---|---|---|---|---|
| Instagram | 34 | Instagram Graph API Business Discovery from a Moburst Instagram professional account | Interim and for accounts Business Discovery does not serve: `apify/instagram-post-scraper` (posts, with details) + `apify/instagram-profile-scraper` (profile record) | Followers, posts, likes (omitted when hidden), comments, reel views, caption, media and product type, permalink, time, bio, website | Official: no fee stated. Apify: USD 0.0020 a post with details, USD 0.002 a profile | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery ; https://apify.com/apify/instagram-post-scraper ; https://apify.com/apify/instagram-profile-scraper |
| Facebook | 33 | Graph API `/{page}` and `/{page}/feed` with Page Public Content Access (PPCA) | Interim: `apify/facebook-posts-scraper` (with date filter) + `apify/facebook-pages-scraper` | Fan and follower count, posts, message, shares, reaction and comment totals, permalink, time | Official: no fee stated. Apify: USD 0.0025 a post + 0.0008 date filter, USD 0.001 a run, USD 0.0065 a page | https://developers.facebook.com/docs/features-reference/page-public-content-access ; https://developers.facebook.com/docs/graph-api/reference/page/feed ; https://apify.com/apify/facebook-posts-scraper ; https://apify.com/apify/facebook-pages-scraper |
| YouTube | 4 read (client channels); 25 competitor channels confirmed, not read before Google's grant | YouTube Data API v3 with an API key: `channels.list`, `playlistItems.list` on the uploads playlist, `videos.list` | none | Subscribers, videos, views, likes, comment counts, title, description, duration, time | No fee; 1 quota unit a call against 10,000 a day | https://developers.google.com/youtube/v3/determine_quota_cost ; https://developers.google.com/youtube/terms/developer-policies |
| X | 34 (29 competitors + 5 clients) | X API v2 through X's official TypeScript SDK `@xdevplatform/xdk`: user by username, user posts with `exclude=replies,retweets`, `start_time`, `since_id`; posts by id for re-reads | none (community actors rejected, see below) | Text, time, link, likes, replies, reposts, quotes, public `impression_count`, media, followers | USD 0.005 per post read, USD 0.010 per user read; "deduplicated within a 24-hour UTC day window"; spending limit per billing cycle; 3 million post reads per cycle (rechecked today) | https://docs.x.com/x-api/getting-started/pricing ; https://docs.x.com/x-api/posts/get-posts ; https://docs.x.com/x-api/tools-and-libraries/overview |
| TikTok | 16 (14 + 2) | `clockworks/tiktok-profile-scraper` (Apify-maintained, 98.65% success over 30 days) | `apidojo/tiktok-scraper` (the actor in use today) | Followers on every row, plays, likes, comments, shares, saves, time, `isAd`, `isSponsored` | USD 0.0015 a result + USD 0.0008 for the date filter = USD 0.0023 | https://apify.com/clockworks/tiktok-profile-scraper ; no official route: https://developers.tiktok.com/products/research-api/ |
| LinkedIn | 23 (21 + 2) | `harvestapi/linkedin-company-posts` (posts) + `harvestapi/linkedin-company` (company record), both in production today | `apimaestro/linkedin-company-posts` | Posts, likes, comments, shares, text, time, media, followers, website | USD 0.00175 a post, USD 0.003 a company | https://apify.com/harvestapi/linkedin-company-posts ; https://apify.com/harvestapi/linkedin-company |
| Threads | 0 | Not read | | | | https://developers.facebook.com/documentation/threads/threads-profiles |
| Pinterest | 0 | Not read | | | | https://policy.pinterest.com/en/developer-guidelines |

Who picks the route: the worker. The ordered list per platform is a constant in the contract file. For each read the worker takes the first route whose state in `reader_routes` is `ok`, and calls the service with that route named. The service alone sees the credentials, so it answers `not_configured` when it holds none for that route; the worker records that state and moves to the next route in the same job. A route in `auth_failed` or `spend_limit` makes its reads wait (4.8); a `not_configured` route never does. The daily credential check (4.6) asks the service which routes have credentials, so when Meta's token is set in the Vercel environment, Instagram and Facebook move to the official route on the next read with no switch and no flag. `not_eligible` (a personal or age-gated Instagram account) also falls to the next route in the same job. The route used is recorded on `social_reads.route`.

Platform notes:

- **Instagram.** Business Discovery needs a Meta app, one Moburst Instagram professional account linked to a Moburst Facebook Page, and on the cautious reading Advanced Access through App Review with business verification (https://developers.facebook.com/documentation/instagram-platform/app-review ; https://developers.facebook.com/docs/graph-api/overview/access-levels). Token: a Business Manager system user token, so no person signs in again and nothing needs refreshing. Whether a system user token works for Business Discovery is unconfirmed, and the first live call settles it. No sign-in fallback is built. If the system user token is refused, Instagram stays on the public route and the finding goes back to Lital as a route decision. The exact permission names are taken from the app review page when the app is built (unconfirmed). Rate limit: app level "Calls within one hour = 200 * Number of Users" (https://developers.facebook.com/docs/graph-api/overview/rate-limiting); the weekly load is about 34 profiles times 1 or 2 pages, spread over the week.
- **Facebook.** PPCA's allowed use is "Analyze and/or display posts and engagement on Pages"; Meta "may require" more contracts; it advises a system user token "to avoid rate limiting issues"; about 600 ranked posts a year per Page, 100 per request (PPCA and Page feed pages above). Unconfirmed: whether a non-admin PPCA app receives reaction and comment totals. The first live call settles it; if totals are missing, Facebook stays on the public route and the finding goes to Lital as a route decision.
- **YouTube.** Developer Policies III.E.2.a bar aggregating channels of different owners, III.E.4 bars "new or derived data or metrics", and III.E.4.b bars storing statistics read with an API key for more than 30 days (https://developers.google.com/youtube/terms/developer-policies, as read in `research-official-apis.md` section 3). The derived metrics amendment (https://developers.google.com/youtube/terms/derived-metrics-policy, in force from 1 June 2026) allows cross-channel comparison, derived metrics and 36 months of stored statistics after an application through YouTube's contact form. This design stays inside the policy as written and rests on no reading of mine. Before the grant: competitors' channels are resolved to their canonical channel id (identity only, nothing stored but the id, handle and title) and are not read; the client's own channel is read, and the product shows only figures the API returns as they are (subscribers, total videos, and each recent video with its own views, likes and comment count); nothing is computed from them, no channel sits beside another, and statistics are deleted at 30 days (4.10). No data source exposes Google's grant, so YouTube joining the comparisons cannot be derived from data. It is a later release that ships after the written grant (section 8, slice 5), with the disclosure the amendment requires. Whether Google grants it to an agency product is unconfirmed.
- **X.** The only route that gives X text, link and date. X publishes an official TypeScript SDK, `@xdevplatform/xdk`, with bearer token authentication (https://docs.x.com/x-api/tools-and-libraries/overview and https://docs.x.com/xdks/typescript/overview, read today); the adapter uses it. Stored X content must be kept "up to date with the current state of that content on X" (https://docs.x.com/developer-terms/agreement-and-policy); handled in 4.10. Whether `public_metrics` on the user object carries the follower count is unconfirmed until the first call. The community X actors are rejected: the most used one forbids monitoring and the cheapest returns mock rows when nothing is found (`research-apify.md`).
- **TikTok and LinkedIn.** No documented route for a commercial product: TikTok's Research API is for non-commercial researchers (https://developers.tiktok.com/products/research-api/); LinkedIn returns posts only for pages the member administers (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) and competitor analysis is not an approved use (https://learn.microsoft.com/en-us/linkedin/marketing/restricted-use-cases). Applying for LinkedIn's API under another stated use would misrepresent the use, so it is not done. The least risky route is the one in production: logged-out public reads of brand pages through Apify. Risk, named: TikTok's terms section 3.4 and LinkedIn's User Agreement section 8.2 forbid automated collection (https://www.tiktok.com/legal/page/us/terms-of-service/en ; https://www.linkedin.com/legal/user-agreement); Apify's General Terms 5.8 leave legal responsibility with the customer (https://docs.apify.com/legal/general-terms-and-conditions). The exposure is Moburst's and its accounts on those platforms. The existing LinkedIn checks (author must be the page, reposts out, complete counts) move into the reader's LinkedIn adapter unchanged.
- **Instagram and Facebook interim.** Same category of risk under Meta's Automated Data Collection Terms (https://www.facebook.com/legal/automated_data_collection_terms), with one specific exposure: scraping Meta while applying for a Meta app. The interim ends the day the token is set.
- **Threads.** The official Profile Discovery route gives followers and 7-day account totals with no per-post engagement and needs App Review (Threads page above). `threads_profile_discovery` is requested in the same Meta review so it can be added later as one more route; no community scraper is used.
- **Pinterest.** Pinterest's guidelines say apps may not offer "platform insights, benchmarking, or competitor research features" without written authorization (Pinterest page above). Left out.

### 4.4 Components and where each runs

| Component | Runs on | Does |
|---|---|---|
| Reader service | The app's Vercel project `moburst-socialytics`, the `server/` package (Node 22, Hono, `maxDuration` 90 s), deployed with the site by the `vercel` job of `.github/workflows/deploy.yml` (as the picture service is since 16 Nov) | Four routes. `POST /api/reader/read` takes a `ReadRequest` for an official route and answers a `ReadAnswer` within 60 s. `POST /api/reader/start` takes a `ReadRequest` for an Apify route, starts the run or runs with `maxTotalChargeUsd`, and answers `{ state: "running", run_ids }`. `POST /api/reader/collect` takes `{ job, step, platform, route, run_ids, out }` and answers `running`, or writes the rows like `read` and answers `done`. `POST /api/reader/routes` answers which routes hold a credential and one cheap live check of each. The service normalizes to `ReaderPost`, writes NDJSON pages, thumbnails and the profile picture to the signed URLs it was given, and holds vendor secrets (`META_SYSTEM_USER_TOKEN`, `META_IG_USER_ID`, `YOUTUBE_API_KEY`, `X_BEARER_TOKEN`, `APIFY_API_TOKEN`) in the Vercel environment, server side only. It holds no database key and no state |
| Adapters, one file per route | Same service; import-free mapping files under `fn/_shared/reader/adapters/` so Deno tests run them too | Map one vendor row to `ReaderPost`; drop bad rows (mock rows, negative counts, rows from another author) and count them |
| `profile_read` job kind | Supabase `scheduled_jobs`, worker `run-scheduled-jobs` | One profile per job: picks the route (4.3), mints signed upload URLs with `signedWrite`, calls the service, polls `collect` for Apify, loads one NDJSON page per step call into the tables (so no step parses a whole dataset under the 2 s CPU limit), writes `social_reads` |
| `reader_check` and `reader_retention` job kinds | Same worker | One of each a day (4.6, 4.10) |
| Enqueuer | `enqueue_scheduled_report_jobs()`, redefined from its latest version (`20261019190000_calendar_self_serve.sql:98`), called by pg_cron `scheduled-reports-enqueue` at 07:15 UTC | Adds `profile_read` jobs for profiles whose `next_read_at` has passed, one `reader_check` job and one `reader_retention` job a day |
| Fact layer, gaps, writer, checks | Supabase pipeline runner, new pipeline definition `competitive_v2` | Section 4.11 |
| Weekly pass per client | Supabase, the existing `feed_refresh` job | Section 4.12 |

The three new job kinds belong to no client. The same migration adds them to `scheduled_jobs_kind_check` and to `scheduled_jobs_client_required`, which today allows only `sprout_onboarding` and `moments_list` without a client (`20261110140000_seasonal_relevance.sql:165-172`), and to `JobKind` in `fn/_shared/scheduled-jobs/types.ts`.

Storage: NDJSON pages go to the existing private bucket `pipeline-payloads` (`20261020110000_inhouse_groundwork.sql:136`) and are deleted once loaded. Thumbnails and profile pictures go to a new private bucket, `social-media`, as WebP with a longest side of 640 pixels. Screens never get a public link: one edge route checks the caller's access to the client, then returns signed read URLs with a one-hour life. PDFs and decks embed the image bytes at export.

The service follows the picture service pattern: the contract file with no imports, a call opened in the database by the worker and claimed once by the service (header `x-socialytics-call`, `server/src/call.ts`; the picture service spec, "As released 16 Nov 2026"), strict zod bodies, one JSON log line per call with route, job, step, platform, duration, rows and cost and never a URL or token (`server/src/log.ts`), one retry on network error, 429 or 5xx, a plain reason on failure, signed storage URLs (`server/src/storage.ts`). No secret is set for the call itself: the picture service's shared secret was removed on 16 Nov, and the reader's calls are checked through the database the same way. One difference, stated: the picture service holds no vendor secret; the reader does, because keeping every platform secret in one service with no database access is narrower than spreading them over edge functions. The edge functions keep `APIFY_API_TOKEN` for trends until trends moves (slice 6).

Why Vercel: Lital chose on 12 Nov to move server work to this Vercel project step by step; edge functions have a 2 s CPU budget per request (the reason the picture service exists); normalizing vendor datasets and resizing thumbnails with `sharp` belongs where the picture service already has CPU, memory and `sharp`.

Dependency, named: the `server/` package is on branch `trends` and not live. The reader's routes are added to that package after the picture service plan's package tasks are merged, and the reader goes live with or after the picture service release. Section 7, risk 9.

### 4.5 Tables

One migration. All staff and service only under RLS. Clients reach the data only through reports and screens.

| Table | One row is | Columns that matter |
|---|---|---|
| `social_profiles` | A public profile, once, however many brands point to it. Platform facts only | `id`, `platform`, `native_id` (unique with platform), `handle` (unique lower-cased with platform while `native_id` is null), `url`, `display_name`, `bio`, `location`, `website`, `bio_links`, `avatar_path`, `account_kind`, `state` (`live`, `gone`), `first_read_done_at`, `last_read_at`, `next_read_at`, `read_weekday` |
| `brand_profiles` | The link between one brand and one profile, with its confirmation. The only place that says whose a profile is | `brand_kind` (`client`, `competitor`), `brand_id`, `platform`, `profile_id`, `state` (`candidate`, `confirmed`, `unconfirmed`, `rejected`), `source` (`site_link`, `search`, `cross_link`, `sprout`, `imported`, `person`), `confirmed_by` (`site_link`, `signals`, `pair`, `sprout`, `person`), `evidence` jsonb, `rank`, `confirmed_at`, `next_check_at`. At most one `confirmed` row per brand and platform (partial unique index); every other candidate keeps its own row |
| `social_profile_snapshots` | One follower count on one day | `profile_id`, `observed_on` (unique with profile), `followers`, `posts_total`, `read_id`, `imported` bool |
| `social_posts` | A post, once | `id`, `platform`, `native_id` (unique with platform), `profile_id`, `published_at`, `url`, `text`, `format`, `paid`, `pinned`, `repost`, `media_path` (our storage copy), `route`, `first_seen_at`, `deleted_at` |
| `social_post_metrics` | One observation of a post's counts, append only | `post_id`, `observed_at`, `age_hours`, `likes`, `likes_hidden`, `comments`, `shares`, `views`, `impressions`, `engagement` (computed by `engagementsOf`; null when every part is null), `read_id` |
| `social_reads` | One read of one profile (or one check) | `id`, `profile_id`, `platform`, `route`, `purpose` (`confirm`, `first`, `weekly`, `snapshot`, `settle`, `keep_current`, `check`), `window_start`, `window_end`, `started_at`, `finished_at`, `outcome` (`ok`, `partial`, `not_configured`, `auth`, `not_found`, `not_eligible`, `rate_limited`, `spend_limit`, `failed`, `empty_unexpected`), `reason`, `rows`, `cost_usd`, `vendor_run_ids`, `job_id` |
| `reader_routes` | One route | `route_key`, `platform`, `state` (`ok`, `not_configured`, `auth_failed`, `spend_limit`), `state_since`, `last_ok_at`, `last_failure_at`, `reason`, `next_probe_at` |
| `theme_vocabularies` | One version of a competitor set's theme list | `set_id`, `version`, `themes` jsonb (each marked pillar or added), `created_at` |
| `post_theme_labels` | One post's themes within one set | `set_id`, `post_id`, `themes`, `vocab_version` |

Why `brand_profiles` is its own table: a profile row is shared by every brand that points to it, while confirmation, evidence and candidates belong to one brand. Today's `competitor_handles` and `client_public_profiles` allow one profile per brand and platform and have nowhere to keep a second candidate. Their rows move into `brand_profiles` in the same migration (5.1), with their two rules carried as states: a row with source `person` is never overwritten, and a `rejected` row never comes back. Both old tables stop being written in slice 1 and are dropped with the RivalIQ tables after cutover; the API serves its handle fields from `brand_profiles` under the same keys.

Theme labels sit per set because the vocabulary is the client's pillars plus that set's added themes, so one post can carry different labels for two clients.

"Absent" is not a row. It is a value on the lifecycle step result (4.7), because it describes what discovery found for a brand, and a profile that does not exist has no row to hold it.

No table holds a feed. The feed is a query (4.12).

The client's own Sprout posts are stored in `social_posts` with `route = 'sprout'` and observed weekly by the weekly pass into `social_post_metrics`, so the settled-engagement rule (4.11) applies to the client and competitors alike.

### 4.6 Schedules

| What | When | Window and cap |
|---|---|---|
| Confirmation read | When a candidate appears | `max_posts` 0: the profile record only |
| First read of a profile | As soon as it is confirmed | 90 days back; `max_posts` 200 |
| Weekly read | Once a week on `read_weekday`: the lowest weekday number that `feed_refresh_weekday(client_id)` (`20261006150000_scheduled_report_queue.sql:56`) gives for the clients that use the profile; queued by the 07:15 UTC enqueuer | Posts published in the last 14 days. `max_posts` is the larger of 60 and twice the number of posts the last weekly read returned, so a busy profile is not cut short every week. The overlap gives every post a second observation at 7 to 14 days old |
| Follower snapshot | With every read; Instagram, Facebook and YouTube on official routes also daily (free, one call, `max_posts` 0, purpose `snapshot`) | One row a day at most |
| Weekly pass per client (`feed_refresh`) | On the client's weekday, deferred until that week's reads of the client's and its competitors' profiles have ended (done, or out of tries) | Observes the client's Sprout posts, labels themes, finds topics (4.11, 4.12) |
| Settle read | First step of a monthly report, only for the period's posts with no observation at 7 days old or older | By id on X; by profile window elsewhere |
| X keep-current read | Before a report or strategy shows an X post as an example | By id |
| Credential check (`reader_check`) | Daily: asks the service which routes hold a credential and makes one cheap call per configured route | Sets `not_configured`, `ok` or `auth_failed` on `reader_routes` |
| Probe of a failed route | Hourly while the route is `auth_failed` or `spend_limit` | One call |
| Confirmation recheck | When a read answers `not_found` twice, when the brand's website changes, and every 30 days for a brand and platform with candidates and none confirmed | One profile record read per candidate |
| Retention (`reader_retention`) | Daily | Section 4.10 |

A profile shared by two clients is one `social_profiles` row and is read once; a read newer than 6 days is reused.

### 4.7 Finding and confirming profiles without a person

**Candidates**, per brand and platform, each a `brand_profiles` row in state `candidate`:

1. Links on the brand's website (existing, `detectHandles.ts`).
2. The rendered read and the Firecrawl search by name, `searchProfiles(name)` (existing, `detectHandles.ts:74-83`).
3. New: links inside the brand's already confirmed profiles (Instagram bio links, the LinkedIn page's website, links in a YouTube channel's description, since the channel record has no website field, `research-official-apis.md:110`).
4. New: the handles RivalIQ recorded (19 competitor rows and 5 client rows) and the client's connected Sprout profiles. The RivalIQ rows enter with source `imported`. They are candidates like any other and get the same profile call; nothing is read from them before they confirm.
5. A person's entry.

**Signals**, in code, from the candidate's own record (one profile call through the reader with `max_posts` 0; free on official routes, USD 0.010 on X, about USD 0.003 on Apify):

| Signal | Holds when |
|---|---|
| S1 back link | The brand's website links this profile and no other on that platform |
| S2 profile website | The profile's website field or a bio link (for YouTube, a link in the channel description) has the brand's registrable domain |
| S3 name | The profile's display name and the brand name match under `normName` (`profiles.ts:24-30`): after normalizing, one contains the other |
| S4 cross link | Another confirmed profile of the same brand links to it |

The registrable domain ("example.co.uk" from "shop.example.co.uk") is taken with the Public Suffix List (https://publicsuffix.org/, read today), through a maintained parser chosen at build.

**Rule**

- `confirmed` when S1 holds, or any two signals hold, or a person entered it, or it is the brand's connected Sprout profile.
- Pair rule, for a brand with no website and nothing confirmed yet: two candidates on different platforms that both match by name (S3) confirm together when one links to the other or both records carry the same website domain. Without it no candidate could ever reach two signals, since S4 needs a confirmed profile to start from. A lone name match stays unconfirmed.
- `unconfirmed` otherwise. An unconfirmed profile is never read and never counted. A profile whose website is another company's domain and whose name does not match is `unconfirmed` (this settles NPDigital's X and YouTube `neilpatel`, which point to a person's site).
- Two candidates that both qualify on one platform: the one with S1 is confirmed, then the one with S2, then the one with more signals; on a full tie, the one the site lists first. The other keeps its `brand_profiles` row as a `candidate` with a lower `rank` and is never read.
- A confirmed profile whose website later points to another company is set `unconfirmed` on its next read.
- YouTube handles and channel ids are resolved to the canonical channel id through `channels.list` (fixes the lower-cased id case).

**What a platform can be for a brand**, kept per platform on the step result:

| Value | Meaning | Words on screens |
|---|---|---|
| `confirmed` | One confirmed profile | A figure, or "Too few posts to compare" |
| `unconfirmed` | Candidates exist and none confirmed | "Not compared" |
| `absent` | The website links no profile on this platform, the search by name finds none, and no confirmed profile of the brand links one. All three, with each source having answered | "Not on this platform" |

A source that failed to answer (a site that refused, a search error) leaves the platform `unconfirmed`, never `absent`. Every rule in this spec that says "absent" means this value.

**Two lifecycle steps replace `tracking`.** The old key described waiting for a RivalIQ seat. It is removed, with its three waits (`rivaliq_full`, `client_website`, `own_site`).

- `profiles`: the client's own profiles. Runs after `website` has ended (found a site or not). Done when every platform is `confirmed` with a finished first read, `unconfirmed`, or `absent`. Spec 2's brief, platforms and strategy read its result, so it runs before `brief_pillars` and `accounts`.
- `competitor_profiles`: the same for each selected competitor. Runs after `competitors`. One competitor's refusing website affects only that competitor (fixes DS-20).

One migration renames the key everywhere it is used: the allowed list in `lifecycle_request` (redefined from `20261109120000_claude_connector.sql:225-250`), the `LifecycleStepName` type (`useLifecycleStep.ts:7`), `ClientSetup.tsx:201`, `display.ts:593`, `steps.ts:146, 931, 1017`, the trigger that seeds a new client's steps, and the stored rows (each client's `tracking` row becomes a pending `competitor_profiles` row, and a `profiles` row is added). Staff-facing step text: "Finding and reading {brand}'s profiles" and "Finding and reading competitors' profiles".

**Competitors with nothing to compare.** "Active on a platform" means the client has a confirmed profile there with a post in the last 90 days. A selected competitor with no confirmed profile on any platform the client is active on is reported by `competitor_profiles`; the `competitors` step then swaps in the next candidate of the set by `similarity_score` (the unselected `competitors` rows that have a website, `steps.ts:814-816`; 86 exist today), and `competitor_profiles` runs for the newcomer. This happens only when the set was made by the system (`competitor_sets.confirmed_by` is null; 11 of the 14 current sets). A set a person confirmed (3 today) is never changed; that competitor shows "Not compared" per platform. The swap ends when a competitor qualifies or the candidates run out. This removes the Twos "HearMe" case (COMPETITIVE-24) without a person.

**A competitor stored with the wrong website** (Streem stored with its parent's site). The `competitors` step gains a check before a candidate is selected: the site's page title or Open Graph site name must match the competitor's name under the same `normName` rule as S3. A mismatch drops the candidate (slice 1).

### 4.8 Failure handling: no stuck path, no silent path

| Class | Example | What happens | How it ends |
|---|---|---|---|
| `not_configured` | Meta's token has not been set yet | Not a failure. The worker uses the next route in the same job | The daily check moves the route to `ok` when the credential appears |
| `auth` | 401, 402 or 403 on a route's credential | The route goes `auth_failed` on the first one; queued reads on that route wait without spending tries; other routes keep running; nothing is stored as an empty result; screens keep the last good data with its date | An hourly probe (one cheap call) sets the route back to `ok` as soon as it answers, and every waiting read runs. The credential itself is fixed by setting the secret, the one owner action every product secret has. A route that has waited 24 hours sends one message through the existing sender (below) |
| `spend_limit` | X answers that the cycle's spending limit is reached | Route `spend_limit`; reads on it wait | The probe clears it at the next billing cycle. Only reachable if X volume is more than double the approved estimate (4.9) |
| `not_found` | Handle renamed or deleted | Second time in a row: profile `gone`; discovery runs again for that brand and platform | A new candidate is confirmed, or the platform becomes `unconfirmed` or `absent` |
| `not_eligible` | Personal or age-gated Instagram account; Page with no PPCA access | The next route in the platform's list reads it in the same job | If no route serves it: "Not compared" for that brand and platform |
| `rate_limited` | 429 with a reset time | The job waits until the reset | Runs at the reset |
| `transient` | Network error, 5xx, vendor run failed or timed out | The runner's backoff, 2 to 60 minutes, 5 tries; then the platform's fallback route once | `failed` with the reason. For a report period, that profile is "Not compared" and the report goes ahead (4.13); the next day's enqueuer tries the read again |
| `partial` | `max_posts` or the run budget reached before `since` | Stored with `complete = false` | Figures use only the days covered and say so in staff coverage; a period with a partial read is excluded from period-on-period change |
| `empty_unexpected` | A read returns no posts for a profile that had posts in the previous read | Stored posts are kept; the read is marked and repeated the next day | A second empty read with the profile still answering is accepted as a real zero |
| Bad rows | Mock rows, negative counts, rows from another author | Dropped by the adapter and counted on the read | n/a |

Rules across all classes: unknown is never zero; a week where reads failed is never "no posts"; screens show the date of the last good read; every outcome is a row in `social_reads`, so "what failed and why" is one query.

Who hears about it. Staff see every read on the run log (4.14). The product's only message today is the Slack note for a report that is still not ready a day after its first try (`fn/_shared/alerts/slack.ts`); a read waiting on a dead credential never fails, so it would never trigger that note, and a weekly feed could go stale for a month in silence. So the same sender posts one message when a route has been `auth_failed` for 24 hours ("Instagram reads have been waiting since November 14. The access token was refused.") and one when it clears. One message per outage, to the channel that already gets the report notes. This was an owner question in the builder's check; I settled it this way because the fix is a secret only Lital sets, and she can strike the message without changing anything else (section 10).

### 4.9 Spend guards

- Every Apify run is started with `maxTotalChargeUsd` = expected rows times unit price times 2 (https://docs.apify.com/api/v2/act-runs-post). No run sends it today. A run stopped at the cap is `partial`.
- Reads are bounded by construction: one weekly read per profile, one first read, the settle and keep-current reads by id, retries bounded by the runner. The monthly bound is therefore the sum of the per-read budgets over the profile list, computed from data and shown on the staff run log beside the spend so far (`sum(social_reads.cost_usd)`). There is no monthly hard stop inside the product: a stop would leave clients with stale data and need a person to restart it.
- X: a spending limit per billing cycle is set in X's console (decision 3: USD 60, which covers 30 clients at the planning pace plus a first read). It trips only if volume doubles; then the route is `spend_limit` until the next cycle (4.8).
- The shared Apify account: Moburst's custom usage limit is USD 590 a billing period (17th to 16th), set 9 Nov 2026; at the limit Apify pauses platform services for every product on the account, AdVisor included. Usage by calendar month was USD 242.55 in August, 352.34 in September and 291.87 in October; the period that began 17 Oct stood at USD 455.37 on 9 Nov, lifted by one-off test runs (all from memory note `apify-billing-and-mesh-card.md`, 9 Nov 2026). Weekly trends began on 3 Nov and add about USD 72 a month at 14 clients (`understand-readers.md` section 5). This design adds about USD 17 a month on Apify at the planning pace while Meta is interim, and about USD 23 once. A normal month then lands at about USD 380 to 440, which leaves USD 150 to 210 under the limit. The first 90-day read is queued for 17 Nov or later so it lands in the new period. The margin is risk 4 and part of decision 3.

### 4.10 Retention, per route

| Route | Kept | Basis |
|---|---|---|
| YouTube (client's own channel, before Google's grant) | Statistics (subscribers, views, likes, comment counts) deleted 30 days after they were observed; titles and descriptions refreshed or deleted within 30 days. A competitor channel holds only its channel id, handle and title; the daily retention job refreshes the title with one `channels.list` call when it is 30 days old, or deletes it | Developer Policies III.E.4.b (URL above) |
| YouTube after the grant (a later release) | Statistics up to 36 months; text still 30-day refresh or delete | Derived metrics policy (URL above) |
| X | Before an X post is shown as an example in a report, strategy or feed, it is re-read by id; a post X reports as deleted is removed from `social_posts`. X text and counts older than 90 days are deleted; the post id and date stay | X Developer Agreement (URL above). The 90 days is this design's own rule |
| Meta (official and interim) | Kept while the profile is in use; deleted 30 days after it stops being in use. "In use" means a current client or competitor set points to it, or a report whose period ended in the last 13 months compared it | Meta Platform Terms 3.d requires deletion when retention "is no longer necessary for a legitimate business purpose" and states no period (https://developers.facebook.com/terms). The 30 days and the 13 months (a year-on-year comparison plus one month) are this design's own rules |
| TikTok, LinkedIn | Same as Meta | Data minimization, this design's own rule |

How deletion reaches every place a post appears. Platform data lives only in the reader's tables. The feed is a query over them (4.12). A report and a strategy store their example posts as post ids and resolve them when the page loads, so a deleted or expired post drops out of every screen at the next load. What a report stores as values are its computed facts (medians, shares, counts). Before the grant no YouTube figure is stored in a report or a strategy at all: the page reads the client's YouTube figures from the tables when it loads, so the 30-day rule holds everywhere. Two things are outside the product's reach and are named: a PDF or deck already exported and handed over, and the computed facts in a stored report after the posts behind them are gone. How those two sit under each platform's terms is my own reading. It is no legal advice and it is unconfirmed.

### 4.11 The analysis: what code computes and what a model writes

#### What the Social strategist needs (drives every fact)

Derived from the report sections, monthly report section 04, calendar and strategy inputs and the owner's "not sufficient". The Social team itself was not asked; decision 5 covers that. A need the team adds becomes a new row here and a new fact below, with no change to the reader or the tables.

| # | Question | Fact | Data |
|---|---|---|---|
| N1 | How much and how steadily does each brand post? | Posts per week; active weeks share; longest gap in days | Every post date in the period |
| N2 | What does a typical post earn relative to audience size? | Median settled engagements; median engagement per 1,000 followers; per 1,000 views on video; per 1,000 impressions on X | Per-post counts, followers near publication |
| N3 | Is the audience growing? | Followers now and change over the period | Dated snapshots |
| N4 | Who holds attention? | Share of posts and share of engagement | N1 and N2 over the same platforms for every brand |
| N5 | What works for them? | Outperformers (at least 2 times the brand's own median on that platform); top 5 by engagement per follower | Settled counts |
| N6 | Which formats and themes? | Format mix and theme mix, with median engagement per format and theme; hashtags | Format, caption, theme labels |
| N7 | When do they post? | Weekday and hour counts in the client's time zone (`clients.timezone`) | Post times |
| N8 | Where is the client missing out? | Gaps by rule | N1 to N6 on the same basis |
| N9 | What changed this week? | New posts, this week's outperformers, topics two or more brands posted about | Weekly read |

#### Facts, computed in code

One shared module beside `reportMetrics.ts`, used by the report, screens, API, strategy and writer. Its per-brand part ships first, with spec 2's slice B, because the strategy needs a brand's own facts before any report exists; the set-level part (shares, benchmarks, gaps) ships in slice 2. Posts that fail `isPublishedPost` (`reportMetrics.ts:100`), reposts and posts with a platform paid label are left out of medians and outperformers; they still count as posts.

Two windows, one rule each. Volume facts use the report period (the month) and the previous period of equal length. Typical-post facts (medians, rates, format and theme medians, the outperformer baseline) use the 90 days ending at the period end, because at the measured October pace a month holds too few posts: X 6, TikTok 2.3, YouTube 8.2, Instagram 11 a month against a minimum of 8 (section 6). Over 90 days the same pace gives X 18 and Instagram 33; TikTok at about 7 still falls short and says so. The reader already holds 90 days, so this costs nothing more. Decision 1 is where this is chosen.

| Fact id pattern | Window | Definition |
|---|---|---|
| `posts`, `posts_per_week` | Period | Published posts in the period; over the period's days times 7. A partial read uses only the days it covers |
| `active_weeks_share`, `longest_gap_days` | Period | Weeks with at least one post over weeks in the period; the longest run of days without a post |
| Settled engagement of a post | | `engagement` from the first observation made when the post was 7 days old or older. A post first seen when it was already older than that is settled at its first observation. A post with no such observation uses its newest one and is marked unsettled; staff coverage counts them. A post with hidden likes has no engagement figure |
| `median_engagements` | 90 days | Median settled engagement; shown only with at least 8 posts that have a figure |
| `engagement_per_1k_followers` | 90 days | Median of settled engagement divided by followers at the snapshot nearest before publication, times 1,000. A post published before the profile's first snapshot uses the earliest snapshot; staff coverage says how many posts did |
| `engagement_per_1k_views` | 90 days | Same over views, for TikTok and Instagram reels; over impressions for X |
| `followers`, `follower_change` | Period | Latest snapshot in the period; change from the first snapshot in the period. No change figure before two snapshots exist |
| `share_of_posts`, `share_of_engagement` | Period | A brand's posts or settled engagements over the set's total, only over platforms where every compared brand is either read or `absent` (4.7) |
| `outperformers` | Period, against the 90-day median | Posts at least 2 times the brand's own median on that platform (brand needs 8 posts with figures), the calendar's existing rule (`calendar/evidence.ts:203-223`) |
| `format_mix`, `theme_mix` | Shares over the period; medians over 90 days | Share of posts per format or theme; median engagement per format or theme with at least 3 posts |
| `rhythm` | 90 days | Weekday and hour counts in the client's time zone |
| `hashtags` | 90 days | Counts and median engagement per follower from captions |
| `coverage` | Period | Per brand and platform: compared, not compared (unconfirmed, no route, or reads out of tries), not on this platform (`absent`), partial span, posts unsettled, posts on the earliest snapshot |

Benchmarks: the competitors' median (the client is never part of it) and the client's rank of four, computed only from brands with a figure; a benchmark with fewer than two competitor figures is not shown. The client's Sprout private measures (impressions, reach, clicks, saves) never sit beside a competitor figure; they stay in the monthly social report. `client_score` is removed: a model score is not a measurement. YouTube is in none of these facts before the grant.

#### Themes

Code cannot read meaning, so labeling is a model task whose output is data code counts. In the weekly pass, after the reads, one call per client labels each new post of the client and its competitors with one or two themes from the set's vocabulary: the client's content pillars plus up to 8 themes the model may add per set. The model is the code's check constant, `CHECK_MODEL` (`claude-sonnet-5-5`, `fn/_shared/strategy/write.ts:56`); the old feed call's hard-coded `claude-sonnet-4-6` (`refreshFeed.ts:146`) goes with the RivalIQ feed. The current vocabulary (`theme_vocabularies`) is sent each week so labels stay stable; labels are stored in `post_theme_labels` with the vocabulary version. A post it cannot label is "other". The weekly topics pass (`competitive_alerts`, stable `topic_key`) is folded into this call; a failed pass ends the job as a retry, never as a silent empty week (fixes COMPETITIVE-11).

The first run for a set has up to 90 days of posts to label. It goes through the Message Batches API in requests of up to 200 posts, and the set's first report waits for it. Its cost is in section 6.3.

#### Gaps, found by rule before any model runs

"Competitors' median" below is the median over the competitors that have a figure, the client excluded.

| Gap type | Rule |
|---|---|
| Format | At least two competitors use a format on a platform with median engagement per 1,000 followers above the competitors' median for that platform, and the client has fewer than 2 posts in that format there |
| Theme | Same, for a theme |
| Platform | At least two competitors are compared and post at least 2 times a week on a platform where the client is `absent`. A platform where the client is "Not compared" is never a gap |
| Cadence | The client's posts per week are below half the competitors' median on a platform where its engagement per 1,000 followers is at or above the competitors' median |
| Consistency | The client's active weeks share is below 50% where the competitors' median is above 80% |

At most 6 gaps, ranked by the size of the difference. Each carries a stable key `type:platform:subject`. `suppressed_insights`, verdicts and edits attach to the key, so they survive the next report (fixes COMPETITIVE-16). No stored verdict needs converting: `competitive_insight_feedback` and `competitive_learnings` hold 0 rows.

#### What the model writes

Writer: the existing monthly analysis, `claude-opus-5-5` through the Message Batches API (`analysis.ts:28-30`), same `ai_analysis` keys (`executive_summary`, `competitor_breakdowns`, `winner_teardown`, `posting_time_insights`, `recommended_schedule`, `gaps_for_client`, `benchmark_scorecard` without `client_score`). Input: the fact list, each fact with an id, label, value, unit, brand, platform, window and sample size; the gaps with their fact ids; up to 3 example posts per outperformer pattern (text up to 400 characters, format, figures, link); the client's time zone; the account team's learned preferences. The model may not add a gap; it writes `why_it_matters` and `suggested_play` for gaps code found. Every sentence cites fact ids in a hidden field. The prompt is rewritten source-neutral (today it names RivalIQ and Sprout at `prompt.ts:21, 49, 51, 67` and `analysis.ts:112`).

Checks, in code: every number in the text appears among the cited facts (rounded as written); no word from the vendor word list; American spelling list; no dash as sentence punctuation; no relative dates; no claim about a platform that is not compared; example links only from the supplied posts. Then one fact check on `CHECK_MODEL` reads the text against the facts, as the strategy writer does today (`write.ts:753-794`).

The vendor word list is one constant in one module (RivalIQ, Rival IQ, Sprout, Apify, Firecrawl, Vercel, Supabase, landscape, pipeline, snapshot, scraper, actor, estimated impressions). The writer's check, the lint over client-facing strings and the one-time correction of old reports (5.1) all import it, so old and new text pass one rule.

When a field fails: up to two rewrite rounds for that field, each given the failed checks. If it still fails, the field is left out of this report. Its section is still drawn, because every section is built from facts and the paragraph only sits beside them. The job tries the missing field again on each of the next three days and adds it when it passes; the staff run log shows which fields are missing and why. No template sentence ever stands in for a written one, and a report is never held for prose.

### 4.12 The weekly competitor feed

The feed is one SQL function, `competitor_feed(client_id, window_start, window_end)`, staff and service only, over `brand_profiles`, `social_posts`, `social_post_metrics` and `post_theme_labels`. It returns the client's and its competitors' posts in the reader's own shape: post id, brand kind, brand id and name, platform, published time, text, link, stored image path, format, engagement and its parts, views, followers near publication, paid label, themes. Nothing is stored twice, so the feed cannot drift from the tables and retention reaches it with no extra step (4.10). It carries no YouTube posts before the grant.

The seven readers (section 3) switch from the stored RivalIQ payload to this function in one change, and each takes the new field names; no reader keeps the old shape. The 41 stored feed rows are not copied. The first read of every confirmed profile already covers the same 90 days, so the calendar's and the strategy's evidence continues from the tables, with images from our own storage (fixes COMPETITIVE-10). `rivaliq_snapshots` stays read-only for replaying old reports.

The `feed_refresh` job becomes the weekly pass for every client whose set is ready (4.13), in place of today's "linked landscapes only" rule: it waits for the week's reads (4.6), observes the client's Sprout posts into `social_post_metrics`, and runs the theme and topics call.

### 4.13 One readiness rule

One SQL function, `competitor_set_ready(set_id, period_end)`. It is true when the client's `profiles` step and the set's `competitor_profiles` step are done (4.7) and, for every confirmed profile of the set, the reads that cover the time up to `period_end` have ended: either a read covers it, or the tries and the fallback are spent, in which case that profile is "Not compared" for the period. One failing route therefore never holds a report (G5). The weekly pass calls it with the end of the week.

The scheduler, the gate, the pipeline, the weekly pass, the run page, the API's `tracked` and every screen call it (fixes COMPETITIVE-01, -02, -03, -12 by construction). Three behaviors follow. The first and third ship in slice 1 with the function; the second ships with `competitive_v2` in slice 3:

- The scheduler skips a due occurrence for a set that is not ready, or that no pipeline serves yet (every set without a landscape, until slice 3 ships). A client added through spec 2 gets its competitive schedule at insert, and nothing runs until then.
- When a set first turns ready, its first report is queued for the latest full month. It does not wait for the 7th. Sets that were ready before slice 3 get theirs on the day it ships.
- The dashboard and Setup state a first report date only when the set is ready and a pipeline serves it (fixes DS-06, DS-07); until then they show the competitors' names alone. The false "runs on Dec 7" sentence goes on the day slice 1 ships.

A newly confirmed set takes over only when it is ready; until then the last ready set keeps serving.

Which pipeline runs is derived from data, because `report_engines` has no place to store a version (section 3). Each definition says which sets it serves: `competitive_v1` serves a set with a linked landscape (`competitor_sets.rivaliq_landscape_id`), through the 7 Jan 2027 cycle; `competitive_v2` serves every other set. The retirement release (slice 4) removes `competitive_v1`, and v2 then serves every set.

### 4.14 Screens and their states, in the words a client reads

No screen names a vendor, a route, a pipeline or a mechanism. Vendor names appear only on the staff Settings page (`/settings`, `src/pages/Settings.tsx:79`), the integrations' own settings.

**Competitive report page** (`CompetitiveReportView.tsx`), sections in order; a section with no facts is not drawn:

1. Summary. The written summary and one line: "Compared on Instagram, Facebook, TikTok and LinkedIn, October 1 to October 31."
2. Where you stand. Per platform: posts per week, consistency, engagement per post, engagement per 1,000 followers (per 1,000 views on video), followers and change, share of posts, share of engagement. Columns: you, competitor median, rank. Typical-post figures carry the label "Last 90 days".
3. Who holds attention. Share of posts beside share of engagement per brand.
4. What works for them. Each competitor's standout posts with images, and the written pattern.
5. Formats and themes. Share and typical engagement per format and per theme, you against the field.
6. When they post. Weekday and hour strips, labeled with the client's time zone ("Times in Eastern Time").
7. Gaps and tests to try. Code-found gaps with the written play; the existing Implement and Not for us actions keyed by gap key.
8. Top posts per brand.
9. Your YouTube channel (only when the client has one, before the grant). Subscribers, total videos, and the recent videos with their views, likes and comments, as YouTube reports them. No competitor, no rate, no median.

Per-platform cell states: a figure; "Not compared" (no confirmed profile, no route, or reads that did not finish); "Not on this platform" (`absent`); "Too few posts to compare" (below the sample minimum). Never "0" for unknown and never "No posts" when a read failed.

A report where no platform reaches the minimum for any brand still ships. The summary line reads "Too few posts in the last 90 days to compare typical results. Posting volume and followers are below." Section 2 shows its volume and follower rows, sections 3 and 6 are drawn, and sections 4, 5 and 7 are left out because they have no facts.

Removed from client view: "Snapshot from the report run", "collected source snapshots", the September 2 note, correction notes, "landscape", "estimated impressions", UTC labels, chart mechanics (COMPETITIVE-05, -06, -07).

**Analytics, Competitive tab, and the monthly report's Competitive tab** (`CompetitiveSnapshot.tsx`): share of posts and share of engagement, posts per week against the competitor median, engagement per 1,000 followers against the median, follower change, open gaps, change cards. Before the first report: "Your competitors: Tinuiti, Brainlabs and NP Digital. Your first comparison is ready on December 31." (the date only when the set is ready; otherwise the names alone).

**Monthly report section 04 "Against the field"** (`ReportView.tsx:546-565`): share of posts, share of engagement, posts a week, engagement per 1,000 followers against the field, from the newest ready report.

**Dashboard Competitors tile**: share of engagement, names, ahead and behind per dimension.

**Staff only, outside print**

- A coverage panel per report: "Instagram: read November 10, 42 posts, complete"; "X for NP Digital: not compared, profile not confirmed"; "3 posts not yet settled"; "12 posts measured against the first follower count we have".
- The Competitors screen, showing each competitor's confirmed profiles with the evidence in plain words. The full list of evidence lines: "Linked from their website", "Their profile links to their website", "Name matches and their website links to it", "Name matches and another of their profiles links to it", "Two of their profiles link to each other", "Connected account", "Added by {person}". Staff can replace or remove a profile; that entry wins.
- The competitor feed page: this week's posts per brand, standouts, open topics, for every client.
- The run log, a page for admins only at `/reads`, guarded like `/usage` (`src/App.tsx:82`). A header with spend this month beside the month's bound (4.9), and one line per platform: "Working", "Waiting for access since November 14" or "Official access not set up". Below, a table of reads, newest first, filtered by client: date, brand, platform, kind of read ("First read", "Weekly", "Follower count", "Check"), result in plain words ("Read 42 posts", "Stopped at its spending cap", "Profile not found"), posts, cost. Report runs list any written field still missing. The log names platforms, never a vendor or an actor; those names sit on `/settings` in a "Data sources" section that lists each platform's route.

**Competitor feed page** (staff): described above; it reads `competitor_feed`.

### 4.15 API and connector

`/v1` changes only add. `competitors.tracked` and `competitor_sets[].tracked` keep their names and mean `competitor_set_ready`; `tracked_since` is the date it became ready. Handle fields keep their keys and are served from `brand_profiles`. New optional fields: `coverage` per competitor and platform. `report_data.aggregates.companies[]` keeps its keys (`post_count, cadence_per_week, by_channel, by_weekday, by_hour, top_posts, top_hashtags, media_type_mix, channel_mix, comparison_metrics`) and adds the new facts beside them; new reports carry `metric_semantics_version: 5` and `source: "public"`. The Claude connector tools keep their names and shapes. Each change is logged in the integrators guide section 12 (memory note `socialytics-api-integrators.md`).

API demo jobs: the demo step named `tracking` (`fn/api/demo/steps.ts:316-321`) is the API's own step name, separate from the lifecycle key, so it stays as integrators know it. It stays skipped: a demo gets no profile reads and no competitive report, so a demo adds no spend. Its message loses the seat wording and becomes "A demo runs no competitor reads; the connected showcase workspace shows the competitive report." Whether demos should get reads was an owner question in the builder's check; I settled it as "stay skipped" because it keeps today's behavior and adds no cost (section 10).

---

## 5. Migration and what is retired

### 5.1 Migration

- **Stored reports** (45 complete, active and archived): figures unchanged; screens keep `normalizedCompetitiveMetrics` for version 4 and below and draw the new sections for version 5. "Since last report" compares only reports of the same version.
- **Vendor words in old report text**: 29 of the 45 complete reports carry a vendor or pipeline word in their written analysis (database, read today). They are corrected once, in the data, by a migration job in slice 3: each failing sentence goes through the writer's own rewrite and check loop on `CHECK_MODEL`, the rest of the text is kept word for word, and the original `report_data` is kept in a new column `report_data_original`. After it, stored text passes the same vendor word list as new text, and no screen scrubs anything when it reads. A report whose text still fails after two rounds keeps the failing field out of client view, the same rule as a new report (4.11). Cost in section 6.3.
- **Which reports clients can read**: `competitive_reports` gains `shared boolean`, and the client RLS policy requires it (fixes COMPETITIVE-08). The pipeline's last step sets it: true for a complete report that passed its checks and came from a scheduled occurrence or a set's first-ready run; false for a manual or test run. For existing rows the migration sets true on complete reports, except the ones the stored quality check holds for review (the six rows in COMPETITIVE-17 among them) and the hand-made Bader Law row `b7c3a1d2` (COMPETITIVE-14).
- **Handles**: every active row of `competitor_handles` and `client_public_profiles` becomes a `brand_profiles` candidate and goes through 4.7. Rows a person entered arrive `confirmed` with source `person`; rejected rows arrive `rejected`. RivalIQ's 19 competitor rows and 5 client rows arrive as `imported` candidates.
- **Lifecycle key**: `tracking` becomes `profiles` and `competitor_profiles` in one migration (4.7).
- **Follower history for Bader Law, Pay The Pyper and Moburst's previous set**: the audience figures in their stored report snapshots (`rivaliq_audience_snapshot` and the period summaries) are imported into `social_profile_snapshots` with `imported = true`, for each platform where the competitor's profile confirms, matched through `competitors.rivaliq_company_id`, so their growth line has no break.
- **Feed**: nothing is copied (4.12); `rivaliq_snapshots` stays read-only for replaying old reports.
- **Parity, as a release test**: the engine switch's shadow mode runs n8n with an in-app run beside it and is per client only (`engine.ts:5-14`, `shadow.ts:1-7`), so it is not used. For the 7 Jan 2027 cycle, the scheduled `competitive_v1` run for Bader Law and Pay The Pyper queues a `competitive_v2` run for the same period that writes to `shadow_competitive_reports` (exists, `20261020110000_inhouse_groundwork.sql:103`). A code check compares, per company and platform, for December 2026: post counts within 5% on Instagram, Facebook and TikTok; followers within 2%; engagement totals within 10% at the same count age; the same top posts. A difference above a threshold must fall into one of four causes that the check itself tests for: the two sources read different profiles (both handles listed); the post has been deleted since RivalIQ captured it (a re-read by id answers not found); the platform or field is one RivalIQ does not carry (LinkedIn, X text and dates); the two counts were taken at different post ages. Anything else fails the check. A failing check is a defect, fixed and rerun before the retirement release like any failing test; nobody writes an explanation into a record, and v1 keeps serving those two sets until the release (4.13). Cutover does not wait on matching RivalIQ's estimated impressions, which the new design does not use.
- **The 11 clients with no data and Moburst's current set**: confirmed profiles, first 90-day read, weekly pass on the client's weekday, and a first report for the latest full month as soon as slice 3 ships and the set is ready. They do not wait for 7 Jan.
- **7 Dec 2026 cycle**: Bader Law and Pay The Pyper run on `competitive_v1` as today. The other 12 do not get a December report from either source; the false "runs on Dec 7" sentence is removed in slice 1 by the readiness rule.

### 5.2 Retired after parity

- Code: `rivaliqConnection.ts`, `rivaliqFetch.ts`, `rivaliqLandscape.ts`, `rivaliqSetup.ts`, `rivaliqSetupRun.ts`, `rivaliqFollowFailure.ts`, `landscapeCheck.ts`, `pipelines/competitive/rivaliq.ts`; the whole `competitive_v1` definition with its steps landscape, readiness, companies, metrics, posts and the 125 s window spacing; functions `import-rivaliq-landscape`, `setup-rivaliq-landscape`, `rivaliq-request`; the RivalIQ source in `strategy/profiles.ts:35-40` and `publicRead.ts`; `publicRead.ts`'s three Apify readers (replaced by queries on the tables, spec 2 slice B); the RivalIQ feed fetch and its model call in `refreshFeed.ts`; about 40 staff strings; "From RivalIQ" in `PublicProfiles.tsx:25, 87`; the import dialog.
- n8n remnants on this path, in the same change: `update-competitive-report`, `competitive-owned-source`, the hard-coded n8n host in `linkedinSource.ts:31-41`, the three webhook rows in `app_settings`, the `n8n` and `shadow` branches for competitive and the LinkedIn source in `dispatch.ts:573-668` and `feedLinkedIn.ts:46-47`, the `n8n/` folder and its mirror tests.
- Database: stop writing `rivaliq_setup_jobs`, `rivaliq_connection_state`, `rivaliq_request_log`, drop them 30 days later with `competitor_handles` and `client_public_profiles`; drop `competitor_sets.rivaliq_landscape_id`, `tracking_check`, `competitors.rivaliq_company_id` after the history import; keep `rivaliq_snapshots` read-only.
- Schedule: the daily follow retries for 10 waiting clients and Buzznow's hourly retry stop with the `tracking` step (slice 1). No pg_cron job is RivalIQ-specific.
- Secret: `RIVALIQ_API_KEY` deleted from the edge function secrets (Lital sets and deletes secrets).
- Subscription: Lital ends it after parity (decision 4). The 11 empty landscapes go with the account.

What is lost, stated: RivalIQ's history before each profile's first read (kept for the 3 clients by import); estimated impressions (no route has them); Facebook's "likely boosted" guess (only platform paid labels remain: Instagram and Facebook paid partnership, TikTok `isAd` and `isSponsored`); RivalIQ's daily series (no screen draws it); competitors' YouTube until Google's grant.

---

## 6. Cost per month, with sources

All figures are arithmetic on published unit prices (section 4.3) and stated volumes; none is an invoice. After the first month, `sum(social_reads.cost_usd)` replaces the read lines.

Volume basis, one rule for every line: post rows a month = profiles x pace x 2 (each post is read in the week it appears and again in the overlap week). Profile record reads: 4.33 a month on paid routes. Two paces:

- Planning pace: 30 posts a month per profile (the research files' working figure).
- Measured pace: October 2026 competitive reports, posts per month per profile that posted (9 competitor companies of Bader Law, Moburst, Pay The Pyper; database read by `proposal-reuse-first.md` 5.1): Instagram 11.0, Facebook 14.0, LinkedIn 13.7, YouTube 8.2, X 6.0, TikTok 2.3. It rests on 9 companies and is a low anchor.

### 6.1 Reads at 14 clients (169 profiles, 144 read before Google's grant)

| Line | Profiles | Arithmetic (planning) | Planning | Measured |
|---|---|---|---|---|
| X, official | 34 | 34 x 60 x 0.005 = 10.20; users 34 x 4.33 x 0.010 = 1.47 | USD 11.67 | USD 3.51 |
| TikTok, Apify | 16 | 16 x 60 x 0.0023 = 2.21; profile read when a week has no posts, at most 16 x 4.33 x 0.0015 = 0.10 | USD 2.31 | USD 0.27 |
| LinkedIn, Apify | 23 | 23 x 60 x 0.00175 = 2.42; companies 23 x 4.33 x 0.003 = 0.30 | USD 2.71 | USD 1.40 |
| YouTube, official | 4 | quota only | USD 0 | USD 0 |
| Instagram, official | 34 | no fee stated | USD 0 | USD 0 |
| Facebook, official | 33 | no fee stated | USD 0 | USD 0 |
| Upkeep: X keep-current re-reads (about 140 examples a month x 0.005), daily credential checks (X 0.30, Apify 0.09), confirmation reads (about 1.00) | | | USD 2.10 | USD 2.10 |
| **Reads, after Meta approval** | | | **USD 18.8** | **USD 7.3** |
| Interim: Instagram on Apify | 34 | 34 x 60 x 0.0020 = 4.08; profiles 34 x 4.33 x 0.002 = 0.29 | USD 4.37 | USD 1.79 |
| Interim: Facebook on Apify | 33 | 33 x 60 x 0.0033 = 6.53; pages 33 x 4.33 x 0.0065 = 0.93; runs 33 x 4.33 x 0.001 = 0.14 | USD 7.60 | USD 4.12 |
| **Reads, while Meta is interim** | | | **USD 30.8** | **USD 13.2** |

Of the interim total, about USD 17 a month (planning) is Apify and USD 12 to 13 is X.

### 6.2 Model calls at 14 clients

Prices rechecked today on https://platform.claude.com/docs/en/about-claude/pricing: Opus 5.5 USD 4 in and 20 out per million tokens, Batch USD 2 and 10; Sonnet 5.5 USD 2 and 10, Batch USD 1 and 5; Sonnet 5 USD 2 and 10. Token counts are assumptions (competitive reports do not store token use today; the new runs will).

| Call | Model | Assumed tokens | Per run | Per month at 14 |
|---|---|---|---|---|
| Monthly analysis, with up to one repair round | Opus 5.5, Batch | 40,000 in, 8,000 out per call, 1 or 2 calls | USD 0.16 to 0.32 | USD 2.2 to 4.5 |
| Fact check, 1 or 2 calls | Sonnet 5.5 (`CHECK_MODEL`) | 20,000 in, 2,000 out | USD 0.06 to 0.12 | USD 0.8 to 1.7 |
| Weekly theme labels and topics | Sonnet 5.5 (`CHECK_MODEL`) | 20,000 in, 3,000 out | USD 0.07 | USD 4.2 |
| **Total** | | | | **USD 7 to 10** |

Today 3 clients already run the analysis and topics, so about a fifth of this exists today.

### 6.3 One-time costs

- First read (90 days, planning pace 90 posts a profile): X 34 x 90 x 0.005 + users = USD 15.6; TikTok 16 x 90 x 0.0023 = USD 3.3; LinkedIn USD 3.7; Instagram interim USD 6.2; Facebook interim USD 10.0. **About USD 39** (about USD 12.5 at the measured pace), of which about USD 23 on Apify. Each client added later: about USD 2.80.
- First theme labels for the 90-day backlog: 144 profiles x 90 posts = 12,960 posts at the planning pace; assumed 130 tokens in and 25 out per post; Sonnet 5.5 through the Batch API: 1.68 million in x USD 1 + 0.32 million out x USD 5 = **about USD 3.30**. Each client added later: about USD 0.25.
- Correcting vendor words in 29 old reports: assumed 12,000 tokens in and 6,000 out per report on Sonnet 5.5: 29 x USD 0.084 = **about USD 2.50**.

One-time total: about USD 45.

### 6.4 Other recurring costs this design touches

| Cost | Volume | Price and source | Monthly |
|---|---|---|---|
| Vercel functions for the reader | About 6,000 calls a month at 14 clients (weekly reads, daily follower counts, checks, collect polls); assumed 10 s of CPU and 20 s of wall time each at 2 GB, an upper bound | Fluid Active CPU "starting at $0.128 per hour", Provisioned Memory "starting at $0.0106 per GB-hr", invocations "starting at $0.60 per 1M"; Pro includes a USD 20 usage credit (https://vercel.com/pricing, read today) | At most about USD 3 (16.7 CPU hours x 0.128 = 2.13; 66.7 GB-hours x 0.0106 = 0.71). Whether it stays inside the Pro plan's included credit depends on the picture service's own use; unconfirmed |
| Storage for thumbnails and profile pictures | At most about 5,000 thumbnails a month at the planning pace, assumed 40 KB each as 640-pixel WebP: about 0.2 GB a month, about 2.6 GB once 13 months are held | The project's storage price was not found: Lovable's Cloud page publishes no per-GB figure and bills backend use as credits (https://docs.lovable.dev/features/cloud, read today) | Unconfirmed; the size is the fact to price |
| Firecrawl, profile and site discovery | No new recurring use at 14 clients. Each new brand: about 30 credits once (assumed: site search, profile search, site reads) | A scrape is 1 credit and a search 2 credits per 10 results; Standard is USD 99 a month for 100,000 credits (https://www.firecrawl.dev/pricing, read today). Which plan Moburst holds is not on record; unconfirmed | Inside the existing plan; about USD 0.03 per new brand at the Standard rate |
| Slack message for a waiting route (4.8) | A few a year | Incoming webhook already set up | USD 0 |

### 6.5 At 30 clients

Profiles scaled by 30/14 with the same mix (shared competitors lower it): reads after Meta approval about USD 40 (measured USD 16); while Meta is interim about USD 66 (measured USD 28); models about USD 16 to 22. Each added client: about USD 1.30 a month after Meta approval, about USD 2.20 while interim, plus about USD 0.50 to 0.75 of model use.

### 6.6 The monthly line

At 14 clients, planning pace: **about USD 38 to 41 a month while Instagram and Facebook are read through Apify, about USD 26 to 29 after Meta approval** (reads plus models), plus at most about USD 3 of Vercel use and an unpriced 0.2 GB a month of storage. About USD 45 once. At the measured October pace: about USD 21 to 24 interim, USD 15 to 18 after approval.

Sources of each new recurring cost: X developer account (new, pay per use, card chosen by Lital, spending limit USD 60 a cycle); Apify org Moburst (existing, pay per event, billing period 17th to 16th, custom limit USD 590, Mesh card 9369, memory note 9 Nov); Anthropic API (existing key); Vercel team Moburst (existing Pro plan, live since 25 Oct); Meta and Google: no fee stated on the pages read.

Not priced, named: storage (above); whether Apify pay-per-event charges draw down the Scale plan's USD 199 prepaid usage (treated here as new spend).

Removed: the strategy's separate public read (USD 1.59 per pass over 13 clients), absorbed by the reader; the RivalIQ subscription. What Moburst pays RivalIQ is recorded nowhere I can read, so the saving cannot be stated; the published equivalent for 56 companies is USD 759 a month plus the unpriced API add-on (section 1). Decision 4 asks for the figure. Unchanged: trends on Apify, about USD 72 a month (`understand-readers.md` section 5); Sprout.

---

## 7. Risks

1. **Meta refuses or delays App Review or business verification**, requires contracts, or refuses a system user token for Business Discovery. Instagram and Facebook stay on Apify with the named terms risk and about USD 12 a month more (planning). Nothing else waits on it.
2. **Google does not grant the YouTube amendment to an agency product.** Competitors' YouTube stays out; the client's own channel still shows YouTube's own figures under the 30-day rule. No Apify YouTube route is used to get around the policy.
3. **Platform action against Moburst for public collection** (TikTok, LinkedIn, interim Meta): terms named in 4.3; reads are logged out, brand pages only, weekly, no personal profiles, no comments. This exposure exists in the product today for LinkedIn, Instagram and TikTok.
4. **Shared Apify account headroom.** The USD 590 limit is shared with AdVisor and other tools; at the limit every product on the account pauses. A normal month with this design lands at about USD 380 to 440 (4.9); per-run caps and the 17 Nov start bound this design's part, but a month of heavy test runs elsewhere, like the period that stood at USD 455 on 9 Nov, could still reach the limit. The limit belongs to Lital (decision 3).
5. **The Apify token answered 401 on 12 Nov 07:11 UTC** (AT-01). Whether it is valid now is unconfirmed. A valid token is a precondition of slice 1; the route state and daily check make a dead token visible within a day and never store an empty week.
6. **Vendor actors change fields or prices** (three actors the product uses changed price 26 Oct to 7 Nov). Second route per platform, mapping tests on fixtures, per-run caps, cost per read logged.
7. **Wrong identity.** A competitor row with the wrong website could confirm the wrong profiles; the site-title check in the `competitors` step catches the known case (Streem). A profile discovery misses makes a platform read `absent` when the brand is in fact there, which can produce a false platform gap for the client; the three-source rule and a person's entry bound it.
8. **X cost scales with posting volume.** Spending limit and `since_id` reads.
9. **Dependency on the Vercel `server/` package**, which exists only on branch `trends` and goes live with the picture service release. If that release slips, the reader slips with it; the adapters are import-free files and run under Deno tests in the meantime.
10. **Low posting volume.** Even over 90 days a brand at TikTok's measured pace has about 7 posts and shows "Too few posts to compare". The cell says so plainly; nothing is estimated to fill it.
11. **Theme labels vary week to week.** Stable vocabulary, versioned labels, fixture tests.
12. **Retention interpretations** (4.10) are my own reading and no legal advice.
13. **Sprout Developer Terms** restrict showing data to third parties (`research-sprout.md` section 7). This design adds no new Sprout use beyond storing the client's own post counts weekly; the existing exposure is unchanged and whether it applies to an agency showing clients their own data is unconfirmed.
14. **Pinterest in trends**: the trends search reads Pinterest, whose guidelines restrict competitor research. Outside this spec; named so it is seen.
15. **The lifecycle key rename and the handle table move touch many files at once.** One migration, one release, and the tests in section 9 run the whole chain on the new keys before it ships.
16. **Old report text is rewritten once.** Only sentences that fail the vendor word check change, and the originals are kept in `report_data_original`.

---

## 8. Build order

Each slice ships something working on its own. Durations are my estimates from 12 Nov 2026. Spec 2's slices run between slice 1 and slice 2 here, because Lital's first directive depends only on the reader.

| Slice | Builds | Ships | Estimate |
|---|---|---|---|
| 0. Applications (owner side, in parallel, no code) | Meta app, business verification, App Review for Business Discovery, PPCA, Threads Profile Discovery; YouTube derived metrics amendment; X developer account with spending limit (decision 2) | Nothing in slices 1 to 4 waits on the answers | Filed in week 1 |
| 1. Reader and identity | Contract, tables (`brand_profiles` with the handle rows moved in), `profile_read`, `reader_check`, `reader_retention` jobs and their constraint changes, the enqueuer change, `reader_routes` with probe and the 24-hour message, Vercel routes and adapters for YouTube, X, TikTok, LinkedIn, Instagram and Facebook (interim), confirmation (4.7), the `profiles` and `competitor_profiles` steps in place of `tracking`, the `competitors` site-title check and swap, `competitor_set_ready` with the scheduler skip and the first-report date rule (the first-report queue follows in slice 3), the first 90-day read (queued for 17 Nov or later), the run log and the Settings "Data sources" section | Every client's and competitor's profiles confirmed and read; no screen states a false first-report date; no step waits on a RivalIQ seat | About 2 weeks, to about 27 Nov |
| (Spec 2 slices A to C) | See spec 2. Slice B builds the per-brand part of the fact module and switches `publicRead.ts` to the tables | Strategy for any client | About 2 weeks, to about 11 Dec |
| 2. Set facts and feed | The set-level part of the fact module (shares, benchmarks), theme vocabularies and labels with the first batch run, `competitor_feed`, the seven readers switched, the weekly pass for every ready set | Weekly feed, topics and calendar evidence for all 14 clients | About 1 week, to about 18 Dec |
| 3. Competitive report v2 | `competitive_v2` pipeline, settle read, gaps, writer, checks, new screens, Analytics, section 04, dashboard tile, `shared` column and policy, RivalIQ follower history import, one-time correction of old report text | First reports for the 11 untracked clients and Moburst for the latest full month, on the day their set is ready | About 2 weeks, to about 31 Dec |
| 4. Parity and retirement | v2 beside v1 for Bader Law and Pay The Pyper on the 7 Jan 2027 cycle; the parity check passes; one release removes `competitive_v1` and everything in 5.2 | No RivalIQ code, secret or wording; Lital can end the subscription | About 3 days after the 7 Jan reports |
| 5. Official Meta routes; YouTube comparisons | Meta: nothing to build. The daily check finds the token in the Vercel environment and Instagram and Facebook move to the official route on their next read. YouTube: after Google's written grant, a small release adds competitors' channels to the reads and YouTube to the facts, with the required disclosure | Interim Apify lines stop; YouTube joins comparisons | When Meta and Google answer |
| 6. Trends on the run layer (follow-up) | Trends' six search actors run through the same start, collect, failure classes, per-run cap and `social_reads` | A failed trends week is collected again (AT-01's partial weeks fixed structurally) | About 1 week, after slice 4 |

---

## 9. Tests, and how each slice is proved

| Slice | Tests | Proof before it ships |
|---|---|---|
| 1 | Adapter fixtures per route from documented samples (hidden Instagram likes give `likes = null` and `likes_hidden = true`; Apify -1 counts; X post with no media; Facebook post with no shares field; mock rows dropped; LinkedIn repost dropped). Route choice (`not_configured` falls to the next route in the same job and spends no try; a 401 sets `auth_failed` after one call and stores nothing; the probe clears it and waiting reads run; one message at 24 hours and one on clearing; 429 with reset; a run stopped at its cap is `partial`; `empty_unexpected` keeps stored posts). Every Apify start carries `maxTotalChargeUsd`. A read with `max_posts` 0 returns the record and no posts. Confirmation fixtures (NPDigital `neilpatel` unconfirmed; Streem with its parent's site dropped by the title check; lower-cased YouTube id resolved; two candidates on one platform, the loser kept as a candidate row; the pair rule confirms two name-matching profiles that link each other and leaves a lone name match unconfirmed; a refused site gives `unconfirmed`, never `absent`; an imported handle is not read before it confirms; a person's entry never overwritten; a rejected handle never returns). A system-made set swaps a competitor with nothing to compare; a person-confirmed set does not. The whole lifecycle runs on `profiles` and `competitor_profiles`, and no code or stored row holds the key `tracking`. Readiness: the scheduler skips a set that is not ready; no screen states a first-report date for it; a profile out of tries does not hold the set. Retention (YouTube statistics older than 30 days deleted; a competitor channel stores no statistic). The service's header, schema refusal of unknown fields, no token or URL in any log line (the picture service tests as the model) | One real first read of one profile per route, recorded and replayed as fixtures; the run log shows every read with cost and no vendor name; the sum of read costs in the first week within the per-read budgets |
| 2 | Fact fixtures (settled engagement chosen by age, a post first seen at 30 days is settled; minimum samples over 90 days; a post older than the first snapshot uses the earliest one and is counted in coverage; shares only over platforms every brand has; rhythm across a daylight saving change; outperformer rule; follower change needs two snapshots; no YouTube in any fact). One readiness rule agreed by scheduler, weekly pass, run page and screens for a new set, a set mid-read and a ready set. `competitor_feed` returns the same posts the tables hold and none that retention deleted. Each of the seven readers on the new shape. Theme labels fixture; the first run batched | Feeds for all 14 clients for one real week; the calendar's evidence for Bader Law drawn from the tables matches the posts its stored RivalIQ feed held for the same weeks |
| 3 | Gap rules (each fires on its fixture and does not on its counter-fixture; a not-compared client platform never yields a platform gap; the competitors' median excludes the client). Writer checks (a number not in the facts fails; a vendor word fails; British spelling fails; an invented gap is dropped). A field that fails twice is left out, its section is still drawn, and the job tries it again the next day. Vendor-word lint over every client-facing string in `src/` and over every stored narrative after the correction; `report_data_original` holds the text as it was. A client session cannot read a report with `shared` false. A set that turns ready gets its first report queued for the latest full month. A report with no platform at the minimum renders its volume state | The first reports for the 12 new clients reviewed on the live app (socialytics.moburst.com) for copy, numbers against the tables, and print |
| 4 | The parity check as code: each of the four causes on a fixture, and an unexplained difference fails | The 7 Jan comparison passes |

---

## 10. Calls I made

### From the proposals and the judges

1. Base design: documented-first, the pick of two of three judges; judge 2 preferred reuse-first for code accuracy, so every code claim it verified (n8n-tied shadow, 41 feed rows, 156 handles) is adopted here.
2. Runtime: the Vercel service, as judges 1 and 3 favored and Lital directed on 12 Nov; judge 2's concern (branch not live) is handled by naming the dependency and keeping adapters import-free.
3. TikTok primary route: the Apify-maintained `clockworks/tiktok-profile-scraper`, since it is maintained by Apify and gives `isAd`, `isSponsored` and shares; the community actor in use today becomes the fallback.
4. No review state for profiles (quality-first's "Use this profile"): judges agreed it breaks rules 2 and 7. Unconfirmed profiles are not read, competitors with nothing comparable are replaced in system-made sets, and a person can still correct.
5. Confirmation by four signals (reuse-first) replaces documented-first's website-only rule, so profiles with no website field can still confirm.
6. No monthly hard stop on spend (reuse-first's ceiling): spend is bounded by construction and by per-run caps, with X's console limit as the only provider-side stop.
7. A written field that fails its checks twice is left out and tried again on the next three days; its section is still drawn from facts. This replaces quality-first's empty field and my earlier code template: a template sentence in a client report lowers quality (rule 7).
8. The lifecycle key `tracking` is replaced by `profiles` and `competitor_profiles` in one migration. My earlier call kept the key under a new meaning, which kept a vendor's shape (rule 1).
9. Credential failure: route state plus hourly probe; the residual human action is setting a secret, which only Lital does for every product secret.
10. Parity runs from the in-app v1 run into `shadow_competitive_reports`, without the n8n shadow path, and is a release test: pass or fail by code, with four causes the check itself tests (rule 2: nobody explains a difference by hand).
11. YouTube before the grant: the client's own channel only, with the figures the API returns as they are. Competitors' channels wait for the grant. The design no longer depends on my reading of III.E.4 (rule 4).
12. Client's Sprout post counts are observed weekly into `social_post_metrics`, so settled engagement is computed the same way on both sides.
13. Weekly read window 14 days and report-time settle read, over a wider weekly window.
14. Timeline: the first new reports land at the end of December for the latest full month; Bader Law and Pay The Pyper stay on RivalIQ through the 7 Jan cycle for parity.
15. Meta retention: 30 days after a profile stops being in use, with "in use" reaching back 13 months of reports. Both are this design's own rules, marked as such.

### Settled after the builder's check (12 Nov)

Between the two specs

16. The per-brand part of the fact module is built in spec 2 slice B, where the strategy first needs it; the set-level part in slice 2.
17. The profile record carries `bio`, `location` and a stored profile picture, because spec 2 builds the brief, logo fallback and location from them.
18. The client's own profiles get their own step, `profiles`, which runs before `brief_pillars` and `accounts`; competitors get `competitor_profiles`.
19. The switch of `publicRead.ts` to the tables belongs to spec 2 slice B only.
20. The scheduler skips a due occurrence for a set that is not ready, shipped in slice 1, so a client added before v2 exists never runs v1.

Against the code

21. Which pipeline runs is derived from data: a set with a linked landscape runs v1 through the January cycle, every other set v2. `report_engines` cannot store a version.
22. `profile_read`, `reader_check` and `reader_retention` are added to `scheduled_jobs_kind_check` and to `scheduled_jobs_client_required`.
23. The enqueuer is redefined from `20261019190000_calendar_self_serve.sql:98`; the weekday function is at `20261006150000_scheduled_report_queue.sql:56`.
24. The fact check and the weekly theme call use the code's `CHECK_MODEL` (`claude-sonnet-5-5`, `write.ts:56`), priced at USD 2 in and 10 out, rechecked today.
25. The 5 client-side `rivaliq` rows are imported candidates, like the 19 competitor rows.
26. The API demo step keeps its name and its skip; only its message changes.

Reader contract and tables

27. The worker picks the route from `reader_routes`; the service answers `not_configured` when it has no credential, and that falls to the next route. A missing Meta token never makes reads wait.
28. `max_posts: 0` is a profile-only read; `since_id` is optional; an Apify read may hold two runs (`run_ids`); `social_reads.purpose` gains `snapshot`.
29. Rows go to the existing `pipeline-payloads` bucket and are deleted after loading; thumbnails are 640-pixel WebP in a private `social-media` bucket, served by signed URLs with a one-hour life.
30. No sign-in fallback for the Meta token. The service keeps no state and refreshes nothing; if a system user token is refused, Instagram stays on the public route.
31. One link table, `brand_profiles`, holds state, evidence and every candidate; theme labels and vocabularies get their own tables per set.
32. Imported handles are candidates and get the same profile call as any other. Nothing is read from an unconfirmed profile, imported or not.

Confirmation and identification

33. The pair rule: two name-matching candidates that link each other, or carry the same website domain, confirm together. A site counts for a brand only when it links a profile whose own record matches by name or website (spec 2 4.1), which breaks the circle the builder found.
34. `absent` means all three discovery sources answered and found nothing. It is kept on the step result, and one word means one thing everywhere.
35. Name match is `normName` containment, for S3 and for the site-title check; domains come from the Public Suffix List; "active on" means a post in 90 days; the swap runs in the `competitors` step; YouTube's S2 reads the channel description.

Schedules, facts, failure paths

36. A post older than the profile's first snapshot is measured against the earliest snapshot, counted in staff coverage.
37. Any observation at 7 days or older settles a post.
38. `competitor_set_ready` takes the period end; a profile whose reads are out of tries is "Not compared" for that period and never holds the report.
39. `read_weekday` is the lowest weekday number; the weekly pass defers until the week's reads end; the weekly cap is the larger of 60 and twice the last count.
40. Retention reaches every place a post appears because nothing holds a copy: the feed is a query and reports and strategies hold post ids. Meta's "in use" window is 13 months.
41. The first theme run is batched and priced (section 6.3); "median" in every gap rule is the competitors' median; the seven templates the builder asked for are not written, because templates are gone (call 7).
42. `shared` is set by the pipeline for scheduled and first-ready complete reports; the rows named in COMPETITIVE-08, -14 and -17 are false. The first v2 run is queued when a set first turns ready.
43. The first-report date rule ships in slice 1, so the false "runs on Dec 7" line goes before 7 Dec.

Screens

44. A report with no platform at the minimum has its own state; the client's YouTube sits in its own block; the run log is an admin page at `/reads`; the evidence lines are listed in full; one vendor word list serves every check.

Rule fixes

45. Rule 1: the feed is a query in the product's own post shape. No table stores a payload in RivalIQ's field names and the 41 old rows are not copied.
46. Rule 1: vendor words in old reports are corrected once in the data, with the originals kept; nothing is scrubbed at read time.
47. Rule 2: no hand-set grant date. YouTube comparisons are a later release after Google's written grant.
48. Rule 4: X is called through X's official SDK; the spec states why no licensed provider is used.
49. Rule 5: the run log names platforms only; vendor and actor names sit on Settings.
50. Rule 8: Vercel, storage and Firecrawl each have a line with its source; the RivalIQ price is asked for in decision 4.

Owner questions I settled myself, to keep the list at five

51. A route waiting on its credential sends one Slack message at 24 hours and one when it clears, through the sender the late-report note already uses. I judged this the smallest of the open questions; Lital can strike it and the run log alone remains.
52. API demo jobs stay skipped, with no reads and no competitive report, so demos add no spend.

## 11. Decisions for Lital

The spec is written to each recommendation. A different answer changes only the section named.

1. **How brands are compared.** Your 19 Oct rate divides engagements by impressions; competitors' impressions existed only as RivalIQ estimates, and only X publishes them. Recommendation: compare brands on engagement per 1,000 followers on every platform, show engagement per 1,000 views beside it on video and per 1,000 impressions on X, and keep the client's measured rate per impression in the monthly social report, never beside a competitor. Typical-post figures use the last 90 days and volume figures the month, because at the measured pace a single month leaves most cells at "Too few posts to compare" (X 6 posts, TikTok 2.3, YouTube 8.2, Instagram 11 against a minimum of 8). The alternative is the month for everything, with those cells empty for low-volume brands. Changes 4.11 and 4.14.
2. **Applications in Moburst's name, the accounts they run from, and public collection.** Meta needs business verification and App Review for Instagram Business Discovery, Page Public Content Access and Threads Profile Discovery; YouTube needs the derived metrics amendment; X needs a developer account. Recommendation: apply now. Query Meta from Moburst's own Instagram professional account and Facebook Page inside Moburst's Business Manager, never a client's; hold the YouTube key in a Google Cloud project owned by a Moburst account; open the X account under a Moburst login. You file, or the Business Manager admin you name, because verification needs company documents; I prepare the application text and the screen recording Meta's review usually asks for (the builder's reading, not rechecked). Leave competitors' YouTube out until Google's grant; the alternative, showing their channel figures beside the client's now, rests on a reading of YouTube's policy that I could not confirm. Accept public collection through Apify for TikTok and LinkedIn (and Instagram and Facebook until Meta approves) with the terms risk in 4.3; leave Threads and Pinterest out. Changes 4.3.
3. **New spend, and the shared Apify limit.** Recommendation: approve the X API with a spending limit of USD 60 a billing cycle; about USD 38 to 41 a month at 14 clients at the planning pace while Meta is interim, about USD 26 to 29 after (section 6.6); about USD 45 once, with the first read queued after 17 Nov so it lands in Apify's next billing period. Keep the Apify limit at USD 590 and put no cap on clients: a normal month lands at about USD 380 to 440, and each client added through spec 2 adds about USD 6.40 on Apify while Meta is interim (USD 5.15 of trends and USD 1.21 of reads), so the headroom covers roughly 23 to 33 more clients. Look at it again at 25 clients; raising the limit also means raising the Mesh card's USD 600 monthly limit (memory note 9 Nov). Changes 4.9.
4. **When RivalIQ ends, and what it costs today.** Recommendation: keep it through the 7 Jan 2027 cycle so Bader Law and Pay The Pyper are compared side by side, then end it and delete `RIVALIQ_API_KEY`. The alternative is to end it now and skip parity. I could not find what Moburst pays or when it renews, so I cannot state the saving; the invoice figure and renewal date from you close that. Changes 5.1 and slice 4.
5. **The Social team's own list of needs.** The nine questions in 4.11 come from the product and your words; the team was not asked. Recommendation: build on the nine, and send the team that one table once, before slice 3 starts. Anything they add becomes one more fact in the module; the reader, tables and schedule do not change. The alternative is to accept the nine as final. Changes 4.11.

## 12. Unconfirmed

1. Whether Business Discovery needs App Review for this setup; whether a system user token works for it; the exact permission names; how far back its `media` edge pages; whether Meta's review asks for a recorded demonstration.
2. Whether a non-admin PPCA app receives reaction and comment totals and `followers_count` on Pages.
3. Meta's review time and any extra contract.
4. Whether Google grants the derived metrics amendment to an agency product, and how long it takes.
5. X: whether `public_metrics` on the user object carries the follower count; whether expanded user objects bill as user reads; whether the official SDK runs unchanged on the Vercel Node 22 runtime (the docs page shows bearer token use and the users endpoint).
6. Every vendor field list (from Store pages; no actor was run), including whether each profile actor returns bio and location; actor prices can change.
7. Posting pace: the planning pace is an assumption; the measured pace rests on 9 companies.
8. Token counts per call; the thumbnail size of 40 KB; the 6,000 Vercel calls a month and their CPU time.
9. Where the project's storage is billed and its price per GB; which Firecrawl plan Moburst holds; whether the reader stays inside the Vercel Pro plan's included credit; whether Apify pay-per-event draws prepaid usage.
10. What Moburst pays RivalIQ, its renewal date, and whether its contract allows client display.
11. Whether `APIFY_API_TOKEN` is valid now.
12. How many competitor Instagram accounts are professional accounts (Business Discovery serves only those).
13. The Social team's own list of needs (decision 5).
14. My readings of retention duties for exported files and for computed facts in stored reports.
15. How many old report sentences the one-time correction touches (29 reports matched the word list; sentences were not counted).
16. Slice durations.

## 13. Corrections made against the proposals and the first draft

| Claim | Correction | Rechecked in |
|---|---|---|
| Documented-first 5.1 profile counts (X 43, TikTok 23, LinkedIn 30, YouTube 35, Instagram and Facebook 40) | X 34, TikTok 16, LinkedIn 23, YouTube 29, Instagram 34, Facebook 33 (169 in all) | Database, 12 Nov: handles of the selected competitors of the 14 current sets; `client_public_profiles` and `sprout_profiles` |
| Reuse-first and quality-first: 4 client X profiles | 5: Sprout does not feed the client's X, and 5 active clients have an X account (4 public rows, 1 more only in Sprout) | `ownedSource.ts:153`; database, 12 Nov |
| Quality-first: client TikTok 1 | 2 | `proposal-reuse-first.md` 2.2 (database) |
| Documented-first and quality-first: all 156 handles are `auto` | 134 `auto`, 19 `rivaliq`, 3 `manual` | Database, 12 Nov |
| Documented-first 5.1 mixed volume basis (10 posts a week for X, 30 per read elsewhere) and TikTok without the date filter | One basis for every line (profiles x pace x 2); TikTok at USD 0.0023 with the date filter; Facebook with its USD 0.0008 date filter | `research-apify.md` lines 102 and 118 |
| Documented-first 6: slice 3 "before 7 Dec" while slices add to about 17 Dec | First new reports at the end of December for the latest full month; parity on 7 Jan 2027 | This spec, section 8 |
| Documented-first and quality-first: shadow through the engine switch | The engine shadow runs n8n beside the app and is per client only; parity runs from the in-app run instead | `engine.ts:5-14`, `shadow.ts:1-7` |
| Quality-first: Apify limit "raised to USD 500 on 8 Nov" | USD 590 since 9 Nov 2026 12:48 IST; USD 455.37 used in the period on 9 Nov; at the limit services pause for every product on the account | Memory note `apify-billing-and-mesh-card.md` |
| Documented-first 5.3 "cannot serve 14 at any published tier"; quality-first "above 40 on request" | Every tier lists "(Additional companies: 5 for $50/mo)": 56 companies USD 759 a month, 120 USD 1,359, API add-on unpriced | https://www.rivaliq.com/pricing/, rechecked 12 Nov 2026 |
| Quality-first: Meta rate limit "200 calls an hour per user" | App level "Calls within one hour = 200 * Number of Users" | https://developers.facebook.com/docs/graph-api/overview/rate-limiting via `research-official-apis.md` line 59 |
| Quality-first: 13 months as Meta's deletion horizon | Meta states no period; this spec's 30 days after last use is its own rule | https://developers.facebook.com/terms via `research-official-apis.md` line 63 |
| Documented-first and quality-first: YouTube per-brand use compliant before the amendment | III.E.4 restricts derived metrics for a single brand too; only YouTube's own figures are shown before the grant | `research-official-apis.md` lines 124 to 131 |
| Reuse-first: TikTok ad flag on `apidojo/tiktok-scraper` | `isAd` and `isSponsored` are fields of `clockworks/tiktok-profile-scraper`, now the primary route | `research-apify.md` lines 96 to 104 |
| Reuse-first 2.4: the runner maps a dataset a page at a time | `apifyStep.ts` reads the whole dataset; this spec has the service write NDJSON pages and the worker load one page per step | `apifyStep.ts:1-12` |
| `lifecycle_request` cited at `20261019220000_lifecycle_steps.sql:317-338` | Latest definition `20261109120000_claude_connector.sql:225-250` (allowed list at 238, unchanged) | File read 12 Nov |
| Model prices from a cached table | Opus 5.5 USD 4 / 20, Batch 2 / 10; Sonnet 5.5 USD 2 / 10, Batch 1 / 5; Sonnet 5 USD 2 / 10; Sonnet 4.6 USD 3 / 15 | https://platform.claude.com/docs/en/about-claude/pricing, rechecked 12 Nov 2026 |
| X prices | USD 0.005 per post read, 0.010 per user read, 24-hour UTC deduplication, spending limit, 3 million post reads per cycle: confirmed | https://docs.x.com/x-api/getting-started/pricing, rechecked 12 Nov 2026 |
| Proposals: the trends-branch design "still awaiting approval" | The picture service design was approved on 12 Nov and its plan written (572bd85); it is being built on `trends` and is not live | Memory note `socialytics-stuck-design-request-nov10.md`; `git log` on `trends` |
| This spec's first draft and spec 2: checks and labels on `claude-sonnet-4-6`, "as the strategy writer does today" | The writer's check model is `claude-sonnet-5-5` (`CHECK_MODEL`) and the pillars call is `claude-sonnet-5`; only the old feed call hard-codes `claude-sonnet-4-6` | `write.ts:56`, `pillars.ts:262`, `refreshFeed.ts:146`, read 12 Nov |
| First draft: enqueuer and weekday function cited at `20261014090000_feed_refresh_linked_landscapes_only.sql` | The latest enqueuer definition is `20261019190000_calendar_self_serve.sql:98`; `feed_refresh_weekday` is at `20261006150000_scheduled_report_queue.sql:56` | Files read 12 Nov |
| First draft: after parity, "`report_engines.competitive` points to `competitive_v2`" | The table holds kind, client and engine; `forKind` takes the first app-capable pipeline. The version is derived from the set | `registry.ts:41-48`; builder's check |
| First draft: an official X TypeScript SDK "unconfirmed", so X was called over plain HTTPS | X lists `@xdevplatform/xdk` under "Official SDKs" | https://docs.x.com/x-api/tools-and-libraries/overview, read 12 Nov 2026 |
| First draft: `profile_read`, `reader_check` and `reader_retention` as ordinary job kinds | They have no client; `scheduled_jobs_client_required` allows only two such kinds today | `20261110140000_seasonal_relevance.sql:165-172` |
| First draft: handles link to `social_profiles` through new columns on `competitor_handles` and `client_public_profiles`, with state on the shared profile row | State and evidence belong to one brand; the old tables hold one profile per brand and platform. One link table, `brand_profiles` | Builder's check; table columns read 12 Nov |
| First draft: the Apify headroom judged from the 9 Nov figure alone | Calendar months ran USD 242.55, 352.34 and 291.87 (Aug to Oct); the USD 455.37 period included one-off test runs; trends add about USD 72 a month since 3 Nov | Memory note `apify-billing-and-mesh-card.md`; `understand-readers.md` section 5 |

## 14. Sources

All read 12 Nov 2026 (by the research files in this folder unless marked rechecked or read today).

- Meta: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery ; https://developers.facebook.com/documentation/instagram-platform/app-review ; https://developers.facebook.com/docs/graph-api/overview/access-levels ; https://developers.facebook.com/docs/graph-api/overview/rate-limiting ; https://developers.facebook.com/docs/features-reference/page-public-content-access ; https://developers.facebook.com/docs/graph-api/reference/page/feed ; https://developers.facebook.com/documentation/threads/threads-profiles ; https://developers.facebook.com/terms ; https://www.facebook.com/legal/automated_data_collection_terms
- YouTube: https://developers.google.com/youtube/v3/determine_quota_cost ; https://developers.google.com/youtube/v3/docs/channels/list ; https://developers.google.com/youtube/terms/developer-policies ; https://developers.google.com/youtube/terms/derived-metrics-policy
- X (pricing rechecked): https://docs.x.com/x-api/getting-started/pricing ; https://docs.x.com/x-api/posts/get-posts ; https://docs.x.com/developer-terms/agreement-and-policy ; official SDK, read today: https://docs.x.com/x-api/tools-and-libraries/overview ; https://docs.x.com/xdks/typescript/overview
- LinkedIn: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api ; https://learn.microsoft.com/en-us/linkedin/marketing/restricted-use-cases ; https://www.linkedin.com/legal/user-agreement
- TikTok: https://developers.tiktok.com/products/research-api/ ; https://www.tiktok.com/legal/page/us/terms-of-service/en
- Pinterest: https://policy.pinterest.com/en/developer-guidelines
- Apify: https://apify.com/pricing ; https://docs.apify.com/api/v2/act-runs-post ; https://docs.apify.com/legal/general-terms-and-conditions ; https://apify.com/apify/instagram-post-scraper ; https://apify.com/apify/instagram-profile-scraper ; https://apify.com/apify/facebook-posts-scraper ; https://apify.com/apify/facebook-pages-scraper ; https://apify.com/clockworks/tiktok-profile-scraper ; https://apify.com/apidojo/tiktok-scraper ; https://apify.com/harvestapi/linkedin-company-posts ; https://apify.com/harvestapi/linkedin-company
- RivalIQ (pricing rechecked): https://www.rivaliq.com/pricing/ ; https://www.rivaliq.com/terms/
- Anthropic (rechecked): https://platform.claude.com/docs/en/about-claude/pricing
- Vercel (read today): https://vercel.com/pricing
- Firecrawl (read today): https://www.firecrawl.dev/pricing
- Lovable Cloud (read today): https://docs.lovable.dev/features/cloud
- Public Suffix List (read today): https://publicsuffix.org/
- Licensed providers: https://www.socialinsider.io/tos and the pages listed in `research-licensed-providers.md`
- Sprout: https://api.sproutsocial.com/docs/ ; https://sproutsocial.com/legal/api-terms-of-service/
