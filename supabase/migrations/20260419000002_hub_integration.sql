-- Hub integration: role helpers, company mapping, and role-scoped RLS policies.
--
-- After this migration:
--   - Every Supabase user can be synced from the Hub by the hub-auth-bridge edge function
--   - is_moburst_staff() returns true for admin AND moburst_user
--   - client users see only the clients whose hub_company_name matches their Hub profile
--     (via the existing client_users join, populated automatically by the bridge)

-- ── 1. Profile extensions for Hub linkage ────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hub_user_id TEXT,
  ADD COLUMN IF NOT EXISTS hub_company_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_hub_user_id ON public.profiles (hub_user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_hub_company_lower
  ON public.profiles (LOWER(hub_company_name));

-- ── 2. Client table: mark which Hub company a client belongs to ──────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS hub_company_name TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_hub_company_lower
  ON public.clients (LOWER(hub_company_name));

-- Backfill: any row without a hub_company_name defaults to the client's own name.
-- This makes auto-mapping work for existing data as long as the Hub company is
-- named identically. Moburst admins can edit hub_company_name later from the tool.
UPDATE public.clients
   SET hub_company_name = name
 WHERE hub_company_name IS NULL OR hub_company_name = '';

-- ── 3. Role helpers ──────────────────────────────────────────────────────────
-- is_admin() already exists. Add is_moburst_staff() for the broader Moburst tier.
CREATE OR REPLACE FUNCTION public.is_moburst_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin'::public.app_role, 'moburst_user'::public.app_role)
  )
$$;

COMMENT ON FUNCTION public.is_moburst_staff() IS
  'True if the current user is an admin or a Moburst staff member. Used by RLS to allow
  broad read/write access to internal Moburst users while still blocking destructive ops
  behind is_admin().';

-- ── 4. Role-scoped policies for core tables ──────────────────────────────────
-- We ADD policies rather than replacing existing ones. Postgres RLS is OR-ed, so the
-- previous ownership/admin policies still apply. Moburst staff get broad read/write
-- on top. Only admin can DELETE (existing `is_admin()` FOR ALL policy covers delete).

-- clients
DROP POLICY IF EXISTS "Moburst staff can view clients" ON public.clients;
DROP POLICY IF EXISTS "Moburst staff can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Moburst staff can update clients" ON public.clients;
CREATE POLICY "Moburst staff can view clients" ON public.clients
  FOR SELECT TO authenticated USING (public.is_moburst_staff());
CREATE POLICY "Moburst staff can insert clients" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (public.is_moburst_staff());
CREATE POLICY "Moburst staff can update clients" ON public.clients
  FOR UPDATE TO authenticated USING (public.is_moburst_staff()) WITH CHECK (public.is_moburst_staff());

-- sprout_profiles
DROP POLICY IF EXISTS "Moburst staff can view sprout_profiles" ON public.sprout_profiles;
DROP POLICY IF EXISTS "Moburst staff can insert sprout_profiles" ON public.sprout_profiles;
DROP POLICY IF EXISTS "Moburst staff can update sprout_profiles" ON public.sprout_profiles;
CREATE POLICY "Moburst staff can view sprout_profiles" ON public.sprout_profiles
  FOR SELECT TO authenticated USING (public.is_moburst_staff());
CREATE POLICY "Moburst staff can insert sprout_profiles" ON public.sprout_profiles
  FOR INSERT TO authenticated WITH CHECK (public.is_moburst_staff());
CREATE POLICY "Moburst staff can update sprout_profiles" ON public.sprout_profiles
  FOR UPDATE TO authenticated USING (public.is_moburst_staff()) WITH CHECK (public.is_moburst_staff());

-- reports
DROP POLICY IF EXISTS "Moburst staff can view reports" ON public.reports;
DROP POLICY IF EXISTS "Moburst staff can insert reports" ON public.reports;
DROP POLICY IF EXISTS "Moburst staff can update reports" ON public.reports;
CREATE POLICY "Moburst staff can view reports" ON public.reports
  FOR SELECT TO authenticated USING (public.is_moburst_staff());
CREATE POLICY "Moburst staff can insert reports" ON public.reports
  FOR INSERT TO authenticated WITH CHECK (public.is_moburst_staff());
CREATE POLICY "Moburst staff can update reports" ON public.reports
  FOR UPDATE TO authenticated USING (public.is_moburst_staff()) WITH CHECK (public.is_moburst_staff());

-- client_users (the join table that maps users → clients)
DROP POLICY IF EXISTS "Moburst staff can manage client_users" ON public.client_users;
CREATE POLICY "Moburst staff can manage client_users" ON public.client_users
  FOR ALL TO authenticated
  USING (public.is_moburst_staff())
  WITH CHECK (public.is_moburst_staff());

-- report_schedules (exists from a later migration)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='report_schedules') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Moburst staff can view report_schedules" ON public.report_schedules';
    EXECUTE 'DROP POLICY IF EXISTS "Moburst staff can insert report_schedules" ON public.report_schedules';
    EXECUTE 'DROP POLICY IF EXISTS "Moburst staff can update report_schedules" ON public.report_schedules';
    EXECUTE 'CREATE POLICY "Moburst staff can view report_schedules" ON public.report_schedules FOR SELECT TO authenticated USING (public.is_moburst_staff())';
    EXECUTE 'CREATE POLICY "Moburst staff can insert report_schedules" ON public.report_schedules FOR INSERT TO authenticated WITH CHECK (public.is_moburst_staff())';
    EXECUTE 'CREATE POLICY "Moburst staff can update report_schedules" ON public.report_schedules FOR UPDATE TO authenticated USING (public.is_moburst_staff()) WITH CHECK (public.is_moburst_staff())';
  END IF;
END $$;

-- Later tables from V2 migrations (post_iterations, brand_voice_learnings, design_states).
-- Guard with existence checks so the migration is idempotent across environments.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['post_iterations','brand_voice_learnings','design_states'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('DROP POLICY IF EXISTS "Moburst staff can select %I" ON public.%I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "Moburst staff can insert %I" ON public.%I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS "Moburst staff can update %I" ON public.%I', t, t);
      EXECUTE format('CREATE POLICY "Moburst staff can select %I" ON public.%I FOR SELECT TO authenticated USING (public.is_moburst_staff())', t, t);
      EXECUTE format('CREATE POLICY "Moburst staff can insert %I" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_moburst_staff())', t, t);
      EXECUTE format('CREATE POLICY "Moburst staff can update %I" ON public.%I FOR UPDATE TO authenticated USING (public.is_moburst_staff()) WITH CHECK (public.is_moburst_staff())', t, t);
    END IF;
  END LOOP;
END $$;
