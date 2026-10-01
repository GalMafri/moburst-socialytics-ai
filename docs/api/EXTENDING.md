# Extending the API

The API is built to absorb new features without rework. Each kind of change has one place. (The same guide, with the AdVisor names, is `docs/api/EXTENDING.md` in the AdVisor repo.)

## Add a field to a resource

1. Add the column to the store's column list for that table (`supabase/functions/api/store.ts`, `*_COLUMNS`; lists read light columns, with JSON sub-fields of `report_data` by alias). Reads are explicit so nothing internal slips out by accident.
2. Add the field to the serializer in `supabase/functions/api/serializers.ts` and to its test with a fixture value (`fixtures.ts`).
3. Add it to the matching schema in `supabase/functions/api/schemas.ts`. The contract test fails if an internal name (`sprout_profile_id`, `sprout_customer_id`, `landscape_id`, `rivaliq_company_id`, `company_id`, `request_id`, `model_path`, `key_hash`, `app_settings`) appears.

Adding fields never breaks a consumer. Renaming or removing one does: keep the old name (or add a `/v2` route table beside `/v1`).

## Add a route

Add one entry to the route table (`routes-read.ts`, `routes-demo.ts`, `routes-admin.ts`, or a new `routes-<area>.ts` mounted in `openapi.ts`). A route declares its method, path, auth kind, scope, documentation (`doc`) and handler. The OpenAPI document is generated from the table, so a route cannot exist undocumented; `openapi.test.ts` checks that every `doc.response` and `doc.body` names a schema that exists and that no internal identifier is documented.

Scoping is in the store: every list takes the key's `ClientScope`, every single read checks the row's client. A new query must do the same (`keyset(q, page, "client_id", scope)`).

A route that needs one of the project's functions calls it through `_shared/invoke.ts` (the operational secret plus the user acted for), never with a user JWT.

## Add a step to the demo

`DEMO_STEPS` in `supabase/functions/api/demo/steps.ts` is an ordered list of `{ name, run(job, ctx) }`. A step:

- checks what already exists before creating anything (the worker re-runs a step after a crash);
- returns `done`, `skipped` (with a `reason` code), `failed` (with a `reason` and a plain `message`; `fatal: true` only when nothing further makes sense), or `waiting` (with `check_in_s`);
- records gaps (`{ step, code, message }`) instead of stopping;
- stamps every row it writes with `demo_job_id`, and flags rows the project's functions create for it (`flagReport`);
- acts for the job's user (`actorOf(job, client)`) when it calls a function;
- may carry `always: true` when it has to run even after a fatal failure (the callback does); every other pending step is then skipped with reason `job_failed`.

Jobs keep the step list they were created with, so adding a step does not touch jobs in flight. Put the outputs of a new step into `collect.ts` so `GET /v1/demo-jobs/{id}` returns them, and extend `refreshOutputs` if the step's result can land after the job closed. Test it against the in-memory `DemoDb` fake in `steps.test.ts`.

## Add a data source the steps need

Add a method to the `DemoDb` interface (`demo/db.ts`), its supabase-js implementation, and its in-memory version in `demo/fake-db.ts`.

## Add a health finding

`health.ts`: add the rows to `HealthRows` and `loadHealthRows`, the rule to `buildFindings` (pure, tested in `health.test.ts`). Findings carry `client_id` so a scoped key sees only its own.

## The shared core

`supabase/functions/_shared/api/*` is written once, in AdVisor, and copied here by `scripts/sync-api-core.sh` in the AdVisor repo; `core-checksum.test.ts` fails when the copy drifts. Change the core in AdVisor, sync, and commit both repos.

## Versioning and change safety

- `/v1` is stable: fields are added, never renamed or removed. A breaking change is a second route table under `/v2` mounted beside the first; `X-Api-Version` says which one answered.
- `GET /v1/status` runs every column list against the live database and reports `api_schema_drift` findings, so a renamed column shows up in the smoke suite the same day.
- Before every push: merge `origin/main` (Lovable commits there), run `npm test`, `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`, then push and publish.
