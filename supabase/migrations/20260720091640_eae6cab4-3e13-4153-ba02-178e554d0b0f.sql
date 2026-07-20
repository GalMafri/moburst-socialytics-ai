ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS company_slug TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS allowed_company_slugs TEXT[];

CREATE INDEX IF NOT EXISTS idx_clients_company_slug ON public.clients (company_slug);

UPDATE public.clients
   SET company_slug = TRIM(BOTH '-' FROM
         REGEXP_REPLACE(LOWER(TRIM(COALESCE(hub_company_name, name))), '[^a-z0-9]+', '-', 'g'))
 WHERE company_slug IS NULL OR company_slug = '';

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
      WHERE cu.user_id = auth.uid()
        AND cu.client_id = _client_id
    )
    OR
    EXISTS (
      SELECT 1
      FROM public.clients c
      JOIN public.profiles p ON p.user_id = auth.uid()
      WHERE c.id = _client_id
        AND p.hub_company_name IS NULL
        AND p.allowed_company_slugs IS NOT NULL
        AND c.company_slug IS NOT NULL
        AND c.company_slug = ANY (p.allowed_company_slugs)
    )
$$;

COMMENT ON FUNCTION public.is_client_member(UUID) IS
  'True if the current user may see the given client. Matches the legacy company-name
  link, an explicit client_users row, OR — for a gOS session (hub_company_name IS NULL) —
  the gOS canonical-slug allowlist (clients.company_slug = ANY(profiles.allowed_company_slugs)).';