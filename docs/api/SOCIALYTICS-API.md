# Socialytics API

The machine door to Socialytics for moburst.ai gOS and any other Moburst tool, agent or app. One versioned router served by the `api` edge function:

```
https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/v1/...
```

The OpenAPI 3.1 document is served by the API itself at `GET /v1/openapi.json`. A typed client lives in `api/client/socialytics-api.ts` (plain `fetch`, no dependencies) and an MCP-style tool manifest in `api/mcp/socialytics-tools.json`. The API has the same shape as AdVisor's (`docs/api/ADVISOR-API.md` in the AdVisor repo): same core, same envelopes, same key model, same demo contract.

## Authentication

Every resource route takes an API key:

```
Authorization: Bearer soc_...
```

(`X-Api-Key: soc_...` is accepted too.) Keys are created on the Settings page of Socialytics by an admin ("API access" card) or through `POST /v1/admin/keys`. The plaintext is shown once; only its SHA-256 is stored. A key carries:

- **scopes**: `read` (every GET), `demo` (demo jobs), `admin` (key management through the API).
- **reach**: `company_slugs` (the gOS canonical slugs the key may see, matched against `clients.company_slug`) or `client_ids`; a key with neither sees every client. Anything outside a key's reach answers `404`.
- **rate limit**: per minute, default 120. Over the limit the API answers `429` with `Retry-After`.

Every request is recorded (key, route, status, duration; never the body or the key). No user session is accepted on resource routes; the only session path is `/v1/admin/keys` for a signed-in Socialytics admin.

## Shapes

- Lists: `{ "data": [...], "next_cursor": "..." | null }`. Pass `next_cursor` back as `cursor`; `limit` is 50 by default, 200 at most. Lists are ordered newest first.
- Single objects: `{ "data": {...} }`.
- Errors: `{ "error": { "code": "not_found", "message": "Report not found" } }`. Codes: `invalid_request`, `unauthorized`, `forbidden`, `not_found`, `method_not_allowed`, `conflict`, `rate_limited`, `demo_capacity`, `job_running`, `unprocessable` (the request is valid but the data cannot serve it; `details.reason` says why, for example `no_sprout_profiles`), `upstream_failed` (a service the API depends on did not answer), `internal`.
- Headers on every answer: `X-Api-Version: 1`, `X-Request-Id`.
- Timestamps are ISO 8601 UTC; report periods are `yyyy-mm-dd` dates.

## Read routes (scope `read`)

| Route | What it returns |
|---|---|
| `GET /v1/clients?q=&company_slug=&include_archived=` | Clients with platforms, pillars, keywords, brand identity, design state, Sprout and competitor summaries, counts, last report, readiness (`setup`), links. |
| `GET /v1/clients/{id}` | One client, plus `sprout_profiles[]` (names and networks), `competitor_sets[]` with handles, `schedules[]`. |
| `GET /v1/clients/{id}/setup` | `{ ready, issues[] }`: brand identity, pillars, keywords, Sprout profile, confirmed competitor set, approved design system, schedule. |
| `GET /v1/clients/{id}/analytics?start=&end=` | Sprout performance over a window (default the last 30 days): totals, the previous window, changes, per profile, top posts. `422 unprocessable` with `reason: no_sprout_profiles` for a brand not managed in Sprout. |
| `GET /v1/reports?client_id=&status=&from=&to=` | Social reports: period, previous period, status, deck, counts, metric changes, warnings, trend status, links. |
| `GET /v1/reports/{id}` | One social report, plus `analysis`, `calendar` (the content calendar), `performance` (without raw post ids) and `trends` summaries. |
| `GET /v1/competitive-reports?client_id=&status=` | Competitive reports: period, status, deck, totals, quality check. |
| `GET /v1/competitive-reports/{id}` | One competitive report, plus `analysis` (executive summary, scorecard, gaps, teardown, breakdowns, schedule) and `aggregates` per company. |
| `GET /v1/competitor-sets?client_id=&status=`, `GET /v1/competitor-sets/{id}` | Competitor sets with competitors (website, rationale, similarity, selection, rank) and their social handles (platform, handle, URL, confidence, source). |
| `GET /v1/posts?client_id=&report_id=&source=&approved=&include_archived=`, `GET /v1/posts/{id}` | Generated posts: platform, format, copy, hashtags, CTA, concept, visual direction, media URLs, variant, approval state, finishing. |
| `GET /v1/media-jobs?client_id=&status=` | Media generation jobs: kind, provider, status, output, review. |
| `GET /v1/schedules?client_id=` | Report schedules: kind, frequency, day of month, range mode, next and last run, last result. |
| `GET /v1/scheduled-posts?client_id=&status=` | Posts scheduled to Sprout Social. |
| `GET /v1/alerts?client_id=&status=` | Competitive alerts: topic, summary, companies, platforms, post URLs, window. |
| `GET /v1/design-systems?client_id=` | Design systems: version, status, templates, tokens (font family, colours), preview URLs. |
| `GET /v1/status` | Health: reports running past 90 minutes, schedules whose last run failed, media failed in 24 hours, demo jobs stuck or failed, schema drift. A company-scoped key sees its own clients' findings only. |

Never returned, by construction: Sprout customer and profile ids, RivalIQ landscape and company ids, media provider request ids and model paths, app settings, integration tokens, key hashes. The schema contract test fails if any of these names appears in a documented response.

## The ad-hoc demo (scope `demo`)

`POST /v1/demo-jobs` onboards any brand from a name and a website and runs every feature for it:

```json
{
  "client_name": "Brooklinen",
  "website": "brooklinen.com",
  "competitors": [{ "name": "Parachute", "website": "parachutehome.com" }],
  "requester": { "id": "gos-42", "email": "someone@moburst.com", "name": "Someone" },
  "idempotency_key": "gos-demo-2026-10-01-brooklinen",
  "callback_url": "https://moburst.ai/api/hooks/socialytics-demo",
  "force_run": false
}
```

Only `client_name` and `website` are required (`industry` and `regions` are accepted for parity with AdVisor and ignored). The answer is `202` with the job; the same `idempotency_key` on the same key returns the same job (`200`). At most three demo jobs run at once (`429 demo_capacity`).

A demo works on its own copy of the brand. It never reads, reuses or writes a production client, even one with the same website or name. The parts of the product that need the brand's own connections (RivalIQ tracking and the competitive report, Sprout performance analytics, publishing) are not run for a prospect; the job records them as `connected_only` gaps and they are shown on the connected showcase workspace, Moburst's own client, which the normal monthly workflow keeps current.

The job runs these steps, each recorded with its outcome and a plain reason:

1. `resolve_client`: reuse the demo client an earlier job created for this website host or exact name, else create one (`company_slug` `demo-<brand>`, owner from the requester's email or the most active creator, Instagram/TikTok/Facebook/LinkedIn, US, English, Gemini for media). A company-scoped key covers its company's demo copy. The outputs carry the slug so the caller can add it to a rep's allowed companies.
2. `brand_identity`: colours, font, tone and logo description from the website (`research-brand-identity`), written only where empty.
3. `site_brief`: the homepage's main text (Firecrawl) becomes the brief when the client has none.
4. `pillars`: content pillars and social keywords derived from the evidence on file.
5. `design`: only for a brand this job created (approving a design system is a team decision, never taken on a client that existed before); when it has at least three design references, a design system is built and approved; otherwise a gap says designs use the brand colours and fonts only.
6. `competitors`: the competitors named in the request, or 8 to 12 proposed from the brand; social handles are detected; the three closest with a website and a verified profile are selected and the set confirmed. Fewer than three: the set stays a draft.
7. `tracking`: skipped with a `connected_only` gap. Tracking takes a RivalIQ seat and a demo never consumes one; the set stays confirmed for the day the brand connects.
8. `run_social`: the social report starts (`run-report`) unless one completed in the last 7 days and `force_run` is false. It runs for every brand; without a Sprout profile it carries trends, recommendations, the calendar and the deck but no performance section, and the job says so in `gaps`. 9. `run_competitive`: skipped (`connected_only`); the competitive report is shown on the connected showcase workspace.
10. `wait_reports`: both rows are polled every two minutes; 100 minutes after start a report is recorded as timed out and folded in later when it lands.
11. `post`: the first calendar post of the social report (or an ad-hoc post from the pillars) is written, rendered with Gemini and stored; a post without an image is still returned, with the reason.
12. `analytics`: skipped for a prospect (no Sprout profile), with the gap saying where it is shown.
13. `collect`: the outputs below. 14. `callback`: signed POST to `callback_url` (one attempt per tick: at once, after 60 s, after 300 s), also after a fatal failure.

`GET /v1/demo-jobs/{id}` returns the job with its `steps[]`, `gaps[]` and, when finished, `outputs`: `client`, `competitors { set_status, selected[], unplaced[], tracked }`, `reports[]` (social and competitive with deck URLs and links), `social_report { period, counts, highlights, calendar_days, deck }`, `competitive_report { executive_summary, scorecard, gaps, deck, quality_check }`, `post`, `analytics` or null, `design { status, version, previews }`. A report that lands after the job closed is folded in on the next read. `POST .../cancel` stops a job; `POST .../discard` removes what a finished job created (the demo client when this job created it, otherwise only the rows flagged with the job; a later job that reused the client keeps it).

### Showing a demo to a prospect

A sales demo has two halves. The prospect half is this job, run on the prospect's own brand from public data. The connected half is Moburst's own workspace (Sprout profiles, monthly social and competitive reports, posts), where performance analytics, publishing and the competitive report are shown with real, current data that belongs to Moburst. Links in every response (`links.app`) use the Lovable origin unless the project sets `PUBLIC_APP_URL` to the tool's branded gOS host (`<tool_id>.moburst.ai`), which keeps gOS users on the branded URL. Inside the app, demo clients and everything they created are visible to admins only: the `moburst_user` and `client` roles never see a demo client, its competitor set, reports, posts or media (database policies, migration `20261006120000_demo_rows_admin_only.sql`). Moburst's own workspace is an ordinary client and stays visible as before. Sales shows the prospect half from the outputs this API returns (deck, calendar, post, brand identity) or with an admin at the keyboard.

The callback body is the job's `status`, `client_id`, `outputs`, `gaps`, `finished_at` and `links.self`, signed with HMAC-SHA256 over the raw body using the SHA-256 of the API key as the secret (`X-Demo-Signature: sha256=<hex>`).

## Known limits

- A brand not managed in Moburst's Sprout account gets a social report without a performance section, no performance analytics, no scheduled posting and no design references from its own posts; the demo says so in `gaps`. Its post comes from the report's calendar.
- Demos never start RivalIQ tracking or the competitive report (`connected_only`). RivalIQ's plan tracks a fixed number of distinct companies (40 on 2026-10-01, all in use); the seats stay with signed clients. `setup-rivaliq-landscape` has a `cleanup` mode that deletes a landscape a failed setup created and left empty.
- Social and competitive reports take 20 to 60 minutes each in n8n.

## Admin routes (scope `admin`, or a signed-in Socialytics admin)

`GET /v1/admin/keys`, `POST /v1/admin/keys` (`{ name, scopes, company_slugs?, client_ids?, rate_limit_per_minute?, expires_at?, note? }`; the answer carries `key` once), `DELETE /v1/admin/keys/{id}` (revoke).

## Operations

- Worker: the `api-demo-worker` cron calls `POST /internal/worker` every minute with the project's operational secret as `X-Cron-Secret`; a new job also kicks it at once.
- The project's own functions are driven as the project itself: the operational secret plus the user acted for (`x-socialytics-secret`, `x-socialytics-user`), which `requireStaff` accepts as a server caller.
- Audit rows are kept 180 days (`api-audit-purge`, 03:15 UTC).
- Smoke: `scripts/smoke-prod.sh` (set `SOCIALYTICS_API_TEST_KEY` for the keyed checks).
- Extending the API: `docs/api/EXTENDING.md`.
