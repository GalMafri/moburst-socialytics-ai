-- Fix: Moburst User role couldn't run reports or save client edits.
--
-- Two RLS gaps were missed by the Hub-integration migration
-- (20260419000002_hub_integration.sql):
--
-- 1. app_settings had only an admin policy. RunAnalysis.tsx reads
--    n8n_webhook_url from this table client-side; for moburst_user the read
--    returned no rows and the UI threw "n8n webhook URL not configured".
--
-- 2. sprout_profiles had Moburst-staff policies for SELECT/INSERT/UPDATE
--    but not DELETE. ClientSetup save does a delete-then-insert on profile
--    re-assignment, so the DELETE silently no-op'd under RLS and the
--    re-INSERT then collided on UNIQUE(client_id, sprout_profile_id),
--    breaking the save.
--
-- DELETE on clients / reports / etc. stays admin-only by intent
-- ("Moburst staff cannot hard-delete"). sprout_profiles is a join/assignment
-- table, not destructive client data, so DELETE for moburst_staff is
-- consistent with the "manage clients" capability.

-- ── 1. app_settings: read access for Moburst staff ──────────────────────────
-- Editing app_settings remains admin-only via the existing FOR ALL policy.
-- The Settings page UI is already gated on isAdmin client-side.
DROP POLICY IF EXISTS "Moburst staff can read app_settings" ON public.app_settings;
CREATE POLICY "Moburst staff can read app_settings" ON public.app_settings
  FOR SELECT TO authenticated USING (public.is_moburst_staff());

-- ── 2. sprout_profiles: delete access for Moburst staff ─────────────────────
-- Required for the delete-then-insert pattern in ClientSetup.saveMutation
-- when a Moburst User changes a client's selected Sprout profiles.
DROP POLICY IF EXISTS "Moburst staff can delete sprout_profiles" ON public.sprout_profiles;
CREATE POLICY "Moburst staff can delete sprout_profiles" ON public.sprout_profiles
  FOR DELETE TO authenticated USING (public.is_moburst_staff());
