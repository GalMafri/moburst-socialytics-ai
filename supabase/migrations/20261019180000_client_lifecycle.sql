-- The client lifecycle (Lital, 19 Oct 2026: a self-serve app; nothing may wait
-- for a person or a developer session). Spec:
-- docs/superpowers/specs/2026-10-19-self-serve-lifecycle-design.md
--
-- Every active client's steps are looked at once a day, and at once when the
-- client is created, its website or name changes, it is unarchived, or its
-- social accounts change. A step runs when its inputs changed, its result is
-- due a refresh, or a failure's retry time came (_shared/lifecycle). The first
-- step is the client's design references and learned style, which until now
-- ran whenever someone opened the setup page.

create table if not exists public.client_lifecycle_steps (
  client_id uuid not null references public.clients(id) on delete cascade,
  step text not null,
  inputs_key text,
  status text not null check (status in ('running', 'done', 'waiting', 'failed')),
  attempts integer not null default 0,
  attempted_at timestamptz,
  done_at timestamptz,
  next_attempt_at timestamptz,
  result jsonb,
  error text,
  updated_at timestamptz not null default now(),
  primary key (client_id, step)
);

alter table public.client_lifecycle_steps enable row level security;
drop policy if exists "Staff read client lifecycle" on public.client_lifecycle_steps;
create policy "Staff read client lifecycle" on public.client_lifecycle_steps
  for select to authenticated using (public.is_moburst_staff());

-- What a lifecycle_step job runs: {"step": "...", "force": true|false}.
alter table public.scheduled_jobs add column if not exists payload jsonb;

alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_kind_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_kind_check
  check (kind in ('feed_refresh', 'dispatch', 'week_plan', 'week_revise', 'voice_profile', 'lifecycle', 'lifecycle_step'));

-- Look at a client's lifecycle now. One job per client per minute, however
-- many rows a save touched.
create or replace function public.lifecycle_enqueue(p_client uuid, p_priority smallint default 30)
returns void
language sql security definer set search_path = public as $$
  insert into scheduled_jobs (kind, client_id, dedupe_key, priority, available_at)
  select 'lifecycle', p_client, 'lifecycle:' || p_client || ':' || to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'), p_priority, now()
   where exists (select 1 from clients where id = p_client and archived_at is null)
  on conflict (dedupe_key) do nothing;
$$;

create or replace function public.lifecycle_on_client_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT'
     or new.website_url is distinct from old.website_url
     or new.name is distinct from old.name
     or (old.archived_at is not null and new.archived_at is null) then
    perform lifecycle_enqueue(new.id);
  end if;
  return new;
end $$;

drop trigger if exists clients_lifecycle on public.clients;
create trigger clients_lifecycle after insert or update of website_url, name, archived_at on public.clients
  for each row execute function public.lifecycle_on_client_change();

create or replace function public.lifecycle_on_profiles_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform lifecycle_enqueue(new.client_id);
    return new;
  elsif tg_op = 'DELETE' then
    perform lifecycle_enqueue(old.client_id);
    return old;
  end if;
  perform lifecycle_enqueue(new.client_id);
  if old.client_id is distinct from new.client_id then perform lifecycle_enqueue(old.client_id); end if;
  return new;
end $$;

drop trigger if exists sprout_profiles_lifecycle on public.sprout_profiles;
create trigger sprout_profiles_lifecycle after insert or update or delete on public.sprout_profiles
  for each row execute function public.lifecycle_on_profiles_change();

-- A person asking for a step to run again now (Refresh on the setup page).
-- Staff only; the step's own rules still decide what it spends.
create or replace function public.lifecycle_request(p_client uuid, p_step text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (auth.role() = 'service_role' or public.is_moburst_staff()) then
    raise exception 'Only the Moburst team can refresh this.';
  end if;
  if not exists (select 1 from clients where id = p_client and archived_at is null) then
    raise exception 'No such client.';
  end if;
  if p_step not in ('design_refs') then
    raise exception 'Unknown step %', p_step;
  end if;
  -- A run already going (and alive) answers the request; nothing is doubled.
  insert into client_lifecycle_steps as s (client_id, step, status, attempted_at)
  values (p_client, p_step, 'running', now())
  on conflict (client_id, step) do update set status = 'running', attempted_at = now(), updated_at = now()
   where s.status <> 'running' or s.attempted_at < now() - interval '30 minutes';
  if not found then return; end if;
  insert into scheduled_jobs (kind, client_id, payload, dedupe_key, priority, available_at)
  values ('lifecycle_step', p_client, jsonb_build_object('step', p_step, 'force', true, 'why', 'person'),
          'lifecycle_step:' || p_step || ':' || p_client || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 12, now());
end $$;

revoke all on function public.lifecycle_enqueue(uuid, smallint) from public, anon, authenticated;
revoke all on function public.lifecycle_request(uuid, text) from public, anon;
grant execute on function public.lifecycle_request(uuid, text) to authenticated, service_role;
grant execute on function public.lifecycle_enqueue(uuid, smallint) to service_role;

-- The daily tick, as in 20261019140000_weekly_calendar.sql, plus one lifecycle
-- look per active client.
create or replace function public.enqueue_scheduled_report_jobs(p_now timestamptz default now(), p_dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_released integer := 0;
  v_enqueued jsonb;
  v_week date := (date_trunc('week', p_now at time zone 'Asia/Jerusalem'))::date + 7;
  v_monday boolean := extract(isodow from p_now at time zone 'Asia/Jerusalem') = 1;
  v_weeks jsonb := '[]'::jsonb;
  v_client record;
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
    select distinct on (cs.client_id) cs.client_id, cs.rivaliq_landscape_id
      from public.competitor_sets cs
      join public.clients c on c.id = cs.client_id
     where cs.status in ('confirmed', 'analyzing', 'complete', 'failed') and c.archived_at is null
     order by cs.client_id, cs.confirmed_at desc nulls last, cs.created_at desc
  ), feed_clients as (
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
    union all
    select 'lifecycle', c.id, null::uuid, null::timestamptz,
           'lifecycle:' || c.id || ':' || to_char(p_now at time zone 'UTC', 'YYYY-MM-DD'),
           45::smallint, 0, 'daily'
      from public.clients c
     where c.archived_at is null
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

  if v_monday then
    for v_client in
      select c.id from public.clients c
       where public.calendar_client_ready(c.id)
         and not exists (select 1 from public.calendar_plans p where p.client_id = c.id and p.week_start = v_week)
       order by c.name
    loop
      if not p_dry_run then
        perform public.calendar_request_week(v_client.id, v_week, 'monday', null);
      end if;
      v_weeks := v_weeks || jsonb_build_object('client_id', v_client.id, 'week', v_week);
    end loop;
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'at', p_now, 'released', v_released, 'enqueued', v_enqueued, 'week_plans', v_weeks);
end;
$$;
