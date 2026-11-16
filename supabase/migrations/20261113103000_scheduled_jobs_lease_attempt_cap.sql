-- No job is leased without end.
--
-- Both lease functions handed out a job whose lease had run out (its worker
-- died, or was killed by the platform) every time, and counted the attempt
-- without ever looking at max_attempts. Only the feed and dispatch kinds check
-- the count themselves, and only after they are leased; a kind that crashes
-- its worker each time (a week plan, a lifecycle step, a pipeline step) was
-- leased again and again, forever.
--
-- A job is now leased while it has been leased at most max_attempts times
-- already, so the last lease is one more than max_attempts: the one in which
-- feed and dispatch report a clean failure for a job that was stopped too
-- often. A job past that is closed here, before anything is leased, the way the
-- worker closes one that threw on its last try: a dispatch is blocked (its
-- schedule has not moved on, so a failed job would never be queued again, and a
-- blocked one is rechecked every day), every other kind is failed.
--
-- Changed retry behavior: a lease counts whether the worker stopped or the job
-- asked to be run again itself (week_plan and week_revise "tried again later
-- while the week has days to come", notes_read "read again later"). Those kinds
-- are now closed as failed after max_attempts + 1 leases; the daily safety nets
-- (enqueue_scheduled_report_jobs for plans and revisions, client_notes_queue_waiting
-- for notes) queue the work again, so nothing is left waiting. The stored reason
-- says only that the job was tried that many times, which is true for both.

create or replace function public.scheduled_jobs_close_exhausted()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_closed integer;
begin
  with due as (
    select id from public.scheduled_jobs
     where attempts > max_attempts
       and (status = 'queued' or (status = 'running' and lease_until < now()))
     for update skip locked),
  closed as (
    update public.scheduled_jobs j
       set status = case when j.kind = 'dispatch' then 'blocked' else 'failed' end,
           reason = 'Tried ' || j.attempts || ' times without finishing.',
           attempts = case when j.kind = 'dispatch' then 0 else j.attempts end,
           lease_until = null,
           finished_at = case when j.kind = 'dispatch' then j.finished_at else now() end,
           updated_at = now()
     where j.id in (select id from due)
    returning 1)
  select count(*)::int into v_closed from closed;
  return v_closed;
end $$;

-- The main lease, as before (it never hands out a pipeline step), with the cap.
create or replace function public.scheduled_jobs_lease(p_lease_seconds integer default 300)
returns setof public.scheduled_jobs
language plpgsql security definer set search_path = public as $$
begin
  perform public.scheduled_jobs_close_exhausted();
  return query
    update public.scheduled_jobs j
       set status = 'running',
           attempts = j.attempts + 1,
           lease_until = now() + make_interval(secs => p_lease_seconds),
           started_at = coalesce(j.started_at, now()),
           updated_at = now()
     where j.id = (
       select id from public.scheduled_jobs
        where kind <> 'report_pipeline'
          and ((status = 'queued' and available_at <= now())
            or (status = 'running' and lease_until < now()))
          and attempts <= max_attempts
        order by priority, available_at, created_at
        limit 1
        for update skip locked)
    returning j.*;
end $$;

-- The pipeline lane's lease, as before, with the same cap.
create or replace function public.scheduled_jobs_lease_pipelines(p_lease_seconds integer default 300, p_max_running integer default 4)
returns setof public.scheduled_jobs
language plpgsql security definer set search_path = public as $$
declare
  v_free integer;
begin
  perform pg_advisory_xact_lock(hashtext('scheduled_jobs_lease_pipelines'));
  perform public.scheduled_jobs_close_exhausted();
  select greatest(0, p_max_running - count(*))::int into v_free
    from public.scheduled_jobs
   where kind = 'report_pipeline' and status = 'running' and lease_until >= now();
  if v_free = 0 then return; end if;
  return query
    with leased as (
      update public.scheduled_jobs j
         set status = 'running',
             attempts = j.attempts + 1,
             lease_until = now() + make_interval(secs => p_lease_seconds),
             started_at = coalesce(j.started_at, now()),
             updated_at = now()
       where j.id in (
         select id from public.scheduled_jobs
          where kind = 'report_pipeline'
            and ((status = 'queued' and available_at <= now())
              or (status = 'running' and lease_until < now()))
            and attempts <= max_attempts
          order by priority, available_at, created_at
          limit v_free
          for update skip locked)
      returning j.*)
    select * from leased;
end $$;

revoke all on function public.scheduled_jobs_close_exhausted() from public, anon, authenticated;
grant execute on function public.scheduled_jobs_close_exhausted() to service_role;
