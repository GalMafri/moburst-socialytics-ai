-- Milestone 4: competitor monitoring.
-- competitive_alerts holds topic convergences detected in the weekly competitor
-- feed (two or more competitors posting about the same thing inside the window)
-- with a confidence score. Rows are written by the refresh-competitor-feed edge
-- function (service role); staff read them for their clients and can dismiss or
-- mark them drafted. Applied to the live database by hand on 2026-09-03; this
-- file mirrors it and is idempotent.

CREATE TABLE IF NOT EXISTS public.competitive_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  topic TEXT NOT NULL,
  topic_key TEXT NOT NULL,
  summary TEXT,
  companies TEXT[] NOT NULL DEFAULT '{}',
  platforms TEXT[] NOT NULL DEFAULT '{}',
  post_urls TEXT[] NOT NULL DEFAULT '{}',
  post_count INT NOT NULL DEFAULT 0,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','dismissed','drafted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, window_start, topic_key)
);

ALTER TABLE public.competitive_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can do everything with competitive_alerts" ON public.competitive_alerts;
CREATE POLICY "Admins can do everything with competitive_alerts"
  ON public.competitive_alerts FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Staff can view competitive_alerts" ON public.competitive_alerts;
CREATE POLICY "Staff can view competitive_alerts"
  ON public.competitive_alerts FOR SELECT TO authenticated
  USING (public.is_moburst_staff() AND public.can_access_client(client_id));

DROP POLICY IF EXISTS "Staff can update competitive_alerts" ON public.competitive_alerts;
CREATE POLICY "Staff can update competitive_alerts"
  ON public.competitive_alerts FOR UPDATE TO authenticated
  USING (public.can_write_client(client_id)) WITH CHECK (public.can_write_client(client_id));

CREATE INDEX IF NOT EXISTS competitive_alerts_client_window_idx
  ON public.competitive_alerts (client_id, window_start DESC);
