-- A report still not made a day after its first try gets one Slack message at
-- the day itself (run-scheduled-jobs/dispatch.ts). A dispatch between runs is
-- queued for that time by the dispatch itself; a dispatch whose report is
-- still running waits, and only this function lets a waiting job out. So,
-- as in 20261020110000_inhouse_groundwork.sql, with one addition: a waiting,
-- sent dispatch whose alert is due (result.alert_due_at, the first run's
-- start plus a day, in UTC ISO form) is let out once. The dispatch then
-- removes alert_due_at, whether or not the message was posted, so the job is
-- never let out again for it.
--
-- The held-social and sent-report releases are unchanged.
-- Safe to apply twice. Writes no client data.

create or replace function public.release_ready_dispatches()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_held integer;
  v_sent integer;
  v_alert integer;
begin
  update public.scheduled_jobs j
     set status = 'queued', available_at = now(), lease_until = null, updated_at = now()
    from public.report_schedules s
    join public.competitive_reports c on c.id = s.pending_competitive_report_id
   where j.schedule_id = s.id and j.kind = 'dispatch' and s.report_kind = 'social'
     and coalesce(j.phase, '') not in ('posting', 'sent')
     and ((j.status in ('waiting', 'blocked') and c.status = 'complete')
       or (j.status = 'waiting' and c.status = 'failed'));
  get diagnostics v_held = row_count;

  update public.scheduled_jobs j
     set status = 'queued', available_at = now(), lease_until = null, updated_at = now()
   where j.kind = 'dispatch' and j.status = 'waiting' and j.phase = 'sent'
     and case
       when coalesce(j.result ->> 'engine', '') = 'app' then
         (not exists (select 1 from public.reports r
                       where r.id = j.report_id and r.status in ('running', 'pending'))
          and not exists (select 1 from public.competitive_reports c
                           where c.id = j.report_id and c.status in ('running', 'pending')))
         or not exists (select 1 from public.report_pipeline_runs p
                         where p.real_id = j.report_id and p.mode = 'app' and p.status = 'running'
                           and p.heartbeat_at > now() - interval '90 minutes')
       else
         not exists (select 1 from public.reports r
                      where r.id = j.report_id and r.status in ('running', 'pending') and r.created_at > now() - interval '90 minutes')
         and not exists (select 1 from public.competitive_reports c
                          where c.id = j.report_id and c.status in ('running', 'pending') and c.created_at > now() - interval '90 minutes')
     end;
  get diagnostics v_sent = row_count;

  -- The alert's time has come for a report still running. The case reads the
  -- time only when it has the form the dispatch writes, so a value written by
  -- hand can never stop this function.
  update public.scheduled_jobs j
     set status = 'queued', available_at = now(), lease_until = null, updated_at = now()
   where j.kind = 'dispatch' and j.status = 'waiting' and j.phase = 'sent'
     and j.result ->> 'alerted_at' is null
     and case
       when coalesce(j.result ->> 'alert_due_at', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
         then (j.result ->> 'alert_due_at')::timestamptz <= now()
       else false
     end;
  get diagnostics v_alert = row_count;
  return v_held + v_sent + v_alert;
end;
$$;
