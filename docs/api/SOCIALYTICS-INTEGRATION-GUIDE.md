# Socialytics API: Integration Guide for gOS

REST integration. No SDK, no repository access required.

API contract version: 1 (paths start with `/v1`). Guide revised 2026-10-06. AdVisor has its own guide with the same shape.

For the gOS (moburst.ai) team building the Socialytics demo screen, and for any other Moburst tool, agent or app that reads Socialytics data. Everything you need is in this document; the API also serves its own OpenAPI 3.1 document.

## 1. Overview

Socialytics is Moburst's organic social intelligence tool: it researches a brand's identity and content pillars, follows the trends in its space, writes a monthly social report with recommendations, a content calendar and a deck, generates posts with images, tracks competitors and compares them in a competitive report, and reads the brand's own performance from Sprout Social.

Its API does three things:

1. **Reads** everything the app shows for the clients a key may see: clients, social and competitive reports, competitor sets, posts and media, schedules, alerts, design systems, Sprout analytics, health.
2. **Runs a sales demo**: `POST /v1/demo-jobs` takes any brand's name and website, onboards a demo copy of that brand and runs every feature that works from public data, then reports back through polling or a signed callback.
3. **Manages keys** (tool admins only).

The API never accepts a gOS user session. The credential is an API key held by gOS. Who the end user is travels in the demo request as `requester`.

**Five facts that shape the gOS screen**

- A demo is **asynchronous**: 10 to 35 minutes for a new brand (the monthly report workflow sets the pace), about 3 minutes for a repeat of the same brand within 7 days. Your screen needs a progress state (poll every minute, or receive the callback) and should show the finished steps while the rest run.
- **Render the outputs yourself.** The job's `outputs` carry everything a rep shows: the brand identity, the brief and pillars, the deck URL, the calendar, the generated post with its image, the competitor set and the gaps in plain words.
- **A demo has two halves.** The prospect half is this job, on the prospect's own brand from public data. The parts of Socialytics that need the brand's own connections, which are competitor tracking and the competitive report (RivalIQ) and performance analytics and publishing (Sprout), are deliberately **not run for a prospect**: the job records them as `connected_only` gaps. They are shown on the connected half, Moburst's own Socialytics workspace (`company_slug` `moburst`, 3 Sprout profiles, monthly social and competitive reports), through the read routes or in the app.
- **Only tool admins can open a demo inside Socialytics.** Through the gOS auth bridge, `super_admin`, `admin` and `account_manager` become tool admins; every other gOS role never sees a demo client or anything it created. Links into the app are for admins; everyone else sees what your screen renders.
- **A demo never touches a production client.** It works on a demo copy of the brand (`company_slug` `demo-<brand>`), created on the first run and reused on the next.

## 2. Where the API lives

| | |
|---|---|
| Base URL | `https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/v1` |
| Key prefix | `soc_` |
| OpenAPI 3.1 | `GET {base}/openapi.json` (no key needed) |
| Liveness | `GET {base}/health` (no key needed) |
| Typed client (TypeScript, plain `fetch`) | `api/client/socialytics-api.ts` in the Socialytics repo |
| Tool manifest (MCP style) | `api/mcp/socialytics-tools.json` |

There is one environment: the production project. There is no separate staging API.

## 3. What you need before you start

Three things come from outside this document. Ask the Socialytics admin (Lital) for the first two.

| Item | Who provides | Notes |
|---|---|---|
| **An API key** with the `read` and `demo` scopes | The Socialytics admin, on the tool's Settings page ("API access" card) | The key is shown once at creation and handed over through a secure channel, never in a document or an email. Only its SHA-256 is stored in Socialytics. Store it as a secret in gOS. It can be revoked at any time. |
| **`PUBLIC_APP_URL` set to Socialytics' branded gOS host** (`<tool_id>.moburst.ai`) | The Socialytics admin, in the Lovable project's settings; you supply the registered tool id | Until it is set, `links.app` in every response points at the Lovable address and a gOS user following one leaves the branded URL. |
| **A callback endpoint** (optional) | You | An HTTPS URL that accepts a POST; see section 7. Without one, poll the job. |

Nothing else is needed: no shared secret, no gOS token, no allowlisting.

A key also carries a **reach** and a **rate limit**, chosen by the admin at creation: `company_slugs` (gOS canonical slugs; the key sees those companies and their demo copies) or `client_ids`, or neither to see every client; and a per-minute limit, default 120, answered with `429` and `Retry-After` when exceeded. A gOS demo key normally has no reach restriction, so it can also read Moburst's own workspace for the connected half. Every request is recorded (key id, route, status, duration; never the body or the key).

## 4. How every call works

**Authentication.** Send the key on every resource route:

```
Authorization: Bearer soc_...
```

`X-Api-Key: soc_...` is accepted too.

**Envelopes.**

- A list: `{ "data": [ ... ], "next_cursor": "..." | null }`. Pass `next_cursor` back as `cursor`. `limit` is 50 by default and 200 at most. Lists come newest first.
- A single object: `{ "data": { ... } }`.
- An error: `{ "error": { "code": "not_found", "message": "Report not found", "details": { ... } } }` (`details` only when there is something to say).

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
| 422 | `unprocessable` | The request is valid but the data cannot serve it; `details.reason` says why (for example `no_sprout_profiles` on analytics for a brand not managed in Sprout). |
| 429 | `rate_limited` | Over the key's per-minute limit; honour `Retry-After`. |
| 429 | `demo_capacity` | Three demo jobs are already running; retry later. |
| 502 | `upstream_failed` | A service the API depends on did not answer. |
| 500 | `internal` | Unexpected; `X-Request-Id` identifies the request for support. |

**Headers on every answer:** `X-Api-Version: 1` and `X-Request-Id`.

**Conventions.** Timestamps are ISO 8601 UTC; report periods are `yyyy-mm-dd` dates.

**Confidentiality, by construction.** Responses never carry Sprout customer or profile ids, RivalIQ landscape or company ids, media provider request ids or model paths, app settings, integration tokens or key hashes. A contract test fails the build if any of these appears in a documented response.

**Change policy.** Changes are additive within `/v1`: new routes, new fields, new gap codes and new step outcomes may appear; existing fields keep their meaning. Read the OpenAPI document for the current shapes rather than hardcoding them.

## 5. Reading data (scope `read`)

| Route | What it returns |
|---|---|
| `GET /clients?q=&company_slug=&include_archived=` | Clients with platforms, pillars, keywords, brand identity, design state, Sprout and competitor summaries, counts, last report, readiness (`setup`), links. |
| `GET /clients/{id}` | One client, plus `sprout_profiles[]` (names and networks), `competitor_sets[]` with handles, `schedules[]`. |
| `GET /clients/{id}/setup` | `{ ready, issues[] }`: brand identity, pillars, keywords, Sprout profile, confirmed competitor set, approved design system, schedule. |
| `GET /clients/{id}/analytics?start=&end=` | Sprout performance over a window (default the last 30 days): totals, the previous window, changes, per profile, top posts. `422 unprocessable` with `reason: no_sprout_profiles` for a brand not managed in Sprout. |
| `GET /reports?client_id=&status=&from=&to=` | Social reports: period, previous period, status, deck, counts, metric changes, warnings, trend status, links. |
| `GET /reports/{id}` | One social report, plus `analysis`, `calendar` (the content calendar), `performance` and `trends` summaries. |
| `GET /competitive-reports?client_id=&status=` | Competitive reports: period, status, deck, totals, quality check. |
| `GET /competitive-reports/{id}` | One competitive report, plus `analysis` (executive summary, scorecard, gaps, teardown, breakdowns, schedule) and `aggregates` per company. |
| `GET /competitor-sets?client_id=&status=`, `GET /competitor-sets/{id}` | Competitor sets with competitors (website, rationale, similarity, selection, rank) and their social handles (platform, handle, URL, confidence, source). |
| `GET /posts?client_id=&report_id=&source=&approved=&include_archived=`, `GET /posts/{id}` | Generated posts: platform, format, copy, hashtags, CTA, concept, visual direction, media URLs, variant, approval state, finishing. |
| `GET /media-jobs?client_id=&status=` | Media generation jobs: kind, provider, status, output, review. |
| `GET /schedules?client_id=` | Report schedules: kind, frequency, day of month, range mode, next and last run, last result. |
| `GET /scheduled-posts?client_id=&status=` | Posts scheduled to Sprout Social. |
| `GET /alerts?client_id=&status=` | Competitive alerts: topic, summary, companies, platforms, post URLs, window. |
| `GET /design-systems?client_id=` | Design systems: version, status, templates, tokens (font family, colours), preview URLs. |
| `GET /status` | Health: reports running past 90 minutes, schedules whose last run failed, media failed in 24 hours, demo jobs stuck or failed, schema drift. |

**The connected half, through these routes.** For the features a prospect demo does not run, read Moburst's own workspace: `GET /clients?company_slug=moburst` gives its id; then `GET /clients/{id}/analytics` (3 Sprout profiles, 30 days), `GET /reports?client_id=` (monthly social reports with decks) and `GET /competitive-reports?client_id=` (competitive reports with decks). The data is real and current, and it belongs to Moburst, so it can be shown to anyone.

## 6. Running a sales demo (scope `demo`)

### Start a demo

`POST /demo-jobs`

```json
{
  "client_name": "Brooklinen",
  "website": "brooklinen.com",
  "competitors": [{ "name": "Parachute", "website": "parachutehome.com" }],
  "requester": { "id": "gos-42", "email": "someone@moburst.com", "name": "Someone" },
  "idempotency_key": "gos-demo-2026-10-06-brooklinen",
  "callback_url": "https://moburst.ai/api/hooks/socialytics-demo",
  "force_run": false
}
```

| Field | Required | Meaning |
|---|---|---|
| `client_name` | yes | The brand's name as it should appear. |
| `website` | yes | Domain or URL; the host is kept. |
| `competitors[]` | no | Up to 12 named competitors (`name`, optional `website`). Without it, 8 to 12 competitors are proposed from the brand; either way, social handles are detected and the three closest with a website and a verified profile are selected and the set confirmed. |
| `requester` | no | The gOS user behind the request (`id`, `email`, `name`). The email picks the Socialytics user the job acts for; the whole object is stored with the job for audit. |
| `idempotency_key` | no | The same key on the same API key returns the same job (`200` instead of `202`). Use one per demo attempt, for example `gos-demo-<date>-<brand>`. |
| `callback_url` | no | Where to POST the result (section 7). |
| `force_run` | no | Run the social report again even when a completed one is under 7 days old. |

`industry` and `regions` are accepted for parity with AdVisor and ignored.

The answer is `202` with the job object. At most three demo jobs run at once; a fourth gets `429 demo_capacity`, so queue on your side and retry in a few minutes.

### Follow the job

`GET /demo-jobs/{id}` returns the job:

| Field | Meaning |
|---|---|
| `status` | `queued`, `running`, `completed` (every step done or skipped on purpose), `partial` (a step failed; outputs are still returned), `failed` (a fatal step, for example the key may not touch this brand), `cancelled`. |
| `steps[]` | Each with `name`, `status` (`pending`, `running`, `done`, `skipped`, `failed`), `outcome` or `reason`, a plain `message`, timestamps and a `data` block. Show them as the progress state. |
| `gaps[]` | What the demo could not do and why, each `{ step, code, message }`, written for a reader. |
| `outputs` | What to show (below); present once the job finishes, and refreshed on read when a report lands later. |
| `callback_status` | Attempts, delivery, last HTTP status and error. |
| `client_id`, `run_ids`, `created_at`, `started_at`, `completed_at`, `links.self` | Bookkeeping. |

`GET /demo-jobs?client_id=&status=` lists jobs. `POST /demo-jobs/{id}/cancel` stops a queued or running job. `POST /demo-jobs/{id}/discard` removes what a finished job created (the demo client when this job created it, otherwise only the rows this job flagged).

**Steps, in order.**

| Step | What happens |
|---|---|
| `resolve_client` | The demo copy of the brand, reused or created (`demo-<brand>`). |
| `brand_identity` | Colours, font, tone and logo description from the website, written only where empty. |
| `site_brief` | The homepage's main text becomes the brief when the brand has none. |
| `pillars` | Content pillars and social keywords derived from the evidence on file. |
| `design` | A design system is built and approved when at least three brand references exist; otherwise a gap says designs use the brand colours and fonts. |
| `competitors` | Named or proposed competitors; handles detected; the three closest selected and the set confirmed. Fewer than three: the set stays a draft. |
| `tracking` | **Skipped, `connected_only`.** Tracking takes a RivalIQ seat; the set stays confirmed for the day the brand connects. |
| `run_social` | The social report starts, unless a completed one is under 7 days old and `force_run` is false. Without a Sprout profile it carries trends, recommendations, the calendar and the deck but no performance section (`performance_data_unavailable`). |
| `run_competitive` | **Skipped, `connected_only`.** Shown on Moburst's workspace. |
| `wait_reports` | The report is polled every two minutes, up to 100 minutes. |
| `post` | The first calendar post is written, rendered as an image and stored; a post without an image is still returned, with the reason. |
| `analytics` | **Skipped for a prospect** (no Sprout profile, `analytics_unavailable`). Shown on Moburst's workspace. |
| `collect`, `callback` | The outputs below; the signed POST to `callback_url`. |

**Duration.** 10 to 35 minutes for a new brand; the social report is almost all of it (recent reports took 10 to 32 minutes). About 3 minutes for a repeat demo of the same brand within 7 days: brand, brief, pillars and the report are reused, competitors and a fresh post still run.

### Outputs

| Block | Content |
|---|---|
| `client` | `id`, `name`, `company_slug` (`demo-<brand>`), `website`, `brand_identity` (colours, font, tone, logo description), `pillars[]`, `keywords[]`, `app_link`, `api_link` |
| `competitors` | `set_status`, `selected[]` (name, website, handles), `unplaced[]` (name, reason), `tracked` (always `false` for a prospect) |
| `reports[]` | The social report with links (`kind: social`) |
| `social_report` | `id`, `status`, `period`, `counts` (trends, recommendations, calendar days), `highlights[]`, `calendar_days`, `deck { url, status }`, links |
| `competitive_report` | `null` for a prospect; read Moburst's through the read routes |
| `post` | `platform`, `source` (`calendar` or `ad_hoc`), `copy`, `hashtags[]`, `cta`, `concept`, `visual_direction`, `media_urls[]`, links |
| `analytics` | `null` for a prospect |
| `design` | `{ status, version, previews[] }`; `status: none` when the brand had no references |
| `gaps[]` | Everything the demo could not do, in plain words |

**Gap codes you will meet.** `connected_only` (tracking and the competitive report start when the brand connects; shown on Moburst's workspace), `performance_data_unavailable` and `analytics_unavailable` (no Sprout profile), `design_system_missing` (no brand references), `competitor_unplaced` and `competitors_unconfirmed` (fewer than three verified competitors), `no_competitors`, `post_image_missing` (the copy is there, the image failed, with the reason), `report_timeout` (the report did not finish within 100 minutes; it is folded in on a later read). A gap is information for the person showing the demo, not a failure of the job.

### What to render for a rep

Show the brand identity (colours, font, tone), the pillars, the deck link, the calendar days and highlights, the generated post with its image, the competitor set, and the gaps as plain sentences; then switch to Moburst's workspace for performance analytics, the competitive report and publishing. Links in `app_link` and `links.app` open Socialytics itself and work only for gOS admins and account managers (section 8); do not rely on them for other users. `outputs.client.app_link` opens the brand's Reports page, where the demo's report and deck are; `social_report.app_link` opens the report itself. The brand's Setup page (`/clients/{id}/setup`) is the team's configuration screen: for every demo brand it shows a notice that no social accounts are assigned, which is the expected state, not a failure.

## 7. Receiving the callback

When `callback_url` is set, the job POSTs once it finishes, including partial completion and failure:

```json
{
  "job_id": "72b60732-...",
  "tool": "socialytics",
  "status": "completed",
  "client_id": "4dbb0ffb-...",
  "outputs": { ... },
  "gaps": [ ... ],
  "finished_at": "2026-10-06T10:04:23.583Z",
  "links": { "self": "/v1/demo-jobs/72b60732-..." }
}
```

**Signature.** Every callback carries `X-Demo-Signature: sha256=<hex>`: an HMAC-SHA256 over the raw request body. The HMAC key is the UTF-8 bytes of the SHA-256 hex digest of the API key that started the job, so the receiver verifies with the key it already holds and nothing else:

```
secret   = sha256_hex(api_key)                  # 64 lowercase hex characters, as text
expected = "sha256=" + hmac_sha256_hex(secret, raw_body)
ok       = constant_time_equal(header("X-Demo-Signature"), expected)
```

**Retries.** Three attempts: at once, after 60 seconds, after 5 minutes. Answer `2xx` quickly and process asynchronously; treat the same `job_id` arriving twice as the same event. The outcome of every attempt is on the job's `callback_status`.

## 8. Identity, roles and visibility

**The requester.** The API does not see gOS sessions. Put the gOS user in `requester` (`id`, `email`, `name`); the job acts inside Socialytics for the user with that email (or for the tool's most active user when none matches) and keeps the whole object on the job.

**How gOS roles land in Socialytics.** Through the gOS auth bridge, `super_admin`, `admin` and `account_manager` become Socialytics admins; `user` or `staff` without a company assignment becomes `moburst_user`; `user` with companies, `client` and `viewer` become `client`, scoped by `allowed_company_slugs`.

**Who sees demos inside Socialytics.** Demo clients and every row a demo created (competitor sets, reports, posts, media, design systems) are visible to Socialytics admins only. The `moburst_user` and `client` roles never see them; this is enforced by database policies, so no screen can show them. Moburst's own workspace is an ordinary client and stays visible to internal users as before.

**Companies.** Demo slugs (`demo-<brand>`) exist only in Socialytics; nothing has to be added to the gOS company catalog, and no portal grant can expose a demo to a client. A key scoped to `bader-law` reaches `demo-bader-law` as well.

**Branded links.** `links.app` uses the Lovable origin until the admin sets `PUBLIC_APP_URL` to the branded host (section 3).

## 9. Verify your integration

```
# 1. Liveness and the OpenAPI document (no key)
curl -s https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/v1/health
curl -s https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/v1/openapi.json | head -c 300

# 2. Without a key the API refuses (401)
curl -s -o /dev/null -w "%{http_code}\n" https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/v1/clients

# 3. With your key: Moburst's workspace (the connected half), and the health findings
curl -s -H "Authorization: Bearer $SOCIALYTICS_KEY" "https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/v1/clients?company_slug=moburst"
curl -s -H "Authorization: Bearer $SOCIALYTICS_KEY" https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/v1/status

# 4. A demo (202), then its progress
curl -s -X POST -H "Authorization: Bearer $SOCIALYTICS_KEY" -H "Content-Type: application/json" \
  -d '{"client_name":"Glossier","website":"glossier.com","requester":{"email":"you@moburst.com"},"idempotency_key":"test-1"}' \
  https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/v1/demo-jobs
curl -s -H "Authorization: Bearer $SOCIALYTICS_KEY" https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/v1/demo-jobs/<job_id>
```

End-to-end checklist:

- A key with `read` and `demo` is stored as a secret in gOS.
- `GET /health` answers `200`; `GET /clients` without a key answers `401`.
- A demo on a brand you choose reaches `completed` or `partial` in 10 to 35 minutes, and your screen shows the progress while it runs and the outputs with their gaps at the end.
- Your screen shows the connected half from Moburst's workspace.
- Your callback endpoint answers `2xx` and verifies `X-Demo-Signature`.
- The same `idempotency_key` sent twice returns the same job.
- A gOS user who is not an admin or account manager opens Socialytics and does not see the demo client; an admin does.
- With `PUBLIC_APP_URL` set, `links.app` points at the branded host.

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 unauthorized` with a key | Revoked, expired, or an AdVisor key (`adv_`) sent here | Check the prefix; ask the admin for a new key. |
| `403 forbidden` on `/demo-jobs` | The key has `read` only | Ask for a key with the `demo` scope. |
| `404 not_found` on a client you know exists | Outside the key's reach | Ask for a wider `company_slugs` or an unscoped key. |
| `429 demo_capacity` | Three demos already running | Queue and retry in a few minutes. |
| `429 rate_limited` | Over the per-minute limit | Honour `Retry-After`; ask for a higher limit on the key if needed. |
| `partial` with `connected_only` gaps | Expected for a prospect | Show tracking, the competitive report and analytics from Moburst's workspace. |
| `competitors_unconfirmed` or `no_competitors` | Fewer than three proposed competitors had a website and a verified social profile | Pass `competitors[]` with the names you want; the demo detects their handles. |
| `post_image_missing` | The image provider refused or ran out of credits; the reason is in the gap | Show the copy; the admin checks the provider. |
| Job stays `running` past 35 minutes | The monthly workflow is slow or has stalled; the API records `report_timeout` at 100 minutes and folds the report in when it lands | Keep polling or wait for the callback. |
| The client link opens a Setup page with a red notice about social accounts | That is the configuration screen; the notice is the normal state of a brand without Sprout | Open `social_report.app_link` or the deck URL instead; `client.app_link` now opens the Reports page. |
| Callback never arrives | Endpoint unreachable or not `2xx` | Check `callback_status` on the job; the API tried three times. |
| Links open the Lovable address | `PUBLIC_APP_URL` not set | Ask the admin to set it to the branded host. |

## 11. Reference

- OpenAPI: `GET {base}/openapi.json`.
- Repo documents: `docs/api/SOCIALYTICS-API.md` (the full route and field notes), `docs/api/EXTENDING.md` (how the shared core is extended).
- Key management (admins): `POST /v1/admin/keys` `{ name, scopes, company_slugs?, client_ids?, rate_limit_per_minute?, expires_at?, note? }` answers `201` with the key once; `GET /v1/admin/keys` lists keys without secrets; `DELETE /v1/admin/keys/{id}` revokes. Accepted callers: a signed-in Socialytics admin, a key with the `admin` scope, or the platform's internal secret.
