# Onboarding that completes from the client's own profile pages, and reports with no n8n

For Lital, 8 Nov 2026. Builds on the onboarding design of 3 Nov
(`2026-11-03-onboarding-complete-design.md`) and the self-serve lifecycle
(`2026-10-19-self-serve-lifecycle-design.md`). Checked against the code by an
independent reviewer reading it as the builder; its corrections are in.

## Why

Lital's standard: onboarding is fully automated, every report is accurate,
reliable and fully filled, and the app makes every report with no n8n. The
8 Nov comparison showed the report engine is ready (screen figures matched n8n
418 of 418 on the same day; 60 app runs with no failures; Moburst's first two
app-written reports complete). Onboarding still leaves some real clients
incomplete, and the app still hands work to n8n in several places.

## What we found on 8 Nov (database, code, one live read)

1. **The website a brand states on its own LinkedIn page is never read.**
   Kitcaster and Uproar have no website on file. Their own LinkedIn pages
   state one (Apify `harvestapi/linkedin-company`, read 8 Nov): Uproar
   `https://uproar.moburst.com/`, Kitcaster
   `https://www.moburst.com/services/organic/podcast-booking/`. The website
   step finds candidates in post links, the Instagram bio and a web search,
   reduces each to its registrable domain (`net/domains.ts`:
   `uproar.moburst.com` becomes `moburst.com`) and reads that homepage. Post
   and bio links are confirmed by the domain's registered name, its
   `og:site_name` or a link back to the profile; the web search needs a link
   back (`sprout/website.ts:142-153, 248-249`). A sub-brand on a subdomain or
   on a page of a parent site is never confirmed.
2. **No brief, pillars or keywords when posts alone are not enough.**
   Kitcaster's 8 posts are mostly about its podcast guests. With posts as the
   only source, each pillar must cite posts (`brand/pillars.ts:224, 239-246`);
   none passed, the reading threw `no_evidence` and discarded the keywords
   with it (`pillars.ts:225`). The step re-runs when its inputs change; for
   Kitcaster nothing changes, so it waits. Its report tells staff "Add
   keywords in client setup".
3. **No logo and no timezone for some clients.** The logo comes from the
   profile picture on the client's posts (`socialRead.ts pickLogo`); Kitcaster
   and Uproar got none. Kitcaster and Buzznow are on UTC: Sprout gave no
   follower countries for either, and no site gave an address, so the
   existing country fallback (`location.ts:427-431`) had nothing to use.
4. **n8n is still the backup in many places.** The dispatch already retries a
   stopped report in the app (30 minutes, doubling to a day,
   `dispatch.ts:67-72, 254-267`; it closes the occurrence 3 hours before the
   next scheduled run, and a manual run after 7 days). It hands the report to
   n8n after 2 stopped app runs (`dispatch.ts:424`), on an unknown engine
   value, a missing pipeline or secret (`pipelines/engine.ts:26-32, 44-53,
   67-75`), a missing pipeline runner (`dispatch.ts:421-422`) and a repeated
   request in the posting phase (`dispatch.ts:467-468`). The LinkedIn source
   hands its window to n8n after 2 stops and on an unreadable run history
   (`feedLinkedIn.ts:62-68`). With n8n off, each of these becomes a report or
   feed that is never made.
5. **The app cannot tell the team anything.** No Slack or email sending
   exists in the functions.
6. **Reports carry two instructions to staff:** "...or paste the brief into
   client setup" (`pipelines/social/nodes.ts:85`) and "Add keywords in client
   setup" (`nodes.ts:1427`).

## Goals

- Every real client finishes onboarding, with no person involved, with a
  website (or a record of every place looked when the brand states none), a
  brief, pillars, keywords, a logo and a timezone.
- No report tells a person to do something.
- The app makes every report and LinkedIn source on its own. Nothing hands
  work to n8n.

## Non-goals

- RivalIQ capacity: 11 clients have no competitive report because RivalIQ is
  full. That decision is pinned and stays Lital's.
- The AI's writing style (Claude in the app, GPT-4 and Gemini in n8n).
- Natural Intelligence (not a real client).
- Anything a person set: every write still goes through `fields.ts` and never
  replaces a person's value.

## Anti-goals (failure even if it works)

- Any flag, alert box or "set X first" for staff.
- A fix for Kitcaster or Uproar alone (a rule about moburst.com, a list of
  names). Every rule works for every client from its own data.
- Guessing a website the brand does not state or link to.
- Rewriting what already works: a client whose brief, pillars, keywords,
  logo and timezone are filled sees no change from this release.
- Any n8n call kept as a backup, or any new n8n workflow.

## The design

### A. The client's LinkedIn page becomes a source

`social_read` already reads each client's Instagram bio through Apify once
per profile, and again when the profile changes. It reads each
Sprout-connected LinkedIn company page the same way, with
`harvestapi/linkedin-company` (about $0.003 a page): website, about text,
tagline, specialties, industries, logo with its size, and headquarters. The
read is kept on the step's result next to the bio, and done again when the
profile set changes and at least every 30 days.

The page read fills what is missing. It is not, by itself, a move of the
social evidence version (`versionMove`), so clients that are already
complete see no rewrite of pillars, keywords, trend profile or strategy. *(My
call: the reviewer showed that counting it as new evidence for everyone
would rewrite pillars, keywords and strategies for every client with a
LinkedIn page.)* Each use below says when it applies.

### B. Website

- **The LinkedIn page's website field is confirmed by the page itself**
  (`confirmed_by: "profile_website"`): the page is the client's own account
  in Sprout, and the field is a deliberate statement of its site. It is
  checked first and kept as stated, with its subdomain and path.
- **Instagram bio links keep today's confirmation** (registered name,
  `og:site_name` or link back), because a bio often links to a campaign or
  product page. *(My call.)*
- **Post links and search results try the full host first, then the
  registrable domain,** so a subdomain can be confirmed without losing the
  parent-domain finds that work today. *(My call.)*
- **A page on another client's site is used for text only.** When the stated
  website is a path on a domain that is another client's website (Kitcaster
  on moburst.com), it feeds the brief, pillars, keywords and competitor
  identification, but not the logo, colors, location, profile links, Sprout
  brand matching or RivalIQ tracking. Tracking for such a client waits for a
  site of its own (RivalIQ is full in any case). *(My call: otherwise
  Moburst's logo, address and RivalIQ company would be taken as Kitcaster's.)*
- **A subdomain whose homepage is the stated site is a site of its own**
  (Uproar on `uproar.moburst.com`). Sprout brand matching
  (`brands.ts:354-359`, `website.ts:264-276`) and RivalIQ matching compare the
  full host for it, and RivalIQ's "best match on the account" fallback
  (`landscapeCheck.ts:66-68`) never takes another client's company. *(My
  call.)*

### C. Brief, pillars and keywords

- The page's about text, tagline, specialties and industries count as a
  source, like a written brief: a pillar may rest on them, as on website
  text, without citing posts. *(My call: they are the brand's own written
  description.)*
- Keywords are written even when no pillar passes.
- The brief, when no person wrote one and there is no strategy document,
  keeps today's order: the website's text, then the page's about text
  ("Drafted from the LinkedIn page on <date>"), then the posts.
- The page read is part of `brief_pillars`' inputs only while that step has
  not produced pillars and keywords, so it re-runs for Kitcaster and not for
  clients that are complete.

### D. Logo

The LinkedIn page's logo is a candidate only when the client has no logo.
*(My call: under today's rule a profile image may replace an earlier profile
image, and the larger page logo would replace many working logos and re-run
their design settings.)*

### E. Timezone

The page's headquarters joins the location sources as an address the brand
set on its own profile (`profile_address`). Following today's ranks, it is
used where the stored zone came from a weaker source or there is none.

A client with no location from any source (Buzznow today) gets the timezone
most of the agency's clients have from a real source: today America/New_York,
all 11 such clients. It is recorded as a new weakest source (`agency`, below
`country`), so any address, headquarters or follower data replaces it as soon
as it appears. It is worked out from the clients each time, never written
into code. *(Lital asked for my suggestion, 8 Nov; this is it.)*

### F. Reports never instruct people

Both instructions (`nodes.ts:85`, `nodes.ts:1427`) are removed. Where a
section cannot run, the report says only that it was not available this
month.

### G. No n8n

- Every n8n hand-off in finding 4 is removed. Each case becomes the dispatch's
  existing in-app retry, with today's timing and closing rules. A missing
  pipeline or secret waits and retries like a stopped run; an unknown engine
  value is read as `app`.
- The LinkedIn source: when its collection stops, the feed is saved without
  the LinkedIn posts (RivalIQ posts are not lost), and LinkedIn is collected
  again on the next feed tick, with no n8n call. *(My call: today one stopped
  source fails the whole feed.)*
- The `n8n` engine value keeps working until the 7 Dec reports run clean, so
  the switch can be turned back by hand. Then the n8n code paths are removed
  and the three workflows archived, with Lital's OK.
- **A report still not made 24 hours after its first attempt** gets one
  Slack message to `#ai-products-issues` (private, `C0CG0ASL404`) that
  mentions Lital (`<@U03AZ88435H>`): the client, the report (social or
  competitive), its period, the reason in plain words and a link to the
  client's reports page. Retries go on as before. When the report is made,
  a second short message says so. One alert per report occurrence, never a
  stream. *(Lital, 8 Nov: "me via a slack msg to: ai-products-issues".)*
- The message is posted through a Slack incoming webhook, Slack's documented
  way to post to one channel. The webhook URL is a secret,
  `SLACK_ISSUES_WEBHOOK_URL`, kept in Lovable and never shown anywhere.
  Without it, nothing is posted and the report keeps retrying.

### H. The switch

After A to G are released:

- the kind-wide default switches for social and competitive are set to the
  app, and every per-client row is removed, so new clients use the app too
  (the LinkedIn source default is already the app);
- the three n8n workflows are turned off, kept, not deleted (social
  `SZbRTV7yOdXTNHHf`, competitive `EBiAwSay3H2R8krv`, LinkedIn source
  `xm3ZFPjysyQCkWsc`);
- the 7 Dec reports run in the app.

## Done looks like

- On their next lifecycle look, with no person involved: Kitcaster has a
  website (its moburst.com page, used for text), a brief, pillars, keywords,
  a logo and a timezone; Uproar has `uproar.moburst.com`, a logo, and its
  competitor tracking moves past "waiting for a website".
- No complete client's brief, pillars, keywords, logo, trend profile or
  strategy changes.
- A Kitcaster social report made by the app has 15 Instagram and 15 TikTok
  trend posts and no warning.
- Tests prove each rule: the page's website kept with subdomain and path; a
  page on another client's site used for text only; full host before
  registrable domain; page text as a source; keywords kept with no pillars;
  the page logo only when there is none; the headquarters as a profile
  address; no instruction text in reports; no n8n call from the dispatch,
  the engine reader or the LinkedIn source; the feed saved without LinkedIn
  posts when LinkedIn stops.
- The free replays of `ee82b373` (social) and `6d9f301c` (competitive) still
  match after every `run-scheduled-jobs` deploy.

## Costs

The LinkedIn page read is about $0.003 a page at onboarding and then about
monthly: under $1 a year for the current clients. Kitcaster's and Uproar's
`brief_pillars` re-runs are one model call each. No complete client is
rewritten.

## Left to the builder

- Where the page read's fields sit in the step result, and the reader module
  (modeled on `apify/instagramProfile.ts`).
- Reading other networks' stated websites (Facebook page, X profile) now or
  later; LinkedIn and the Instagram bio cover every current client.

## One-time setup by Lital (the only step a person does)

The Slack webhook is a secret, so Lital creates and adds it herself, once:

1. In Slack, open **api.slack.com/apps**, choose the workspace's app for AI
   tools (or **Create New App > From scratch**, named `Socialytics`).
2. Under **Incoming Webhooks**, switch it on, click **Add New Webhook to
   Workspace**, pick `#ai-products-issues` and click **Allow**.
3. Copy the webhook URL and add it in Lovable (**More > Settings >
   Secrets**) as `SLACK_ISSUES_WEBHOOK_URL`. Do not paste it anywhere else.

## Lital's answers (8 Nov)

1. A report that is still not made: a Slack message to her in
   `#ai-products-issues` (section G).
2. A client with no location from any source: she asked for my suggestion;
   it is in section E.

## Tests added for the answers

- An alert is posted once, at 24 hours, with the client, report, period,
  reason and link, mentioning Lital; a second message when the report is
  made; nothing without the secret; nothing for a report made within 24
  hours.
- The agency timezone is the most common sourced zone, is replaced by any
  real source, and is never used while a real source exists.
