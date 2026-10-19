-- Every pipeline finishes or recovers on its own (self-serve design, section 3,
-- 19 Oct). Nothing here waits for a person, and nothing tells anyone that a
-- run did not finish: a run that stops is made again by the product.
-- Safe to apply twice.

-- ── Scheduled reports ───────────────────────────────────────────────────────
-- A dispatch whose request the workflow accepted is 'sent': it watches its
-- report until the report exists, and a report that does not finish is taken
-- away and made again (run-scheduled-jobs/dispatch.ts).
alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_phase_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_phase_check
  check (phase in ('prepared', 'posting', 'sent'));

-- Run by the worker every minute. Releases, back into the queue:
--  * held social dispatches whose pinned competitive report finished (as
--    before), never one that already sent its own request;
--  * sent dispatches whose report finished, or stopped answering for 90
--    minutes (STUCK_AFTER_MINUTES in _shared/reports/payloads.ts).
create or replace function public.release_ready_dispatches()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_held integer;
  v_sent integer;
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
     and not exists (select 1 from public.reports r
                      where r.id = j.report_id and r.status in ('running', 'pending') and r.created_at > now() - interval '90 minutes')
     and not exists (select 1 from public.competitive_reports c
                      where c.id = j.report_id and c.status in ('running', 'pending') and c.created_at > now() - interval '90 minutes');
  get diagnostics v_sent = row_count;
  return v_held + v_sent;
end;
$$;
revoke all on function public.release_ready_dispatches() from public, anon, authenticated;
grant execute on function public.release_ready_dispatches() to service_role;

-- ── Archived clients' schedules ─────────────────────────────────────────────
-- Archiving a client pauses its active schedules; unarchiving starts each one
-- again from that day, by its own rule, so nothing fires at once for months
-- that passed while the client was archived. Schedules a person had turned
-- off stay off.
alter table public.report_schedules add column if not exists paused_by_archive boolean not null default false;

-- The schedule's first run after a moment: a monthly one on its run day at
-- 07:15 UTC, this month when that is still ahead, else next month; a weekly
-- or biweekly one a week or two later. Mirrors firstRunFrom in
-- supabase/functions/_shared/reports/schedule.ts.
create or replace function public.report_schedule_first_run(p_from timestamptz, p_run_day integer, p_frequency text)
returns timestamptz
language sql stable set search_path = public as $$
  select case
    when p_frequency = 'weekly' then p_from + interval '7 days'
    when p_frequency = 'biweekly' then p_from + interval '14 days'
    else (
      select (case when x.t at time zone 'UTC' > p_from then x.t else x.t + interval '1 month' end) at time zone 'UTC'
        from (select date_trunc('month', p_from at time zone 'UTC')
                     + make_interval(days => least(greatest(coalesce(p_run_day, 7), 1), 28) - 1, hours => 7, mins => 15) as t) x
    )
  end
$$;
revoke all on function public.report_schedule_first_run(timestamptz, integer, text) from public, anon, authenticated;
grant execute on function public.report_schedule_first_run(timestamptz, integer, text) to service_role;

create or replace function public.clients_archive_schedules()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    update public.report_schedules
       set is_active = false, paused_by_archive = true, pending_competitive_report_id = null, dispatch_claimed_at = null
     where client_id = new.id and is_active;
  elsif new.archived_at is null and old.archived_at is not null then
    update public.report_schedules
       set is_active = true, paused_by_archive = false,
           next_run_at = public.report_schedule_first_run(now(), run_day_of_month, frequency)
     where client_id = new.id and paused_by_archive;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_archive_schedules on public.clients;
create trigger clients_archive_schedules after update of archived_at on public.clients
  for each row when (old.archived_at is distinct from new.archived_at)
  execute function public.clients_archive_schedules();

-- One pass over every schedule of a client archived before this trigger
-- existed: the same rule, applied once (22 active schedules on 19 Oct, 6 of
-- them past due).
update public.report_schedules s
   set is_active = false, paused_by_archive = true, pending_competitive_report_id = null, dispatch_claimed_at = null
  from public.clients c
 where c.id = s.client_id and c.archived_at is not null and s.is_active;

-- ── Design requests ─────────────────────────────────────────────────────────
-- A request no longer waits on staff ('needs_staff'). It closes, quietly and
-- with its reason, and the automatic designs make the post's design again
-- later when the reason calls for it (_shared/design/requestRules.ts):
--   no_design     every option was tried and none finished: made again later, until the post's time
--   no_progress   planning stopped three times: made again later, until the post's time
--   no_footage    a filmed post with no footage a day before its time: a design from the same idea
--   filmed        its footage arrived
--   post_passed   the post's time passed first
--   post_removed  the post left the calendar
alter table public.design_requests add column if not exists end_reason text;
alter table public.design_requests add column if not exists ended_at timestamptz;
-- Planning tries for the request; the design worker plans a request again when
-- its planning shows no progress for 30 minutes.
alter table public.design_requests add column if not exists plan_attempts integer not null default 1;

update public.design_requests
   set status = 'closed', end_reason = 'no_design', ended_at = coalesce(ended_at, updated_at, now())
 where status = 'needs_staff';

alter table public.design_requests drop constraint if exists design_requests_status_check;
alter table public.design_requests add constraint design_requests_status_check
  check (status in ('preparing', 'ready', 'canceled', 'needs_filming', 'closed'));
alter table public.design_requests drop constraint if exists design_requests_end_reason_check;
alter table public.design_requests add constraint design_requests_end_reason_check
  check (end_reason is null or end_reason in ('no_design', 'no_progress', 'no_footage', 'filmed', 'post_passed', 'post_removed'));

-- Every planned post gets a design automatically (Lital's decision 3, 19 Oct).
alter table public.design_brand_settings alter column auto_designs set default true;
update public.design_brand_settings set auto_designs = true where not auto_designs;

-- The automatic designs run as the system: the operational secret alone, no
-- person named (it used to name Lital). They also run while a filming request
-- waits, so one whose footage cannot come in time is closed and its post
-- designed, for every client.
select cron.unschedule('design-auto-upcoming') where exists (select 1 from cron.job where jobname = 'design-auto-upcoming');
select cron.schedule('design-auto-upcoming', '*/10 * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/design-request',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{"action":"auto"}'::jsonb, timeout_milliseconds := 60000)
  where exists (select 1 from public.design_brand_settings where auto_designs and confirmed_at is not null)
     or exists (select 1 from public.design_requests where status = 'needs_filming');
$cron$);
