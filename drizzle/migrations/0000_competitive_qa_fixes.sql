DROP POLICY IF EXISTS "Moburst staff can select rivaliq_snapshots" ON public.rivaliq_snapshots;
CREATE POLICY "Moburst staff can select rivaliq_snapshots" ON public.rivaliq_snapshots
  FOR SELECT TO authenticated
  USING (public.is_moburst_staff() AND client_id IS NOT NULL AND public.can_access_client(client_id));