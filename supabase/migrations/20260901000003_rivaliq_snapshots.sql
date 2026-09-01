-- rivaliq_snapshots: raw-response cache for the RivalIQ competitive pipeline.
--
-- RivalIQ allows 1 concurrent call and 100 calls per UTC hour for the WHOLE
-- account, so every response the n8n workflow fetches is cached here verbatim.
-- Analysis steps (content breakdowns, gap identification, benchmarks) re-run
-- against this cache for free, and the history is what later enables
-- change detection ("what moved since last run").
--
-- Written exclusively by the update-competitive-report edge function (service
-- role) on behalf of n8n; read by staff for the client in question.

CREATE TABLE IF NOT EXISTS public.rivaliq_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  report_id UUID REFERENCES public.competitive_reports(id) ON DELETE SET NULL,
  landscape_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,               -- e.g. 'socialposts', 'companies', 'status'
  params_hash TEXT DEFAULT '',          -- discriminates variants of one endpoint
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rivaliq_snapshots_lookup
  ON public.rivaliq_snapshots (landscape_id, endpoint, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_rivaliq_snapshots_client
  ON public.rivaliq_snapshots (client_id, fetched_at DESC);

ALTER TABLE public.rivaliq_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can do everything with rivaliq_snapshots" ON public.rivaliq_snapshots;
CREATE POLICY "Admins can do everything with rivaliq_snapshots" ON public.rivaliq_snapshots
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Moburst staff can select rivaliq_snapshots" ON public.rivaliq_snapshots;
CREATE POLICY "Moburst staff can select rivaliq_snapshots" ON public.rivaliq_snapshots
  FOR SELECT TO authenticated
  USING (public.is_moburst_staff() AND (client_id IS NULL OR public.can_access_client(client_id)));
-- No INSERT/UPDATE policies for users: writes come from the service role only.
