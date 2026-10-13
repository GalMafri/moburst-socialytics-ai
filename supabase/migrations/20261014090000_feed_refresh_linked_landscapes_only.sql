-- Scheduled competitor feed refreshes only for clients whose current
-- competitor set is linked to a RivalIQ landscape.
--
-- enqueue_scheduled_report_jobs (20261006150000_scheduled_report_queue.sql)
-- queued a feed refresh for every client with a non-draft set. A client with
-- no linked landscape cannot be refreshed: the refresh asks RivalIQ, is told
-- the client is not tracked, and the job is skipped, every day it falls due.
-- This replaces the function with the same body except feed_clients, which
-- now takes each client's current set (newest confirmation, unconfirmed rows
-- last) and keeps the client only when that set has a rivaliq_landscape_id.
--
-- Dispatches, release, lease and gaps are unchanged. Safe to apply twice.

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
  ), current_sets as (
    -- Each client's current set: the newest confirmation among the statuses
    -- every reader accepts, unconfirmed rows last (refreshFeed.ts orders it
    -- the same way, so the set queued here is the set the refresh reads).
    select distinct on (cs.client_id) cs.client_id, cs.rivaliq_landscape_id
      from public.competitor_sets cs
      join public.clients c on c.id = cs.client_id
     where cs.status in ('confirmed', 'analyzing', 'complete', 'failed') and c.archived_at is null
     order by cs.client_id, cs.confirmed_at desc nulls last, cs.created_at desc
  ), feed_clients as (
    -- Only a client whose current set is linked to a RivalIQ landscape. An
    -- unlinked client's refresh cannot succeed, and queuing it daily only
    -- spent a provider call to be told so.
    select client_id from current_sets
     where nullif(btrim(rivaliq_landscape_id), '') is not null
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
        or l.fetched_at < p_now - interval '6 days'
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

revoke all on function public.enqueue_scheduled_report_jobs(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_scheduled_report_jobs(timestamptz, boolean) to service_role;
