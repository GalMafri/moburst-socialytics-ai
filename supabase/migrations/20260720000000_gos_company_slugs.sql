-- gOS (moburst.ai) company-slug scoping for Socialytics.
--
-- The legacy hub scopes Client-role users by company NAME
-- (profiles.hub_company_name = clients.hub_company_name) OR an explicit client_users
-- row. gOS instead sends an allowlist of canonical company SLUGS (e.g. "bader-law").
-- This migration adds an ISOLATED slug-based path so gOS multi-company access works
-- WITHOUT changing the existing name/client_users behavior for legacy-hub users.
--
-- Safety: legacy-hub users have profiles.allowed_company_slugs = NULL, so the new
-- slug branch below is inert for them — is_client_member() behaves exactly as before
-- (the name-OR-client_users definition from 20260420145500).

-- ── 1. Canonical slug on each client ─────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS company_slug TEXT;

-- ── 2. gOS allowlist on the user profile ─────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS allowed_company_slugs TEXT[];

CREATE INDEX IF NOT EXISTS idx_clients_company_slug ON public.clients (company_slug);

-- ── 3. Backfill company_slug from the human company name ─────────────────────
-- Slugify: lowercase, trim, non-alphanumeric runs → single hyphen, strip edges.
-- Matches the portal's catalog convention ("Bader Law" → "bader-law").
-- Socialytics' clients name column is "name" (AdVisor's is "client_name").
UPDATE public.clients
   SET company_slug = TRIM(BOTH '-' FROM
         REGEXP_REPLACE(LOWER(TRIM(COALESCE(hub_company_name, name))), '[^a-z0-9]+', '-', 'g'))
 WHERE company_slug IS NULL OR company_slug = '';

-- ── 4. Extend is_client_member() with an isolated slug branch ────────────────
-- Preserves the existing name match AND the client_users override (20260420145500),
-- and ADDS the slug allowlist check. For legacy users (allowed_company_slugs IS NULL)
-- the added branch is always false, so their scope is unchanged.
CREATE OR REPLACE FUNCTION public.is_client_member(_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- (A) Legacy name-based match (unchanged)
    EXISTS (
      SELECT 1
      FROM public.clients c
      JOIN public.profiles p ON p.user_id = auth.uid()
      WHERE c.id = _client_id
        AND c.hub_company_name IS NOT NULL
        AND p.hub_company_name IS NOT NULL
        AND LOWER(TRIM(c.hub_company_name)) = LOWER(TRIM(p.hub_company_name))
    )
    OR
    -- (B) Explicit client_users override (unchanged)
    EXISTS (
      SELECT 1
      FROM public.client_users cu
      WHERE cu.user_id = auth.uid()
        AND cu.client_id = _client_id
    )
    OR
    -- (C) gOS canonical-slug allowlist (new; inert unless the gOS bridge set it)
    EXISTS (
      SELECT 1
      FROM public.clients c
      JOIN public.profiles p ON p.user_id = auth.uid()
      WHERE c.id = _client_id
        AND p.allowed_company_slugs IS NOT NULL
        AND c.company_slug IS NOT NULL
        AND c.company_slug = ANY (p.allowed_company_slugs)
    )
$$;

COMMENT ON FUNCTION public.is_client_member(UUID) IS
  'True if the current user may see the given client. Matches the legacy company-name
  link, an explicit client_users row, OR the gOS canonical-slug allowlist
  (clients.company_slug = ANY(profiles.allowed_company_slugs)). Computed at query time.';
