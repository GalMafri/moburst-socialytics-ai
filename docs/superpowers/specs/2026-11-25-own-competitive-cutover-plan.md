# Own competitor analysis: plan for Lital's approval (25 Nov 2026, revised 26 Nov)

Status: approved 26 Nov 2026 (Lital: "start building"). Step 1 is built (tables, readers, confirmation, the read job); no paid call has been made. Lital told Sinéad on 18 Nov that competitive moves from RivalIQ to Socialytics' own competitor reads. This plan is how.

Decided: X is left out for now (Lital, 26 Nov). Decisions 1, 2 and 4 in section 8 are approved (26 Nov). Decision 5 (ending RivalIQ) waits for the side-by-side check of step 6. The first 90-day read (step 2) needs Lital's separate yes to its spend.

It builds on the full design of 12 Nov (`2026-11-12-competitor-analysis-in-house-design.md`, still awaiting approval). That design is the target. This plan picks a smaller first release and names what it leaves for later. Where the two differ, section 7 says so.

## 1. Where things stand today (production, read 25 Nov)

- 17 active clients have a confirmed competitor set: 51 competitors, 3 each.
- 2 of the 17 are tracked in RivalIQ: Bader Law and Pay The Pyper. The other 15 have never had a competitive report from their current set (Moburst's 9 reports in 60 days came from its previous set). RivalIQ's 40 slots are full.
- 3 clients got a competitor feed in the last 30 days.
- The competitors' profiles on file: Instagram 42, Facebook 41, X 36, YouTube 32, LinkedIn 27, TikTok 18. None has been checked against the platform.
- The app already reads public profiles through Apify for strategies (`_shared/strategy/publicRead.ts`). Measured cost of those reads: Instagram USD 0.002 a profile (12 latest posts), TikTok USD 0.026 a profile (90 days), LinkedIn USD 0.048 a page (90 days). All 44 runs succeeded.
- The competitive reports of Bader Law and Pay The Pyper run on the 7th of each month (`report_schedules.run_day_of_month = 7`; next run 7 Dec 2026, 07:15 UTC).
- RivalIQ's published price for 40 companies is USD 559 a month (Engage Pro). What Moburst actually pays is not recorded anywhere I can read: [RivalIQ invoice figure and renewal date].

## 2. What the reads give, per competitor and platform

Every competitor's profile on Instagram, Facebook, TikTok and LinkedIn is read once a week. Each read stores the profile's follower count that day and every post from the last 14 days with its public counts. The 14-day window means each post is seen twice: in its first week and again when it is 7 to 14 days old, so engagement is compared once it has settled.

| | Instagram | Facebook | TikTok | LinkedIn | YouTube |
|---|---|---|---|---|---|
| Followers (one figure per read; growth from the first read on) | yes | yes | yes | yes | client's own channel only |
| Every post: date, link, text, format | yes | yes | yes | yes | |
| Likes, comments | yes (likes null when the profile hides them) | reactions, comments | yes | yes | |
| Shares | no | yes | yes | yes | |
| Views | reels and videos | no | yes | no | |
| Paid label | paid partnership | no | ad, sponsored | no | |

From these the report computes, per company and platform: posts and posts per week, median engagement per post, engagement per 1,000 followers (per 1,000 views on video), follower count and change, format mix, hashtags, posting days and hours in the client's time zone, top posts, share of posts and share of engagement in the set.

What RivalIQ gave that this does not:

- Estimated impressions and reach. No public source has them. Decision 2 below.
- Facebook's "likely boosted" guess. Only the platforms' own paid labels remain.
- History before the first read. Posts go back 90 days from the first read, so the previous-period comparison works from the first report. Follower growth starts at the first read, except for Bader Law and Pay The Pyper, whose RivalIQ follower figures are copied from their stored reports.
- Competitors' YouTube channels. YouTube's developer policy bars comparing channels of different owners until Google grants its derived-metrics amendment, and Apify is not used to get around that. The client's own channel can still be shown as YouTube reports it.
- X. Left out for now (Lital, 26 Nov). The 36 competitor X profiles on file are kept and not read. Bader Law's and Pay The Pyper's reports lose the X posts RivalIQ gave them (which had no text, link or date) once they move to the new source.

## 3. Cost per client per month

Unit prices are Apify's published prices at Moburst's tier (Silver), read 25 Nov: Instagram post scraper USD 0.0013 a post (0.0020 with details), Facebook posts scraper USD 0.0025 a post plus 0.0008 for the date filter and 0.001 a run, TikTok USD 0.0023 a post, LinkedIn USD 0.00175 a post. Two posting paces: the planning pace of 30 posts a month per profile, and the pace measured in the October reports (Instagram 11, Facebook 14, LinkedIn 13.7, TikTok 2.3). A client has on average 2.5 competitor profiles on Instagram, 2.4 on Facebook, 1.6 on LinkedIn and 1.1 on TikTok.

| Per client, per month | Measured pace | Planning pace |
|---|---|---|
| Apify reads (Instagram, Facebook, TikTok, LinkedIn) | USD 0.55 | USD 1.20 |
| Claude: weekly topics for the feed, monthly analysis and its check | USD 0.50 to 0.75 | USD 0.50 to 0.75 |
| Total | about USD 1.05 to 1.30 | about USD 1.70 to 1.95 |

At 17 clients that is about USD 18 to 33 a month. The first 90-day read of every profile is a one-off of about USD 1.70 a client at the planning pace (about USD 28 for all 17). The client's own profiles that Sprout does not cover add a few cents each. Every read records its real cost through the paying desk (`paid.fetch`, feature `competitors.read`), so after the first month the costs page shows the actual figure per client.

Apify's monthly limit (USD 590) is shared with AdVisor and other Moburst tools. This adds about USD 10 to 20 a month to it at 17 clients.

## 4. How it works (release 1)

- Tables (one migration, staff and service only): `social_profiles` (one row per public profile, with whether it is confirmed and why), `social_profile_snapshots` (followers per day), `social_posts` (one row per post), `social_post_metrics` (each time a post's counts were read), `social_reads` (one row per read with its outcome and cost). Handles keep living in `competitor_handles` and `client_public_profiles`, where people already edit them; `social_profiles` links to them by platform and handle.
- Reads: a new scheduled job kind, one profile per job, run by the existing `run-scheduled-jobs` worker. It starts the Apify run through `paid.fetch` (so the cost webhook records it), looks again a few minutes later, and stores the rows. This is the start-then-look pattern `publicRead.ts` already uses in production; its three readers become the Instagram, TikTok and LinkedIn readers here, and Facebook is added. Each reader is a small mapping file with no imports, so it can move to the Vercel reader of the 12 Nov design later without changes.
- A read that fails is tried again and is recorded as failed. It never becomes "no posts". A profile whose reads failed is "Not compared" for that period and never holds up a report.
- Confirmation: before a profile is read, its own record is checked (one cheap profile read): it is confirmed when it links the brand's website, or its name matches the brand and the brand's website links to it. A profile a person entered is confirmed. Nobody is asked to approve anything; an unconfirmed profile is simply not read, and staff see why.
- Weekly feed: the feed job runs for every client with a confirmed set (17, up from 3) once that week's reads are done. It builds the week's posts from the tables, runs the same topic pass as today, and writes the feed row the calendar, strategy and design-reference readers already read, so none of them changes in this release.
- Monthly report: the report pipeline keeps everything from `aggregate` onward (Claude analysis, repair, assembly, writer). The RivalIQ steps (landscape, readiness, companies, metrics, posts) are replaced by one step that builds the same inputs from the tables. Report screens keep working on the same report shape; new reports carry `source: "public"`.
- Which source a set uses is decided from data: a set linked to a RivalIQ landscape (Bader Law, Pay The Pyper) stays on RivalIQ until cut-over; every other set uses the new source as soon as its profiles are read.

## 5. How the screens change

| Screen | Today | After |
|---|---|---|
| Competitors (`CompetitorReview.tsx`) | RivalIQ landscape import dialog; a "tracking" state that waits on RivalIQ slots | Import dialog removed. Each competitor shows its profiles per platform: "Read Nov 24, 18 posts", "Not compared: profile not confirmed", "Not on this platform". Staff can still replace a profile |
| Competitive index and run page (`CompetitiveIndex.tsx`, `CompetitiveRun.tsx`) | "RivalIQ tracking: …", run blocked until tracked, "Pulls RivalIQ data" | "Profiles: 11 of 12 read, last read Nov 24". A report can run once the set's first reads are done. No slot or tracking wait |
| Competitive report (`CompetitiveReportView.tsx`) | Audience from RivalIQ, estimated impressions, "Likely boosted" badge, staff chip "RivalIQ · landscape" | Followers and change from our reads; engagement per 1,000 followers (per 1,000 views on video, decision 2); paid label only where the platform shows one; staff chip "Public profiles, read Nov 24"; a "Not compared" cell where a read failed, never a 0. Old reports draw exactly as before |
| Competitor feed (`CompetitiveFeed.tsx`) | 3 clients; X tiles with no text; refresh spends a RivalIQ call | Every client with a confirmed set; posts with text and images from Instagram, Facebook, TikTok and LinkedIn; no X tiles; "Refresh" reads the profiles again (asks first, since it spends Apify credit) |
| Public profiles (`PublicProfiles.tsx`), client setup | "From RivalIQ" labels | Removed |

No client-facing screen names a vendor.

## 6. Migration and cut-over

There is no basis for a duration for any step: nothing comparable has been measured, so this plan gives the order and what each step waits for, not dates. The only dates here are the report schedule's (the 7th of each month).

1. Tables, readers, confirmation and the read job. Waits for: Lital's answers to decisions 1, 2 and 4; the four new Apify actors listed for the cost guard (section 9). No screen changes and no spend in this step.
2. First 90-day read of every confirmed profile (about USD 28 once). Waits for: step 1 merged and deployed, and Lital's yes to the spend.
3. The feed runs from our reads for all 17 clients, and the Competitors, index and run screens drop the RivalIQ tracking wording. Waits for: step 2's reads for a client's set to have finished.
4. The report runs from our reads. The 15 untracked clients each get a first report for the latest full month as soon as their profiles are read; they do not wait for the 7th. Waits for: step 3.
5. Report schedule, 7 Dec 2026: Bader Law and Pay The Pyper run on RivalIQ, as today, whatever state steps 1 to 4 are in.
6. Report schedule, the first 7th of the month after step 4 is live (7 Jan 2027 at the earliest): Bader Law and Pay The Pyper run on both sources for the previous month. A code check compares them per company and platform (post counts within 5%, followers within 2%, engagement within 10% at the same post age, the same top posts). A difference must have a cause the check can test (different profile, post deleted since, a field RivalIQ lacks, a different post age); anything else is fixed before cut-over. Waits for: step 4, and the two clients' profiles read since the first day of that month.
7. Cut-over: both clients move to the new source, the RivalIQ code, the `rivaliq-request` and `import-rivaliq-landscape` functions and the RivalIQ steps of the report pipeline are removed, `RIVALIQ_API_KEY` is deleted, and Lital ends the subscription. Stored reports and `rivaliq_snapshots` stay readable. Waits for: step 6's check passing, and decision 5.

Rollback at any step before 7: the source is chosen per set from data, so a set can go back to RivalIQ by re-linking its landscape.

## 7. Left for later, and where this differs from the 12 Nov design

- X is left out for now (Lital, 26 Nov). Adding it later means a new paid provider in the shared cost core (AdVisor repo) and an X developer account in Moburst's name.
- Official Meta routes (Instagram Business Discovery, Facebook Page Public Content Access) and Google's YouTube amendment need applications Lital or the Business Manager admin files. The Apify reads run until then.
- The 12 Nov design's Vercel reader service, the `brand_profiles` table, the new fact layer, gap rules and report sections, the theme labels and the `competitor_feed` query are later releases. Release 1 keeps today's report shape and today's feed row so nothing downstream breaks.
- The lifecycle step keeps its key `tracking` in release 1, because the API and the Claude connector read that key and another session owns them. Its work changes to confirming and reading profiles. Renaming it is coordinated with that session later.

## 8. Decisions for Lital

Numbering is kept from the first version of this plan, so 3 stays answered.

1. Scope. Approve release 1 as above (Instagram, Facebook, TikTok and LinkedIn through Apify, today's report shape), with the rest of the 12 Nov design after it. The alternative is building the whole 12 Nov design first, which is more work and has parts that wait on Meta's and Google's answers. Approved 26 Nov.
2. How brands are compared. Without impressions, competitors are compared on engagement per 1,000 followers, with per 1,000 views beside it on video. The client's own rate per impression stays in the monthly social report and is never put beside a competitor's. This replaces the 19 Oct rule (engagements divided by impressions) for the competitive report only. Approved 26 Nov.
3. X. Answered 26 Nov: left out for now.
4. Spend. About USD 1.05 to 1.95 per client a month (USD 18 to 33 at 17 clients) plus about USD 28 once for the first reads, on the shared Apify account and the existing Claude key. Approved 26 Nov.
5. RivalIQ's end. Keep it through the side-by-side check on the report schedule (step 6), then cancel. Please add what Moburst pays and the renewal date, so the saving can be stated. Open.

## 9. Things this needs from other sessions

- Four Apify actors added to `APIFY_ACTORS` in `supabase/functions/_shared/paid/config.ts` (the cost guard test fails until they are listed): `apify/instagram-post-scraper`, `apify/facebook-posts-scraper`, `apify/facebook-pages-scraper`, `clockworks/tiktok-profile-scraper`. That file belongs with the cost work another session owns. Done in step 1: Facebook posts as shared (another tool on the account ran it on 29 Oct), the other three as owned.
- No API or connector change is needed in release 1: `competitors.tracked` and the report shape keep their meaning. If the API should say a set is "read" instead of "tracked", that is that session's change.
