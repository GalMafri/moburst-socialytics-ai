# gOS (moburst.ai) integration — Socialytics

This tool now supports **two** portals at once:

| Hub | Trigger | Bridge | Status |
|-----|---------|--------|--------|
| Legacy `tools.moburst.com` | `?hubToken=…` | `hub-auth-bridge` | **unchanged** |
| New `moburst.ai` (gOS) | `/auth/handoff?token=…` | `gos-auth-bridge` | **added** |

Both bridges converge on the same Supabase session (shadow user + `user_roles` +
`profiles`), so all downstream RLS, role gates, and company scoping are identical
regardless of which portal the user came from. The legacy path was not modified.

## What was added

- `supabase/functions/gos-auth-bridge/index.ts` — server-side exchange of the gOS
  single-use handoff token; role + company-slug translation; provisions the session.
- `src/utils/gosAuth.ts`, `src/pages/AuthHandoff.tsx`, `src/pages/GosPortal.tsx` —
  the `/auth/handoff`, `/login`, `/logout`, `/portal` routes.
- `src/hooks/useAuth.tsx` — gOS handoff detection (step 0) + session reconstruction
  on reload (step 2). Legacy path untouched.
- `public/health`, `public/auth/sdk-info` — static portal probe endpoints.
- `supabase/migrations/20260720000000_gos_company_slugs.sql` — adds
  `clients.company_slug` + `profiles.allowed_company_slugs`, and an **isolated** slug
  branch in `is_client_member()` (added alongside the existing name + `client_users`
  branches; inert for legacy users, so no behavior change).

## Role mapping (gOS 5 → Socialytics 3)

| gOS role | Socialytics role |
|----------|------------------|
| `super_admin`, `admin` | `admin` |
| `account_manager`, `user` | `moburst_user` (staff) |
| `client` | `client` |

## Company scoping

gOS sends `allowed_company_slugs` (canonical slugs, e.g. `bader-law`). The bridge
stores them on `profiles.allowed_company_slugs`; `is_client_member()` matches them
against `clients.company_slug`. `company_slug` is backfilled by slugifying the
company name — verify/adjust per client if a name doesn't slugify to the catalog
slug. Staff/admin bypass company scoping (`is_moburst_staff()`), as before.

## Deploy checklist

1. **Register** on the portal — slug `socialytics`, origin = the Lovable app URL.
   Test on dev (`mobtools.ai`) first.
2. **Migration** — apply `20260720000000_gos_company_slugs.sql`.
3. **Edge function** — deploy `gos-auth-bridge` (config already sets
   `verify_jwt = false`).
4. **Secrets** (Supabase edge env):
   - `AUTH_SERVICE_URL` = `https://auth.dev-mobtools.com` (dev) /
     `https://auth.prod-mobtools.com` (prod)
   - `TOOL_ID` = `socialytics`
   - (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` already present)
5. **Frontend env** (optional): `VITE_PORTAL_URL` — defaults to `mobtools.ai` in dev
   and `moburst.ai` in prod, so usually no need to set it.
6. **Verify**: click the tool in the portal grid → lands logged in; reload stays
   logged in; a legacy `tools.moburst.com` login still works unchanged.

## Security notes (from adversarial review)

- **No dev bypass in the bridge.** `gos-auth-bridge` only accepts a real handoff
  token — there is no `devEmail`/Origin-gated path (that pattern is spoofable when
  `verify_jwt=false`). UI-only preview still uses the frontend dev user.
  ⚠️ The **legacy** `hub-auth-bridge` still has the origin-gated `devEmail` path; it
  was left untouched here but should be hardened separately (gate on a server-only
  secret, not the `Origin` header).
- **Company-scope isolation.** The gOS slug branch of `is_client_member()` fires only
  when `profiles.hub_company_name IS NULL` (a gOS session). Since the legacy bridge
  always sets `hub_company_name`, a later legacy login makes the slug branch inert —
  no cross-hub company leakage — without modifying the legacy bridge.
- **Pre-existing `client_users` branch.** Socialytics' `is_client_member()` keeps its
  legacy `client_users` override (AdVisor dropped it to fix the "Bader Law leak").
  This migration preserves that existing behavior; the gOS bridge clears
  `client_users` for gOS users so it can't affect a gOS session.
- **Dual-hub = last login wins.** gOS and legacy share one Supabase shadow user, and
  each login rewrites the single role row. A user who switches hubs takes the most
  recent hub's role/company; a still-open session from the other hub may need a
  reload. This is the "moburst.ai wins / last-write-wins" behavior to confirm as policy.

## Known follow-ups / things to verify

- **company_slug accuracy & uniqueness.** Slugs are backfilled by slugifying the
  company name and are **not** unique-constrained. Verify each client's `company_slug`
  matches the portal's canonical slug, and that two clients don't collapse to the same
  slug (which would cross-grant). Correct by hand where needed.
- **gOS client-role UX.** Staff (admin/moburst_user) is the fully-exercised path.
  Client-role company visibility now defers to RLS via `isGosSession`; validate the
  client dashboard / reports / analytics views with a real gOS client account.
- **Handoff-token tool binding.** The exchange sends `tool_id` advisorily. Confirm with
  Growth Labs that handoff tokens are tool-scoped server-side, so a token minted for
  one tool can't be replayed against the other tool's bridge.
