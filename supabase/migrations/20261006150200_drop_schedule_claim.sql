-- The schedule claim is replaced by scheduled_jobs (unique dedupe_key plus a
-- lease). Applied after the new trigger-scheduled-reports is deployed, since
-- the old one called it. report_schedules.dispatch_claimed_at stays as a column.
drop function if exists public.claim_report_schedule(uuid, timestamptz);
