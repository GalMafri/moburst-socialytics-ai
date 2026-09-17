ALTER TABLE public.report_schedules
  ADD COLUMN IF NOT EXISTS pending_competitive_report_id uuid REFERENCES public.competitive_reports(id),
  ADD COLUMN IF NOT EXISTS dispatch_claimed_at timestamptz;

-- Only the service-role scheduler may claim a due dispatch. A claim is not
-- automatically expired: an interrupted POST may already have started n8n.
-- Resolve an interrupted claim against its report/execution before releasing it.
CREATE OR REPLACE FUNCTION public.claim_report_schedule(schedule_id uuid, expected_next_run_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE claimed uuid;
BEGIN
  UPDATE public.report_schedules SET dispatch_claimed_at = clock_timestamp()
  WHERE id = schedule_id AND is_active
    AND next_run_at = expected_next_run_at AND next_run_at <= now()
    AND dispatch_claimed_at IS NULL
  RETURNING id INTO claimed;
  RETURN claimed IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_report_schedule(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_report_schedule(uuid, timestamptz) TO service_role;
