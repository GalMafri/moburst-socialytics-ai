-- Company scoping applied to cached RivalIQ responses.
--
-- Applied by hand against the live Lovable-managed project; this file is the
-- record, not the mechanism.
--
-- The staff SELECT policy read:
--   is_moburst_staff() AND (client_id IS NULL OR can_access_client(client_id))
-- is_moburst_staff() is a pure role check, so the `client_id IS NULL` disjunct
-- handed every row with no client to every staff member, company scoping and
-- all. Nothing legitimately writes such a row — update-competitive-report
-- always has a client — and there are none in the table, so the disjunct only
-- ever widened access. Admins keep full access through their own policy.

DROP POLICY IF EXISTS "Moburst staff can select rivaliq_snapshots" ON public.rivaliq_snapshots;
CREATE POLICY "Moburst staff can select rivaliq_snapshots" ON public.rivaliq_snapshots
  FOR SELECT TO authenticated
  USING (public.is_moburst_staff() AND client_id IS NOT NULL AND public.can_access_client(client_id));
