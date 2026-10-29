# Trends: the client's industry landscape

Status: approved by Lital on 29 Oct 2026, with option A for reports (see "Lital's decision"). Nothing is built yet.
Replaces the trend scraping inside the monthly social report and the hand-typed trend keywords.

## What Lital asked for (28 Oct)

Trends exist to show the broader landscape of a client's industry, beyond the client's own accounts and its direct competitors. Her four problems with it today:

1. It covers too few platforms. LinkedIn, Facebook, Pinterest and others could be relevant.
2. It doesn't really inform the reports or the calendar.
3. It isn't accurate enough. It often finds generic or spam posts, with no filter for what the brand would actually want to see.
4. It depends on hashtags and keywords that people type in, when they may not know what to track. The app should suggest them.

## The rules this design follows

- Nothing needs a person to set it up or keep it running, and there are no switches to remember.
- The same rules work for every client, from that client's own data. No rules written for one client.
- A failure in one source never stops the rest.
- Client screens show no raw errors, IDs or pipeline wording.
- n8n is not changed. The 7 Nov side-by-side check of the monthly reports must compare like with like.
- Paid work runs only when there is something new to read.

## How it works today (checked 28 Oct)

- Trends run only inside the monthly social report: TikTok (apidojo/tiktok-scraper since 28 Oct; clockworks' date-filtered search broke around 20 Oct) and Instagram (apify/instagram-hashtag-scraper).
- The searches come from `clients.social_keywords`. The client lifecycle derives those from the pillars when they're empty, but all three active clients have hand-typed lists, and those lists weren't written for finding trends:
  - Bader Law's include "Bader Law", "Atlanta" and "Georgia". Those find its own posts and anything about the city.
  - Moburst's has 11 phrases. Moburst posts on Instagram, Facebook and LinkedIn, but trends search TikTok and Instagram.
  - `trends_keywords` is empty for every client.
- Instagram hashtags are the keywords with the spaces removed (`prepareTrendInputs`, `cleanTag`). Nothing suggests what's worth tracking.
- Posts are picked by code ported from n8n: client language, a keyword-in-caption match, a short spam word list, the date window, then the 15 most engaged. On the 28 Oct Moburst run, the top 15 TikTok posts included a Myanmar hiring ad, a "big sister advice" side-hustle post and "I made £1,313 online in ONE WEEK".
- Claude then writes `tiktok_trends_analysis` and `instagram_trends_analysis` in the report (overview, themes, formats, hashtags, opportunities).
- What reads trends:
  - The monthly report screen and its deck.
  - The Analytics page's "Trend insights" section (`TrendInsightsSection`).
  - The weekly calendar planner (`calendar/runWeek.ts`). It reads only the report's `opportunities_for_client` strings, as text-only "trend" evidence, at most eight lines. Own and competitor evidence carries platform, format, date and link; trend evidence carries none of that.
- The Run analysis page has an "Include trend analysis" switch.

## The design

### 1. The app decides what to track

Each client gets a **trend profile**, written by Claude (Opus 5.5) as a new client lifecycle step after `brief_pillars`. Its inputs are data the client already has:

- the brief, pillars, brand book and learned social voice
- the website text the lifecycle already reads
- region, language and primary platforms
- the tracked competitors' names
- the hashtags that the client's own best posts and its competitors' best posts used in the last 90 days (Sprout and the competitor feed)

The profile holds:

- **Who the brand speaks to.** One or two sentences on the audience and what that audience wants to learn or see.
- **Search topics.** 6 to 10 phrases that describe the industry landscape, each with a one-line reason. Never the brand's own name, and never a place name on its own.
- **Hashtags per platform** (Instagram, TikTok, LinkedIn). Up to 10 each, each with a reason. They're seeded from what the best posts in the space use, so the list follows what performs.
  - Instagram's hashtags drive its search.
  - TikTok's and LinkedIn's are stored for the calendar's hashtag suggestions; those two platforms search by topic.
  - YouTube, Pinterest and Facebook need no hashtags.

  (My call.)
- **Exclusions.**
  - The brand's own name and handles.
  - Tracked competitors: they already have the competitor feed.
  - Words that pull in another meaning.
  - Content types the brand would never want, for example job ads, giveaways and money-making schemes.
- **Fit rubric.** Three to six sentences describing a post this brand would want to learn from, and what to drop.
- **Platforms to watch.** The client's primary platforms, plus any platform the profile adds with a reason (for example Pinterest for a home or fashion brand).

When it's refreshed:

- **Brand inputs change** (brief, pillars, brand book, voice, website, platforms): the whole profile is written again. Same rule as the existing lifecycle steps, so nothing runs when nothing changed.
- **The first trend run of each month:** only the hashtags are refreshed from the newest best posts. That's when the performance data has moved.

People see the profile on Client setup as **"Trends we track"**: topics and hashtags, each with its reason. Anyone can remove one or add their own, and a person's change is never overwritten. That's the same `field_sources` rule the lifecycle already follows. Nothing has to be filled in.

`social_keywords` stays as it is. Competitor matching, the reports and the API still read it. Trends stops reading it directly, and it becomes one input to the profile.

### 2. Six platforms, chosen per client

Each platform has its own source, and each source's answer is turned into one shared post shape: platform, link, author, text, date, format, views, likes, comments, shares or saves, and the search that found it. A broken source can then be replaced without touching anything else; the 20 Oct TikTok break is why this matters.

| Platform | Source (checked 28 Oct) | Search | Listed price |
|---|---|---|---|
| TikTok | apidojo/tiktok-scraper | topics, last 7 days, most liked, client region | $0.0003 per post |
| Instagram | apify/instagram-hashtag-scraper (in use today) | profile hashtags | measured in the trial |
| LinkedIn | harvestapi/linkedin-post-search (same maker as the LinkedIn source in use) | topics, last 7 days, most engaged | $0.00175 per post |
| YouTube | api-ninja/youtube-search-scraper | topics, this week, client region and language | $0.0005 per result plus $0.01 per run |
| Pinterest | epctex/pinterest-scraper | topics; pins have no reliable date, so ranked by saves | $0.0015 per pin |
| Facebook | scraper_one/facebook-posts-search | topics, last 7 days, client location | $0.0025 per post |

Facebook's public keyword search is the weakest of the six. It's included on trial, and the trial decides whether it stays. Each source is tested on Moburst and Bader before it's switched on (see Proof).

### 3. Collected every week

- A new weekly job, `trend_refresh`, runs one per active client. "Active" means the calendar's existing readiness rule (`calendar_client_ready`: not archived, not excluded from reporting, and has Sprout or a competitor landscape). Today that's Bader Law, Moburst and Pay The Pyper. (My call.) It's queued by the existing daily enqueue on the client's competitor-feed weekday (`feed_refresh_weekday`), so Monday's calendar plan always reads the newest trends and feed together. It doesn't depend on RivalIQ, so clients without a competitor landscape get trends too.
- It runs as an in-app pipeline on the existing step runner, as `social_v1` and `competitive_v1` do: one step per platform with quiet retries, every provider answer kept 90 days for replays, and Claude calls through the batch-or-direct race.
- **Window:** the last 7 days.
- **Budget:** about 25 posts per topic per platform, at most 200 per platform per week. The builder tunes these against the cost measured in the trial.
- One platform failing or coming back empty after its retries is recorded for that platform, and the week finishes with the others.

### 4. A filter that knows the brand

**Step 1, rules in code** (cheap; these cut what Claude has to read):

- Remove duplicates across searches.
- Keep only posts inside the window and in the client's language.
- Drop the client's own posts and tracked competitors' posts.
- Send at most about 60 candidates per platform to step 2, most engaged first.

**Step 2, Claude reads every candidate** against the trend profile. My call: Sonnet 5.5 here, for cost, and Opus 5.5 for the themes.

- **Each dropped post** gets one reason: off-topic, scheme or spam, job ad, giveaway, wrong audience, own or competitor, or low quality.
- **Each kept post** gets four things:
  - a fit score from 0 to 100
  - a one-line "why this matters for the brand"
  - its format (short video, long video, carousel, image, text or pin)
  - the lesson to borrow: the hook, the angle or the format
- Up to 10 posts per platform per week are kept, ranked by fit and then engagement, with a minimum fit score set in the trial.
- Every decision is stored, kept and dropped, with its reason, so quality can be checked at any time.

**The filter learns from dismissals, with nothing to fill in.** Moburst staff can dismiss a theme on Client setup or in the Analytics section; client users can't. The dismissed pattern is stored as an exclusion, and the very next weekly filter reads it, with no profile rewrite needed. Learning from which trends end up in published posts is left out of this version, because the calendar doesn't record publishing yet. (My call.)

### 5. Themes

After filtering, one Claude call per client per week (Opus 5.5) groups the kept posts from every platform into 3 to 6 themes. Each theme has:

- a title and what's happening
- why it matters for this brand
- the angle the brand could take
- the platforms it shows up on
- its example posts

Themes are what people see first. The posts are the evidence behind them.

### 6. Where trends are used

**Weekly calendar.**

- The planner's "trend" evidence becomes the newest week's themes, each with its best example posts: platform, format, excerpt, link and engagement. That's the same detail own and competitor evidence already carry.
- Evidence scoring gives each trend item a score from its fit and engagement. The planner picks on score, with no quota.
- A planned post built on a trend shows "Inspired by" with the theme and the example post's link, the way competitor evidence shows today.

**Monthly report.**

- The trends section is built from the month's stored themes and posts across all the client's platforms, instead of scraping when the report runs.
- Claude gets them as industry trends with per-platform notes. The report's TikTok-only and Instagram-only sections become one "Industry trends" section, with platform tags.
- n8n's workflow is never changed, and nothing about reports switches before 7 Nov, so that day's side-by-side compares like with like.
- **Every report shows the new Trends from go-live (Lital's decision, 28 Oct).** This holds whichever engine wrote the report, including the reports n8n still writes until the monthly social report moves off n8n (planned for around January).
  - For a report n8n wrote, the app keeps n8n's stored trend fields untouched and shows the month's themes and example posts from the new Trends in their place. n8n's trend text and posts are no longer shown.
  - n8n's workflow and what it sends back don't change.
  - One gap stays until the move: the Gamma deck n8n makes still has n8n's trends.

  See "Lital's decision" at the end.

**Analytics.** The "Trend insights" section shows the latest weeks' themes with example posts and a platform filter, in client-safe wording.

**Public API and demo.** (My call.)
- `/v1/reports/:id` keeps `trends.tiktok` and `trends.instagram` for older reports, and adds `industry_trends` (the month's themes and their example posts). Nothing that works today breaks.
- The API stops selecting `trends_keywords` before that column is dropped.
- A demo copy runs one trend collection for itself, so a demo report still includes trends.

**No new navigation item.** Trends appear where the work already happens.

### 7. What is removed

- The TikTok and Instagram scraping steps inside the in-app monthly report, once the report reads stored trends.
- The "Include trend analysis" switch on Run analysis, and the `skip_trends` request field. A report includes trends whenever stored trends exist.
- The `trends_keywords` column, which is empty for every client.
- The keyword-in-caption relevance rule. Claude's filter replaces it.

### 8. What stays with people

- **Nothing is required.** Anyone may remove or add a topic or hashtag, or dismiss a theme, and their changes stick.
- **One review before rollout:** Lital looks over the first trial weeks before other clients get the new Trends.

## Cost

- **Scraping (listed prices).** For a client like Moburst (3 platforms, 8 topics, 200 posts per platform per week):
  - LinkedIn: about $0.35 a week
  - Facebook: about $0.50 a week
  - Instagram: measured in the trial
- **Claude.** One profile write when brand inputs change, a hashtag refresh once a month, one filter pass a week (about 180 candidates on Sonnet 5.5) and one theme call a week (Opus 5.5). Measured on Moburst in the trial and reported before rollout.
- **Removed cost:** the in-app monthly report stops paying for its own TikTok and Instagram scrapes.

## How we'll know it works

- **Relevance.** In the trial, Lital reviews the kept posts of the first two weeks. Target: she would keep at least 8 in 10. After rollout it's tracked from what people dismiss or remove.
- **No junk.** Zero job ads, money-making schemes or giveaways among kept posts. Checked on the stored decisions every week.
- **Used.** The share of weekly plans that use a trend theme, tracked per client.
- **Coverage.** At least 5 kept posts per platform per week for each client. A platform under that for two weeks running gets its searches rewritten automatically from the profile. Replacing a source that keeps failing is developer work.
- **Reliability.** Every weekly run finishes on its own. No stuck runs.
- **Cost.** Per client per week, measured.

All of these are computed from what each weekly run stores: counts, decisions and cost. The coverage rewrite is the only one that acts on its own; the rest are checked in the trial and at each go-live. (My call.)

## Proof before building the screens

1. Build the profile, the six sources, the filter and the themes, storing results only. Nothing is shown anywhere.
2. Run them for all three active clients (Bader Law, Moburst, Pay The Pyper). They cover three different industries and five platforms between them.
3. Lital reviews:
   - the three trend profiles
   - each platform's kept posts, and a sample of dropped posts with their reasons
   - the themes
   - the measured cost
4. Only after her OK: the calendar, Analytics, report and Client setup changes.

## Build and release order (proposed dates)

| When | What |
|---|---|
| Thu 29 Oct to Wed 4 Nov | Trend profile step, six sources, filter, themes, weekly job; stored only |
| Thu 5 Nov | Trial runs for all three active clients, stored only |
| Sun 8 Nov | Lital reviews the trial |
| Sun 8 to Thu 12 Nov | Calendar evidence, Analytics section, Client setup "Trends we track", Run analysis switch removed, API field |
| Sun 15 Nov | Live for all three active clients at once, after Lital's OK. There's no per-client switch: with three clients, one release is simpler. (My call.) |
| 7 Dec reports | First monthly reports whose trends section shows the new Trends, for every report whichever engine wrote it (Lital's decision). Built from the weekly runs stored since the 5 Nov trial. |

## Owners and dependencies

- **Build:** Claude, in this project.
- **Approvals:** Lital, three times: this design, the trial review and each go-live.
- **Dependencies:** the existing Apify token and Anthropic key. No n8n, no new accounts, nothing from Gal.

## Not in this design

- X (Twitter) and Reddit. They can be added later as further sources, using the same shared post shape.
- Official platform trend data (TikTok Creative Center and the like), paid-ads trends, influencer discovery and sentiment analysis.
- A separate Trends page.

## Would count as failure even if it runs

- A client sees spam, job ads or money-making schemes as "trends".
- Anyone has to fill something in before trends work.
- Rules written for one client.
- The 7 Nov side-by-side check of the monthly reports is disturbed, or n8n is changed.

## Left to the builder

- Table names and shapes, as long as kept and dropped posts, themes, profiles and weekly runs are all stored.
- Exact budgets and the minimum fit score, set from the trial.
- Prompt wording.
- Evidence scoring weights.
- Screen layout within the existing components and the Moburst design system.

## Lital's decision (28 Oct)

The question was what reports show until the monthly social report moves off n8n (planned for around January). Until then n8n still writes each client's real report, with its own trend posts and trend text. n8n's TikTok trends have been empty since about 20 Oct, so those reports show Instagram trends only, with the junk problem above.

**Lital chose option A.** From go-live, every report's trends section shows that month's themes and example posts from the new Trends, whichever engine wrote the report. n8n's own trend text and posts are no longer shown. n8n's workflow is unchanged. One gap stays until the move: the Gamma deck n8n makes still has n8n's trends.

Option B, keeping n8n's trends in reports until the move, was turned down: clients would have kept seeing the junk trends in the December and January reports.
