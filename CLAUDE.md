# Socialytics: rules for working in this repo

Read `.agents/qa-project-context.md` for the stack, test commands, data model and release rules. This file adds the rules that keep cost tracking and the public API correct as the product changes. Tests enforce every rule below; when one fails, its message names the file, the line and what to do.

## How Socialytics is built and deployed (do not ask the owner to explain this)

- Socialytics is a Lovable project ("Socialytics AI", id `9444db2d-9d44-473f-b34f-26767e1c6c0c`). The backend is Lovable Cloud: Supabase project `rwouwxqggjjacbpbhqsn`, managed by Lovable, not reachable with a personal Supabase connector.
- Code lives in GitHub `GalMafri/moburst-socialytics-ai`. Merging or pushing to `main` syncs the code into Lovable within a minute. That does NOT make the website live: the site (the custom domain and the *.lovable.app copy serve the same build) changes only when the project is published in Lovable. After every merge that touches what the site serves, publish it (the Lovable connector's `deploy_project`, without a name) and check the live bundle changed.
- Edge functions and database migrations go live through Lovable: ask the project's Lovable agent (the Lovable connector's `send_message`) to apply the new migrations and deploy the named functions. Read production data with the connector's `query_database`.
- GitHub access: the owner's token is in the macOS Keychain and `gh` is signed in. Open, merge and follow pull requests yourself.

## Paid calls and cost tracking

Every call to a paid provider (Claude, OpenAI, Gemini, Apify, Gamma, Firecrawl, Higgsfield, Jina) goes through the paying desk:

```ts
import { costCtx, hasKey, paid } from "../_shared/paid/index.ts";

const ctx = costCtx({ clientId, feature: "calendar.week_copy", actor: "schedule", executionId: job.id });
const res = await paid.fetch(ctx, "anthropic", "/v1/messages", { method: "POST", body: JSON.stringify(body) });
```

- Claude calls go through `_shared/anthropic.ts` (`anthropicMessages`, `anthropicFetch`, the batch and stream helpers in `_shared/pipelines/`), which take the same cost context and use the paying desk underneath.
- `paid.fetch` adds the provider's credentials, records what the call cost in `cost_events`, and returns the provider's answer untouched. Never `fetch` a provider URL yourself and never read a provider key (`Deno.env.get("ANTHROPIC_API_KEY")`, the `app_settings` key rows, and the like). Use `await hasKey(provider)` to check whether a key is set. Keys come from the function secrets first, then `app_settings`, as before.
- `clientId` is the client the work is for, whoever started it and whether or not the client pays. Take it from the request body, the job or run row, or the record being processed. Pass `null` only for a feature listed in `SHARED_FEATURES` (`_shared/paid/config.ts`), which is work that serves every client at once. Work with no client that is not shared is recorded under development & QA and flagged unattributed.
- `feature` is a stable lowercase label for the work (`post.image`, `report.social.brief`). Keep it when you refactor; the costs page groups by it.
- `executionId` is the id the gOS usage events use for the same unit of work (see `supabase/migrations/20260820180000_gos_usage_contract.sql`; in pipelines, the run id).
- QA and smoke scripts pass `qa: true`, so their spend is dev/QA.
- A test client is marked with `clients.exclude_from_reporting = true` (the same flag the gOS usage contract uses); its spend, past and future, then reports under development & QA.

### Safeguards (`_shared/cost/meter.ts`, `apify.ts`, `audit.ts`)
- The meter retries a failed cost insert 3 times before logging `COST_EVENT_DROPPED`, and writes a `cost_intents` row before each paid call (Apify excepted), completed once the cost rows are written. An intent still open an hour later is an unrecorded call.
- Every Apify actor or task run started through `paid.fetch` (`POST /v2/acts/<id>/runs` or `/v2/actor-tasks/<id>/runs`) carries an ad-hoc webhook to `cost-apify-webhook` (secret `COST_WEBHOOK_SECRET`), which records the run as `apify:<runId>`.
- `APIFY_ACTORS` in `_shared/paid/config.ts` lists the actors Socialytics runs: `owned` (only Socialytics) or `shared` (another Moburst tool on the same Apify account may run it). A new actor fails the cost-guard test until it is listed. The audit records a missed run only for an `owned` actor; others go to `cost_unclaimed_runs` for review. Those are other work on the shared Apify account (other tools, n8n, research), so they are counted but never raise an alert here. `others` names the actors the other Moburst tool on the account owns (keep it equal to that tool's `owned`): their runs are counted apart, never recorded or flagged here.
- `cost-reconcile` (daily cron; or `POST /v1/admin/cost-check?from=&to=[&dry_run=1]` with an admin key, up to 90 days) compares bills, counts unrecorded calls, audits Apify runs and keeps alerts in `cost_alerts`, shown on `GET /v1/costs` as `alerts`. Alerts stay in the app: never post them to Slack, email or n8n. Unattributed-share threshold: `COST_ALERT_UNATTRIBUTED_PCT` (default 0.1).
- The Anthropic and OpenAI bill checks read the organization's bill with the admin keys (`ANTHROPIC_ADMIN_KEY`, `OPENAI_ADMIN_KEY`) but count only this app's own API key: `ownKey()` in `_shared/paid/index.ts` gives the app's key, the check finds its id in the organization's key list (matching the key's visible start and end), and asks for that key's costs. An app with no key of its own for a provider is "unreconciled" for it, never compared with the whole organization. A 429 from a billing API is retried.
- One-off Apify history load: `POST /v1/admin/cost-check?from=YYYY-MM-DD&to=YYYY-MM-DD&mode=history&dry_run=1`, check `data.apify.missing`, then repeat without `dry_run`, in windows of at most 90 days. Trends runs go to the client whose trends week was running, LinkedIn posts runs to the client whose report was running, unattributed when several clients or none match (`_shared/paid/checks.ts`). Trends runs inside a week whose Apify dollars the 23 Nov 2026 backfill already loaded count as recorded and are never written again.

### Adding a paid provider
1. Add it to `PROVIDERS` in `supabase/functions/_shared/cost/registry.ts` (base URL, hosts, key names) and a usage reader in `usage.ts`. These files are the shared core: make the change in the AdVisor repo and sync it here with its `scripts/sync-api-core.sh`. Never edit them in this repo.
2. Add its credentials to `authHeaders` in `_shared/paid/index.ts`.
3. Add a price row to `_shared/cost/pricing.ts`, with the source URL.

### Changing or adding a price
Add a new row to `_shared/cost/pricing.ts` with a new `effectiveFrom` date. Never edit or delete a row that was used: recorded events keep the price they were charged at. Mark `verified: false` when the figure is an estimate or depends on Moburst's plan.

### What the cost guardrails check (`supabase/tests/paid/cost-guard.test.ts`)
- No provider address appears outside `_shared/cost` and `_shared/paid`. A line that only names a provider (a URL check) can say so with `// cost-guard: not a call`.
- Every secret the code reads is either a paid provider's key in the registry or listed in `NOT_PAID_SECRETS` with a reason. A new secret fails until you decide which it is.
- Paid keys are read only inside `_shared/paid`.
- Every AI model id in the code has a price row. Switching models fails until the new one is priced.
- `clientId: null` appears only for shared features.

## The public API (`supabase/functions/api`)

- The route table is the only description of the API. `docs/api/REFERENCE.md`, `api/openapi.json` and `docs/api/CHANGES.md` are generated from it. Never edit them by hand.
- After changing a route, a schema (`supabase/functions/api/schemas.ts`) or anything in the API function, run `npm run api:gen` and commit what it writes. The api-docs test fails until you do.
- Changes are additive by default: add routes, optional parameters and response fields freely. Removing or renaming a route, a query parameter or a response field, making a request field required, or dropping an accepted value breaks the portal, demo screens and agents that use the API. `npm run api:gen` refuses such a change until each line is listed in `api/BREAKING.md` with the date and what replaces it. Prefer keeping the old shape working alongside the new one.
- Key scopes: `read`, `demo`, `run`, `costs`, `admin` (`SCOPES` in `_shared/api/router.ts`). The Settings page offers the list in `src/lib/api-scopes.ts`; `api-scopes.test.ts` fails when the two differ.
- Actions are the public way to start work (`supabase/functions/_shared/socialytics-api/actions.ts`, built by the shared `actionRoutes` in `_shared/api/actions.ts`): each has its own fixed input schema and a small adapter that calls today's internal function, as the project acting for the key's owner (`callFunction` with the act-as user). When a screen's function changes its inputs, change the adapter, never the action's schema. Actions need the `run` scope, reach only the key's clients, and take an optional `idempotency_key` (kept in `api_action_runs`) so a retry never starts paid work twice. Every function the screens call must be mapped by an action (`maps`) or listed in `INTERNAL_ONLY` (`supabase/functions/api/internal-only.ts`) with the reason; `supabase/tests/api/actions-coverage.test.ts` fails until you decide.
- The Claude connector (`supabase/functions/mcp`) lists its tools in one place, `mcp/catalog.ts`: who is offered each (a signed-in person by role, or an API key by scope) and what it runs. `npm run api:gen` writes `api/mcp/socialytics-tools.json` from it; never edit that file by hand. Work tools (`mcp/tasks.ts`) start the public actions in process and are two-step: the first call returns an estimate and a `confirm_token` and starts nothing. Every public action is reached by a work tool or listed in `API_ONLY` there with the reason (`supabase/tests/mcp/catalog.test.ts`). The connector takes a person's OAuth token or a Socialytics API key as the bearer; keep the OAuth sign-in as it is. Client users have no API access at all: no API page, no keys, and the connector and its consent page refuse them (`mcp/access.ts`, `src/pages/OAuthConsent.tsx`).
- Personal keys (`/v1/me/keys`, the API page's Tokens tab at `/api-access`) are staff only, read only or read and write (`read`, `run`), for all the person's companies or some, at most 90 days. Tool keys (any scope, `costs` for the moburst.ai portal) are made by admins in the same dialog.
- The cost routes (`GET /v1/costs`, `/v1/cost-events`, `/v1/cost-pricing`) come from the shared core and must stay identical in AdVisor and Socialytics.

## Shared cores

`supabase/functions/_shared/api` and `supabase/functions/_shared/cost` are written in the AdVisor repo and copied here verbatim by AdVisor's `scripts/sync-api-core.sh`. Never edit them in this repo: change them in AdVisor, run their tests there, then sync. The script refuses to overwrite a copy that was edited in place. The `core-peer` check in CI fails when the two repos' copies differ.

## Before you push

`npx vitest run` covers the guardrails above. If you changed the API, `npm run api:gen` first.
