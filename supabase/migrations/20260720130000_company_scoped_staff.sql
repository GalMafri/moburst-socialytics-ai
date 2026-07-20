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
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid()
      AND hub_company_name IS NULL
      AND allowed_company_slugs IS NOT NULL
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

-- NOTE: existing "Admins can do everything with <table>" (is_admin) policies and
-- "Client users can view <table>" (is_client_member) policies are intentionally
-- left in place — they remain correct under this model (admins see all; the
-- client-member view is subsumed by can_access_client). If any ownership-based
-- ("created_by = auth.uid()") SELECT policies still exist on these tables, they
-- should be reviewed, as they could let a scoped user see rows they authored for
-- a company they are no longer assigned to.
