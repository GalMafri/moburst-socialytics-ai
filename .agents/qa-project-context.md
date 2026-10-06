# Socialytics QA project context

Read by the QA skills before any assessment. Keep it current: update the risk
section after every production incident (within 48 hours) and at least
quarterly. First written on 2026-10-01 from a survey of commit d3319a4.

## Product

Socialytics (moburst-socialytics-ai.lovable.app, gOS slug `socialytics`) is
Moburst's organic social intelligence tool. For a client it holds the brand
(identity, pillars, keywords, design system), runs a social analysis report
through an n8n workflow (trends, performance, content recommendations and a
calendar), builds competitor sets and competitive reports (RivalIQ and the
public profiles), turns recommendations into posts with generated designs and
videos (Gemini, Higgsfield), and schedules posts to Sprout Social. Reports and
posts are client-facing agency work.

## Tech stack

- Frontend: React 18 + Vite + TypeScript, shadcn/ui, Tailwind, TanStack Query.
  Design system: Moburst Intercept (glass surfaces, lime accent). The
  `public-env.ts` pattern keeps a missing `.env` harmless.
- Backend: Lovable Cloud (Supabase ref `rwouwxqggjjacbpbhqsn`): Postgres with
  pg_cron + pg_net, 50 edge functions (Deno), Storage for generated media.
  Nobody uses the Supabase dashboard or CLI; everything goes through Lovable
  (connector `query_database`, agent deploys, `deploy_project`).
- Auth: two portals (legacy hub `tools.moburst.com` through `hub-auth-bridge`,
  gOS `moburst.ai` through `gos-auth-bridge`), roles `admin`, `moburst_user`,
  `client`; client scoping by `clients.company_slug` against
  `profiles.allowed_company_slugs` (`is_client_member`).
- Secrets in the project (names only): ANTHROPIC_API_KEY, FIRECRAWL_API_KEY,
  GEMINI_API_KEY, HIGGSFIELD_API_KEY_ID, HIGGSFIELD_API_KEY_SECRET,
  HIGGSFIELD_WEBHOOK_SECRET, LOVABLE_API_KEY, OPENAI_API_KEY, RIVALIQ_API_KEY,
  SOCIALYTICS_AGENT_KEY, SOCIALYTICS_N8N_SECRET, SPROUT_CLIENT_ID,
  SPROUT_CLIENT_SECRET, SPROUT_SOCIAL_ACCESS_TOKEN. The operational secret the
  crons and n8n send is `SOCIALYTICS_N8N_SECRET`, header `x-socialytics-secret`
  (the public API's worker cron sends the same value as `X-Cron-Secret`).
- Crons: `advance-creative-plans` every two minutes; the public API adds
  `api-demo-worker` (every minute) and `api-audit-purge` (03:15 UTC).
  Scheduled reports and competitor feeds (since 2026-10-06):
  `scheduled-reports-enqueue` (07:15 UTC, pure SQL
  `enqueue_scheduled_report_jobs()`) and `scheduled-jobs-worker` (every
  minute, `run-scheduled-jobs`). n8n "Socialytics - Scheduled Jobs Check"
  reads `run-scheduled-jobs {"mode":"status"}` at 08:30 UTC and emails through
  the error workflow when anything needs a person. Design:
  `docs/superpowers/specs/2026-10-06-scheduled-report-queue-design.md`.

## Test frameworks and commands

- Unit and component: Vitest (`npm test`; 94 files, 746 tests on 2026-10-01
  including the shared API core). Includes `src/**`, `supabase/functions/**`
  and `api/**`.
- Backend and workflow QA scripts: `npm run test:qa` runs
  `scripts/qa-backend.cjs`, `qa-workflows.mjs`, `qa-metrics.cjs`,
  `qa-sprout.cjs`; `scripts/qa-rls-guards.mjs` and `qa-sql.mjs` exist too
  (each reads its connection from the environment; see the file headers).
- Type check: `npx tsc --noEmit -p tsconfig.app.json`. Lint: `npm run lint`.
- The API core under `supabase/functions/_shared/api` is a verbatim copy of
  AdVisor's; `scripts/sync-api-core.sh` in the AdVisor repo copies it here and
  `core-checksum.test.ts` fails when the copy drifts.

## CI/CD and environments

- No CI pipeline runs the tests; they run locally before every push.
- Git: `origin main` (GalMafri/moburst-socialytics-ai) syncs into Lovable;
  Lovable commits its own changes to main, so merge `origin/main` before every
  push. Edge functions are deployed by asking the Lovable agent; the site is
  published with `deploy_project` after the last push.
- Environments: production only. Database changes go through the Lovable
  connector's `query_database` and are recorded in `supabase/migrations/`.

## Quality goals

- No client-facing surface shows an internal operational note.
- A report run never leaves a schedule or a creative plan stuck.
- A schedule occurrence is dispatched at most once (scheduled_jobs dedupe key
  plus the posting phase), and every job that cannot finish is alerted daily.
- Generated media carries the client's brand tokens, never another client's.
- A client-scoped key or user never sees another company's rows.

## Data model (the tables the API reads)

- `clients`: the brand (`name`, `website_url`, `company_slug`, `primary_platforms`, `geo`, `language`, `timezone`, `brand_identity` jsonb, `content_pillars` jsonb, `social_keywords`, `brief_text`, `logo_url`, `design_style_synthesis`, `harvested_design_references`, `design_references`, `media_backend`, `archived_at`, `created_by`, `demo_job_id`). `sprout_customer_id` and the Sprout profile ids stay internal.
- `sprout_profiles`: the brand's Sprout Social profiles (`sprout_profile_id` internal, `profile_name`, `native_name`, `network_type`, `native_link`, `is_active`).
- `competitor_sets` → `competitors` → `competitor_handles`: a set is `draft` until three competitors are selected and ranked and each has a review-ready handle (`confirm-competitor-set`); `rivaliq_landscape_id` (internal) marks a tracked set; statuses `draft`, `confirmed`, `analyzing`, `complete`, `failed`.
- `reports`: social analysis runs (`status` running/completed/failed, `date_range_*`, `gamma_url`, `report_data` jsonb with `report_period`, `data_counts`, `metrics_summary`, `warnings`, `ai_analysis`, `content_calendar`, `sprout_performance`, `tiktok_trends`, `instagram_trends`); written by n8n through `update-report`.
- `competitive_reports`: RivalIQ runs (`status` running/complete/failed, `report_data` with `period`, `totals`, `aggregates.companies[]`, `ai_analysis`, `quality_check`); written through `update-competitive-report`.
- `post_iterations`: generated posts (`source` calendar/ad_hoc/recommendation, copy, hashtags, format, `media_urls`, variants, approval, `finishing`); `media_jobs` (Higgsfield renders; `request_id` and `model_path` internal).
- `report_schedules` (monthly social or competitive, `last_result`), `scheduled_posts` (Sprout; `sprout_post_id`, `profile_id` internal), `competitive_alerts`, `client_design_systems` (tokens, templates, previews in the `design-previews` bucket).
- Public API: `api_keys` (hash only), `api_requests` (audit, 180 days), `api_rate_buckets`, `demo_jobs`; `demo_job_id` on clients, competitor_sets, reports, competitive_reports, post_iterations, media_jobs.

## Features and surfaces

- Client setup (`/clients/:id/setup`): brand research, brand book, pillars, keywords, Sprout profiles, design references and design system.
- Social report (`/clients/:id/analyze`, `run-report kind=social`): n8n monthly workflow (`app_settings.n8n_webhook_url`), 20 to 60 minutes; result in `/clients/:id/reports/:reportId` with a Gamma deck and a content calendar.
- Competitive (`/clients/:id/competitive`): competitor review, handle detection, RivalIQ tracking setup, competitive run (`run-report kind=competitive`), feed and alerts, reports.
- Posts: calendar and ad-hoc posts, creative plans, image and video generation (Gemini or Higgsfield), scheduling to Sprout.
- Analytics (`/clients/:id/analytics`): Sprout performance through `sprout-analytics`.
- Settings (admins): integration settings, Sprout, Higgsfield connection, API access card (keys for gOS and other tools).
- Public API (`/functions/v1/api/v1`): read routes for all of the above, the demo job, key management, health; see `docs/api/SOCIALYTICS-API.md`.

## Risk matrix (updated 2026-10-01 after the API release)

| # | Area | Risk | Likelihood | Impact | Mitigation and evidence |
|---|------|------|-----------|--------|-------------------------|
| S1 | API scoping | A company-scoped key reads another company's rows | low | high | every list filtered by `ClientScope`, every single read checks the row's client; 7 route tests; live: scoped key saw only Bader Law, 404 on LegaBot, filtered lists empty, status filtered, admin 403 |
| S2 | Confidentiality | Sprout, RivalIQ or media provider ids leave through the API | low | high | explicit column lists, `omitDeep` on JSON blocks, schema and OpenAPI scans; live check found `profile_ids` lists in report performance, fixed the same morning |
| S3 | Server caller | The operational secret path lets an unauthenticated caller through | low | high | `secretEquals` constant-time compare, UUID required for the acted-for user; live: wrong secret answers 401; 26 auth tests |
| S4 | Server caller | A staff-gated function refuses the project's own call | medium | medium | happened live (per-client `can_write_client` under the service role is false); five functions now treat `viaSecret` as allowed; the demo records such refusals as gaps instead of failing |
| S5 | Demo | A demo re-run after a crash writes rows twice | low | medium | every step checks what exists (`demo_job_id`, set ownership, posts for the job); 28 step tests including re-runs |
| S6 | Demo | A demo touches a production client (reads its Sprout data, writes its brief, shows it to a sales key) | low | high | since 2026-10-06 a demo reuses or creates only demo clients (`demo_job_id` set, slug `demo-<brand>`); a production client with the same website or name is never read; 7 resolve tests; brand, brief, pillars and keywords are still written only where empty on a reused demo client; live: Glossier created `demo-glossier` (job 72b60732) |
| S7 | Demo | A demo consumes a RivalIQ seat or leaves a landscape behind | fixed | low | since 2026-10-06 `tracking` and `run_competitive` are skipped as `connected_only` (the competitor set is still confirmed); `setup-rivaliq-landscape` has a `cleanup` mode (deletes only a landscape with this setup's name and no companies, clears the stale record when RivalIQ already removed it); the two empty demo landscapes 654991 and 654992 were deleted on 2026-10-06 |
| S8 | Reports | A social report outlives the 100-minute wait | medium | low | the step records `report_timeout`; the finished report is folded into the outputs on the next read (`refreshOutputs`) |
| S9 | Rate limit | A consumer floods a function and spends credits | low | medium | per-key minute buckets, 429 with `Retry-After` (live: 5-per-minute key refused the sixth call with `retry-after: 39`) |
| S10 | Schema drift | Lovable renames a column the API reads | medium | medium | `GET /v1/status` tries 19 column lists live; the smoke suite fails on any drift |
| S11 | Secrets | The operational secret sits in a cron command in plain text | fixed | high | moved to Vault by the migration; both crons read `vault.decrypted_secrets` (verified live) |
| S12 | Demo | The prospect half of a sales demo shows connected-only features as failures | low | medium | three `connected_only` messages name the connected showcase workspace (Moburst's own client: 3 Sprout profiles, 26 social and 13 competitive reports on 2026-10-06); gap recorded once, by `tracking`; e2e test pins the step outcomes |
| S13 | Competitors | Every proposed competitor is rejected because its website refuses automated visitors | high before 2026-10-06 | high | Glossier's identification rejected nine of ten sites with HTTP 429 and one with 403; `validateCompetitorWebsites` now keeps a company answering 401/403/405/429 and still rejects 404, 5xx, no answer and the client's own domain; 3 tests |
| S15 | Demo | Demo traces reach a moburst_user or client screen | low | high | restrictive select policies (`20261006120000_demo_rows_admin_only.sql`) on clients and 21 client-keyed tables plus demo_jobs; impersonation checks: moburst_user and client roles see 0 demo rows, admin sees all; the service role (API, functions) is not subject to RLS |
| S14 | RivalIQ | A provider answer without a body (204 on DELETE) breaks the connection wrapper | fixed | low | `coordinatedRivalIqFetch` returns a null body for 204/205/304; 1 test; the first cleanup deleted its landscape and then failed on this |

## Known fragile areas

- The monthly social workflow (n8n `SZbRTV7yOdXTNHHf`) used to need the brand's Sprout profiles; with none, its Sprout step returned no items and the run ended on the failure branch, whose "Mark Social Report Failed" node had an expression the engine rejects (`json.body?.report_id`), so failed runs left their report `running` for good. Fixed on 2026-10-01: the marker expression (version `8a6c17dd`), then a `Has Sprout Profiles` branch that hands the merge an empty Sprout block so trends, recommendations, calendar and deck are still produced, a synthesis prompt note that forbids invented performance figures, and a deck builder that shows one plain "performance tracking starts once the accounts are connected" slide instead of zeros (version `2615c3b2`). Clients with profiles run exactly as before.
- `delete-client` removed brand books and design references but left `generated-media/<client>/` and `design-previews/previews/<client>/`; both folders are removed since 2026-10-01.

- `run-report` refuses to start when the previous run is under 90 minutes old and still `running`; a stuck row needs that long before a retry.
- RivalIQ landscape setup is a multi-phase state machine with a two-minute lease; a second caller gets "Setup is already being checked".
- Firecrawl returns navigation and images as "main content"; the demo cleans it (`demo/site-text.ts`) before drafting a brief.
- `generate-post-image` on a Higgsfield client answers 202 with a media job; the demo records `post_image_pending` for those. The app reads the balance of the workspace its linked team login has selected (the shared "Moburst" workspace, Scale plan). On 2026-10-01 it stood at 0.2 credits, below the 20-credit floor, and image generation stopped with "The Higgsfield account is down to 0 credits"; an auto top-up of 4,000 credits landed the same day at 15:23 Israel time (3,996.95 on 2026-10-06, read through the Higgsfield MCP). A provider balance is confirmed through the provider, never from an app message alone.
- RivalIQ's plan allows 40 distinct tracked companies and the account reached 40 during Subliy's setup on 2026-09-30 (14 landscapes: TIER 1 Competitors 6, LandGlide 5, Subliy 4, two Socialytics Moburst landscapes 4 each, NewDay USA 4, LegaBot 4, MyRxProfile 4, TIER 2 FIRMS 4, Socialytics Subliy 3, BenchApp 1, InPlay Global 1, and the two empty demo landscapes). Every follow-by-URL since then answers each company with a credits payload (`plan 40, distinct 40`), which the app now reads as "RivalIQ's plan tracks 40 distinct companies and 40 are in use" instead of raw JSON; calm.com separately refused RivalIQ's visit (403). Demos no longer touch RivalIQ at all (`connected_only`), and the two empty demo landscapes were removed on 2026-10-06 through the new `cleanup` mode (12 landscapes remain, all with companies). The seats stay with signed clients.
