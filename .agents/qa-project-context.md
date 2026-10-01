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
| S6 | Demo | A demo on an existing client overwrites hand-written data | low | high | brand, brief, pillars and keywords are written only where empty; an existing confirmed set is reused, never replaced |
| S7 | Demo | RivalIQ landscapes created by demos are never removed | high | low | known limit: `discard` removes the client and rows, not the RivalIQ landscape (the app has no delete call); listed in what is left |
| S8 | Reports | A social report outlives the 100-minute wait | medium | low | the step records `report_timeout`; the finished report is folded into the outputs on the next read (`refreshOutputs`) |
| S9 | Rate limit | A consumer floods a function and spends credits | low | medium | per-key minute buckets, 429 with `Retry-After` (live: 5-per-minute key refused the sixth call with `retry-after: 39`) |
| S10 | Schema drift | Lovable renames a column the API reads | medium | medium | `GET /v1/status` tries 19 column lists live; the smoke suite fails on any drift |
| S11 | Secrets | The operational secret sits in a cron command in plain text | fixed | high | moved to Vault by the migration; both crons read `vault.decrypted_secrets` (verified live) |

## Known fragile areas

- `run-report` refuses to start when the previous run is under 90 minutes old and still `running`; a stuck row needs that long before a retry.
- RivalIQ landscape setup is a multi-phase state machine with a two-minute lease; a second caller gets "Setup is already being checked".
- Firecrawl returns navigation and images as "main content"; the demo cleans it (`demo/site-text.ts`) before drafting a brief.
- `generate-post-image` on a Higgsfield client answers 202 with a media job; the demo records `post_image_pending` for those.
