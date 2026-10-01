# Public API for Socialytics: addendum to the shared design

Date: 2026-10-01. Owner: Lital. Companion to `docs/superpowers/specs/2026-09-30-public-api-and-demo-onboarding-design.md` in the AdVisor repo, whose sections 1, 2, 5 and 10 apply here unchanged. This addendum settles what is specific to Socialytics: its resources, its demo steps, how the API drives functions that today accept only a signed-in staff member, and what a brand with no Sprout profiles can and cannot get.

## 1. Surface and core

Same `api` edge function, same core (`supabase/functions/_shared/api/*`, copied verbatim from AdVisor by `scripts/sync-api-core.sh` and pinned by `core-checksum.test.ts`), same tables (`api_keys`, `api_requests`, `api_rate_buckets`, `demo_jobs`), same scoping by `clients.company_slug`. Keys carry the `soc_` prefix. App links point at `https://moburst-socialytics-ai.lovable.app`.

The operational secret the project already uses for server calls (`SOCIALYTICS_N8N_SECRET`, header `x-socialytics-secret`) is the internal secret of the API too: the worker cron sends it as `X-Cron-Secret`, and it is read from Vault (the migration moves it there from the plain-text cron command).

## 2. Driving the functions as a server

Most Socialytics functions guard themselves with `requireStaff()`: a signed-in staff JWT, often with `can_write_client`. A worker holds no user session. The guard gains one more accepted caller, following the pattern six functions already use for schedules: a request presenting `x-socialytics-secret` equal to `SOCIALYTICS_N8N_SECRET` **and** `x-socialytics-user` naming the user it acts for (a UUID that becomes `created_by`). Such a caller gets a service-role client and is trusted for every client (the secret is the project's own authority); `viaSecret: true` is set on the caller so the two functions that add an admin check (`delete-client`) can treat it as admin. `sprout-analytics`, which checks a JWT on its own, accepts the same pair. Nothing changes for browser callers.

The API never forwards a user JWT. The user it acts for is the demo's requester when their email matches a profile, otherwise the creator of the most clients.

## 3. Read routes (scope `read`, scoped, paginated)

| Route | Returns |
|---|---|
| `GET /clients`, `GET /clients/{id}` | `id, name, website, company_slug, platforms, geo, language, timezone, pillars[] {name, description}, keywords[], brand_identity {primary_color, secondary_color, accent_color, font_family, visual_style, tone_of_voice, logo_description}, design {synthesis_at, references, system {version, status, approved_at}}, sprout {profiles, networks[]}, competitors {set_status, selected[], tracked}, counts {reports, competitive_reports, posts, schedules}, last_report {id, status, period, completed_at}, setup, demo_job_id, created_at, links`. Detail adds `competitor_sets[]`, `schedules[]`, `sprout_profiles[] {name, network}` (never the Sprout numeric ids). |
| `GET /clients/{id}/setup` | `{ ready, issues[] }`: no brand identity, no pillars, no keywords, no Sprout profile, no confirmed competitor set, no approved design system, no schedule. |
| `GET /clients/{id}/analytics?start=&end=` | `sprout-analytics` through the server path (totals, previous totals, changes, by profile, top posts); `422 no_sprout_profiles` when the client has none. |
| `GET /reports?client_id=&status=&from=&to=`, `GET /reports/{id}` | Social reports: `id, client_id, status, period {start, end}, previous_period, created_at, completed_at, duration_minutes, deck {url, status}, counts (data_counts), metrics_summary, warnings, trend_status, links`. Detail adds `analysis` (ai_analysis), `calendar` (content_calendar), `performance` (sprout_performance without raw post ids), `trends {tiktok, instagram}` as the app reads them. |
| `GET /competitive-reports?client_id=&status=`, `GET /competitive-reports/{id}` | `id, client_id, set_id, status, period {start, end, days}, created_at, deck {url}, duration_minutes, totals, quality_check, links`; detail adds `analysis` (executive summary, scorecard, gaps, teardown, breakdowns, schedule) and `aggregates` per company. Never the RivalIQ landscape id or company ids. |
| `GET /competitor-sets?client_id=`, `GET /competitor-sets/{id}` | `id, client_id, status, source, confirmed_at, notes, competitors[] {name, website, rationale, similarity_score, selected, rank, handles[] {platform, handle, url, confidence, source}}, tracked (landscape present)`. |
| `GET /posts?client_id=&report_id=&source=&approved=`, `GET /posts/{id}` | Post iterations: `id, client_id, report_id, source, platform, format, copy, hashtags, cta, concept, visual_direction, media_urls, variant_group_id, variant_angle, selected, approved, approved_at, rejected_at, rejection_reason, finishing, created_at, links`. |
| `GET /media-jobs?client_id=&status=` | `id, client_id, post_id, kind, provider, status, output_url, seed_image_url, review {dirty, reason}, created_at`. Never `request_id` or `model_path`. |
| `GET /schedules?client_id=` | Report schedules: `id, client_id, kind, frequency, run_day_of_month, range_mode, active, next_run_at, last_run_at, last_result`. |
| `GET /scheduled-posts?client_id=` | `id, client_id, report_id, platform, scheduled_time, status, content, media_url, created_at`. |
| `GET /alerts?client_id=&status=` | Competitive alerts: `id, client_id, topic, summary, companies, platforms, post_urls, confidence, window {start, end}, status, created_at`. |
| `GET /design-systems?client_id=` | `id, client_id, version, status, approved_at, templates[] {id, name, formats}, tokens {font.family, colors}, previews[] {template_id, format, url}, created_at`. |
| `GET /status` | Health: reports or competitive reports `running` past 90 minutes, schedules with `last_result` failures, media jobs failed in 24 hours, demo job findings, schema drift; scoped keys see their clients' findings only. |

Confidential or internal, never returned: `app_settings`, `integration_tokens`, Sprout customer and profile ids, RivalIQ landscape and company ids, media job request ids and model paths, `rivaliq_snapshots` payloads, the agent key.

## 4. The demo (scope `demo`)

Same request contract as AdVisor (`client_name`, `website`, optional `industry` (unused here but accepted), `competitors[]`, `requester`, `idempotency_key`, `callback_url`, `regions` (ignored), `force_run`). Steps:

1. `resolve_client`: match by website host, then by exact name; a scoped key may only reach its companies (fatal `out_of_scope`); create with `name`, `website_url`, `company_slug` (slugified, unique by suffix), `created_by` = the acted-for user, `primary_platforms` Instagram, TikTok, Facebook, LinkedIn, `geo` US, `language` en, `timezone` UTC, `media_backend` gemini, `demo_job_id`.
2. `brand_identity`: `research-brand-identity {website_url, client_name}` → `clients.brand_identity`, `logo_url` when the research names one; written only where empty. Failure is a gap.
3. `site_brief`: `firecrawl-scrape` of the homepage (markdown, main content) → `clients.brief_text` (the first 2,500 characters, prefixed "Drafted from the website on <date>:") when the brief is empty; the excerpt is kept on the step for later steps. Failure is a gap.
4. `pillars`: `derive-content-pillars {client_id}` → `content_pillars`, `social_keywords`, `pillars_source "website"`, `pillars_derived_at`; written only where empty. A 422 (no evidence) is a gap.
5. `design`: when the client has Sprout profiles or at least three design references, `synthesize-design-language {client_id, discover: true}` and then `build-design-system {action: build}` followed by `approve`; otherwise skipped with reason `no_references` and a gap ("No brand references: designs use the brand colours and fonts only"). This is the honest limit for a brand Moburst does not yet manage on Sprout.
6. `competitors`: when the request lists competitors, insert a draft set with them (source `manual`); otherwise `identify-competitors {client_id}` (8 to 12 candidates) → `detect-competitor-handles {set_id}` → choose the three highest `similarity_score` candidates that carry a review-ready handle (manual, rivaliq, or confidence at least 0.8) → mark `is_selected`, `selected_rank` → `confirm-competitor-set {set_id}`. Fewer than three placeable candidates: the set stays `draft`, a gap is recorded, and the competitive report is skipped.
7. `tracking`: `setup-rivaliq-landscape {set_id, mode: preview}` then `advance` once per tick until the phase is `complete` (waiting step, 120 s between checks, 60 minutes at most). Failure or timeout is a gap and the competitive run is skipped.
8. `run_social`: only when the client has an active Sprout profile (the monthly workflow analyses the brand's own performance first and stops without it; found live on 2026-10-01); otherwise skipped with the gap "No Sprout profile: the social report needs the brand's own performance data". Then `run-report {client_id, kind: social}` (last 30 days) unless a report completed in the last 7 days and `force_run` is false; `{resumed: true}` is accepted as the run to wait for.
9. `run_competitive`: `run-report {client_id, kind: competitive, date_range_start, date_range_end}` (the 30 days ending yesterday) when the set is confirmed and tracked; same freshness rule.
10. `wait_reports`: both rows polled every 2 minutes; `completed`/`complete` or `failed` closes a wait; 100 minutes after start a run is recorded `run_timeout` (the app itself abandons runs at 90).
11. `post`: from the social report's first calendar post (platform, format, copy, visual direction) when the report completed, else from the brand brief: `generate-ad-hoc-post {client_id, platform, topic, creative_type}` → insert `post_iterations` (`source ad_hoc`, `demo_job_id`) → `generate-post-image` (Gemini path; `brand_context` from the brand identity, `client_id`, `platform`, `format`, `prompt` from the visual direction) → `upload-generated-media {client_id, media_data, media_type image}` → `post_iterations.media_urls`. Each failure is a gap; a post without media is still returned.
12. `analytics`: `sprout-analytics` for the last 30 days when the client has Sprout profiles; otherwise skipped with the gap "No Sprout profile: performance analytics are not available for this brand".
13. `collect`: `client` (id, name, brand identity, pillars, keywords, links), `competitors {set_status, selected[], unplaced[], tracked}`, `reports[]` (social and competitive with links and deck URLs), `social_report {period, counts, highlights (ai_analysis.sprout_performance_analysis.key_insights), calendar_days, deck}`, `competitive_report {executive_summary, scorecard, gaps, deck}`, `post {id, platform, copy, media_urls, app_link}`, `analytics` or null, `design {status}`, `gaps[]`.
14. `callback`: as in AdVisor.

Flags `demo_job_id` on `clients`, `competitor_sets`, `reports`, `competitive_reports`, `post_iterations`, `media_jobs`. Discard: a client the job created goes through `delete-client` (server path, admin-equivalent); otherwise only the flagged rows are removed.

## 5. Settings card

The same API access card as AdVisor, on the Settings page, admins only, through `/v1/admin/keys` with the admin's session.

## 6. Tests and proof

Unit tests as in AdVisor (core copy pinned, serializers on fixture rows, routes with an in-memory store, demo steps with an in-memory data layer, the gate's server path on a pure helper). Live: smoke checks on health, OpenAPI, refusals and a keyed read; one demo job each on a direct-to-consumer brand and an app brand with no prior setup, followed through the API; the social report and the post verified through the API and the database; `.agents/qa-project-context.md` filled from the survey and a release record.

## 7. Known limits stated up front

- A brand not managed in Moburst's Sprout account gets no social report, no performance analytics, no scheduled posting and no design references from its own posts; the demo says so in `gaps`. Its post is written ad hoc from the pillars.
- The competitive report depends on RivalIQ ingesting a newly created landscape; the first report may come back thin or `needs_review`, which the API returns as recorded.
- Social and competitive reports take 20 to 60 minutes each in n8n.
