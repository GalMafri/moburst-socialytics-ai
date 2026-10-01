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
