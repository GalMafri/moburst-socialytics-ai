-- Extend the app_role enum to cover the 3-tier Hub role model:
--   admin         = can do everything (Moburst ops)
--   moburst_user  = Moburst staff (can manage clients, run reports, cannot hard-delete)
--   client        = external client contact (read-only, scoped to their company)
--
-- The existing 'admin' value stays. 'user' stays for backwards compatibility but is unused.
-- This must run in its own migration so the new enum values are committed before
-- any later migration uses them in function bodies or policies.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'moburst_user';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'client';
