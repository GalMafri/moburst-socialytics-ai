-- Make app_settings readable by any authenticated user.
--
-- Previously this was scoped to is_moburst_staff(), but that turned out to
-- be brittle: a Moburst User session occasionally arrives with a JWT whose
-- sub doesn't match the user_roles row the bridge wrote (stale token,
-- pre-metadata auth.users row, etc.), so is_moburst_staff() returns false
-- and Run Analysis fails with "n8n webhook URL not configured" even though
-- the user is correctly assigned in the Hub.
--
-- The n8n webhook URL itself isn't a secret — it's the URL the user's own
-- browser POSTs to. Role-based gating already happens at the right layers:
--
--   * UI:   canRunAnalysis in useAuth.tsx hides Run Analysis from clients
--   * Data: clients / reports / sprout_profiles RLS still requires
--           is_moburst_staff(), so a client without a payload can't trigger
--           anything useful even if they read this URL
--
-- Editing app_settings remains admin-only via the existing FOR ALL
-- is_admin() policy.

DROP POLICY IF EXISTS "Moburst staff can read app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Authenticated users can read app_settings" ON public.app_settings;
CREATE POLICY "Authenticated users can read app_settings" ON public.app_settings
  FOR SELECT TO authenticated USING (true);
