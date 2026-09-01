-- Competitive analysis foundation (project steps 1-6).
--
-- Data model:
--   competitor_sets     one review cycle for a client. AI drafts it, a human
--                       confirms it. Exactly one set is "current" per client
--                       (the latest confirmed one).
--   competitors         candidates inside a set. AI-proposed rows carry a
--                       rationale + similarity score; humans can add manual
--                       rows, deselect misfits, and rank the top 3.
--   competitor_handles  per-competitor social handles with an active flag per
--                       platform (step 4's platform detection output).
--   competitive_reports the deep-analysis output (steps 7-11, Milestone 3
--                       fills report_data; the table exists now so the run
--                       trigger and history UI are real from day one).
--
-- clients.competitor_seed_notes is the only client-row addition: free text
-- from the account team about who they think the client competes with, fed
-- into the AI identification prompt.
--
-- PERMISSIONS. Staff write, clients read ONLY the finished deck:
--   competitor_sets / competitors / competitor_handles — staff-only both ways.
--     A half-reviewed competitor list must never be client-visible, so the
--     SELECT policy requires is_moburst_staff() IN ADDITION to client access
--     (can_access_client alone would let client members through).
--   competitive_reports — staff read/write; client members read rows with
--     status='complete' only.
-- All tables carry client_id so the company-scoped-staff helpers apply as-is.

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS competitor_seed_notes TEXT DEFAULT '';

-- ── competitor_sets ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competitor_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'analyzing', 'complete', 'failed')),
  notes TEXT DEFAULT '',
  generated_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  confirmed_by UUID REFERENCES auth.users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_sets_client
  ON public.competitor_sets (client_id, created_at DESC);

-- ── competitors ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id UUID NOT NULL REFERENCES public.competitor_sets(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  website_url TEXT,
  rationale TEXT DEFAULT '',
  similarity_score NUMERIC(3,2) CHECK (similarity_score IS NULL OR (similarity_score >= 0 AND similarity_score <= 1)),
  source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'manual')),
  is_selected BOOLEAN NOT NULL DEFAULT false,
  selected_rank SMALLINT CHECK (selected_rank IS NULL OR selected_rank BETWEEN 1 AND 3),
  rivaliq_company_id TEXT,          -- filled by Milestone 3's landscape sync
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitors_set ON public.competitors (set_id);
CREATE INDEX IF NOT EXISTS idx_competitors_client ON public.competitors (client_id);
-- At most one competitor per rank inside a set.
CREATE UNIQUE INDEX IF NOT EXISTS idx_competitors_rank
  ON public.competitors (set_id, selected_rank) WHERE selected_rank IS NOT NULL;

-- ── competitor_handles ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competitor_handles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,           -- instagram | tiktok | facebook | linkedin | youtube | x
  handle TEXT NOT NULL,
  profile_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  followers BIGINT,
  detection_confidence NUMERIC(3,2),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competitor_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_competitor_handles_client ON public.competitor_handles (client_id);

-- ── competitive_reports ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competitive_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  set_id UUID REFERENCES public.competitor_sets(id) ON DELETE SET NULL,
  report_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'complete', 'failed')),
  gamma_url TEXT,
  duration_minutes INTEGER,
  date_range_start DATE,
  date_range_end DATE,
  created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitive_reports_client
  ON public.competitive_reports (client_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.competitor_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_handles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitive_reports ENABLE ROW LEVEL SECURITY;

-- Staff-only tables: the SELECT policy adds is_moburst_staff() on top of
-- can_access_client so external client members cannot read drafts.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['competitor_sets','competitors','competitor_handles'] LOOP
    EXECUTE format('CREATE POLICY "Admins can do everything with %I" ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())', t, t);
    EXECUTE format('CREATE POLICY "Moburst staff can select %I" ON public.%I FOR SELECT TO authenticated USING (public.is_moburst_staff() AND public.can_access_client(client_id))', t, t);
    EXECUTE format('CREATE POLICY "Moburst staff can insert %I" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_write_client(client_id))', t, t);
    EXECUTE format('CREATE POLICY "Moburst staff can update %I" ON public.%I FOR UPDATE TO authenticated USING (public.can_write_client(client_id)) WITH CHECK (public.can_write_client(client_id))', t, t);
    EXECUTE format('CREATE POLICY "Moburst staff can delete %I" ON public.%I FOR DELETE TO authenticated USING (public.can_write_client(client_id))', t, t);
  END LOOP;
END $$;

-- competitive_reports: staff full write; clients read finished reports only.
CREATE POLICY "Admins can do everything with competitive_reports" ON public.competitive_reports
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Moburst staff can select competitive_reports" ON public.competitive_reports
  FOR SELECT TO authenticated USING (public.is_moburst_staff() AND public.can_access_client(client_id));
CREATE POLICY "Client users can view complete competitive_reports" ON public.competitive_reports
  FOR SELECT TO authenticated USING (status = 'complete' AND public.is_client_member(client_id));
CREATE POLICY "Moburst staff can insert competitive_reports" ON public.competitive_reports
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(client_id));
CREATE POLICY "Moburst staff can update competitive_reports" ON public.competitive_reports
  FOR UPDATE TO authenticated USING (public.can_write_client(client_id)) WITH CHECK (public.can_write_client(client_id));

CREATE TRIGGER update_competitor_sets_updated_at BEFORE UPDATE ON public.competitor_sets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- CompetitiveRun watches competitive_reports the way RunAnalysis watches
-- reports; CompetitorReview live-refreshes handles as detection fills them in.
ALTER TABLE public.competitive_reports REPLICA IDENTITY FULL;
ALTER TABLE public.competitor_handles REPLICA IDENTITY FULL;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['competitive_reports','competitor_handles'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
