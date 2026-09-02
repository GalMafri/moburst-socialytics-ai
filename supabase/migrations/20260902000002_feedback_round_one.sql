-- Social-team feedback round one (2026-09-02).
--
-- post_previews: resolved thumbnails for posts. Sprout's post analytics carry no
--   media, so the post-preview edge function resolves one per URL (YouTube id,
--   TikTok oEmbed, og:image best-effort) and caches it here. Read by any
--   authenticated user; written by the function via the service role.
-- competitive_insight_feedback: thumbs up/down per gap, per client. Down hides
--   the gap and is sent to the competitive workflow as a suppressed insight;
--   up marks it endorsed so the monthly report's calendar prioritises it.
-- report_schedules: report_kind (social|competitive), run_day_of_month (7),
--   range_mode (previous_month), last_result. Every active client gets both
--   schedules; new clients get them via trigger.

CREATE TABLE IF NOT EXISTS public.post_previews (
  url TEXT PRIMARY KEY,
  platform TEXT,
  media_type TEXT,
  image_url TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.post_previews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read post_previews" ON public.post_previews;
CREATE POLICY "Authenticated can read post_previews" ON public.post_previews FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.competitive_insight_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  insight_key TEXT NOT NULL,
  platform TEXT,
  gap_text TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('up','down')),
  report_id UUID REFERENCES public.competitive_reports(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, insight_key)
);
ALTER TABLE public.competitive_insight_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can do everything with competitive_insight_feedback" ON public.competitive_insight_feedback;
CREATE POLICY "Admins can do everything with competitive_insight_feedback" ON public.competitive_insight_feedback FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Moburst staff can select competitive_insight_feedback" ON public.competitive_insight_feedback;
CREATE POLICY "Moburst staff can select competitive_insight_feedback" ON public.competitive_insight_feedback FOR SELECT TO authenticated USING (public.can_access_client(client_id));
DROP POLICY IF EXISTS "Moburst staff can insert competitive_insight_feedback" ON public.competitive_insight_feedback;
CREATE POLICY "Moburst staff can insert competitive_insight_feedback" ON public.competitive_insight_feedback FOR INSERT TO authenticated WITH CHECK (public.can_write_client(client_id));
DROP POLICY IF EXISTS "Moburst staff can update competitive_insight_feedback" ON public.competitive_insight_feedback;
CREATE POLICY "Moburst staff can update competitive_insight_feedback" ON public.competitive_insight_feedback FOR UPDATE TO authenticated USING (public.can_write_client(client_id)) WITH CHECK (public.can_write_client(client_id));
DROP POLICY IF EXISTS "Moburst staff can delete competitive_insight_feedback" ON public.competitive_insight_feedback;
CREATE POLICY "Moburst staff can delete competitive_insight_feedback" ON public.competitive_insight_feedback FOR DELETE TO authenticated USING (public.can_write_client(client_id));

ALTER TABLE public.report_schedules ADD COLUMN IF NOT EXISTS report_kind TEXT NOT NULL DEFAULT 'social';
ALTER TABLE public.report_schedules ADD COLUMN IF NOT EXISTS run_day_of_month SMALLINT NOT NULL DEFAULT 7;
ALTER TABLE public.report_schedules ADD COLUMN IF NOT EXISTS range_mode TEXT NOT NULL DEFAULT 'previous_month';
ALTER TABLE public.report_schedules ADD COLUMN IF NOT EXISTS last_result TEXT;
-- One schedule per client per kind (the old constraint allowed one per client in total).
ALTER TABLE public.report_schedules DROP CONSTRAINT IF EXISTS report_schedules_client_id_unique;
DROP INDEX IF EXISTS public.report_schedules_client_kind_unique;
CREATE UNIQUE INDEX report_schedules_client_kind_unique ON public.report_schedules (client_id, report_kind);

UPDATE public.report_schedules
   SET run_day_of_month = 7, range_mode = 'previous_month', frequency = 'monthly', is_active = true,
       next_run_at = (date_trunc('month', now()) + interval '1 month' + interval '6 days' + interval '7 hours')
 WHERE report_kind = 'social';

INSERT INTO public.report_schedules (client_id, frequency, is_active, next_run_at, report_kind, run_day_of_month, range_mode, analysis_date_range_days, trends_date_range_days)
SELECT c.id, 'monthly', true,
       (date_trunc('month', now()) + interval '1 month' + interval '6 days' + interval '7 hours'),
       k.kind, 7, 'previous_month', 30, 7
FROM public.clients c CROSS JOIN (VALUES ('social'), ('competitive')) AS k(kind)
WHERE c.archived_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.report_schedules s WHERE s.client_id = c.id AND s.report_kind = k.kind);

CREATE OR REPLACE FUNCTION public.create_default_report_schedules()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.report_schedules (client_id, frequency, is_active, next_run_at, report_kind, run_day_of_month, range_mode, analysis_date_range_days, trends_date_range_days, created_by)
  SELECT NEW.id, 'monthly', true,
         (date_trunc('month', now()) + interval '1 month' + interval '6 days' + interval '7 hours'),
         k.kind, 7, 'previous_month', 30, 7, NEW.created_by
  FROM (VALUES ('social'), ('competitive')) AS k(kind)
  WHERE NOT EXISTS (SELECT 1 FROM public.report_schedules s WHERE s.client_id = NEW.id AND s.report_kind = k.kind);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clients_default_schedules ON public.clients;
CREATE TRIGGER clients_default_schedules AFTER INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.create_default_report_schedules();
