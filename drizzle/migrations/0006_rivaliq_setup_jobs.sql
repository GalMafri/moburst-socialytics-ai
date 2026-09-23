-- Server-only journal prevents duplicate provider POSTs after uncertain responses.
CREATE TABLE IF NOT EXISTS public.rivaliq_setup_jobs (
 set_id uuid PRIMARY KEY REFERENCES public.competitor_sets(id) ON DELETE CASCADE,
 client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
 plan jsonb NOT NULL,
 fingerprint text NOT NULL,
 phase text NOT NULL DEFAULT 'ready',
 landscape_id text,
 operation_token text,
 lease_id uuid,
 lease_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rivaliq_setup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rivaliq_setup_jobs FROM anon, authenticated;
GRANT ALL ON public.rivaliq_setup_jobs TO service_role;