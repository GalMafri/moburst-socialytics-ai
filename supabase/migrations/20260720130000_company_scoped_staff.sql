-- Company-scoped Moburst Users for Socialytics.
--
-- BEFORE: any Moburst staff (admin OR moburst_user) saw and managed EVERY client.
-- Company scoping applied only to the external "client" role.
--
-- AFTER: a Moburst User assigned specific companies (gOS allowed_company_slugs)
-- sees and works on ONLY those companies' data, keeping full staff features.
-- Admins, and Moburst Users with NO company assignment, are unchanged (see all).
-- Legacy tools.moburst.com users are unaffected (they carry no gOS allowlist).
--
-- Model:
--   admin/super_admin        → all data (never company-restricted)
--   moburst_user, unassigned → all data
--   moburst_user, assigned   → read + write ONLY their companies
--   client                   → read-only their companies (unchanged)
-- Existing "Admins can do everything" (is_admin) policies are left in place.

-- ── Scoping helpers (identical contract to the AdVisor tool) ──────────────────
CREATE OR REPLACE FUNCTION public.is_company_restricted()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Restricted ONLY when the gOS allowlist is NON-EMPTY. The gOS bridge writes an
  -- empty array (never NULL) for unassigned users, so a NULL/empty allowlist means
  -- "no company restriction" → sees all (matches the model; avoids locking out
  -- unassigned staff).
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid()
      AND hub_company_name IS NULL
      AND allowed_company_slugs IS NOT NULL
      AND cardinality(allowed_company_slugs) > 0
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_client(_client_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.is_admin()
    OR (public.is_moburst_staff() AND NOT public.is_company_restricted())
    OR public.is_client_member(_client_id)
$$;

CREATE OR REPLACE FUNCTION public.can_write_client(_client_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_moburst_staff() AND public.can_access_client(_client_id)
$$;

CREATE OR REPLACE FUNCTION public.can_manage_roster()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin() OR (public.is_moburst_staff() AND NOT public.is_company_restricted())
$$;

-- ── clients (id) ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Moburst staff can view clients" ON public.clients;
DROP POLICY IF EXISTS "Moburst staff can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Moburst staff can update clients" ON public.clients;
CREATE POLICY "Moburst staff can view clients" ON public.clients
  FOR SELECT TO authenticated USING (public.can_access_client(id));
CREATE POLICY "Moburst staff can insert clients" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_roster());
CREATE POLICY "Moburst staff can update clients" ON public.clients
  FOR UPDATE TO authenticated USING (public.can_write_client(id)) WITH CHECK (public.can_write_client(id));

-- ── sprout_profiles (client_id) ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Moburst staff can view sprout_profiles" ON public.sprout_profiles;
DROP POLICY IF EXISTS "Moburst staff can insert sprout_profiles" ON public.sprout_profiles;
DROP POLICY IF EXISTS "Moburst staff can update sprout_profiles" ON public.sprout_profiles;
DROP POLICY IF EXISTS "Moburst staff can delete sprout_profiles" ON public.sprout_profiles;
CREATE POLICY "Moburst staff can view sprout_profiles" ON public.sprout_profiles
  FOR SELECT TO authenticated USING (public.can_access_client(client_id));
CREATE POLICY "Moburst staff can insert sprout_profiles" ON public.sprout_profiles
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(client_id));
CREATE POLICY "Moburst staff can update sprout_profiles" ON public.sprout_profiles
  FOR UPDATE TO authenticated USING (public.can_write_client(client_id)) WITH CHECK (public.can_write_client(client_id));
CREATE POLICY "Moburst staff can delete sprout_profiles" ON public.sprout_profiles
  FOR DELETE TO authenticated USING (public.can_write_client(client_id));

-- ── reports (client_id) ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Moburst staff can view reports" ON public.reports;
DROP POLICY IF EXISTS "Moburst staff can insert reports" ON public.reports;
DROP POLICY IF EXISTS "Moburst staff can update reports" ON public.reports;
CREATE POLICY "Moburst staff can view reports" ON public.reports
  FOR SELECT TO authenticated USING (public.can_access_client(client_id));
CREATE POLICY "Moburst staff can insert reports" ON public.reports
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(client_id));
CREATE POLICY "Moburst staff can update reports" ON public.reports
  FOR UPDATE TO authenticated USING (public.can_write_client(client_id)) WITH CHECK (public.can_write_client(client_id));

-- ── report_schedules (client_id) — guarded (created by a later migration) ─────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='report_schedules') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Moburst staff can view report_schedules" ON public.report_schedules';
    EXECUTE 'DROP POLICY IF EXISTS "Moburst staff can insert report_schedules" ON public.report_schedules';
    EXECUTE 'DROP POLICY IF EXISTS "Moburst staff can update report_schedules" ON public.report_schedules';
    EXECUTE 'CREATE POLICY "Moburst staff can view report_schedules" ON public.report_schedules FOR SELECT TO authenticated USING (public.can_access_client(client_id))';
    EXECUTE 'CREATE POLICY "Moburst staff can insert report_schedules" ON public.report_schedules FOR INSERT TO authenticated WITH CHECK (public.can_write_client(client_id))';
    EXECUTE 'CREATE POLICY "Moburst staff can update report_schedules" ON public.report_schedules FOR UPDATE TO authenticated USING (public.can_write_client(client_id)) WITH CHECK (public.can_write_client(client_id))';
  END IF;
END $$;

-- ── post_iterations / brand_voice_learnings / design_states (all have client_id) ─
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['post_iterations','brand_voice_learnings','design_states'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('DROP POLICY IF EXISTS "Moburst staff can select %I" ON public.%I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "Moburst staff can insert %I" ON public.%I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "Moburst staff can update %I" ON public.%I', t, t);
      EXECUTE format('CREATE POLICY "Moburst staff can select %I" ON public.%I FOR SELECT TO authenticated USING (public.can_access_client(client_id))', t, t);
      EXECUTE format('CREATE POLICY "Moburst staff can insert %I" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_write_client(client_id))', t, t);
      EXECUTE format('CREATE POLICY "Moburst staff can update %I" ON public.%I FOR UPDATE TO authenticated USING (public.can_write_client(client_id)) WITH CHECK (public.can_write_client(client_id))', t, t);
    END IF;
  END LOOP;
END $$;

-- ── Drop residual permissive USING(true) policies (CRITICAL pre-existing leak) ─
-- post_iterations, brand_voice_learnings and design_states were created with
-- role-less USING(true) policies that granted every authenticated user (and even
-- external clients) full read — and, via FOR ALL, write — of ALL clients' rows.
-- RLS OR-s permissive policies, so these defeated the scoped policies above. Drop
-- them; legitimate staff access now flows through the scoped policies, and edge
-- functions use the service role (which bypasses RLS).
DROP POLICY IF EXISTS "Users can read post iterations for their clients" ON public.post_iterations;
DROP POLICY IF EXISTS "Users can insert post iterations" ON public.post_iterations;
DROP POLICY IF EXISTS "Users can read brand voice learnings" ON public.brand_voice_learnings;
DROP POLICY IF EXISTS "Service role can manage brand voice learnings" ON public.brand_voice_learnings;
DROP POLICY IF EXISTS "Users can manage design states" ON public.design_states;

-- ── Harden is_client_member: gate the client_users branch to non-gOS sessions ─
-- The client_users override is a LEGACY mechanism. For a gOS session (which has a
-- company allowlist), scoping must be slug-only, so a stale client_users row can't
-- grant access to a company outside the allowlist. The gOS bridge already wipes
-- client_users on every gOS login; this is defense-in-depth.
CREATE OR REPLACE FUNCTION public.is_client_member(_client_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
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
    -- (B) explicit client_users override — legacy/manual only, never for a
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
$$;

-- NOTE: existing "Admins can do everything with <table>" (is_admin) policies and
-- "Client users can view <table>" (is_client_member) policies are intentionally
-- left in place — they remain correct under this model (admins see all; the
-- client-member view is subsumed by can_access_client). If any ownership-based
-- ("created_by = auth.uid()") SELECT policies still exist on these tables, they
-- should be reviewed, as they could let a scoped user see rows they authored for
-- a company they are no longer assigned to.
