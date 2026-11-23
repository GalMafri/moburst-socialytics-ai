-- A client user the portal deactivated loses access to their client.
--
-- QA 22 Nov 2026 (P24-01): when the Hub deactivates a person, hub-auth-bridge
-- (revokeAccess, _shared/auth/session.ts) removes their role and client_users
-- rows. is_client_member matched on the profile alone (hub_company_name, or
-- the slug allowlist), with no look at user_roles, so any session not ended
-- at deactivation (another browser, a stored refresh token) kept member
-- access: requireMember actions and every "Client users can view" policy.
-- Live on 22 Nov no profile had a company or slugs without a role, so no one
-- holds access this way today; the gap opened the first time the Hub
-- deactivated a client user.
--
-- is_client_member now also needs the caller to hold a role. Every portal
-- sign-in writes one (set_user_role), and the only way a role goes is the
-- portal taking the tool away. The body is otherwise the definition of
-- 20260720130000_company_scoped_staff.sql, as it is live. revokeAccess now
-- clears the profile's company and slugs too. Safe to apply twice.

CREATE OR REPLACE FUNCTION public.is_client_member(_client_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    -- A person the portal no longer grants the tool has no role, and no membership.
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid())
    AND (
      -- (A) legacy company-name match
      EXISTS (
        SELECT 1 FROM public.clients c
        JOIN public.profiles p ON p.user_id = auth.uid()
        WHERE c.id = _client_id
          AND c.hub_company_name IS NOT NULL
          AND p.hub_company_name IS NOT NULL
          AND LOWER(TRIM(c.hub_company_name)) = LOWER(TRIM(p.hub_company_name))
      )
      OR
      -- (B) explicit client_users override: legacy/manual only, never for a
      --     company-restricted gOS session.
      (
        NOT public.is_company_restricted()
        AND EXISTS (
          SELECT 1 FROM public.client_users cu
          WHERE cu.user_id = auth.uid() AND cu.client_id = _client_id
        )
      )
      OR
      -- (C) gOS canonical-slug allowlist (only for a gOS session)
      EXISTS (
        SELECT 1 FROM public.clients c
        JOIN public.profiles p ON p.user_id = auth.uid()
        WHERE c.id = _client_id
          AND p.hub_company_name IS NULL
          AND p.allowed_company_slugs IS NOT NULL
          AND c.company_slug IS NOT NULL
          AND c.company_slug = ANY (p.allowed_company_slugs)
      )
    )
$$;
