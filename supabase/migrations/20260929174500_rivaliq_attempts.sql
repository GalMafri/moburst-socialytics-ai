-- Tie saved provider responses to a particular retry, not just a reusable report ID.
ALTER TABLE public.rivaliq_snapshots ADD COLUMN IF NOT EXISTS attempt_started_at timestamptz;
CREATE INDEX IF NOT EXISTS rivaliq_snapshot_attempt_idx ON public.rivaliq_snapshots(report_id, attempt_started_at, endpoint, fetched_at DESC);
