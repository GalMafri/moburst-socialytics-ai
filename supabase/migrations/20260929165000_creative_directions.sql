-- Server-written reference evidence and recent concepts prevent repetitive output.
CREATE TABLE IF NOT EXISTS public.creative_directions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  mode text NOT NULL CHECK (mode IN ('single','carousel','video')),
  post_copy text NOT NULL,
  platform text,
  format text,
  reference_paths jsonb NOT NULL,
  plan jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS creative_directions_client_recent ON public.creative_directions(client_id, created_at DESC);
ALTER TABLE public.creative_directions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own client creative directions" ON public.creative_directions
  FOR SELECT TO authenticated USING (public.can_write_client(client_id));
GRANT SELECT ON public.creative_directions TO authenticated;
GRANT ALL ON public.creative_directions TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS media_jobs_creative_plan_unique ON public.media_jobs ((input->>'creative_plan_id'))
  WHERE input ? 'creative_plan_id';
