-- Add hub_company_name to clients and profiles, then redefine is_client_member
-- to compute membership from current Hub data instead of relying on the
-- client_users cache.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS hub_company_name TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hub_company_name TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_hub_company_name_lower
  ON public.clients (LOWER(TRIM(hub_company_name)))
  WHERE hub_company_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_hub_company_name_lower
  ON public.profiles (LOWER(TRIM(hub_company_name)))
  WHERE hub_company_name IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_client_member(_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
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
    EXISTS (
      SELECT 1
      FROM public.client_users cu
      WHERE cu.user_id  = auth.uid()
        AND cu.client_id = _client_id
    )
$$;

COMMENT ON FUNCTION public.is_client_member(UUID) IS
  'Returns true if the current user is a member of the given client — either via automatic company-name matching (profiles.hub_company_name = clients.hub_company_name) or via an explicit client_users row. Computed at query time, never cached.';