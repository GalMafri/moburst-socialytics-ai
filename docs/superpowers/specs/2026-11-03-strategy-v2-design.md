# Strategy tab, version 2

Status: design, 3 Nov 2026. Nothing is built. It replaces the page, the writer's output and the editing of the 2 Nov design (`2026-11-02-content-strategy-tab-design.md`). The lifecycle step `content_strategy`, its two tables, the platform states (posting, new, not now), the code-computed cadence and baselines, the fact check and the calendar block stay.

Lital, 3 Nov: the page is "just a text wall, it's completely unreadable and tiny"; there is no PDF or Google Slides option, and the Slides deck should be Moburst branded from our design system; and a newly onboarded client who has not given us its socials yet needs a strategy "informed by what we can track from their social profiles without sprout".

## Decisions for Lital

1. **Deck theme.** The deck uses the design system's Strategy section plates (`strategy-inner.jpg`, accent `#E5C53D`, the `strategy.jpg` divider), with the animated `cover` loop on the cover and `mix` on the close. The other option is the Organic plates (cyan `#33C7E3`). My pick: Strategy.
2. **Who the words are for.** The strategy is now written so it can go to the client as is: the brand by name, "we" for Moburst, dated targets. The page stays staff only; clients get the PDF or the deck. "What we avoid" stays in the deck, written as patterns, never quoting one of the client's posts. Agree?
3. **Sharing the deck.** Each deck is a new copy in ai@moburst.com's Drive, shared to the person who asked for it as an editor, with no Google email; the link is saved on the strategy. Agree?
4. **Prospects and RivalIQ.** Public data for Facebook, Instagram, X, TikTok and YouTube comes from RivalIQ, so a prospect takes the same 4 company slots as a client (itself and 3 competitors) from the moment it is added. Proposal: archiving a client that did not sign releases its RivalIQ tracking. Yes or no?
5. **A profile RivalIQ does not have.** When the website or a person names a profile that RivalIQ's record of the company lacks, RivalIQ's help center says handles can be changed on its Companies screen, but the public description of its API that I could read lists no call for it (the full reference needs a RivalIQ login, which I did not use). Proposal: ask RivalIQ support for the documented API call (the repo already has the rule that fills only missing profiles, `missingProfileRepairs`); until then that one profile is read with an Apify profile actor, at Apify's per-run cost. Agree?
6. **Google connection.** The four one-time steps in section 4 need you signed in as ai@moburst.com in Google Cloud. If the moburst.com Workspace admin restricts third-party apps, the admin marks the app as trusted once.

## 1. Layout: readable, structured, the app's own parts

Rules for the page (my calls throughout this section):

- **Band sections at full width** (`Section` layout "band"). The split layout put a title column on the left third and squeezed the text into the rest; it goes.
- **Every section is cards, lists and numbers.** No paragraph runs past two sentences. A list has at most four items of at most 140 characters. Anything longer sits behind a native `<details>` disclosure ("Example posts", "First 30 days"), which the PDF export already opens.
- **Type sizes.** Section titles `t-h2` (20px), card titles `t-h3` (18px), numbers `t-stat` (30px) or compact `t-h2`. Content text gets a new reading token, `.t-read` (16px on 26px, white, 68ch), added to `src/index.css` beside `.t-prose`. The 13px gray `t-label` is kept for chips, dates and sources, never for content.
- **One origin line for the page**, in the header ("Written 3 Nov from the brief, the website and 90 days of posts"). A card shows only an "Edited by Neria, 4 Nov" chip when a person changed it. The 2 Nov page repeated the origin on every card.
- **Visuals from `src/components/ui`:** `StatCard` (compact) for baselines, `RankedBars` for the brand against its competitors (brand in lime, competitors gray), `CompareBars` for the pillar mix, `PlatformBadge`, `Badge`, `InsightCard` styling for goals, `SectionNav` for the rail, the Intercept glass surfaces (`glass`, `glass-inner`, `glass-accent` for the goals row). Below lg every grid is one column.
- **Editing** moves to a pencil icon on each card that opens a `Sheet` with that card's fields (a title input, list items one per line). Save goes through `strategy_section_save` with `sendQuietly`, as today. Pencils, the client switcher and edit chips carry `data-print="hide"`.

Wireframe, desktop (numbers are placeholders):

```
HEADER   [logo] Acme                       [Client v] [Export PDF] [Google Slides deck]
         Social strategy, 3 Nov 2026 to 1 Feb 2027
         Written 3 Nov from the brief, the website and 90 days of posts
         Data: Instagram from Sprout | TikTok public posts | LinkedIn public posts, no follower count

01 THE PLAN            3 stat tiles: [n] platforms   [n] posts a week   [n] pillars
                       Goal cards, 2 to 4 across (glass-accent):
                         Grow Instagram engagement per post        <- t-h3
                         [n] today, above it by 1 Feb 2027        <- t-stat + t-read
                         Why: carousels beat the usual [n]x        <- one line, t-read

02 WHERE WE START      Per platform, compact StatCards: Followers | Posts a week |
                         Median engagement per post | Rate (per impression or per view)
                       RankedBars "Posts a week" and "Engagement per post": Acme vs 3 competitors
                       <details> How each platform is measured (the measures table)

03 AUDIENCE AND        Two cards side by side
   POSITIONING           Who: one line | Wants: 3 items | Where: platform badges
                         Our position: one sentence | 3 rows "vs Rival: [point with a number]"

04 PILLARS             CompareBars: share of posts, last 8 weeks (gray) vs planned (lime)
                       Pillar cards, 2 across: name, purpose line, format chips, planned share
                         <details> Example posts (2, in the client's language)

05 PLATFORMS           One card per Posting now or New platform, 2 across:
                         [Instagram] [Posting now] [From Sprout]
                         Role: one line (t-h3)
                         3 tiles: cadence | engagement per post | followers
                         What we post: 3 items
                         What worked: up to 2 real post tiles (date, [n]x usual, link)
                         <details> First 30 days (New)   <details> Checks at 30 and 90 days
                       Not now: one line each

06 WHAT WE AVOID       Up to 5 rows: the pattern + a source chip (Our posts, Trend profile, Brief)
```

## 2. Value: what each section answers

| Section | The social team gets | The client gets | Numbers, all from code | Cut from v1 |
|---|---|---|---|---|
| The plan | What we do for 90 days, and the measure for each goal | The commitments, with dates | Baseline per goal metric; target date = written date + 90 days | Goals as paragraphs |
| Where we start | Today's numbers per platform against 3 competitors | An honest start line | Followers, posts a week, median engagement per post, rate; competitors' medians from the same read | The separate Measures essay (now a table under a disclosure) |
| Audience and positioning | Who we write for, the angle no competitor holds | Why the plan fits them | Each "vs" row cites a competitor figure from the evidence | Two long sections that repeated the trend profile |
| Pillars | What each pillar is for, its formats, its planned share | The content mix in one chart | Current share (8 weeks of calendar posts); planned shares must sum to 100 | Free-text pillar essays |
| Platforms | Role, cadence, what to post, proof of what worked, launch steps | Where we post and why | Cadence (calendar rhythm), baselines, real posts with their multiple | Prose restating the cadence line |
| What we avoid | Patterns to stop | The same, as patterns | None | Long lists |

The writer returns fields instead of prose (`write.ts`, shape version 2). Caps are checked in code by `strategyProblems`, and a reply over a cap is asked again once, as now:

- `goals`: 2 to 4 items of {title (60 chars), why (140), platform, metric, direction}. Metric is an enum (`posts_per_week`, `median_engagement`, `engagement_rate`, `followers`) and must exist for that platform's data basis (section 5). Code adds the baseline figure and the date.
- `audience`: {who (120), wants: 3 items (100 each), where: platforms}.
- `positioning`: {statement (140), points: up to 3 of {vs: a tracked competitor's name, point (120)}}.
- `pillar:<name>`: {purpose (120), formats: up to 3, planned_share, ideas: 2 of {hook (100), format}}.
- `platform:<p>:<state>`: {role (100), post: 3 items (120), worked: up to 2 evidence ids, first_30: 4 week lines (New only), checks: {day_30, day_90}}. Evidence ids are allowed only in `worked`; code turns them into real post tiles. Every text field still rejects ids and em dashes.
- `avoid`: up to 5 of {pattern (120), source}. `not_now` stays one line per platform.
- `measures` is no longer written; code builds the measures table from goals and baselines. (My call.)

People's versions: `content_strategy_edits` gains `value jsonb`, and `strategy_section_save` takes it. A 2 Nov text edit keeps showing as text in its card with its chip until someone saves the new form; nothing is converted or lost. The writer still gets people's versions as fixed context. `strategyBlock` (calendar) renders the v2 fields as lines under the same 4,000-character cap. The inputs key gains `v2`, so each active client gets one rewrite after release. (My call.)

## 3. Clients without Sprout

There is no prospect type and no toggle. A prospect or newly onboarded client is added in Client setup with its name and website, like any client, and the lifecycle does the rest: brand read, competitors, RivalIQ tracking (the client company is the focus company of its own set), trend profile, strategy. The strategy reads the same way for every client: Sprout where profiles are assigned, public data for every other platform. (My call.)

**Where profiles come from.** RivalIQ's own record of the client company (already returned by the `tracking` step), the links on the client's homepage (`brand_read`'s `site_profiles`), and a person's entry. They are kept in a new `client_public_profiles` table (client, platform, handle, URL, source), shown in Client setup under "Sprout Social profiles" as "Public profiles", with the competitor_handles rules: a person's entry is never overwritten and a profile a person removed never comes back.

**The 90-day public read** (`strategy/publicRead.ts`), once per write and reused for 7 days:

- RivalIQ `GET /landscapes/{id}/socialposts` for the last 90 days in 30-day windows, `limit=500`. A window that reaches the limit is split in half and read again; a partial window is never kept (the feed's rule). One `metrics/summary` read gives each company's current followers per platform.
- LinkedIn company pages (client and competitors) through the in-app Apify step with the `harvestapi/linkedin-company-posts` actor already in `pipelines/linkedin/sources.ts`, halving the window when a page reaches the 150-post cap. Never the n8n webhook.
- Stored as a `rivaliq_snapshots` row (endpoint `strategy_public`). The competitors' baselines for "Where we start" come from the same read, for every client.

What can be read without Sprout:

| Platform | Source | Posts, format, text, date | Engagement counted | Reach | Followers |
|---|---|---|---|---|---|
| Instagram | RivalIQ | yes | likes, comments | RivalIQ estimate only | yes |
| Facebook | RivalIQ | yes, plus RivalIQ's likely-boosted signal | reactions, comments, shares | RivalIQ estimate only | yes |
| TikTok | RivalIQ | yes | likes, comments, shares | public views | yes |
| YouTube | RivalIQ | yes | likes, comments | public views | yes |
| X | RivalIQ | yes | likes, replies, reposts | RivalIQ estimate only | yes |
| LinkedIn | Apify actor | yes | reactions, comments, reposts | none | none |

Only Sprout gives measured impressions and reach, clicks, saves, Stories, paid splits and watch time. An estimated reach is never used as a baseline or a target; on Instagram, Facebook and X the public baseline is engagement per post and followers. (My call.)

**How confidence is stated.** Code sets a data basis per platform (`strategy/basis.ts`): measured (Sprout), public (12 or more public posts in 90 days, about one a week), thin (1 to 11), none (no profile found or no posts). (My call on 12.) The header's data line says it per platform in words. The writer is told each basis; a goal on a thin or none platform may only use `posts_per_week` or `followers`, which code checks. The deck's "Where we start" slide carries one factual line, "Based on public posts from 5 Aug to 2 Nov 2026", and no request to connect anything.

**When a prospect becomes a Sprout client** nothing moves. The `accounts` step assigns its Sprout profiles by name or homepage link (the rule proven on 19 Oct); the strategy's inputs key already includes the Sprout networks, so the next write uses measured numbers. Section keys do not change, because a platform with public posts is already "posting", so people's versions stay on the same cards, and earlier decks and their links stay on the export list. The API's demo copies (admin only) are unrelated and unchanged.

## 4. Exports

**PDF, from the app.** The page gets the existing `ExportPdfButton`, which uses `exportReportToPdf` (the browser's print to PDF, dark theme kept). The page is built for it: disclosures are `<details>` (opened in print), cards are `article` (kept whole across pages), charts are the Recharts and `bars.tsx` components the export already handles, and edit controls carry `data-print="hide"`. The PDF is the page with every section open, titled "Acme | Social Strategy". (My call.)

**Google Slides deck, Moburst branded.** Built the way Google's merge guide documents it: copy a template with the Drive API, then fill the copy with `replaceAllText` and `replaceAllShapesWithImage`, never touching the template.

What Lital does once:

1. In Google Cloud console, signed in as ai@moburst.com, in a project owned by the moburst.com organization: enable the Google Slides API and the Google Drive API.
2. OAuth consent screen: user type **Internal**, app name Socialytics, scopes `drive.file`, `openid`, `email`. Internal apps skip Google's verification and the 7-day refresh-token expiry that External apps in Testing get.
3. Credentials: create an OAuth client ID of type Web application, with the redirect URI the build gives (the `google-auth` Edge Function). Paste the client ID and secret into Supabase, Edge Functions, Secrets, as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
4. In Socialytics, Settings, "Google Slides": Connect, sign in as ai@moburst.com, Allow. The panel then reads "Connected as ai@moburst.com".

The refresh token is stored in Supabase Vault and read only through a security-definer function that only the service role may execute; the browser, logs and error text never see it (redacted as the Apify client does). An access token is minted per export and never stored. A weekly refresh in `run-scheduled-jobs` keeps the token in use, since Google drops refresh tokens unused for six months. `drive.file` is Google's recommended non-sensitive Drive scope and covers everything here because the app creates the folder, the template and every copy; Slides `batchUpdate`, Drive `files.copy` and `permissions.create` all accept it. (My call.)

The template (my call): built with the deck design system's own builder (`mbdeck.py`, measured geometry, the text-anchoring lift, `audit()`), checked into the repo with its build script, and imported once into a "Socialytics strategy decks" folder in ai@moburst.com's Drive as a Google Slides file. After import the app sets every text run's weight with Slides' `weightedFontFamily` (Geist 300 body 10pt, 400 titles 18pt, 500 card labels 11pt, 700 cover 40pt), since Slides takes weight from that field and not from a face name. Slides, in order:

1. Cover: `cover` GIF loop, "Acme | Social Strategy", subtitle "Our plan for 3 Nov 2026 to 1 Feb 2027", the client's logo.
2. "Strategy | The Plan": a card row of the goals, each with its dated target.
3. "Strategy | Where We Start": per-platform figures and the brand-vs-competitors chart image, with the data line.
4. "Strategy | Audience and Positioning": `general-2`.
5. "Strategy | Content Pillars": the pillar mix chart and a card row sized to the pillar count.
6. One "Platforms | Instagram" slide per posting or new platform (role, what we post, cadence, measure).
7. "Platforms | First 30 Days" per new platform: process flow, 4 weeks.
8. "Strategy | What We Avoid", then the `mix` loop close.

Card text follows the system's line budgets: code measures each field with the Geist metrics the renderer already uses (`render/measure.ts`), and a field over budget moves the slide to the taller variant the system names (`short-5`, `tall-5`, `general-4`), never a smaller font. Charts are SVG from the same numbers as the page, in the deck's tokens (brand in `#E5C53D`, competitors white at 25%), rendered to PNG at 2x by `render/resvg.ts`, stored privately and passed as a 10-minute signed URL (Slides fetches an image once at insertion, PNG under 50 MB and 25 megapixels, URL under 2 KB).

Each export runs as a `strategy_deck` job in the scheduled-jobs queue:

1. Token from Vault, then `files.copy` of the template into the folder, named "Acme | Social Strategy | Nov 2026".
2. `presentations.get` to find the archetype slides by their tokens.
3. One `batchUpdate`: `duplicateObject` for each extra platform or pillar slide (ids set by code), `replaceAllText` scoped with `pageObjectIds`, `replaceAllShapesWithImage` for charts and logo, `deleteObject` for unused slides and empty card slots.
4. Every required token must report `occurrencesChanged` of at least 1; otherwise the copy is moved to Drive's trash and the job ends with a log line.
5. `permissions.create`: user, writer, the requester's email, `sendNotificationEmail: false`.
6. The link is saved in a new `content_strategy_exports` table (client, file id, URL, the strategy's `written_at`, requester, status, created).

The page shows "Google Slides deck, made 3 Nov" with Open. When the strategy or a person's version changed since, the button reads "Make a new deck". A deck is never rewritten after it is made, because someone may have edited it in Slides. While a job runs the button reads "Making the deck"; a failed job retries quietly. Who may export: staff with `can_access_client`.

## 5. Costs

- **Model:** unchanged pattern, usually one Opus 5.5 write and one Sonnet 5.5 check per write, at most three and two. Output is shorter under the field caps. One extra write per active client at release. Tokens are stored per write, so the real cost is read from the first writes; no estimate is given here.
- **RivalIQ:** no new slots for existing clients, whose company is already tracked. Per write, 3 to 6 `socialposts` reads and 1 metrics read, at most once a week per client, inside RivalIQ's 100 calls per hour per account and through the existing coordinated fetch. Prospects use 4 slots each (decision 4).
- **Apify:** one LinkedIn company-posts run per write for the client and its competitors, reused for 7 days; the run's own `usageTotalUsd` is stored with the read. Profile actors only under decision 5.
- **Google:** Slides and Drive API use is free within quota. One export is one token call, one copy, one read, one `batchUpdate` and one permission, far under the 60 writes per minute per user.
- **Charts and PDF:** rendered in the app and in the browser; a few hundred KB of chart images in Storage per deck.

## 6. Tests

- `strategy/publicRead.test.ts`: a window at 500 is split, never kept partial; client and competitors split by company id; platforms Sprout covers skip the client's public posts; LinkedIn halves at 150; a read under 7 days old is reused.
- `strategy/basis.test.ts`: each basis from data; rate per view on TikTok and YouTube; no estimated rate anywhere; LinkedIn without followers.
- `strategy/write.test.ts`: every v2 cap and enum rejects; a metric missing for its basis rejects; code fills baselines and dates; ids only in `worked`; one re-ask; people's values as fixed context.
- `strategy/prompt.test.ts`, `calendar/weekPlan.test.ts`: v2 fields render under the cap; no strategy gives today's prompt byte for byte. `strategy/charts.test.ts`: SVG from fixed numbers matches a stored snapshot.
- `strategy/deck.test.ts`: the request list for fixtures with 1, 3 and 6 platforms and 2 to 6 pillars; variant by count and by measured line budget; `pageObjectIds` on every replace; a reply with 0 occurrences trashes the copy; the share request.
- `google/oauth.test.ts`: the token is read only through the service-role function, refreshed, and never appears in an error or log.
- `lifecycle/steps.test.ts`: a client with no Sprout profiles gets a strategy; Sprout profiles arriving start a rewrite and keep people's versions.
- `src/test/clientStrategy.test.tsx`: section order as the wireframe; `<details>` disclosures; the edit sheet saves `value`; a 2 Nov text edit still shows; export buttons; no "connect" wording. The display guard covers the new screens.

## 7. Files

Create:
- `supabase/migrations/<timestamp after 20261109150000>_strategy_v2.sql`: `content_strategy_edits.value`, the new `strategy_section_save`, `client_public_profiles` and `content_strategy_exports` with RLS (staff with `can_access_client`), the Vault read and write functions for the Google token (service role only)
- `supabase/functions/_shared/strategy/publicRead.ts`, `basis.ts`, `charts.ts`, `deck.ts`, each with its test
- `supabase/functions/_shared/google/oauth.ts`, `slides.ts`, `drive.ts`, with tests
- `supabase/functions/google-auth/index.ts` (connect and callback)
- `assets/strategy-deck/template.pptx` and its `build_template.py`, plus the plates and loops it embeds, copied from the deck design system
- `src/components/strategy/`: `StrategyHeader.tsx`, `GoalCards.tsx`, `Baseline.tsx`, `AudiencePosition.tsx`, `PillarMix.tsx`, `PlatformCard.tsx`, `AvoidList.tsx`, `EditSheet.tsx`, `StrategyExports.tsx`
- `src/components/settings/GoogleSlidesConnection.tsx`

Change:
- `supabase/functions/_shared/strategy/write.ts`, `platforms.ts`, `prompt.ts` and their tests
- `supabase/functions/_shared/lifecycle/steps.ts` and its test (inputs key `v2`, the public read)
- `supabase/functions/run-scheduled-jobs/index.ts` (`strategy_deck`, the weekly token refresh)
- `src/pages/ClientStrategy.tsx`, `src/pages/ClientSetup.tsx` (Public profiles), `src/pages/Settings.tsx`, `src/index.css` (`.t-read`), `src/integrations/supabase/types.ts`
- Remove `src/components/strategy/StrategyPlatforms.tsx`; `StrategySection.tsx` keeps `useSectionEdit` for the sheet

## Sources

- Slides merge guide: https://developers.google.com/workspace/slides/api/guides/merge
- Slides requests (image rules, `replaceAllText`, `duplicateObject`): https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations/request
- Slides `batchUpdate` scopes: https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations/batchUpdate
- Slides `weightedFontFamily`: https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations.pages/text
- Slides limits and cost: https://developers.google.com/workspace/slides/api/limits
- Drive scopes (`drive.file` non-sensitive): https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Drive `files.copy`: https://developers.google.com/workspace/drive/api/reference/rest/v3/files/copy
- Drive import of a .pptx as Google Slides: https://developers.google.com/workspace/drive/api/guides/manage-uploads
- Drive `permissions.create`: https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create
- Refresh-token expiry: https://developers.google.com/identity/protocols/oauth2#expiration
- Internal apps and verification: https://support.google.com/cloud/answer/13464323
- RivalIQ API and limits: https://rivaliq.com/developers and https://help.rivaliq.com/en/articles/1651517-api-guide
- RivalIQ handle changes: https://help.rivaliq.com/articles/457816-can-i-change-the-social-handles-connected-to-a-company
- Supabase Vault: https://supabase.com/docs/guides/database/vault
