-- Replace is_client_member() with a COMPUTED check so Client-role scoping is
-- always in sync with the Hub's current state. No more reliance on the
-- client_users cache being fresh.
--
-- How it works:
--   A user is a "member" of a client if EITHER
--   (A) their profiles.hub_company_name (set by the bridge on every login)
--       matches the client's hub_company_name (admin-configured), OR
--   (B) an explicit row in client_users links them (manual admin override for
--       edge cases).
--
-- Why this is better than the old client_users-only check:
--   - No stale state. profiles is rewritten on every login; clients is
--     admin-managed. Both are current.
--   - Changing a user's Hub company takes effect on their next login with no
--     cleanup step.
--   - client_users still works for admins who want to manually pin a user to
--     a specific client (e.g. a consultant who needs access to multiple
--     clients across companies). Optional, not required.

CREATE OR REPLACE FUNCTION public.is_client_member(_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Automatic match via company name. No cache.
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
    -- Explicit admin override via client_users.
    EXISTS (
      SELECT 1
      FROM public.client_users cu
      WHERE cu.user_id  = auth.uid()
        AND cu.client_id = _client_id
    )
$$;

COMMENT ON FUNCTION public.is_client_member(UUID) IS
  'Returns true if the current user is a member of the given client — either via
  automatic company-name matching (profiles.hub_company_name = clients.hub_company_name)
  or via an explicit client_users row. Computed at query time, never cached.';
