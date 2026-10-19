-- The weekly content calendar (Lital, 19 Oct 2026).
-- Spec: docs/superpowers/specs/2026-10-19-weekly-calendar-design.md
--
-- One plan per client per week, made once from the freshest evidence: every
-- Monday for the following week, or when someone presses "Plan next week".
-- "Revise this week" rewrites the posts nobody has worked on from a note.
-- Plans, revisions and the client's voice profile run as scheduled jobs, so
-- they share the queue's leasing, retries and daily alert.
--
-- This part only adds. 20261019140100_weekly_calendar_cutover.sql moves the
-- existing calendar onto plans; 20261019140200_weekly_calendar_removals.sql
-- removes what this replaces.

-- ── Plans ────────────────────────────────────────────────────────────────────

create table if not exists public.calendar_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  status text not null default 'queued' check (status in ('queued', 'planning', 'ready', 'failed')),
  -- monday: the weekly run; button: "Plan next week"; cutover: a week planned before 19 Oct 2026.
  trigger text not null check (trigger in ('monday', 'button', 'cutover')),
  requested_by uuid,
  -- The scored inputs the plan was written from.
  evidence jsonb,
  -- Posts per platform the week followed, and where that came from.
  rhythm jsonb,
  model text,
  input_tokens integer,
  output_tokens integer,
  -- Every "Revise this week": [{note, by, at, scope, rewritten, kept, replaced: [{id, copy, hashtags, cta, pillar, visual_direction, reasons}]}]
  revisions jsonb not null default '[]'::jsonb,
  -- The revision waiting to run: {note, by, at, scope}. One at a time.
  pending_revision jsonb,
  error text,
  -- Set by the job that is writing or revising the week; another run waits it out.
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  unique (client_id, week_start)
);
comment on table public.calendar_plans is 'One plan per client per week, made once (weekly calendar, 19 Oct 2026). Written only by the service role.';

alter table public.calendar_plans enable row level security;
revoke all on public.calendar_plans from anon, authenticated;
grant select on public.calendar_plans to authenticated;
grant all on public.calendar_plans to service_role;
drop policy if exists "Read calendar plans" on public.calendar_plans;
create policy "Read calendar plans" on public.calendar_plans
  for select to authenticated using (public.is_moburst_staff() or public.is_client_member(client_id));

alter table public.calendar_posts add column if not exists plan_id uuid references public.calendar_plans(id) on delete set null;
create index if not exists calendar_posts_plan on public.calendar_posts (plan_id);
comment on column public.calendar_posts.plan_id is 'The week plan that wrote this post; null for posts people added.';

-- 'plan' is the only source the planner writes from now on. 'report' and
-- 'trend_slot' leave with the cutover.
alter table public.calendar_posts drop constraint if exists calendar_posts_source_check;
alter table public.calendar_posts add constraint calendar_posts_source_check
  check (source in ('plan', 'ad_hoc', 'insight', 'report', 'trend_slot'));

-- ── The client's voice and rhythm ────────────────────────────────────────────

alter table public.clients add column if not exists social_voice jsonb;
alter table public.clients add column if not exists posting_rhythm jsonb;
comment on column public.clients.social_voice is 'How the client actually writes on each platform, learned from its published posts: {built_at, post_count, platforms: {Instagram: {...}}, examples: {Instagram: [...]}}.';
comment on column public.clients.posting_rhythm is 'Staff setting: posts per week per platform, e.g. {"LinkedIn": 3}. Null follows what the client publishes.';

-- ── One preference memory ────────────────────────────────────────────────────

alter table public.brand_voice_learnings add column if not exists status text not null default 'active';
alter table public.brand_voice_learnings add column if not exists times_confirmed integer not null default 1;
alter table public.brand_voice_learnings add column if not exists last_confirmed_at timestamptz;
alter table public.brand_voice_learnings add column if not exists source text not null default 'copy_edit';
alter table public.brand_voice_learnings add column if not exists replaced_by uuid references public.brand_voice_learnings(id) on delete set null;
alter table public.brand_voice_learnings add column if not exists evidence text;
alter table public.brand_voice_learnings drop constraint if exists brand_voice_learnings_status_check;
alter table public.brand_voice_learnings add constraint brand_voice_learnings_status_check check (status in ('active', 'replaced'));
alter table public.brand_voice_learnings drop constraint if exists brand_voice_learnings_source_check;
alter table public.brand_voice_learnings add constraint brand_voice_learnings_source_check check (source in ('copy_edit', 'revise_note'));
update public.brand_voice_learnings
   set times_confirmed = greatest(1, coalesce(source_iterations, 1)),
       last_confirmed_at = coalesce(last_confirmed_at, updated_at, created_at)
 where last_confirmed_at is null;
alter table public.brand_voice_learnings alter column last_confirmed_at set default now();
alter table public.brand_voice_learnings alter column last_confirmed_at set not null;
-- Replaced preferences stay as history, so the same wording can come back:
-- only one active preference per client may say a thing.
alter table public.brand_voice_learnings drop constraint if exists brand_voice_learnings_client_id_pattern_type_pattern_descri_key;
create unique index if not exists brand_voice_learnings_one_active
  on public.brand_voice_learnings (client_id, pattern_type, lower(pattern_description)) where status = 'active';
-- Staff remove a preference from client settings; there was no delete policy, so the button did nothing.
drop policy if exists "Moburst staff can delete brand_voice_learnings" on public.brand_voice_learnings;
create policy "Moburst staff can delete brand_voice_learnings" on public.brand_voice_learnings
  for delete to authenticated using (public.is_moburst_staff());

-- ── Jobs ─────────────────────────────────────────────────────────────────────

-- For week_plan and week_revise, occurrence is the week's Monday.
alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_kind_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_kind_check
  check (kind in ('feed_refresh', 'dispatch', 'week_plan', 'week_revise', 'voice_profile'));

-- A client the calendar can plan for: not archived, in reporting, and with
-- something to learn from (Sprout profiles or a linked RivalIQ landscape).
create or replace function public.calendar_client_ready(p_client uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clients c
     where c.id = p_client and c.archived_at is null and not coalesce(c.exclude_from_reporting, false)
       and (exists (select 1 from sprout_profiles sp where sp.client_id = c.id and sp.is_active is distinct from false)
         or exists (select 1 from competitor_sets cs where cs.client_id = c.id
                     and cs.status in ('confirmed', 'analyzing', 'complete', 'failed')
                     and nullif(btrim(cs.rivaliq_landscape_id), '') is not null)));
$$;

-- Ask for a week's plan. The plan row is made once (unique per client and
-- week); a new plan, or a failed one asked for again, gets a week_plan job.
-- The client's voice profile is queued first when it is missing or older
-- than this month's first Monday. Returns the plan.
create or replace function public.calendar_request_week(p_client uuid, p_week date, p_trigger text, p_user uuid default null)
returns public.calendar_plans
language plpgsql security definer set search_path = public as $$
declare
  v_plan calendar_plans;
  v_new boolean := false;
  v_priority smallint := case when p_trigger = 'button' then 15 else 40 end;
  v_month date := date_trunc('month', current_date)::date;
  v_first_monday date;
  v_voice timestamptz;
  v_runs integer;
begin
  if extract(isodow from p_week) <> 1 then
    raise exception 'A calendar week starts on a Monday, not %', p_week;
  end if;
  if not calendar_client_ready(p_client) then
    raise exception 'This client has no published posts or competitor tracking to plan from yet.';
  end if;

  insert into calendar_plans (client_id, week_start, trigger, requested_by)
  values (p_client, p_week, p_trigger, p_user)
  on conflict (client_id, week_start) do nothing
  returning * into v_plan;
  v_new := found;

  if not v_new then
    -- Asked for again after it failed: plan it again, once per request.
    update calendar_plans set status = 'queued', error = null, requested_by = coalesce(p_user, requested_by), updated_at = now()
     where client_id = p_client and week_start = p_week and status = 'failed'
    returning * into v_plan;
    if not found then
      select * into v_plan from calendar_plans where client_id = p_client and week_start = p_week;
      return v_plan;
    end if;
  end if;

  -- The voice profile: missing, or built before this month's first Monday once that Monday has come.
  v_first_monday := v_month + ((8 - extract(isodow from v_month)::int) % 7);
  select (social_voice->>'built_at')::timestamptz into v_voice from clients where id = p_client;
  if v_voice is null or (current_date >= v_first_monday and v_voice::date < v_first_monday) then
    insert into scheduled_jobs (kind, client_id, dedupe_key, priority, available_at)
    values ('voice_profile', p_client, 'voice_profile:' || p_client || ':' || to_char(current_date, 'YYYY-MM-DD'), v_priority - 1, now())
    on conflict (dedupe_key) do nothing;
  end if;

  select count(*) into v_runs from scheduled_jobs where kind = 'week_plan' and client_id = p_client and occurrence = p_week::timestamptz;
  insert into scheduled_jobs (kind, client_id, occurrence, dedupe_key, priority, available_at)
  values ('week_plan', p_client, p_week::timestamptz,
          'week_plan:' || p_client || ':' || p_week || case when v_runs > 0 then ':' || v_runs else '' end,
          v_priority, now())
  on conflict (dedupe_key) do nothing;
  return v_plan;
end $$;

-- Ask for a week to be revised from a note. One revision at a time, and only
-- on a plan that is ready. scope: untouched (posts nobody worked on) or empty
-- (posts with no copy yet).
create or replace function public.calendar_request_revision(p_plan uuid, p_note text, p_user uuid default null, p_scope text default 'untouched')
returns public.calendar_plans
language plpgsql security definer set search_path = public as $$
declare
  v_plan calendar_plans;
begin
  if p_scope not in ('untouched', 'empty') then
    raise exception 'Unknown revision scope %', p_scope;
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Say what should change.';
  end if;
  update calendar_plans
     set pending_revision = jsonb_build_object('note', left(btrim(p_note), 2000), 'by', p_user, 'at', now(), 'scope', p_scope),
         updated_at = now()
   where id = p_plan and status = 'ready' and pending_revision is null
  returning * into v_plan;
  if not found then
    select * into v_plan from calendar_plans where id = p_plan;
    if v_plan.id is null then raise exception 'No such plan.'; end if;
    if v_plan.pending_revision is not null then raise exception 'This week is already being revised.'; end if;
    raise exception 'This week is still being planned.';
  end if;
  -- A client with no voice profile yet gets one first, so the rewrite is in its real voice.
  if (select social_voice is null from clients where id = v_plan.client_id) then
    insert into scheduled_jobs (kind, client_id, dedupe_key, priority, available_at)
    values ('voice_profile', v_plan.client_id, 'voice_profile:' || v_plan.client_id || ':' || to_char(current_date, 'YYYY-MM-DD'), 14, now())
    on conflict (dedupe_key) do nothing;
  end if;
  insert into scheduled_jobs (kind, client_id, occurrence, dedupe_key, priority, available_at)
  values ('week_revise', v_plan.client_id, v_plan.week_start::timestamptz,
          'week_revise:' || v_plan.id || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
          15, now());
  return v_plan;
end $$;

revoke all on function public.calendar_client_ready(uuid) from public, anon, authenticated;
revoke all on function public.calendar_request_week(uuid, date, text, uuid) from public, anon, authenticated;
revoke all on function public.calendar_request_revision(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.calendar_client_ready(uuid), public.calendar_request_week(uuid, date, text, uuid),
  public.calendar_request_revision(uuid, text, uuid, text) to service_role;

-- The daily tick, as in 20261014090000_feed_refresh_linked_landscapes_only.sql,
-- plus the Monday plans: on Mondays (Israel time) every client the calendar
-- can plan for gets the following week's plan asked for. A week already
-- planned (someone pressed "Plan next week") costs nothing.
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
