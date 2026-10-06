# Moburst Tool APIs: Integration Guide (AdVisor and Socialytics)

REST integration. No SDK, no repository access required.

API contract version: 1 (paths start with `/v1`). Guide revised 2026-10-06.

For the gOS (moburst.ai) team and any other Moburst tool, agent or app that reads AdVisor or Socialytics data or runs a sales demo through them. Everything you need is in this document; the APIs also serve their own OpenAPI 3.1 documents.

## 1. Overview

AdVisor (competitive ad intelligence) and Socialytics (organic social intelligence) each expose one versioned HTTPS API. The two APIs share one shape: the same authentication, the same response envelopes, the same error codes, the same demo contract. Learn one, and the other differs only in base URL, key prefix and resource names.

The API does three things:

1. **Reads** everything the app shows for the clients a key may see (clients, reports, competitors, ads or posts, decks, health).
2. **Runs a sales demo**: `POST /v1/demo-jobs` takes any brand's name and website, onboards a demo copy of that brand and runs every feature that works from public data, then reports back through polling or a signed callback.
3. **Manages keys** (admins only).

Nothing in the API accepts a gOS user session. The credential is an API key held by the calling system. Who the end user is travels in the demo request as `requester`.

## 2. Where the APIs live

| | AdVisor | Socialytics |
|---|---|---|
| Base URL | `https://emyiuzsgvnnzgtqwmttb.supabase.co/functions/v1/api/v1` | `https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/v1` |
| Key prefix | `adv_` | `soc_` |
| OpenAPI 3.1 | `GET {base}/openapi.json` (no key needed) | same |
| Liveness | `GET {base}/health` (no key needed) | same |
| Typed client (TypeScript, plain `fetch`) | `api/client/advisor-api.ts` in the AdVisor repo | `api/client/socialytics-api.ts` in the Socialytics repo |
| Tool manifest (MCP style) | `api/mcp/advisor-tools.json` | `api/mcp/socialytics-tools.json` |

There is one environment per tool: the production project. There is no separate staging API.

## 3. What you need before you start

| Item | Who provides | Notes |
|---|---|---|
| One API key per tool | A tool admin, on the tool's Settings page ("API access" card) or through `POST /v1/admin/keys` | Shown once at creation; only its SHA-256 is stored. Store it as a secret in your system. Keys can be revoked at any time. |
| Scopes on the key | Chosen at creation | `read` for every GET, `demo` for demo jobs, `admin` for key management. A gOS demo key needs `read` and `demo`. |
| Reach of the key | Chosen at creation | `company_slugs` (gOS canonical slugs; the key sees those companies and their demo copies) or `client_ids`. A key with neither sees every client. Anything outside the reach answers `404`. |
| Rate limit | Chosen at creation, default 120 requests per minute | Over the limit the API answers `429` with `Retry-After`. |
| A callback endpoint (optional) | You | An HTTPS URL that accepts a POST; see section 7. Without one, poll the job. |

No shared secret other than the key is involved. Every request is recorded (key id, route, status, duration; never the body or the key).

## 4. How every call works

**Authentication.** Send the key on every resource route:

```
Authorization: Bearer adv_...
```

`X-Api-Key: adv_...` is accepted too.

**Envelopes.**

- A list: `{ "data": [ ... ], "next_cursor": "..." | null }`. Pass `next_cursor` back as `cursor`. `limit` is 50 by default and 200 at most. Lists come newest first.
- A single object: `{ "data": { ... } }`.
- An error: `{ "error": { "code": "not_found", "message": "Run not found", "details": { ... } } }` (`details` only when there is something to say).

**Error codes.**

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `invalid_request` | A field is missing or malformed; the message names it. |
| 401 | `unauthorized` | No key, an unknown key, a revoked or expired key. |
| 403 | `forbidden` | The key lacks the scope the route needs. |
| 404 | `not_found` | No such row, or a row outside the key's reach (the two are not distinguished). |
| 405 | `method_not_allowed` | Wrong method on a known path. |
| 409 | `conflict` | The action does not fit the current state (for example cancelling a finished job). |
| 409 | `job_running` | A discard was asked for a job that is still running. |
| 422 | `unprocessable` | The request is valid but the data cannot serve it; `details.reason` says why (for example `no_sprout_profiles`). |
| 429 | `rate_limited` | Over the key's per-minute limit; honour `Retry-After`. |
| 429 | `demo_capacity` | Three demo jobs are already running on this tool; retry later. |
| 502 | `upstream_failed` | A service the API depends on did not answer. |
| 500 | `internal` | Unexpected; `X-Request-Id` identifies the request for support. |

**Headers on every answer:** `X-Api-Version: 1` and `X-Request-Id`.

**Conventions.** Timestamps are ISO 8601 UTC. Report periods are `yyyy-mm-dd` dates. AdVisor's Competitive Signal is 0 to 10, percentiles 0 to 1, engagement 0 to 10.

**Confidentiality, by construction.** Responses never carry Sprout customer or profile ids, RivalIQ landscape or company ids, media provider request ids, the names of the Snowflake advertisers behind AdVisor's benchmarks, app settings, integration tokens or key hashes. A contract test fails the build if any of these names appears in a documented response.

**Change policy.** Changes are additive within `/v1`: new routes, new fields, new gap codes and new step outcomes may appear; existing fields keep their meaning. Read the OpenAPI document for the current shapes rather than hardcoding them.

## 5. Reading data (scope `read`)

### AdVisor

| Route | What it returns |
|---|---|
| `GET /clients?q=&company_slug=` | Clients with brief, sources, readiness (`setup`), counts, last run, links. |
| `GET /clients/{id}` | One client with `competitors[]` and `schedules[]`. |
| `GET /clients/{id}/setup` | `{ ready, issues[] }`: what still stands between the client and a report that comes out right. |
| `GET /clients/{id}/context` | The agent package: brain, own ads, competitor ads with reads, aggregates. |
| `GET /clients/{id}/analytics?days=90` | Ad counts, Signal average and bands, confidence, per-competitor summaries, pattern counts, vertical evidence. |
| `GET /competitors?client_id=` | Competitors with Meta page and Google source status. |
| `GET /runs?client_id=&status=&report_type=&from=&to=` | Reports: counts, coverage per competitor, brief and deck status, links. |
| `GET /runs/{id}`, `/runs/{id}/ads`, `/runs/{id}/brief`, `/runs/{id}/deck` | One report, its ads (best Signal first), its strategic brief, its deck `{ status, url, started_at }`. |
| `GET /ads?client_id=&run_id=&competitor=&platform=&creative_type=&min_signal=&from=&to=`, `GET /ads/{id}` | Ads across reports, each with `signal`, the stored `competitive_read` and, for videos, `engagement`. |
| `GET /briefs?client_id=` | Strategic briefs, newest first. |
| `GET /schedules?client_id=` | Report schedules. |
| `GET /ad-tests?client_id=`, `GET /ad-tests/{id}` | Test an Ad results: prediction, Signal, engagement. |
| `GET /benchmarks?tag=` | Industry aggregates for a canonical tag: medians and quartiles, pattern summary, evidence. Never an advertiser. |
| `GET /status` | Pipeline health findings and demo job counts. |

### Socialytics

| Route | What it returns |
|---|---|
| `GET /clients?q=&company_slug=&include_archived=` | Clients with platforms, pillars, keywords, brand identity, design state, Sprout and competitor summaries, counts, last report, readiness (`setup`), links. |
| `GET /clients/{id}` | One client, plus `sprout_profiles[]` (names and networks), `competitor_sets[]` with handles, `schedules[]`. |
| `GET /clients/{id}/setup` | `{ ready, issues[] }`. |
| `GET /clients/{id}/analytics?start=&end=` | Sprout performance over a window (default the last 30 days). `422 unprocessable` with `reason: no_sprout_profiles` for a brand not managed in Sprout. |
| `GET /reports?client_id=&status=&from=&to=`, `GET /reports/{id}` | Social reports; the detail adds `analysis`, `calendar`, `performance` and `trends`. |
| `GET /competitive-reports?client_id=&status=`, `GET /competitive-reports/{id}` | Competitive reports; the detail adds `analysis` and per-company `aggregates`. |
| `GET /competitor-sets?client_id=&status=`, `GET /competitor-sets/{id}` | Competitor sets with competitors and their social handles. |
| `GET /posts?client_id=&report_id=&source=&approved=&include_archived=`, `GET /posts/{id}` | Generated posts: platform, format, copy, hashtags, CTA, visual direction, media URLs, approval state. |
| `GET /media-jobs?client_id=&status=` | Media generation jobs: kind, provider, status, output, review. |
| `GET /schedules?client_id=` | Report schedules. |
| `GET /scheduled-posts?client_id=&status=` | Posts scheduled to Sprout Social. |
| `GET /alerts?client_id=&status=` | Competitive alerts. |
| `GET /design-systems?client_id=` | Design systems: version, status, templates, tokens, preview URLs. |
| `GET /status` | Health: reports running past 90 minutes, failed schedules, failed media, demo jobs stuck or failed, schema drift. |

## 6. Running a sales demo (scope `demo`)

### How a demo is meant to be shown

A sales demo has two halves.

- **The prospect half** is this job, run on the prospect's own brand from public data. It never reads, reuses or writes a production client, even one with the same website or name: it works on a demo copy of the brand whose `company_slug` is `demo-<brand>`, created on the first run and reused on the next.
- **The connected half** is Moburst's own Socialytics workspace (an ordinary client, `company_slug` `moburst`, with Sprout profiles and monthly social and competitive reports). The parts of Socialytics that need the brand's own connections (RivalIQ tracking and the competitive report, Sprout performance analytics, publishing) are not run for a prospect; the job records them as `connected_only` gaps and they are shown on that workspace, through the read routes or in the app.

AdVisor's inputs (the Meta Ad Library and Google Ads Transparency) are public, so every AdVisor feature runs for any brand.

### Start a demo

`POST /demo-jobs`

```json
{
  "client_name": "Brooklinen",
  "website": "brooklinen.com",
  "competitors": [{ "name": "Parachute", "website": "parachutehome.com" }],
  "industry": "Shopping",
  "regions": ["US"],
  "requester": { "id": "gos-42", "email": "someone@moburst.com", "name": "Someone" },
  "idempotency_key": "gos-demo-2026-10-06-brooklinen",
  "callback_url": "https://moburst.ai/api/hooks/advisor-demo",
  "force_run": false
}
```

| Field | Required | Meaning |
|---|---|---|
| `client_name` | yes | The brand's name as it should appear. |
| `website` | yes | Domain or URL; the host is kept. |
| `competitors[]` | no | Up to 12 named competitors (`name`, optional `website`). Without it the brand's competitors are proposed: AdVisor places the three closest, Socialytics selects the three closest with a website and a verified social profile. A named list may go further (AdVisor places up to eight). |
| `industry` | no | AdVisor only: a canonical industry tag; otherwise one is assigned from the website. Socialytics accepts and ignores it. |
| `regions[]` | no | AdVisor only: ad regions, default `["US"]`. |
| `requester` | no | The gOS user behind the request (`id`, `email`, `name`). The email picks the tool user the job acts for; the whole object is stored with the job. |
| `idempotency_key` | no | The same key on the same API key returns the same job (`200` instead of `202`). Use one per demo attempt, for example `gos-demo-<date>-<brand>`. |
| `callback_url` | no | Where to POST the result (section 7). |
| `force_run` | no | Run the reports again even when a completed one is under 7 days old. |

The answer is `202` with the job object. At most three demo jobs run at once per tool; a fourth gets `429 demo_capacity`.

### Follow the job

`GET /demo-jobs/{id}` returns the job:

| Field | Meaning |
|---|---|
| `status` | `queued`, `running`, `completed` (every step done or skipped on purpose), `partial` (some step failed; outputs are still returned), `failed` (a fatal step, for example the key may not touch this brand), `cancelled`. |
| `steps[]` | Each with `name`, `status` (`pending`, `running`, `done`, `skipped`, `failed`), `outcome` or `reason`, a plain `message`, timestamps and a `data` block. |
| `gaps[]` | What the demo could not do and why, each `{ step, code, message }`, written for a reader. |
| `outputs` | What to show (below); present once the job finishes, and refreshed on read when a report lands later. |
| `callback_status` | Attempts, delivery, last HTTP status and error. |
| `client_id`, `run_ids`, `created_at`, `started_at`, `completed_at`, `links.self` | Bookkeeping. |

`GET /demo-jobs?client_id=&status=` lists jobs. `POST /demo-jobs/{id}/cancel` stops a queued or running job. `POST /demo-jobs/{id}/discard` removes what a finished job created (the demo client when this job created it, otherwise only the rows this job flagged).

**Steps, in order.**

| AdVisor | Socialytics |
|---|---|
| `resolve_client` (the demo copy, reused or created) | `resolve_client` |
| `client_sources` (Google source from the domain, Meta page when unambiguous) | `brand_identity` (colours, font, tone, logo from the website) |
| `brief` (drafted from the website; bot-blocking sites are read through a residential crawl, then a real browser) | `site_brief` (the homepage's main text) |
| `industry` (from the request, else assigned; the closest existing tag when none fits exactly) | `pillars` (content pillars and keywords) |
| `competitors` (named or proposed, each placed by Meta page or reachable website) | `design` (a design system when at least three brand references exist; otherwise a gap) |
| `readiness` (every setup issue as a gap) | `competitors` (named or proposed; handles detected; the set confirmed) |
| `run_competitor`, `run_self_audit` (the two scraper runs; the self-audit only when the brand has its own sources) | `tracking`: skipped, `connected_only` |
| `wait_runs` (up to 180 minutes) | `run_social` (the social report, unless a fresh one exists) |
| `wait_outputs` (brief and deck, up to 25 minutes) | `run_competitive`: skipped, `connected_only` |
| `test_ad` (a text-only Test an Ad on copy from the site) | `wait_reports` (up to 100 minutes) |
| `collect` | `post` (the first calendar post, rendered as an image) |
| `callback` | `analytics`: skipped for a prospect (no Sprout profile) |
| | `collect`, `callback` |

**Typical duration.** Socialytics: about 15 minutes for a new brand; about 3 minutes for a repeat demo of the same brand within 7 days (the report is reused). AdVisor: 25 to 60 minutes, driven by the ad scrapes.

**Outputs.**

| AdVisor `outputs` | Socialytics `outputs` |
|---|---|
| `client` (`id`, `name`, `company_slug`, `website`, `industry_tags`, `app_link`, `api_link`) | `client` (`id`, `name`, `company_slug`, `website`, `pillars`, `keywords`, `brand_identity`, links) |
| `competitors { placed[], unplaced[], tracked[] }` | `competitors { set_status, selected[], unplaced[], tracked }` |
| `runs[]` with status, counts and links; `brief`; `deck { status, url }` | `reports[]`; `social_report { period, counts, highlights, calendar_days, deck }`; `competitive_report` (null for a prospect) |
| `top_ads[]` (best 10 by Signal, with reads); `engagement_highlights[]` | `post { platform, source, copy, hashtags, cta, media_urls[] }` |
| `ad_test` (prediction and Signal) | `analytics` (null for a prospect); `design { status, version, previews[] }` |
| `analytics` (the last 90 days); `gaps[]` | `gaps[]` |

**Gap codes you will meet.** AdVisor: `client_meta_unplaced` (the brand's own Meta page could not be placed), `competitor_meta_missing`, `brief_missing`, `industry_missing`, `competitor_unplaced`, `no_competitors`, `run_error`, `run_timeout`. Socialytics: `connected_only` (tracking and the competitive report wait for the brand's connection), `performance_data_unavailable` and `analytics_unavailable` (no Sprout profile), `design_system_missing` (no brand references), `competitor_unplaced`, `competitors_unconfirmed`, `no_competitors`, `post_image_missing`, `report_timeout`. A gap is information for the person showing the demo, not a failure of the job.

### What to render for a rep

Everything a rep needs is in `outputs`: the deck URL, the brief or calendar, the top ads or the generated post with its image, the competitor list, and the gaps in plain words. Links in `links.app` and `app_link` point at the tool's web app; they open only for tool admins (section 8).

## 7. Receiving the callback

When `callback_url` is set, the job POSTs once it finishes, including partial completion and failure:

```json
{
  "job_id": "7031ae2e-...",
  "tool": "advisor",
  "status": "completed",
  "client_id": "9e5ea381-...",
  "outputs": { ... },
  "gaps": [ ... ],
  "finished_at": "2026-10-06T10:32:10.331Z",
  "links": { "self": "/v1/demo-jobs/7031ae2e-..." }
}
```

**Signature.** Every callback carries `X-Demo-Signature: sha256=<hex>`: an HMAC-SHA256 over the raw request body. The HMAC key is the UTF-8 bytes of the SHA-256 hex digest of the API key that started the job, so the receiver can verify with the key it already holds and nothing else:

```
secret   = sha256_hex(api_key)                  # 64 lowercase hex characters, as text
expected = "sha256=" + hmac_sha256_hex(secret, raw_body)
ok       = constant_time_equal(header("X-Demo-Signature"), expected)
```

**Retries.** Three attempts: at once, after 60 seconds, after 5 minutes. Answer `2xx` quickly and process asynchronously; treat the same `job_id` arriving twice as the same event. The outcome of every attempt is on the job's `callback_status`.

## 8. Identity, roles and visibility

**The requester.** The API does not see gOS sessions. Put the gOS user in `requester` (`id`, `email`, `name`); the job acts inside the tool for the tool user with that email (or for the tool's most active user when none matches) and the whole object is kept on the job for audit.

**How gOS roles land in the tools.** Through the tools' gOS auth bridges, `super_admin`, `admin` and `account_manager` become tool admins; `user` or `staff` without a company assignment becomes `moburst_user`; `user` with companies, `client` and `viewer` become `client`, scoped by `allowed_company_slugs`.

**Who sees demos inside the apps.** Demo clients and every row a demo created are visible to tool admins only. The `moburst_user` and `client` roles never see a demo client, its runs, competitors, ads, reports, posts or media; this is enforced by database policies, so no screen can show them. A rep who is not an admin therefore sees a demo through what your system renders from `outputs`, or with an admin at the keyboard.

**Companies.** Demo slugs (`demo-<brand>`) exist only in the tools; nothing has to be added to the gOS company catalog, and no portal grant can expose a demo to a client. A key scoped to `bader-law` reaches `demo-bader-law` as well.

**Branded links.** Each tool emits `links.app` with its Lovable origin unless its project sets `PUBLIC_APP_URL` to the branded gOS host (`<tool_id>.moburst.ai`). Ask a tool admin to set it so links keep gOS users on the branded URL.

## 9. Verify your integration

```
# 1. Liveness and the OpenAPI document (no key)
curl -s https://emyiuzsgvnnzgtqwmttb.supabase.co/functions/v1/api/v1/health
curl -s https://emyiuzsgvnnzgtqwmttb.supabase.co/functions/v1/api/v1/openapi.json | head -c 300

# 2. Without a key the API refuses (401)
curl -s -o /dev/null -w "%{http_code}\n" https://emyiuzsgvnnzgtqwmttb.supabase.co/functions/v1/api/v1/clients

# 3. With your key: one client, and the health findings
curl -s -H "Authorization: Bearer $ADVISOR_KEY" "https://emyiuzsgvnnzgtqwmttb.supabase.co/functions/v1/api/v1/clients?limit=1"
curl -s -H "Authorization: Bearer $ADVISOR_KEY" https://emyiuzsgvnnzgtqwmttb.supabase.co/functions/v1/api/v1/status

# 4. A demo (202), then its progress
curl -s -X POST -H "Authorization: Bearer $ADVISOR_KEY" -H "Content-Type: application/json" \
  -d '{"client_name":"Allbirds","website":"allbirds.com","requester":{"email":"you@moburst.com"},"idempotency_key":"test-1"}' \
  https://emyiuzsgvnnzgtqwmttb.supabase.co/functions/v1/api/v1/demo-jobs
curl -s -H "Authorization: Bearer $ADVISOR_KEY" https://emyiuzsgvnnzgtqwmttb.supabase.co/functions/v1/api/v1/demo-jobs/<job_id>
```

End-to-end checklist:

- A key with `read` and `demo` exists for each tool and is stored as a secret in your system.
- `GET /health` answers `200` and `GET /clients` without a key answers `401`.
- A demo on a brand you choose reaches `completed` or `partial` and its `outputs` render in your screen, including the gaps.
- Your callback endpoint answers `2xx` and verifies `X-Demo-Signature`.
- The same `idempotency_key` sent twice returns the same job.
- A non-admin gOS user opening the tool does not see the demo client; an admin does.

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 unauthorized` with a key | Revoked, expired, or sent to the other tool (`adv_` key on the Socialytics base URL) | Check the prefix against the base URL; ask an admin for a new key. |
| `403 forbidden` on `/demo-jobs` | The key has `read` only | Create a key with the `demo` scope. |
| `404 not_found` on a client you know exists | Outside the key's reach | Widen the key's `company_slugs`, or use an unscoped key. |
| `429 demo_capacity` | Three demos already running on that tool | Queue on your side and retry in a few minutes. |
| `429 rate_limited` | Over the per-minute limit | Honour `Retry-After`; ask for a higher limit on the key if needed. |
| Job stays `running` for a long time | AdVisor ad scrapes can take up to 60 minutes; a scraper crash is only detected at the 180-minute timeout | Poll every 1 to 2 minutes or rely on the callback; show the completed steps meanwhile. |
| `partial` with `connected_only` gaps (Socialytics) | Expected for a prospect | Show tracking, the competitive report and analytics on Moburst's own workspace. |
| `brief_missing` or `client_meta_unplaced` (AdVisor) | The site blocks every reader, or the brand's Meta page could not be found | The demo continues; say so when showing it, or pass the Meta page by onboarding the brand properly later. |
| Callback never arrives | Endpoint unreachable or not `2xx` | Check `callback_status` on the job; the API tried three times. |
| Links open the Lovable address | `PUBLIC_APP_URL` not set in the tool's project | Ask a tool admin to set it to the branded host. |

## 11. Reference

- OpenAPI documents: `GET {base}/openapi.json` on each tool.
- Repo documents: `docs/api/ADVISOR-API.md` and `docs/api/SOCIALYTICS-API.md` (the full route and field notes), `docs/api/EXTENDING.md` (how the shared core is extended).
- Typed clients and tool manifests: section 2.
- Key management: `POST /v1/admin/keys` `{ name, scopes, company_slugs?, client_ids?, rate_limit_per_minute?, expires_at?, note? }` answers `201` with the key once; `GET /v1/admin/keys` lists keys without secrets; `DELETE /v1/admin/keys/{id}` revokes. Accepted callers: a signed-in tool admin, a key with the `admin` scope, or the platform's internal secret.
