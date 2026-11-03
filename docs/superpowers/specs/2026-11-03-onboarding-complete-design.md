# Onboarding that completes itself from social profiles

Status: design, 3 Nov 2026. Nothing is built. Asked for by Lital on 3 Nov: the weekly Sprout onboarding added 10 clients on 2 Nov, and the 8 without a website stopped at a mostly empty setup with no logo.

## Decisions for Lital

1. **Time zone from followers.** When the website, the Sprout profiles and the posts give no address and no stated location, should the time zone follow the city most of the client's followers are in (Sprout's follower-by-city data)? Yes: posting times match the audience. No: the field stays empty and calendar times show labeled as UTC until an address turns up. I recommend yes.
2. **Instagram bio.** Sprout's API has no bio or bio link. Getting them takes Meta's Business Discovery API (official and free; needs a Moburst Meta app, an Instagram business account to query from, and App Review) or an Apify actor the repo does not use today (apify/instagram-profile-scraper). The design works without either. I recommend neither now, and a second look if the name search (section 4) still leaves clients without a website after a month.

## What the code does today

- The `website` step (lifecycle/steps.ts:205-225) reads links in at most 150 posts from 90 days, sorted by impressions (sprout/posts.ts:17-21), weekly.
- `brand_read` needs a website (steps.ts:233-237): no logo, brand identity, location, country or language. The empty time zone reads as UTC (steps.ts:176, `lifecycle_first_output`).
- `brief_pillars` has no input without a website, brief or strategy document (steps.ts:321), and everything after it waits: `competitors` also needs a website (547), `trend_profile` the brief (605), `content_strategy` the profile (680), `first_output` the brief (819-820). No week plans, voice profile or first report. Pillars read posts only from completed reports (brand/pillars.ts:101-114).
- `accounts`, `access` and `design_refs` run; they need only Sprout profiles.
- Report schedules come from the insert trigger (migrations/20260902000002_feedback_round_one.sql:73-86), so by the code both monthly rows exist; the first report and local dates are what is missing. I read code only, not production rows.
- Sprout documents (api.sproutsocial.com/docs): `/metadata/customer` has `customer_profile_id`, `network_type`, `name`, `native_name`, `native_id`, `groups`, `network_metadata` (an `address` for Google Business Profile, Yelp and Tripadvisor). No picture, bio, website or time zone. The Message Fields table, which covers the posts endpoint, lists `from.profile_picture` ("URL to the profile picture"). Sprout's changelog (GitHub mirror, 19 Feb 2025) and Fivetran list `lifetime_snapshot.followers_by_country` and `followers_by_city`; I could not find them in the part of Sprout's page I could read. The build starts with a dry run on the 8 clients that confirms these three fields per network and writes nothing.

## 1. A full setup from social profiles alone

The profiles become a source the way the website is one. Each field takes the best source that has a value, and every write still goes through `lifecycle_write_client`, so a person's value is never touched.

**New step `social_read`**, weekly, for every client with Sprout profiles (My call: its own step, since the site is read every 180 days and posts every week).

- One Sprout read, no model call: 90 days of posts with the fields and metrics `collectOwnedCompetitive` already asks for (competitive/ownedSource.ts:184) plus `from.profile_picture`, and its follower snapshot (ownedSource.ts:182) plus the two follower-location metrics.
- Code scores posts with `scoreOwnPosts` (calendar/evidence.ts:157: organic, settled 48 hours, each post a multiple of its platform-and-format median), picks the logo (section 2), finds post addresses with the page-text rule (location.ts:197, ZIP or street number required), and tallies follower countries and cities.
- When the evidence moves (section 5), one model call, only if a field it fills is still the lifecycle's (as steps.ts:255 decides): the brand read `brand_read` already makes (brand/research.ts, gpt-4.1), given the profile picture and up to six top designed posts as images and the 30 top posts as text. It returns brand identity, the posts' languages and where the posts say the business is; that place is kept only if its city or country appears in a post.
- Results live in the step's row, as `brand_read` keeps the homepage's profile links (My call: no new column).

| Step | With no website it reads | Minimum | Below it |
|---|---|---|---|
| brief_pillars | Top 12 posts by multiple and the 12 newest, from `social_read`; document and notes as today | 5 organic posts with text in 90 days, else in 12 months (evidence.ts:98) | Waits, looks weekly; Client setup gives the count |
| competitors | Name, pillars, keywords, brief, follower countries as markets, top posts' text for homepage text (competitive/identify.ts:131-132) | Pillars written | Waits for them |
| trend_profile, content_strategy, first_output, design_refs, design_settings | Unchanged; they follow the brief, pillars and logo | As today | As today |
| tracking | RivalIQ tracks by website (competitive/rivaliqSetupRun.ts:58) | A client website and a free RivalIQ slot | Waits, stated as a fact (section 6) |

The brief from posts comes out of the pillars call (one Sonnet 5 call, as today): what the client offers, who it speaks to, its voice, its recurring claims. Each line names its posts; code checks the ids, then removes them. Saved as "Drafted from the client's posts on [date]". A lifecycle brief prefers the strategy document, then the website, then posts (My call: the site states what the business sells in its own words).

## 2. Logos from profile pictures

- Source: `from.profile_picture` on each profile's newest post, inside the read `social_read` already makes. No scraping, no new vendor.
- Rule: the largest picture by pixel width, read from the file header. Tie: LinkedIn page, Facebook page, Instagram, YouTube, TikTok, X (My call: page logos are square and uncropped; Instagram and TikTok crop to a circle).
- Stored like today's logos: copied to `generated-media` at `<client>/brand/logo-profile-<network>-<hash>.<ext>`, beside `logo-site-<hash>.svg` (steps.ts:277), because network picture URLs expire. `logo_url` is its public address; `design_settings` makes its PNG as for any logo (lifecycle/imaging.ts `logoPng`).
- Order: a person's logo, then the website's, then a profile picture. A new picture replaces an earlier picture only. `lifecycle_write_client` records each value's source in `field_sources[field].from` (an extra key there already exists, migrations/20261108130000_sprout_auto_onboarding.sql:60).
- A face as the picture (a personal brand) is kept (My call: it is how the brand shows itself on social).
- If Sprout gives no picture on any of a client's networks, the logo waits for the website. Facebook's `/{page-id}/picture` needs Pages Public Metadata Access through App Review, so it is left out.

## 3. Time zone, country and language

Location sources, most exact first (extends `SOURCE_RANK`, location.ts:234; a lower rank replaces a higher one, never the reverse):

1. A schema.org address on the site; the Sprout `network_metadata.address` of a Google Business Profile, Yelp or Tripadvisor profile.
2. An address in the site's footer.
3. An address on the site or in the client's posts (several vote by zone, as today).
4. Where the site, or a post in its own words, says the business is.
5. The city most followers are in (decision 1), when one zone holds half or more of the followers with a known city (My call).
6. The country's main zone, from any source above or the top follower country (today's last rule).

Below all six the field stays empty; nothing writes UTC (a stored UTC already counts as no value, migrations/20261019220000_lifecycle_steps.sql:50). Posting times are not a source (My call: 9:00 in New York is 16:00 in Jerusalem, and Moburst's team schedules many of these posts).

Regions: the business's country when known, then each country with 20% or more of followers, else the top one. Languages: each language in 25% or more of the posts with text, most used first; posts outrank the site's language tag, for every client (My call on these thresholds and that order).

## 4. A better website finder, and the website found later

The `website` step keeps the first domain confirmed by:

1. **Post links**, now 12 months and every page Sprout returns, with today's three facts: the homepage links to one of the brand's profiles, the domain is the brand name, or `og:site_name` is (sprout/website.ts:147). The weekly onboarding job keeps 90 days to fit its 90-second run.
2. **Name search**: up to 3 Firecrawl searches (name and each distinct handle; the repo already calls Firecrawl search on the server, competitive/detectHandles.ts:76), shared platforms dropped (net/domains.ts), three new domains read at most. A searched domain counts only if its homepage links to one of the client's own Sprout profiles; a name match alone does not, since a short name finds other companies (My call). It runs at creation, when the name or profiles change, and monthly while there is no website (My call).
3. **Instagram bio link**, only if decision 2 adds one, confirmed like a post link.

When a website arrives, `brand_read` runs and each field takes the site's value only where the site ranks higher: logo, location, brand identity, and a lifecycle brief. A person's fields stay. `accounts` adds the profiles the homepage links to. A competitor set the system chose from posts alone, untouched and never tracked, is identified once more with the site; any other set stays (My call).

## 5. The weekly refresh

Each week `social_read` reads Sprout and keeps an evidence version that moves only when, since it was set (each threshold My call):

- 4 or more of the top 12 posts are new to the top 12;
- a platform reaches or drops below 5 organic posts, or posting starts or stops on a network;
- a platform's median engagement per post moves by half or more, with 5 or more posts on both sides;
- a language crosses 25%, or the top follower country changes;
- the profile picture changes, or `design_refs` reports a look change;
- 28 days pass with 5 or more new posts (a monthly floor).

Otherwise it is a quiet week: one Sprout read, no model call, no write. A move runs the social brand read, then `brief_pillars` (inputs gain the version; it rewrites only the lifecycle's brief, pillars and keywords), `trend_profile` when those changed, and `content_strategy` (inputs gain the version, so it follows performance even when a person owns the pillars). A person's change to the brief, document or notes rewrites as today.

Performance weighting, with the calendar's own score:

- Pillars and brief read the top 12 by multiple, labeled like "2.4x its platform's median for carousels", plus the newest 12. Top posts weigh more, and each pillar names one top post or three posts behind it.
- Design references: inside each platform's slots (6 per platform, 16 in all, kept posts first; specs/2026-11-02-design-refs-refresh-design.md), posts at or above median come next, newest first, then the rest; after a look change only newer posts, as today. Images carry their multiple into the rulebook. A platform the strategy marks "not now" lends posts but gets no section of its own, and the strategy's platform states join `design_refs`' inputs.
- Strategy evidence and voice examples already use `scoreOwnPosts` (voice/load.ts:175).

## 6. What staff see on Client setup

Each line is a fact with a date or a count; no step names, statuses or errors.

- Website: "No website found yet. Looked through [n] posts from the last 12 months and searched the web for [brand] on [date]." Then: "Found on [date]: the site links to the client's Instagram."
- Logo: "From the client's LinkedIn profile picture, [date]. The website's logo replaces it once the website is found; a logo you upload is kept."
- Time zone: "Worked out from the address on the client's Google Business Profile", "from an address in the client's posts", "from where the client's posts say the business is based" or "from where most of the client's followers are ([city])". None: "Not known yet: no address or location in the client's profiles or posts. Calendar times show in UTC until then." Placeholder: "Worked out from the website, profiles and posts".
- Regions: "From where the client's followers are: [country] [n]%." Languages: "From the client's posts: English in [n] of [n]."
- Brief and pillars: "Drafted from the client's posts on [date]", or "Written once the client has 5 posts with text. It has [n]."
- Competitors: the three chosen, with "RivalIQ follows companies by their website, so tracking starts once the client's website is found." or "The RivalIQ plan is full. Tracking starts when a place opens." (from RivalIQ's own answer, competitive/rivaliqSetup.ts:83-85).
- Strategy sources and Schedule: same screens, now filled; "The first one runs on [date]" once `first_output` starts the report.

## 7. Costs

List prices: Sonnet 5 and Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 per million tokens; gpt-4.1 $2/$8; Firecrawl search 2 credits per 10 results, $19 per 5,000 credits (Hobby). Token sizes are my estimates, measured on the 8 clients.

| Item | When | Cost |
|---|---|---|
| Sprout read, logo copy | Weekly | $0 beyond the Sprout plan |
| Social brand read (gpt-4.1, ~10K in, ~0.9K out) | Version move | ~$0.03 |
| Brief and pillars (Sonnet 5, ~8K in, ~2.5K out) | Version move | ~$0.04 |
| Trend profile (Opus 5.5, ~6K in, ~2K out) | Brief or pillars changed | ~$0.06 |
| Content strategy (Opus 5.5 write, Sonnet 5.5 check) | Version move, and monthly | ~$0.27 |
| Website name search (up to 6 credits) | Creation, then monthly while none | ~$0.02 |
| Competitors (Sonnet 5 identify, handle lookup) | Once | ~$0.05 |

Per client per week: $0 in a quiet week, plus $0.0025 per new designed post reviewed (design-refs spec); about $0.40 with a version move, $0.58 if the design library also relearns. At most one move a week; I expect one or two a month, to be measured.

The 8 waiting clients now: about $0.47 each, $3.80 in all. Their voice profile, week plans and first report are `first_output`'s existing cost for any new client and are not counted. Nothing is run by hand: once shipped, the daily lifecycle look queues `social_read` for every client and the rest follows.

## 8. Tests and files

Tests

- lifecycle/socialRead.test.ts (new): largest picture, tie order; a picture never replaces a website or person logo; post addresses need a ZIP or street number; follower thresholds; each trigger moves the version; a quiet week makes no model call and no write; boosted posts out.
- location.test.ts: new ranks; a profile address beats page text; followers never beat an address; no UTC written.
- steps.test.ts: a client with profiles and no website reaches brief_pillars, competitors, trend_profile, content_strategy and first_output; 3 posts waits 7 days; a website replaces only lower-ranked values; tracking waits without a website or slot and never fails.
- sprout/website.test.ts: 12-month window; a searched domain needs a profile link. sprout/posts.test.ts: `from.profile_picture` requested. brand/pillars.test.ts: posts from `social_read`, labeled multiples, brief from posts. identify: posts' text for homepage text. brand-references/corpus.test.ts: performance order; "not now" platforms get no section.
- clientSetup.test.tsx, display.test.ts: every section 6 line; no developer words; American English; no em dashes.

Files

- Create: supabase/functions/_shared/lifecycle/socialRead.ts, socialRead.test.ts; supabase/migrations/[timestamp]_onboarding_from_socials.sql (`lifecycle_write_client` records `from` per field).
- Change: _shared/lifecycle/steps.ts, location.ts, fields.ts; _shared/sprout/posts.ts, website.ts; _shared/brand/pillars.ts, research.ts; _shared/competitive/identify.ts; _shared/brand-references/corpus.ts, learnStyle.ts; run-scheduled-jobs/sproutOnboarding.ts; src/pages/ClientSetup.tsx, src/lib/display.ts, src/integrations/supabase/types.ts; the tests above.
- Unchanged: RivalIQ tracking and capacity, the schedules trigger, the `design_settings` rule, the voice build.

## Sources

- Sprout Social API: https://api.sproutsocial.com/docs/
- Sprout API changelog, GitHub mirror: https://raw.githubusercontent.com/api-evangelist/sprout-social/refs/heads/main/changelog/sprout-social-changelog.yml
- Fivetran, Sprout follower snapshots: https://fivetran.com/docs/connectors/applications/sprout-social/troubleshooting/follower-data-30-day-intervals
- Meta, Page picture: https://developers.facebook.com/docs/graph-api/reference/page/picture/
- Meta, Instagram Business Discovery: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
- Firecrawl search credits and pricing: https://docs.firecrawl.dev/features/search, https://www.firecrawl.dev/pricing
