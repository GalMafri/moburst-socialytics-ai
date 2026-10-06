-- Scheduled reports and competitor feeds run as a queue.
-- Design: docs/superpowers/specs/2026-10-06-scheduled-report-queue-design.md
--
-- One row per unit of work: one feed refresh for one client on one day, or one
-- dispatch of one schedule occurrence. pg_cron enqueues once a day (pure SQL)
-- and a worker function leases one job at a time, so no request ever carries
-- the whole batch. The cron jobs are in 20261006150100_scheduled_report_queue_cron.sql.

create table if not exists public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('feed_refresh', 'dispatch')),
  client_id uuid not null references public.clients(id) on delete cascade,
  schedule_id uuid references public.report_schedules(id) on delete cascade,
  -- The schedule's next_run_at this dispatch serves.
  occurrence timestamptz,
  -- dispatch:<schedule>:<occurrence> or feed:<client>:<date>. Enqueueing twice is a no-op.
  dedupe_key text not null unique,
  -- Feeds 10, competitive 20, social 30: the order the single request used.
  priority smallint not null default 50,
  -- Sent to n8n, which waits this long before its first external call.
  stagger_seconds integer not null default 0,
  -- waiting: a dependency is in progress. blocked: a dependency or a step failed
  -- and needs a person. Both are rechecked daily; held social jobs are also
  -- released by the worker's sweep as soon as their competitive report finishes.
  status text not null default 'queued'
    check (status in ('queued', 'running', 'waiting', 'blocked', 'done', 'skipped', 'failed')),
  -- Dispatch progress: prepared = the report row exists (report_id); posting =
  -- the webhook request was about to be sent. A job found in posting after an
  -- interruption never posts again.
  phase text check (phase in ('prepared', 'posting')),
  report_id uuid,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  reason text,
  result jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint scheduled_jobs_dispatch_has_schedule
    check ((kind = 'dispatch') = (schedule_id is not null and occurrence is not null))
);

create index if not exists scheduled_jobs_ready on public.scheduled_jobs (priority, available_at)
  where status in ('queued', 'running');
create index if not exists scheduled_jobs_schedule on public.scheduled_jobs (schedule_id);

alter table public.scheduled_jobs enable row level security;
revoke all on public.scheduled_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.scheduled_jobs to service_role;

-- A client's feed refresh weekday (0 = Sunday), stable for the client, so
-- feeds spread across the week instead of all falling due together.
create or replace function public.feed_refresh_weekday(p_client_id uuid)
returns integer
language sql immutable as $$
  select (('x' || substr(md5(p_client_id::text), 1, 7))::bit(28)::int % 7)
$$;

-- Hands out the next due job, best priority first, and counts the attempt.
-- A running job whose lease ran out (its worker died) is handed out again.
create or replace function public.scheduled_jobs_lease(p_lease_seconds integer default 300)
returns setof public.scheduled_jobs
language sql security definer set search_path = public as $$
  update public.scheduled_jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(j.started_at, now()),
         updated_at = now()
   where j.id = (
     select id from public.scheduled_jobs
      where (status = 'queued' and available_at <= now())
         or (status = 'running' and lease_until < now())
      order by priority, available_at, created_at
      limit 1
      for update skip locked)
  returning j.*;
$$;

-- The daily tick. Releases waiting and blocked dispatches for their recheck,
-- then adds one dispatch per due schedule occurrence and one feed refresh per
-- client whose feed is due. p_dry_run returns the plan and writes nothing.
create or replace function public.enqueue_scheduled_report_jobs(p_now timestamptz default now(), p_dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_released integer := 0;
  v_enqueued jsonb;
begin
  if p_dry_run then
    select count(*) into v_released from public.scheduled_jobs
     where kind = 'dispatch' and status in ('waiting', 'blocked');
  else
    update public.scheduled_jobs
       set status = 'queued', available_at = p_now, lease_until = null, updated_at = now()
     where kind = 'dispatch' and status in ('waiting', 'blocked');
    get diagnostics v_released = row_count;
  end if;

  with due as (
    select s.id as schedule_id, s.client_id, s.report_kind, s.next_run_at,
           row_number() over (partition by s.report_kind order by s.next_run_at, s.created_at, s.id) - 1 as n
      from public.report_schedules s
      join public.clients c on c.id = s.client_id
     where s.is_active and s.next_run_at <= p_now and c.archived_at is null
  ), feed_clients as (
    select distinct cs.client_id
      from public.competitor_sets cs
      join public.clients c on c.id = cs.client_id
     where cs.status in ('confirmed', 'analyzing', 'complete', 'failed') and c.archived_at is null
  ), latest_feed as (
    select client_id, max(fetched_at) as fetched_at
      from public.rivaliq_snapshots where endpoint = 'feed' group by client_id
  ), candidates as (
    select 'dispatch'::text as kind, d.client_id, d.schedule_id, d.next_run_at as occurrence,
           'dispatch:' || d.schedule_id || ':' || to_char(d.next_run_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as dedupe_key,
           (case when d.report_kind = 'competitive' then 20 else 30 end)::smallint as priority,
           (d.n * case when d.report_kind = 'competitive' then 150 else 180 end)::integer as stagger_seconds,
           d.report_kind as detail
      from due d
    union all
    select 'feed_refresh', f.client_id, null::uuid, null::timestamptz,
           'feed:' || f.client_id || ':' || to_char(p_now at time zone 'UTC', 'YYYY-MM-DD'),
           10::smallint, 0,
           coalesce('last feed ' || to_char(l.fetched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), 'no feed yet')
      from feed_clients f
      left join latest_feed l on l.client_id = f.client_id
     where l.fetched_at is null
        or l.fetched_at < p_now - interval '7 days'
        or (l.fetched_at < p_now - interval '1 day'
            and extract(dow from p_now at time zone 'UTC')::int = public.feed_refresh_weekday(f.client_id))
  ), fresh as (
    select c.* from candidates c
     where not exists (select 1 from public.scheduled_jobs j where j.dedupe_key = c.dedupe_key)
  ), inserted as (
    insert into public.scheduled_jobs (kind, client_id, schedule_id, occurrence, dedupe_key, priority, stagger_seconds, available_at)
    select kind, client_id, schedule_id, occurrence, dedupe_key, priority, stagger_seconds, p_now
      from fresh where not p_dry_run
    on conflict (dedupe_key) do nothing
    returning id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', kind, 'client_id', client_id, 'schedule_id', schedule_id, 'detail', detail,
           'priority', priority, 'stagger_seconds', stagger_seconds) order by priority, dedupe_key), '[]'::jsonb)
    into v_enqueued
    from fresh;

  return jsonb_build_object('dry_run', p_dry_run, 'at', p_now, 'released', v_released, 'enqueued', v_enqueued);
end;
$$;

-- Release held social dispatches whose pinned competitive report has finished:
-- complete, so the social report can go out; or failed, so the job records
-- that it is blocked and the daily check alerts. The worker runs this every
-- minute, so the competitive callback needs no knowledge of scheduling.
create or replace function public.release_ready_dispatches()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update public.scheduled_jobs j
     set status = 'queued', available_at = now(), lease_until = null, updated_at = now()
    from public.report_schedules s
    join public.competitive_reports c on c.id = s.pending_competitive_report_id
   where j.schedule_id = s.id and j.kind = 'dispatch' and s.report_kind = 'social'
     and ((j.status in ('waiting', 'blocked') and c.status = 'complete')
       or (j.status = 'waiting' and c.status = 'failed'));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Due schedule occurrences with no job, an hour past due: the daily enqueue did
-- not run, or something kept a schedule out of the queue. The daily check
-- alerts on these, so an empty queue can never pass for a healthy one.
create or replace function public.scheduled_report_gaps(p_now timestamptz default now())
returns table (schedule_id uuid, client_id uuid, client_name text, report_kind text, next_run_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.client_id, c.name, s.report_kind, s.next_run_at
    from public.report_schedules s
    join public.clients c on c.id = s.client_id
   where s.is_active and c.archived_at is null
     and s.next_run_at < p_now - interval '1 hour'
     and not exists (select 1 from public.scheduled_jobs j where j.schedule_id = s.id and j.occurrence = s.next_run_at)
$$;

revoke all on function public.feed_refresh_weekday(uuid) from public, anon, authenticated;
revoke all on function public.scheduled_jobs_lease(integer) from public, anon, authenticated;
revoke all on function public.enqueue_scheduled_report_jobs(timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.release_ready_dispatches() from public, anon, authenticated;
revoke all on function public.scheduled_report_gaps(timestamptz) from public, anon, authenticated;
grant execute on function public.feed_refresh_weekday(uuid), public.scheduled_jobs_lease(integer),
  public.enqueue_scheduled_report_jobs(timestamptz, boolean), public.release_ready_dispatches(),
  public.scheduled_report_gaps(timestamptz) to service_role;
