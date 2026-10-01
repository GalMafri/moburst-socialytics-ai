# Test review: the public API and demo (2026-10-01)

Review of the tests written for the API release, with the ai-qa-review skill. Scope: the 20 new test files (113 tests). Evidence: the files ran green three times in a row (`npx vitest run` at 12:35 Israel time, 113 of 113 each run); the slowest test takes 169 ms (the Settings card render); the whole suite is 112 files and 844 tests. Mutation score: not run. It would add Stryker and its Vitest runner to Lital's project for a one-off measurement; the assertions below are checked by hand for truthiness-only checks instead (one found, fixed in this review).

## Findings, one row per file

| File | Tests | Readability | Reliability | Diagnostic | Design | AI-generated | Coverage | Severity | Action |
|---|---|---|---|---|---|---|---|---|---|
| `api/serializers.test.ts` | 11 | fixture rows named after the real client (Bader Law); `toMatchObject` with concrete values | pure, no I/O | failing values print the field | fixtures shared from `fixtures.ts` | data is the project's own shapes, not placeholders | happy path plus failed report, bare client, newer draft set, plural id lists | low | none |
| `api/schemas.test.ts` | 2 | walks every schema for forbidden names | pure | prints the offending path | gate | n/a | the forbidden list is the risk register's list | low | none |
| `api/openapi.test.ts` | 3 | builds the document from stub deps | pure | names the route and `$ref` that fail | gate | n/a | every route documented, scopes marked, internal names absent | low | none |
| `api/store.test.ts` | 1 | light row to full row | pure | field-level | mapper only | n/a | the supabase-js query builders are not unit-tested; covered live by the 19-column schema check and every list route on production | medium | keep the live schema check in the smoke suite (it is) |
| `api/routes-read.test.ts` | 7 | one scenario per route group | in-memory store, hashed keys | `toEqual` on ids, codes, details | the fake store mirrors the real filters | fixtures from the project | pagination, scoping, 404s, analytics refusals (422, 400, 502), boolean query flags | low | `next_cursor` was only checked as truthy; now decoded and compared to the last row |
| `api/routes-demo.test.ts` | 7 | copied from AdVisor, shapes adapted | in-memory job store | codes asserted | capacity, idempotency, cancel, discard refusals | n/a | fatal path is in `jobs.test.ts` (core) | low | none |
| `api/routes-admin.test.ts` | 5 | key lifecycle | in-memory | prefix and hash checks | n/a | n/a | admin JWT and admin scope, hash never returned | low | none |
| `api/worker.test.ts` | 6 | hand-built supabase stub for discard | no timers | names the function called and the actor | stub is minimal | n/a | discard of a created client, of a reused client, refused delete, lease release on error | low | the actor assertion was added after the live 500 |
| `api/jobs-store.test.ts` | 2 | visibility rule | pure | boolean rule with named cases | n/a | n/a | scoped and unscoped | low | none |
| `api/health.test.ts` | 2 | one fixture per finding kind | pure, fixed clock | asserts kinds, severities, texts | n/a | n/a | every rule plus the empty case; `loadHealthRows` (DB) covered live by `GET /v1/status` | low | none |
| `api/demo/steps.test.ts` | 27 | the harness `defaultCall` is long (one fake per project function); the whole-job test asserts 14 step outcomes in one place | fixed clock, in-memory data, no network | step results asserted with outcome, reason, data and gap codes | `upTo` and `runStep` mirror the engine so steps see each other's effects | implementation and tests by the same author in one session: the closed-loop risk is offset by the live runs (two demo rounds, every step exercised on production) | re-runs after a crash, scoped keys, missing evidence, refusals, timeouts, image failure, Sprout absent, out-of-scope fatal path | medium | split the whole-job test if a fourth outcome set is added; keep the live round as the second pair of eyes |
| `api/demo/collect.test.ts` | 2 | full and bare outputs | pure | field-level | n/a | n/a | both shapes, no internal ids | low | none |
| `api/demo/site-text.test.ts` | 2 | one real-looking page | pure | exact line list | n/a | the sample is the Brooklinen page that caused the bug | chrome-only page returns empty | low | none |
| `_shared/invoke.test.ts` | 2 | header-level | fake fetch | header names asserted | n/a | n/a | refusal and unreachable service | low | none |
| `src/test/auth/serverCaller.test.ts` | 2 | pure helper | pure | exact | n/a | n/a | UUID accepted, junk rejected | low | the gate's full branch is covered live (wrong secret 401, demos driving 12 functions) |
| `settings/ApiAccessCard.test.tsx` | 5 | role-based queries | mocked fetch, no timers | texts asserted | n/a | key values in the test are obvious placeholders by design (a key is shown once) | list, create, revoke, empty, error | low | none |
| `api/client/socialytics-api.test.ts` | 3 | fake fetch | no timers (sleep injected) | status, code, details | n/a | n/a | envelopes, errors, polling | low | none |
| core `_shared/api/*.test.ts` (synced) | 56 | AdVisor's | pure | | | | includes the new `always` test | low | reviewed in the AdVisor release |

## Systemic notes

- Reliability: no sleeps, timers or real network in any new test; the clock is injected everywhere it matters.
- Diagnostics: assertions are on codes, outcomes, ids and texts; the one truthiness check is gone.
- Automated gates in place: the schema scan for internal names, the OpenAPI contract test, the core checksum, the production smoke suite (16 checks, including the live schema-drift check).
- Known gap: the supabase-js implementations (`store.ts`, `demo/db.ts`, `health.ts` reads) have no unit tests. They are exercised live on every smoke run and were exercised by two demo rounds; a renamed column surfaces as `api_schema_drift` on `/v1/status`.
