-- Strategy-only clients (18 Nov 2026).
--
-- A client can be added by hand with a name and a website and no account in
-- Sprout: a prospect, an RFP, a client shown a strategy before the team
-- onboards it. Such a client is strategy-only. It gets its 90-day strategy
-- (the client lifecycle reads its website, picks its competitors, reads its
-- public posts and writes the strategy, exactly as before), and its
-- calendar, designs, analytics and reports are closed until an account is
-- connected. The moment it has an active account everything opens by itself.
--
-- Nothing is stored for this. The state is read from sprout_profiles every
-- time, by the three functions below, so no flag can be wrong or forgotten:
--
--   client_in_sprout(client)      the client has at least one row in
--                                 sprout_profiles with is_active = true. An
--                                 account the one-account-per-network rule
--                                 set aside (parked_at set, is_active false)
--                                 is not active; the account it kept is.
--   client_strategy_only(client)  the client exists, is not a demo copy the
--                                 API made for a prospect (demo_job_id: a
--                                 demo runs only the steps its demo job asks
--                                 for), and is not in Sprout.
--   strategy_only_clients()       those clients among the ones the caller
--                                 can see, for the screens.
--
-- Then the places in the database where work is started ask
-- client_strategy_only, each restated from its latest definition with that
-- one condition added and nothing else changed:
--
--   calendar_request_week          (20261110100000_calendar_plan_cancel.sql)
--       refuses, as it refuses an archived client. Every plan request passes
--       through it: the Monday run, the client lifecycle's first output,
--       "Plan next week" and the daily safety net.
--   calendar_request_revision      (20261118110000_calendar_replan.sql)
--       refuses. Every revision passes through it: "Revise this week", the
--       daily fill of empty copy, the client notes' rewrite and the
--       lifecycle's re-plan.
--   enqueue_scheduled_report_jobs  (20261019190000_calendar_self_serve.sql)
--       the daily run queues no report dispatch, no Monday plan, no plan or
--       revision retry and no copy fill for such a client. Its competitor
--       feed refresh and its daily lifecycle look are queued as before: the
--       strategy reads both.
--   enqueue_trend_refresh_jobs     (20261113101501_trend_past_weeks_close.sql)
--       no weekly trends collection: it feeds the calendar and the Analytics
--       Trends tab only. The trend profile, which the strategy is written
--       from, is the lifecycle's and is written as before.
--   scheduled_report_gaps          (20261006150000_scheduled_report_queue.sql)
--       a due schedule of such a client is not a gap: it is not meant to
--       have a job.
--
-- One thing a plan request did for every client is kept for a strategy-only
-- one, because its strategy is written in the client's voice: asking for the
-- voice profile when it is missing or a month old. A client with no plans is
-- never asked that way, so the client lifecycle asks instead, through
-- voice_profile_request below: the same rule and the same job key as
-- calendar_request_week, at the moment its first plan would have been asked
-- for and once a week after that (_shared/lifecycle/steps.ts, first_output).
--
-- Nothing is deleted, cancelled or changed on any row: the plans, posts,
-- reports, schedules and trend weeks such a client already has stay as they
-- are, and are there again when it gets an account. A schedule whose run is
-- due stays due, so the daily run queues it on the first day the client is
-- in Sprout. No table, column, policy or trigger is added. Every function is
-- made with create or replace: safe to run twice.

-- ── The one definition ──────────────────────────────────────────────────────

create or replace function public.client_in_sprout(p_client uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sprout_profiles sp where sp.client_id = p_client and sp.is_active = true);
$$;

revoke all on function public.client_in_sprout(uuid) from public, anon, authenticated;
grant execute on function public.client_in_sprout(uuid) to service_role;

create or replace function public.client_strategy_only(p_client uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clients c
                  where c.id = p_client and c.demo_job_id is null and not client_in_sprout(c.id));
$$;

revoke all on function public.client_strategy_only(uuid) from public, anon, authenticated;
grant execute on function public.client_strategy_only(uuid) to service_role;

-- For the screens: the strategy-only clients among those the caller can see
-- (can_access_client, the rule the clients table itself is read by). The
-- answer is a fact about the client, not about which sprout_profiles rows the
-- caller may read, so it is read with the definer's rights behind that check.
create or replace function public.strategy_only_clients()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.id from clients c
   where (coalesce(auth.role(), '') = 'service_role' or can_access_client(c.id))
     and client_strategy_only(c.id);
$$;

revoke all on function public.strategy_only_clients() from public, anon;
grant execute on function public.strategy_only_clients() to authenticated, service_role;

-- ── The voice profile of a client with no plans ─────────────────────────────

-- calendar_request_week asks for a client's voice profile when it has none,
-- or one built before this month's first Monday once that Monday has come.
-- This is that rule on its own, for a strategy-only client: the same test,
-- the same job key (one a day), the priority a plan the product asked for
-- gives it. True when a profile was asked for.
create or replace function public.voice_profile_request(p_client uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', current_date)::date;
  v_first_monday date;
  v_voice timestamptz;
begin
  if not exists (select 1 from clients where id = p_client and archived_at is null) then
    return false;
  end if;
  -- The voice profile: missing, or built before this month's first Monday once that Monday has come.
  v_first_monday := v_month + ((8 - extract(isodow from v_month)::int) % 7);
  select (social_voice->>'built_at')::timestamptz into v_voice from clients where id = p_client;
  if v_voice is null or (current_date >= v_first_monday and v_voice::date < v_first_monday) then
    insert into scheduled_jobs (kind, client_id, dedupe_key, priority, available_at)
    values ('voice_profile', p_client, 'voice_profile:' || p_client || ':' || to_char(current_date, 'YYYY-MM-DD'), 39, now())
    on conflict (dedupe_key) do nothing;
    return true;
  end if;
  return false;
end $$;

revoke all on function public.voice_profile_request(uuid) from public, anon, authenticated;
grant execute on function public.voice_profile_request(uuid) to service_role;

-- ── A week's plan ───────────────────────────────────────────────────────────

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
  if not exists (select 1 from clients where id = p_client and archived_at is null) then
    raise exception 'This client is archived, so its calendar is not planned.';
  end if;
  if public.client_strategy_only(p_client) then
    raise exception 'This client is set up for strategy only, so its calendar is not planned until its social accounts are connected.';
  end if;

  insert into calendar_plans (client_id, week_start, trigger, requested_by)
  values (p_client, p_week, p_trigger, p_user)
  on conflict (client_id, week_start) do nothing
  returning * into v_plan;
  v_new := found;

  if not v_new then
    update calendar_plans p
       set status = 'queued', error = null, requested_by = coalesce(p_user, p.requested_by), updated_at = now(),
           ready_at = null, canceled_at = null, canceled_by = null
     where p.client_id = p_client and p.week_start = p_week
       and (p.status = 'failed'
            or (p.status = 'canceled' and p_trigger = 'button')
            or (p.status in ('queued', 'planning')
                and not exists (select 1 from scheduled_jobs j
                                 where j.kind = 'week_plan' and j.client_id = p_client and j.occurrence = p_week::timestamptz
                                   and j.status in ('queued', 'running', 'waiting'))))
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

revoke all on function public.calendar_request_week(uuid, date, text, uuid) from public, anon, authenticated;
grant execute on function public.calendar_request_week(uuid, date, text, uuid) to service_role;

-- ── A week's revision ───────────────────────────────────────────────────────

create or replace function public.calendar_request_revision(p_plan uuid, p_note text, p_user uuid default null, p_scope text default 'untouched')
returns public.calendar_plans
language plpgsql security definer set search_path = public as $$
declare
  v_plan calendar_plans;
begin
  if p_scope not in ('untouched', 'empty', 'replan') then
    raise exception 'Unknown revision scope %', p_scope;
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Say what should change.';
  end if;
  if exists (select 1 from calendar_plans p where p.id = p_plan and public.client_strategy_only(p.client_id)) then
    raise exception 'This client is set up for strategy only, so its calendar is not revised until its social accounts are connected.';
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

revoke all on function public.calendar_request_revision(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.calendar_request_revision(uuid, text, uuid, text) to service_role;

-- ── The daily run ───────────────────────────────────────────────────────────

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
  v_plan record;
  v_today date := (p_now at time zone 'UTC')::date;
  v_day_start timestamptz := date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC';
  v_retries jsonb := '[]'::jsonb;
  v_fills jsonb := '[]'::jsonb;
  v_revisions jsonb := '[]'::jsonb;
  v_asked boolean;
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
       and not public.client_strategy_only(c.id)
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

  -- Mondays: every active client gets the following week planned. Nothing
  -- else is required: the posting rhythm always resolves, and a client with
  -- no posts and no tracking is planned from its brief, pillars and moments.
  if v_monday then
    for v_client in
      select c.id from public.clients c
       where c.archived_at is null and not coalesce(c.exclude_from_reporting, false)
         and not public.client_strategy_only(c.id)
         and not exists (select 1 from public.calendar_plans p where p.client_id = c.id and p.week_start = v_week)
       order by c.name
    loop
      if not p_dry_run then
        perform public.calendar_request_week(v_client.id, v_week, 'monday', null);
      end if;
      v_weeks := v_weeks || jsonb_build_object('client_id', v_client.id, 'week', v_week);
    end loop;
  end if;

  -- Every day, a safety net: a plan whose week isn't over and that has no
  -- job on its way (one from before this change that failed, or one whose
  -- job ended some other way) is asked for again, at most once a day (no
  -- week_plan job for that week was made today). A plan's own job already
  -- retries it with growing waits, so this rarely finds anything.
  for v_plan in
    select p.client_id, p.week_start, p.trigger
      from public.calendar_plans p
      join public.clients c on c.id = p.client_id
     where p.status in ('failed', 'queued', 'planning')
       and p.week_start + 6 >= v_today
       and c.archived_at is null
       and not public.client_strategy_only(c.id)
       and not exists (select 1 from public.scheduled_jobs j
                        where j.kind = 'week_plan' and j.client_id = p.client_id and j.occurrence = p.week_start::timestamptz
                          and (j.status in ('queued', 'running', 'waiting') or j.created_at >= v_day_start))
     order by p.week_start, p.client_id
  loop
    if not p_dry_run then
      perform public.calendar_request_week(v_plan.client_id, v_plan.week_start, v_plan.trigger, null);
    end if;
    v_retries := v_retries || jsonb_build_object('client_id', v_plan.client_id, 'week', v_plan.week_start);
  end loop;

  -- Every day: a ready week with upcoming posts that have no copy gets them
  -- written, at most once a day (no 'empty' revision was asked for today).
  -- One revision runs at a time, so a week being revised waits for tomorrow.
  for v_plan in
    select p.id, p.client_id, p.week_start
      from public.calendar_plans p
      join public.clients c on c.id = p.client_id
     where p.status = 'ready' and p.pending_revision is null
       and c.archived_at is null
       and not public.client_strategy_only(c.id)
       and exists (select 1 from public.calendar_posts cp
                    where cp.plan_id = p.id and cp.post_date >= v_today and coalesce(btrim(cp.copy), '') = '')
       and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p.revisions) = 'array' then p.revisions else '[]'::jsonb end) r
                        where r->>'scope' = 'empty'
                          and (case when r->>'at' ~ '^\d{4}-\d{2}-\d{2}' then (r->>'at')::timestamptz end) >= v_day_start)
     order by p.week_start, p.client_id
  loop
    v_asked := true;
    if not p_dry_run then
      begin
        perform public.calendar_request_revision(v_plan.id, 'Write the posts that have no copy yet.', null, 'empty');
      exception when others then
        -- Someone asked for a revision between the check and now: tomorrow's run looks again.
        v_asked := false;
      end;
    end if;
    if v_asked then
      v_fills := v_fills || jsonb_build_object('client_id', v_plan.client_id, 'week', v_plan.week_start, 'plan_id', v_plan.id);
    end if;
  end loop;

  -- Every day, the same safety net for revisions: one waiting with no job on
  -- its way gets a job again while its week has days to come.
  for v_plan in
    select p.id, p.client_id, p.week_start
      from public.calendar_plans p
      join public.clients c on c.id = p.client_id
     where p.pending_revision is not null
       and p.week_start + 6 >= v_today
       and c.archived_at is null
       and not public.client_strategy_only(c.id)
       and not exists (select 1 from public.scheduled_jobs j
                        where j.kind = 'week_revise' and j.client_id = p.client_id and j.occurrence = p.week_start::timestamptz
                          and (j.status in ('queued', 'running', 'waiting') or j.created_at >= v_day_start))
     order by p.week_start, p.client_id
  loop
    if not p_dry_run then
      insert into public.scheduled_jobs (kind, client_id, occurrence, dedupe_key, priority, available_at)
      values ('week_revise', v_plan.client_id, v_plan.week_start::timestamptz,
              'week_revise:' || v_plan.id || ':again:' || to_char(p_now at time zone 'UTC', 'YYYY-MM-DD'), 15, p_now)
      on conflict (dedupe_key) do nothing;
    end if;
    v_revisions := v_revisions || jsonb_build_object('client_id', v_plan.client_id, 'week', v_plan.week_start, 'plan_id', v_plan.id);
  end loop;

  return jsonb_build_object('dry_run', p_dry_run, 'at', p_now, 'released', v_released, 'enqueued', v_enqueued,
                            'week_plans', v_weeks, 'plan_retries', v_retries, 'revision_retries', v_revisions, 'copy_fills', v_fills);
end;
$$;

revoke all on function public.enqueue_scheduled_report_jobs(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_scheduled_report_jobs(timestamptz, boolean) to service_role;

-- ── The weekly trends collection ────────────────────────────────────────────

create or replace function public.enqueue_trend_refresh_jobs(p_now timestamptz default now(), p_dry_run boolean default false)
returns table (due_client uuid, due_key text)
language plpgsql security definer set search_path = public as $$
declare
  v_day text := to_char(p_now at time zone 'UTC', 'YYYY-MM-DD');
  v_week date := date_trunc('week', p_now at time zone 'Asia/Jerusalem')::date;
begin
  -- A week with no run going is closed as partial when its runs stopped three
  -- times, or when the week is over: a past week is never collected again
  -- (the run reads "this week"), so one left running by a stop on its last day
  -- or a retry that crossed Monday would otherwise stay running for good. Only
  -- stopped runs count: a replay or a finished run never uses up a week's tries.
  if not p_dry_run then
    update public.trend_weeks set status = 'partial', finished_at = p_now
     where status = 'running'
       and not exists (select 1 from public.report_pipeline_runs r where r.real_id = trend_weeks.id and r.status = 'running')
       and (trend_weeks.week_start < v_week
            or (select count(*) from public.report_pipeline_runs r where r.real_id = trend_weeks.id and r.status = 'stopped') >= 3);
  end if;

  return query
  with due as (
    select c.id as client, 'trend_refresh:' || c.id || ':' || v_day as job_key
      from public.clients c
      join public.trend_profiles tp on tp.client_id = c.id
     where c.archived_at is null
       and not coalesce(c.exclude_from_reporting, false)
       and c.demo_job_id is null
       and not public.client_strategy_only(c.id)
       and (
         -- No week yet this week: on the client's feed weekday, or after 8 days without a week.
         (not exists (select 1 from public.trend_weeks w where w.client_id = c.id and w.week_start = v_week)
          and (extract(dow from p_now at time zone 'UTC') = public.feed_refresh_weekday(c.id)
               or not exists (select 1 from public.trend_weeks w where w.client_id = c.id and w.created_at > p_now - interval '8 days')))
         -- Or this week's run stopped, fewer than three times so far.
         or exists (select 1 from public.trend_weeks w
                     where w.client_id = c.id and w.week_start = v_week and w.status = 'running'
                       and not exists (select 1 from public.report_pipeline_runs r where r.real_id = w.id and r.status = 'running')
                       and (select count(*) from public.report_pipeline_runs r where r.real_id = w.id and r.status = 'stopped') < 3)
       )
  ), queued as (
    insert into public.scheduled_jobs (kind, client_id, dedupe_key, priority, available_at)
    select 'trend_refresh', d.client, d.job_key, 50, p_now from due d where not p_dry_run
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select d.client, d.job_key from due d;
end $$;

revoke all on function public.enqueue_trend_refresh_jobs(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_trend_refresh_jobs(timestamptz, boolean) to service_role;

-- ── Due schedules with no job ───────────────────────────────────────────────

create or replace function public.scheduled_report_gaps(p_now timestamptz default now())
returns table (schedule_id uuid, client_id uuid, client_name text, report_kind text, next_run_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.client_id, c.name, s.report_kind, s.next_run_at
    from public.report_schedules s
    join public.clients c on c.id = s.client_id
   where s.is_active and c.archived_at is null
     and not public.client_strategy_only(c.id)
     and s.next_run_at < p_now - interval '1 hour'
     and not exists (select 1 from public.scheduled_jobs j where j.schedule_id = s.id and j.occurrence = s.next_run_at)
$$;

revoke all on function public.scheduled_report_gaps(timestamptz) from public, anon, authenticated;
grant execute on function public.scheduled_report_gaps(timestamptz) to service_role;
