# Personal API Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Moburst person (admin or Moburst user) makes their own read-only API key that reaches exactly what their account sees, live, and whose calls are recorded as them.

**Architecture:** The API core (`supabase/functions/_shared/api/`) is synced verbatim from AdVisor and does not change. `api_keys` gains `owner_user_id`; the key lookup `api_key_touch` works out a personal key's reach from its owner's access on every call and refuses a key whose owner is no longer staff; a trigger stamps the owner on each audit row. A person makes, lists and revokes their own keys through new Socialytics routes `GET/POST /v1/me/keys` and `DELETE /v1/me/keys/{id}` (`auth: "none"`, checked against the person's app session inside the handler, like `verifyAdminJwt`), using the core's `generateKey` and `hashKey`. The app gets a "Your API keys" screen for staff.

**Tech Stack:** Supabase Postgres (PGlite in tests), Deno edge function `api`, React + TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-personal-api-keys-design.md` (approved by Lital 9 Nov 2026, with her two defaults: Moburst staff only, read only).

## Global Constraints

- Only a session whose user has the `admin` or `moburst_user` role (`is_moburst_staff()`) may make or list personal keys; a `client` never can. An OAuth token from the Claude connector is refused on every `/v1/me/*` route (`oauthClientOf(token)`, as in `api/index.ts` `verifyAdminJwt`).
- A personal key: scopes exactly `{read}`, `rate_limit_per_minute` 120, `expires_at` = creation + 90 days, `company_slugs` null, `client_ids` null in the table (reach is worked out at lookup), `owner_user_id` and `created_by` = the person.
- At most 10 live (not revoked, not expired) personal keys per person; the 11th answers `409 conflict` with "You have 10 active keys. Revoke one to make another."
- Reach is live: admin owner → every client (`client_ids` null and `company_slugs` null from `api_key_touch`); `moburst_user` owner → every client with `demo_job_id is null` (demo rows stay admin-only, as in the app); owner without a staff role, or deleted → `api_key_touch` returns no row (the core answers 401).
- Never return an empty `client_ids` array for a personal key: the core reads empty as "every client". With no client to reach, return `{00000000-0000-0000-0000-000000000000}`.
- The plaintext key is returned once, at creation, never stored; only `key_hash` (the core's `hashKey`) is stored. Lists never carry `key_hash`.
- Tool keys (`owner_user_id` null) behave exactly as today, and `POST /v1/admin/keys` is unchanged.
- No file under `supabase/functions/_shared/api/` changes (`CORE.sha256` must still match).
- Tests for edge function code live under `supabase/tests/` at the code's path (`supabase/tests/paths.ts`); never inside `supabase/functions/`.
- Client-facing copy: no em or en dashes, no developer words or ids, plain American English.

## Review Focus

- A person whose role changes from `moburst_user` to `client` (or whose account is deleted) keeps a key in hand: its next call must answer 401, and no row may leak through a cached lookup. (Task 1 test.)
- A `moburst_user` personal key must never reach a demo client, by id or through a list; an admin's may. (Task 1 test.)
- A request with a valid personal key but an expired or revoked row answers 401 exactly as a tool key does. (Task 1 test, through `api_key_touch` returning the row's `expires_at`/`revoked_at` for the core to judge.)
- Someone calls `POST /v1/me/keys` with a tool API key or no Authorization at all: 401, never a key. (Task 2 test.)
- `DELETE /v1/me/keys/{id}` with another person's key id: 404 (indistinguishable from missing). (Task 2 test.)

---

### Task 1: Database: owner, live reach, audit owner

**Files:**
- Create: `supabase/migrations/20261111120000_personal_api_keys.sql`
- Test: `supabase/tests/migrations/personalApiKeys.test.ts`

**Interfaces:**
- Produces: `api_keys.owner_user_id uuid null references auth.users(id) on delete cascade` with index `api_keys_owner`; `api_key_touch(p_key_hash text)` keeps its return columns and, for a key with an owner, returns `company_slugs null` and `client_ids` per the reach rule (or no row); trigger `api_requests_owner` (before insert) sets `user_id` from the key's owner when `user_id` is null.

- [ ] **Step 1: Write the failing test** (PGlite, set up like `supabase/tests/migrations/moburstUsersSeeAllClients.test.ts`: auth stubs, `app_role`, `user_roles`, `clients` with one demo client, `api_keys`, `api_rate_buckets`, `api_requests`, live `api_key_touch` from `20261001100000_public_api.sql`). Tests:
  - `touch_tool_key_unchanged`: a key with no owner returns its stored `client_ids`/`company_slugs`.
  - `touch_admin_owner_reaches_all`: owner role `admin` → `client_ids` null, `company_slugs` null.
  - `touch_staff_owner_reaches_real_clients`: owner `moburst_user` → `client_ids` equals the non-demo client ids (sorted), demo id absent.
  - `touch_staff_owner_no_clients_sentinel`: no non-demo clients → `client_ids = {00000000-0000-0000-0000-000000000000}`.
  - `touch_owner_not_staff_refused`: owner role `client`, and owner with no role row → no row.
  - `touch_keeps_expiry_and_revocation`: owner key with `revoked_at` set → the row comes back with `revoked_at` (the core judges it).
  - `audit_stamps_owner`: insert into `api_requests (key_id, method, path, status, duration_ms)` for a personal key → `user_id` = owner; for a tool key → null; an explicit `user_id` is kept.
  - The migration applies twice.

- [ ] **Step 2: Run** `npx vitest run supabase/tests/migrations/personalApiKeys.test.ts`. Expected: FAIL (migration file missing).

- [ ] **Step 3: Write the migration.** `add column if not exists`; `create or replace function api_key_touch` keeping the rate-bucket and `last_used_at` bodies, branching on `k.owner_user_id`; the owner's role is read from `user_roles` for that user id (the function is security definer; `auth.uid()` is not the owner here); `create or replace function` + `drop trigger if exists`/`create trigger` for the audit owner.

- [ ] **Step 4: Run** the test. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Personal API keys: owner, live reach and audit owner in the database"`.

### Task 2: API routes for a person's own keys

**Files:**
- Create: `supabase/functions/api/routes-me.ts`
- Modify: `supabase/functions/api/routes-admin.ts` (the `StoredKey` and `KeyStore` types: add `owner_user_id` and `owner_email`; `publicKey` adds `owner_email`), `supabase/functions/api/index.ts` (the `keys` store: insert with owner, `listByOwner(userId)`, `revokeOwned(id, userId)`, list joins `profiles.email` as `owner_email`; a `verifyStaffSession(token)` beside `verifyAdminJwt`; register `meRoutes`), `supabase/functions/api/openapi.ts` (routes registered), `supabase/functions/api/schemas.ts` (`PersonalKey`, `PersonalKeyCreated`)
- Test: `supabase/tests/api/routes-me.test.ts`

**Interfaces:**
- Consumes: Task 1's `owner_user_id`; core `generateKey("soc")`, `hashKey(key)`.
- Produces: `meRoutes(deps: { keys: KeyStore; verifyStaffSession(token: string): Promise<{ userId: string } | null>; now(): Date }): Route[]` with
  - `GET /v1/me/keys` → `200 { data: PersonalKey[], next_cursor: null }`, newest first; `PersonalKey = { id, name, key_prefix, scopes, created_at, expires_at, last_used_at, revoked_at }`.
  - `POST /v1/me/keys` body `{ name: string }` (1 to 80 characters after trim) → `201 { data: PersonalKey & { key: string } }`.
  - `DELETE /v1/me/keys/{id}` → `200 { data: { id, revoked_at } }`; another person's or a missing id → `404 not_found`.
  - Every route: missing or invalid session, a tool API key, or an OAuth token → `401 unauthorized`; a session without a staff role → `403 forbidden` "Personal API keys are for Moburst staff."

- [ ] **Step 1: Write the failing tests** with a fake `KeyStore` and a fake `verifyStaffSession`: each Review Focus line for this task; create returns a key starting `soc_` whose `hashKey` equals the stored hash, scopes `["read"]`, rate 120, expiry exactly 90 days after `now()`; name trimmed, empty or 81 characters → `400 invalid_request`; 11th live key → `409 conflict` with the exact message; list never contains `key_hash` or `key`; admin `GET /v1/admin/keys` shows `owner_email` for a personal key and null for a tool key.
- [ ] **Step 2: Run** `npx vitest run supabase/tests/api/routes-me.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `routes-me.ts` and the store and session pieces in `index.ts`. `verifyStaffSession` mirrors `verifyAdminJwt` (refuse `oauthClientOf(token)`; `db.auth.getUser(token)`; role `admin` or `moburst_user` in `user_roles`).
- [ ] **Step 4: Run** the test, then `npx vitest run supabase/tests/api supabase/tests/_shared/api` (the core checksum and the OpenAPI contract stay green) and `deno check --no-lock supabase/functions/api/index.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Personal API keys: a person's own key routes"`.

### Task 3: The "Your API keys" screen

**Files:**
- Create: `src/pages/ApiKeys.tsx`, `src/hooks/usePersonalKeys.ts`
- Modify: the app's router (route `/api-keys`, staff only, like other staff routes), `src/components/layout/AppSidebar.tsx` (an "API keys" entry for staff, near the bottom), `src/components/settings/ApiAccessCard.tsx` (an "Owner" column: the owner's email for a personal key, "Tool" for a tool key)
- Test: `src/test/apiKeys/apiKeys.test.tsx`

**Interfaces:**
- Consumes: Task 2's routes, called with the person's session token (`supabase.auth.getSession()`), base `${VITE_SUPABASE_URL}/functions/v1/api/v1`.
- Produces: nothing for other tasks.

- [ ] **Step 1: Write the failing tests:** a `client` user is redirected away from `/api-keys` and sees no sidebar entry; staff see their keys (name, created, expires, last used, a Revoke button); making a key shows it once with Copy and the line "Copy this key now. You won't see it again."; after closing, the list shows only its prefix; revoking asks to confirm, then marks it revoked; the 409 message is shown as written; no em or en dashes and none of the banned words of `src/test/competitive/clientFacing.test.tsx` on the screen; the admin card shows the Owner column.
- [ ] **Step 2: Run** `npx vitest run src/test/apiKeys`. Expected: FAIL.
- [ ] **Step 3: Implement** the screen with the app's existing card, button, dialog and confirm components (see `ApiAccessCard.tsx` for the copy-once pattern) and the hook with TanStack Query.
- [ ] **Step 4: Run** the test and `npx tsc -b --force`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `git commit -m "Personal API keys: the Your API keys screen"`.

### Task 4: Docs

**Files:**
- Modify: `docs/api/SOCIALYTICS-API.md` (Authentication: personal keys; the `/v1/me/keys` routes), `docs/api/SOCIALYTICS-INTEGRATION-GUIDE.md` (a short "Your own key" subsection under section 3, and a section 12 entry: additive, nothing changes for tool keys), `docs/superpowers/specs/2026-11-09-personal-api-keys-design.md` ("How it fits the code": keys are made by the `/v1/me/keys` routes with the core's generator, not a database function; status line: built)

- [ ] **Step 1:** Write the doc changes; no em or en dashes.
- [ ] **Step 2: Run** `grep -c "—\|–"` on the changed docs. Expected: no new dashes.
- [ ] **Step 3: Commit** `git commit -m "Personal API keys: docs"`.
