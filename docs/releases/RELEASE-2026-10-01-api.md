# Release record: the Socialytics public API and the ad-hoc demo (2026-10-01)

Go/no-go record for the API shipped to Socialytics on 2026-10-01 between 11:00 and [end time] Israel time, written with the release-readiness skill. The risk matrix is in `.agents/qa-project-context.md` (rows S1 to S11). Everything listed is in production; this record says what evidence stands behind each part and what is still open.

## Scope

Commits `899c303` to `[last]` on main: the `api` edge function on the shared core copied from AdVisor (`_shared/api`, checksum-pinned), the Socialytics read routes, the demo job with its fourteen steps and worker, key management, the Settings card, the typed client and MCP manifest, the staff gate's server path (`requireStaff` accepts the operational secret plus the user acted for), the migration `20261001100000_public_api.sql` (four tables, three SQL functions, two crons, six flag columns, the operational secret moved into Vault), and three fixes the live run exposed the same morning (per-client write checks refused the server caller in five functions; report details carried `profile_ids` lists; scraped page text was drafted into briefs with its navigation). Edge functions deployed: `api` and the 46 functions that bundle the staff gate (twice for six of them). Frontend published twice (the card, then its error state).

The shared core changed too, in AdVisor first and synced here: a step marked `always` (the callback) runs after a fatal failure; `unprocessable` and `upstream_failed` joined the error vocabulary. AdVisor's `api` was redeployed from `3779c5c`.

## Go/no-go checklist with evidence

| Check | Result | Evidence |
|-------|--------|----------|
| Unit and component tests | pass | `npm test`: 112 files, 844 tests green on the merged tree (Lital's Lovable commits merged first); 31 serializer and route tests, 28 demo step tests, 2 health, 3 OpenAPI, 1 store, 5 card, 3 client |
| Type check, lint, build | pass | `tsc` exit 0; `eslint` clean on every new file (ten pre-existing `any`s remain in five function files the fix touched); `vite build` ok |
| Contract: every route documented | pass | `openapi.test.ts`: 27 public paths, every `$ref` resolves, internal route absent, no internal identifier in the document; live `GET /v1/openapi.json` 40 KB |
| Confidentiality scan | pass after fix | `schemas.test.ts` finds no Sprout, RivalIQ, media provider or key-hash property; live report detail carried `profile_ids` lists in `performance` at 11:58, stripped and redeployed by 12:07 |
| Migration applied | pass | tables `api_keys`, `api_requests`, `api_rate_buckets`, `demo_jobs`; functions `api_key_touch`, `demo_jobs_lease`, `api_purge_audit` executable by `service_role` only; crons `api-demo-worker` (every minute) and `api-audit-purge` (03:15 UTC); `demo_job_id` on six tables; `socialytics_n8n_secret` in Vault (64 characters) and both crons read it (`plaintext_secret: false`) |
| Production smoke suite | 16 of 16 | `scripts/smoke-prod.sh` with `SOCIALYTICS_API_TEST_KEY` at 12:00 |
| Auth and scoping, live | pass | no key 401, bad key 401, worker without the cron secret 401, wrong server secret on a gated function 401; the company-scoped key saw only Bader Law, 404 on LegaBot, filtered lists empty, status filtered, admin 403, demo list empty |
| Rate limit, live | pass | a 5-per-minute key: five 200s then 429 with `retry-after: 39`, `x-request-id`, `x-api-version: 1` |
| Every read route, live | pass | 17 routes exercised with a key at 11:55 to 12:05 against Bader Law: clients (3, paginated), detail with 5 profiles and 7 sets, setup (3 issues), analytics (951,824 impressions over September, 10 top posts, no profile ids), reports (14; detail with analysis, 7 calendar days, performance, trends), competitive reports (13; detail with scorecard and 4 companies, no RivalIQ ids), sets with handles, posts (32), media jobs, schedules, scheduled posts, alerts, design systems (preview URLs), status, admin keys (no hash) |
| Same numbers as the app | pass | the report detail's calendar, counts and deck URL are the stored `report_data`; the analytics totals come from `sprout-analytics`, the function the Analytics page calls |
| Schema drift check | pass | `GET /v1/status` tries 19 column lists live: 0 findings |
| Health findings | pass | status reports `media_failed: Moburst` (5 failed generations in 24 hours), a real finding |
| Settings card | pass | 5 component tests; seen on the dev server at 1440x900 (count tile, title, copy, create button); the published bundle carries the card and its error state |
| Demo, round one (Brooklinen `2327739d`, Calm `e238bdd9`, 12:00 to 12:20) | partial, then discarded | both created their client, researched the brand (navy palette and Inter; yellow and blue and Montserrat), drafted a brief, derived pillars and keywords, and wrote an Instagram post with a Gemini image carrying the brand's logo; both callbacks delivered (sink executions 489899, 489900). Found and fixed the same hour: the competitor functions refused the server caller (S4); the social workflow cannot run without a Sprout profile and its failure marker was broken (two report rows marked failed by hand); the brief was drafted from navigation text; the stored image name ended in `.png.png`; the first discard ran as the requester's id and answered 500. Both jobs then discarded through the API (clients and rows gone; two orphan media files led to the delete-client fix) |
| Demo, round two (Brooklinen `7e92b632`, Calm `f7679522`, from 12:27) | [pending] | on the fixed code: cleaned briefs ("Shop bundles with built-in savings", "Calm your mind. Change your life."), 5 and 6 pillars, 3 competitors selected and confirmed each (Boll & Branch, Quince, Pottery Barn; Headspace, Balance, Ten Percent Happier), RivalIQ landscapes created; tracking and the competitive report in progress |
| Fatal path and its callback, live | pass | the company-scoped key asked for a demo on Calm: job `56c69629` failed at `resolve_client` (`out_of_scope`), the twelve other steps skipped `job_failed`, the callback delivered with `status: failed` (sink execution 489888) |
| Idempotency and capacity | pass | the Brooklinen request replayed with its key returned the same job (200); an empty body 400 with `field: client_name`; capacity 3 refused a fourth job (unit) |
| Rollback plan | written | below |

## Rollback plan

- Frontend: `deploy_project` republishes the previous commit after a revert of `b4edb55` and `63d8a66`.
- Functions: the `api` function can be removed from the project; the 46 redeployed functions only gained the server-call branch in `requireStaff`, which no browser call reaches; reverting `899c303` and redeploying restores the old gate.
- Database: the four API tables, three functions and two crons can be dropped (`cron.unschedule`); the `demo_job_id` columns are nullable and unused by the app. The Vault move is kept either way: the plain-text secret no longer sits in a cron command.
- Keys: the three session keys are revoked at the end of the session; any other key can be revoked from the Settings card.
