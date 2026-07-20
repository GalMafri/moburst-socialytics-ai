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
