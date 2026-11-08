# Onboarding From Profile Pages, and Reports With No n8n: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every real client finishes onboarding from its own LinkedIn page and posts, reports never instruct staff, and the app makes every report with no n8n hand-off, alerting Lital in Slack when one is still not made after a day.

**Architecture:** A new Apify reader for LinkedIn company pages feeds `social_read`, which fills only missing fields (logo, location, timezone). The website step takes the page's stated website first; a page on another client's site is used for text only. The pillar reader accepts the page text as a source. The dispatch, engine reader and LinkedIn feed lose every n8n fallback; a Slack incoming webhook carries one alert per stuck report.

**Tech Stack:** Deno edge functions (`supabase/functions`), TypeScript, Vitest (`npx vitest run`), Apify (`harvestapi/linkedin-company`), Slack incoming webhooks.

**Spec:** `docs/superpowers/specs/2026-11-08-onboarding-profile-pages-and-no-n8n-design.md`

## Global Constraints

- Every client write goes through `writeClientFields` (`lifecycle/fields.ts`); never replace a person's value.
- No client that is already complete changes: no version move of `social_read` from the page read alone; no `brief_pillars` re-run for a client that has pillars and keywords.
- No n8n call is added; every existing automatic hand-off to n8n is removed. The `n8n` engine value set by hand keeps working.
- Secret name `SLACK_ISSUES_WEBHOOK_URL`; channel `#ai-products-issues` (`C0CG0ASL404`); mention `<@U03AZ88435H>`. Never log or print the webhook URL.
- Brief label for the page source: `Drafted from the LinkedIn page on <YYYY-MM-DD>:`.
- No user-visible text may instruct a person ("add", "paste", "set") or show developer detail.
- A function imports only its own folder and `_shared` (packaging test); upload under 4,000,000 bytes.
- Writing standard for user-visible copy: no em dashes, plain words.
- Release: `npx tsc -b --force`, `npx vitest run --maxWorkers=4`, `deno check` on each deployed function, deploy via Lovable, then free replays of `ee82b373` (social) and `6d9f301c` (competitive) must match.

## Review Focus

1. A LinkedIn page read that fails, is pending, or returns no item must leave the client exactly as before (no write, no thrown step). Test in Task 2.
2. A client with a person-set logo, timezone or website must never get the page's values. Tests in Tasks 3 and 4.
3. The agency timezone must never win over any real source, and must be computed only from sourced zones (never from `UTC` or person-unset rows). Test in Task 3.
4. A report made within 24 hours must never alert; an occurrence must alert at most once, plus one "made" message. Test in Task 9.
5. A client whose website is a plain domain (`https://olo.com`) must behave exactly as today in every step touched by the parent-page rule. Test in Task 5.

---

### Task 1: LinkedIn company page reader

**Files:**
- Create: `supabase/functions/_shared/apify/linkedinPage.ts`
- Test: `supabase/functions/_shared/apify/linkedinPage.test.ts`

**Interfaces:**
- Produces:
  - `LINKEDIN_PAGE_ACTOR = { id: "harvestapi~linkedin-company", name: "harvestapi/linkedin-company", timeoutSecs: 120 }`
  - `interface LinkedInPage { url: string; name: string | null; website: string | null; about: string; tagline: string | null; specialties: string[]; industries: string[]; logo: { url: string; width: number | null; height: number | null } | null; headquarters: { line1: string | null; city: string | null; region: string | null; postalCode: string | null; country: string | null } | null }`
  - `type PageRead = { state: "read"; page: LinkedInPage | null; run_id: string; usd: number | null } | { state: "pending"; run_id: string } | { state: "failed"; run_id: string; status: string }`
  - `pageUrlOf(nativeName: string): string` → `https://www.linkedin.com/company/<native_name>/`
  - `pageFromItem(item: unknown, url: string): LinkedInPage | null`
  - `readLinkedInPage(apify: ApifyClient, url: string, o?: { runId?: string | null; waitSecs?: number }): Promise<PageRead>` (same flow as `readInstagramBio`, input `{ companies: [url] }`)

- [ ] **Step 1: Write the failing tests** with the 8 Nov item shapes:
  - `pageFromItem` on an item `{ universalName: "kitcaster-by-moburst", name: "Kitcaster by Moburst", website: "https://www.moburst.com/services/organic/podcast-booking/", description: "Kitcaster by Moburst is the podcast booking division...", tagline: "Strategic podcast booking...", specialities: ["podcast","marketing"], industries: [{ name: "Marketing Services" }], logos: [{ url: "https://media.licdn.com/a.png", width: 400, height: 400 }], locations: [{ headquarter: true, city: "New York", geographicArea: "NY", country: "US", postalCode: "10001", line1: "1 Main St" }] }` returns `website` unchanged (path kept), `about` clipped to 3000 chars, `specialties`, `industries: ["Marketing Services"]`, `logo { width: 400, height: 400 }`, and `headquarters.city === "New York"`.
  - An item whose `universalName` differs from the URL's slug returns `null`.
  - An item with no website, no description and no logo returns `null`.
  - `pageUrlOf("uproar-by-moburst") === "https://www.linkedin.com/company/uproar-by-moburst/"`.
  - `readLinkedInPage` with a fake client: a running run returns `pending`; a `SUCCEEDED` run returns `read` with the page; a `FAILED` run returns `failed`.
- [ ] **Step 2:** `npx vitest run supabase/functions/_shared/apify/linkedinPage.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement in `linkedinPage.ts`, modeled on `apify/instagramProfile.ts`. Take the headquarters from the location with `headquarter: true`, else the first.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `Apify: LinkedIn company page reader`.

### Task 2: `social_read` reads the client's LinkedIn page

**Files:**
- Modify: `supabase/functions/_shared/lifecycle/socialRead.ts` (`SocialIO`, a `readPage` beside `readBio`, both result branches)
- Modify: `supabase/functions/_shared/lifecycle/socialIO.ts` (wire `linkedinPage`)
- Test: `supabase/functions/_shared/lifecycle/socialRead.test.ts`

**Interfaces:**
- Consumes: Task 1 `readLinkedInPage`, `pageUrlOf`, `LinkedInPage`, `PageRead`.
- Produces:
  - `SocialIO.linkedinPage(url: string, runId: string | null): Promise<PageRead>`
  - `interface LinkedInPageState { profile_id: string; url: string; key: string; read_at: string | null; page: LinkedInPage | null; run_id?: string | null; status?: string }`
  - result field `linkedin_page: LinkedInPageState | null`, kept in the quiet branch and the move branch, exactly as `instagram` is.
  - `pageOf(result: Row | null): LinkedInPage | null` (exported, for other steps).

- [ ] **Step 1: Write the failing tests:**
  - "reads the LinkedIn page of a client with a linkedin_company profile once, and keeps it while the profile is the same" (second run makes no `linkedinPage` call when `key` is unchanged and `read_at` is under 30 days old).
  - "reads it again after 30 days or when the profile changes".
  - "a pending page read keeps the run id and changes nothing else; a failed or throwing read keeps the last page" (Review Focus 1).
  - "the page read alone is not a move": a quiet week with a new page returns `moved: null` and the same `version`.
- [ ] **Step 2:** `npx vitest run supabase/functions/_shared/lifecycle/socialRead.test.ts` → the new tests FAIL.
- [ ] **Step 3:** Implement `readPage(profiles, prev, io, now)`: the first `linkedin_company` profile with a `native_name`; `key = "<profile id>:<native_name lowercased>"`; re-read when the key differs or `read_at` is 30+ days old. Add the field to `base` so both branches carry it.
- [ ] **Step 4:** Same command → PASS; `npx vitest run supabase/functions/_shared/lifecycle` → PASS.
- [ ] **Step 5:** Commit `social_read: the client's LinkedIn page as a source`.

### Task 3: Fill missing logo, location and timezone (with the agency timezone)

**Files:**
- Modify: `supabase/functions/_shared/lifecycle/location.ts` (`LocationSource` adds `"agency"`, `SOURCE_RANK.agency = 7`)
- Create: `supabase/functions/_shared/lifecycle/agencyZone.ts`
- Modify: `supabase/functions/_shared/lifecycle/socialRead.ts` (a gap fill that runs in both branches)
- Test: `supabase/functions/_shared/lifecycle/agencyZone.test.ts`, `socialRead.test.ts`

**Interfaces:**
- Consumes: Task 2 `linkedin_page`.
- Produces:
  - `mostCommonZone(rows: Array<{ timezone: string | null; field_sources: unknown }>): string | null`: counts only rows whose `field_sources.timezone` has a source (`from` or `by`) and whose zone is not `UTC`; ties go to the alphabetically first zone.
  - `agencyZone(db: Db, exceptClientId: string): Promise<string | null>`: reads active, non-archived clients and applies `mostCommonZone`.
  - `pageFill(client: Row, page: LinkedInPage | null, agency: string | null): { fields: Record<string, unknown>; from: Record<string, string>; logoUrl: string | null }` (pure apart from the logo upload, which the step does).

- [ ] **Step 1: Write the failing tests:**
  - `mostCommonZone` returns `America/New_York` for 11 sourced New York rows plus 2 unsourced UTC rows; returns `null` when no row is sourced (Review Focus 3).
  - The page logo is written (`from.logo_url = "linkedin_page"`) only when `client.logo_url` is empty and the lifecycle may write it; never over a person's or the website's logo (Review Focus 2).
  - The headquarters is offered as a `profile_address`; it replaces a stored location only when `replacesLocation` allows (a `followers` zone yes; a `schema.org` site zone no).
  - With no location from any source and a stored zone of `UTC` or none, the agency zone is written with source `agency`; with any other source present it is not.
  - The fill writes on a quiet week (no move) and does not change `version`.
- [ ] **Step 2:** Run the two test files → FAIL.
- [ ] **Step 3:** Implement. In the step, call `pageFill` before the quiet return and before the move branch's own writes, upload the page logo through `io.image` + `generated-media` (path `<client id>/brand/logo-linkedin-<hash>.<ext>`), and merge its fields with the move branch's (the move branch's own location wins when its source ranks higher).
- [ ] **Step 4:** Run the two test files, then `npx vitest run supabase/functions/_shared/lifecycle` → PASS.
- [ ] **Step 5:** Commit `social_read: fill a missing logo, location and timezone from the page and the agency`.

### Task 4: Website from the page, and full hosts before registrable domains

**Files:**
- Modify: `supabase/functions/_shared/sprout/website.ts` (`linkedDomains`, `searchWebsite`, `searchWebsiteByName`)
- Modify: `supabase/functions/_shared/lifecycle/steps.ts` (`website` step: inputs and run)
- Test: `supabase/functions/_shared/sprout/website.test.ts`, `supabase/functions/_shared/lifecycle/steps.test.ts`

**Interfaces:**
- Consumes: Task 2 `pageOf`.
- Produces: `statedWebsite(page: LinkedInPage | null): string | null` (in `steps.ts` or `sprout/website.ts`): the page's website when it is http(s), not a shared platform, kept with subdomain and path; `confirmed_by: "profile_website"` on the website step's result.

- [ ] **Step 1: Write the failing tests:**
  - website step: a client with no website whose page states `https://uproar.moburst.com/` gets `website_url = "https://uproar.moburst.com/"`, `confirmed_by: "profile_website"`, and no search is run.
  - a stated `https://www.moburst.com/services/organic/podcast-booking/` is written with its path.
  - a person-set website is never replaced (Review Focus 2); a page stating a social profile URL is ignored.
  - the step's inputs key changes when the page's stated website appears.
  - `linkedDomains` counts `shop.olo.com` as `shop.olo.com`; `searchWebsite` tries `https://shop.olo.com` and then `https://olo.com` when the first does not confirm, and still confirms `olo.com` as today.
- [ ] **Step 2:** Run both test files → FAIL.
- [ ] **Step 3:** Implement. Count landing hosts with `www.` stripped; try each host, then its registrable domain if different and not tried; same order in `searchWebsiteByName`. In the website step, check `statedWebsite(pageOf(socialResult(rows)))` first.
- [ ] **Step 4:** Run both files → PASS.
- [ ] **Step 5:** Commit `website: the page's stated site first; full hosts before registrable domains`.

### Task 5: A page on another client's site is used for text only

**Files:**
- Create: `supabase/functions/_shared/lifecycle/parentPage.ts`
- Modify: `supabase/functions/_shared/lifecycle/steps.ts` (`brand_read`, `accounts`, `tracking`)
- Modify: `supabase/functions/_shared/sprout/brands.ts` (`clientWithSite`)
- Test: `supabase/functions/_shared/lifecycle/parentPage.test.ts`, `steps.test.ts`, `supabase/functions/_shared/sprout/brands.test.ts`

**Interfaces:**
- Produces:
  - `isParentPage(website: string | null, otherSites: Array<string | null>): boolean`: true when the website has a path other than `/` and its registrable domain equals the registrable domain of one of the other clients' websites.
  - `otherClientSites(db: Db, clientId: string): Promise<string[]>` (active, non-archived, not demo copies).

- [ ] **Step 1: Write the failing tests:**
  - `isParentPage("https://www.moburst.com/services/organic/podcast-booking/", ["https://www.moburst.com"]) === true`; `isParentPage("https://uproar.moburst.com/", ["https://www.moburst.com"]) === false`; `isParentPage("https://olo.com", ["https://www.moburst.com"]) === false` (Review Focus 5).
  - `brand_read` for a parent page writes no logo, location, timezone, brand identity or geo, and returns `site_profiles: []` and `parent_page: true`.
  - `accounts` uses no site profile links for a parent page.
  - `tracking` for a parent page returns `waiting` with reason `own_site`.
  - `clientWithSite("https://uproar.moburst.com/", [Moburst with https://moburst.com])` returns null; `clientWithSite("https://shop.olo.com", [Olo with https://olo.com])` still returns Olo.
  - a plain-domain client's `brand_read`, `accounts` and `tracking` results are unchanged (Review Focus 5).
  - `matchingClientCompanies(companies, "Uproar by Moburst", "https://uproar.moburst.com/")` does not return a company whose url is `https://moburst.com` (pins today's full-host RivalIQ matching, which the design relies on; no code change expected in `competitive/rivaliqLandscape.ts`).
- [ ] **Step 2:** Run the three test files → FAIL.
- [ ] **Step 3:** Implement. `clientWithSite` compares full hosts (`www.` stripped) when the client's stored website is a subdomain of its registrable domain, otherwise registrable domains as today.
- [ ] **Step 4:** Run the files, then `npx vitest run supabase/functions/_shared` → PASS.
- [ ] **Step 5:** Commit `A page on another client's site is used for text only`.

### Task 6: Brief, pillars and keywords from the page

**Files:**
- Modify: `supabase/functions/_shared/brand/pillars.ts` (`derivePillars` options, sources, the no-pillar case)
- Modify: `supabase/functions/_shared/lifecycle/steps.ts` (`brief_pillars` inputs and run)
- Test: `supabase/functions/_shared/brand/pillars.test.ts`, `supabase/functions/_shared/lifecycle/steps.test.ts`

**Interfaces:**
- Consumes: Task 2 `pageOf`.
- Produces: `derivePillars(..., opts: { ...; page?: { about: string; tagline: string | null; specialties: string[]; industries: string[] } | null })`; new `PillarSource` value `"linkedin_page"`; when no pillar passes but keywords exist, `derivePillars` returns `{ pillars: [], keywords, ... }` instead of throwing.

- [ ] **Step 1: Write the failing tests:**
  - With posts and page text, `checkPostIds` runs with `postsOnly: false` (pillars need not cite posts) and `sources` includes `"linkedin_page"`.
  - With no pillars passing and keywords in the reply, `derivePillars` returns the keywords and `pillars: []`.
  - `brief_pillars` with no document and no site text but a page writes `brief_text` starting `Drafted from the LinkedIn page on 2026-11-08:`.
  - `brief_pillars` inputs include the page's key only while the step has not produced pillars and keywords; a complete client's key is unchanged by a new page read (Global Constraints).
  - `brief_pillars` writes keywords even when pillars come back empty, and then waits with reason `evidence`.
- [ ] **Step 2:** Run the two test files → FAIL.
- [ ] **Step 3:** Implement. Page text goes into the prompt as untrusted content (about, tagline, specialties, industries), clipped to 4000 chars, like the bio.
- [ ] **Step 4:** Run the files → PASS.
- [ ] **Step 5:** Commit `Pillars and keywords from the LinkedIn page; a brief from it when there is no site text`.

### Task 7: Reports never instruct people

**Files:**
- Modify: `supabase/functions/_shared/pipelines/social/nodes.ts:85` and `:1427`
- Test: `supabase/functions/_shared/pipelines/social/nodes.test.ts`

- [ ] **Step 1: Write the failing test:** `prepareBriefText` with an unreadable file gives `"The linked brief could not be read."` plus the existing used-instead sentence; a `missing_keywords` trend state gives `"TikTok trends were not available this month."` / `"Instagram trends were not available this month."`; neither contains `client setup`, `Add` or `paste`.
- [ ] **Step 2:** `npx vitest run supabase/functions/_shared/pipelines/social` → FAIL.
- [ ] **Step 3:** Change the two strings.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `Reports: no instructions to staff`.

### Task 8: No automatic n8n hand-off

**Files:**
- Modify: `supabase/functions/_shared/pipelines/engine.ts` (`requestedEngine`, `resolveEngine`, `readEngine`)
- Modify: `supabase/functions/run-scheduled-jobs/dispatch.ts` (`routeOf`, `send`, the webhook check)
- Modify: `supabase/functions/_shared/pipelines/feedLinkedIn.ts`, `supabase/functions/_shared/competitive/refreshFeed.ts`
- Modify: `supabase/functions/_shared/pipelines/types.ts` (remove `APP_STOPS_BEFORE_N8N`)
- Test: `engine.test.ts`, `run-scheduled-jobs/dispatch.test.ts`, `feedLinkedIn.test.ts`, `refreshFeed.test.ts`

**Interfaces:**
- Produces: `readEngine` returns `{ engine: "app" | "shadow" | "n8n"; pipeline?; refused? }` where an unreadable switch, an unknown value or a missing pipeline/secret gives `{ engine: "app", pipeline: undefined, refused }`; callers treat "app without a pipeline" as "wait and retry".

- [ ] **Step 1: Write the failing tests:**
  - `requestedEngine` with an unknown value gives `app`; with no row gives `app`; an explicit `n8n` row still gives `n8n`.
  - `readEngine` on a read error gives `app` with `refused`, never `n8n`.
  - The dispatch never calls `post` for an `app` route: after 2 stopped app runs the occurrence runs again in the app; a missing pipeline runs again later; a repeated request in phase `posting` with an `app` route starts the app run; a missing competitive webhook URL does not throw for an `app` route.
  - `feedLinkedInAnswer` never calls `n8n()` for an `app` engine: an unreadable run history or 2 stops return no LinkedIn posts for this refresh.
  - `refreshFeed` saves the snapshot with the RivalIQ posts when the LinkedIn collection throws or stops.
- [ ] **Step 2:** Run the four test files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them, then `npx vitest run --maxWorkers=4` → PASS.
- [ ] **Step 5:** Commit `No automatic hand-off to n8n`.

### Task 9: One Slack alert for a report still not made after a day

**Files:**
- Create: `supabase/functions/_shared/alerts/slack.ts`
- Modify: `supabase/functions/run-scheduled-jobs/dispatch.ts` (`DispatchDeps.alert`, `DispatchMemory.alerted_at`, `runAgain`, `watch`), `supabase/functions/run-scheduled-jobs/index.ts` (wire it)
- Test: `supabase/functions/_shared/alerts/slack.test.ts`, `run-scheduled-jobs/dispatch.test.ts`

**Interfaces:**
- Produces:
  - `ISSUES_WEBHOOK_ENV = "SLACK_ISSUES_WEBHOOK_URL"`, `LITAL_SLACK = "<@U03AZ88435H>"`
  - `postIssue(webhook: string | undefined, text: string, fetchImpl?: typeof fetch): Promise<boolean>` (false and no call without a webhook; never throws; never logs the URL)
  - `stuckReportText(a: { client: string; kind: "social" | "competitive"; range: { start: string; end: string }; reason: string; link: string }): string`
  - `madeReportText(a: { client: string; kind: "social" | "competitive"; range: { start: string; end: string }; link: string }): string`
  - `DispatchDeps.alert?(text: string): Promise<void>`; `DispatchMemory.alerted_at?: string`

- [ ] **Step 1: Write the failing tests:**
  - `stuckReportText` starts with `<@U03AZ88435H>` and names the client, the kind, the period, the reason and the link `https://socialytics.moburst.com/clients/<id>/reports` (social) or `/competitive/reports` (competitive).
  - `postIssue` without a webhook returns false and makes no request; with one, posts `{ text }` JSON once.
  - The dispatch alerts once when a run is made again 24 hours or more after the occurrence's first run started, keeps `alerted_at` in the job's memory, and does not alert again on later retries (Review Focus 4).
  - No alert when the report finishes within 24 hours; one `madeReportText` message when a report finishes after `alerted_at` was set.
- [ ] **Step 2:** Run both test files → FAIL.
- [ ] **Step 3:** Implement. Keep `alerted_at` in the `kept` memory `runAgain` saves.
- [ ] **Step 4:** Run them → PASS.
- [ ] **Step 5:** Commit `One Slack alert to #ai-products-issues for a report still not made after a day`.

### Task 10: Release, switch and verify (operations, no new code)

- [ ] **Step 1:** `npx tsc -b --force`; `npx vitest run --maxWorkers=4`; `npx vite build` → all pass.
- [ ] **Step 2:** Merge to main through the canva worktree (`git fetch`; `merge --ff-only origin/main`; `merge trends`; `push origin canva-finish:main`).
- [ ] **Step 3:** List the functions whose imports reach any changed file (import-graph script), `deno check` each, deploy them through Lovable, and run the two free replays (`ee82b373`, `6d9f301c`) → 1 distinct md5 each.
- [ ] **Step 4:** Copy the Slack setup steps from the spec to the Desktop as `Socialytics Slack alert setup 2026-11-08.md` for Lital; the alert stays silent until she adds `SLACK_ISSUES_WEBHOOK_URL`.
- [ ] **Step 5:** Enqueue lifecycle looks for Kitcaster and Uproar; verify their website, brief, pillars, keywords, logo and timezone; verify Buzznow's timezone; verify no complete client's `brief_pillars`, `content_strategy` or `social_read.version` changed.
- [ ] **Step 6:** Switch: `report_engines` kind-wide rows for `social` and `competitive` set to `app`; delete every per-client row; deactivate the n8n workflows `SZbRTV7yOdXTNHHf`, `EBiAwSay3H2R8krv`, `xm3ZFPjysyQCkWsc` (kept, not deleted).
- [ ] **Step 7:** Run one app-made Kitcaster social report for October and confirm 15 Instagram and 15 TikTok trend posts and no warning.
