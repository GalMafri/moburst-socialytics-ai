-- The weekly calendar never needs a setting and never dead-ends (Lital,
-- 19 Oct 2026: a self-serve app; nothing may wait for a person, a flag or a
-- developer session). Spec, section 2:
-- docs/superpowers/specs/2026-10-19-self-serve-lifecycle-design.md
--
--   * No readiness gate. calendar_client_ready goes: every client that isn't
--     archived can be planned, and the Monday run plans every active client.
--     The posting rhythm always resolves (_shared/calendar/evidence.ts
--     resolveRhythm), so a plan never fails for want of a setting.
--   * No failure while a week can be used (Lital, 19 Oct: nothing may fail
--     and flag the user). A plan or revision that doesn't finish is tried
--     again by its job with growing waits (_shared/calendar/runWeek.ts
--     retryWait); a week that is over closes quietly as 'expired'. As a
--     safety net, the daily run asks again for any plan or revision left
--     without a job, at most once a day.
--   * No empty posts. The daily run has the copy written for any upcoming
--     post in a ready week that has none, at most once a day.
--
-- enqueue_scheduled_report_jobs is the definition in
-- 20261019180000_client_lifecycle.sql (with its daily lifecycle look), with
-- the Monday block changed and the daily sweeps added.

-- A week that ended before it was planned closes quietly as 'expired'.
-- 'failed' stays allowed for plans written before this change; nothing
-- writes it any more.
alter table public.calendar_plans drop constraint if exists calendar_plans_status_check;
alter table public.calendar_plans add constraint calendar_plans_status_check
  check (status in ('queued', 'planning', 'ready', 'failed', 'expired'));
update public.calendar_plans set status = 'expired', updated_at = now()
 where status = 'failed' and week_start + 6 < current_date;

-- Ask for a week's plan, as in 20261019140000_weekly_calendar.sql, for any
-- client that isn't archived. A plan that failed, or that is waiting with no
-- job left to write it, is queued again; a plan with a job on its way is
-- left to it.
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

  insert into calendar_plans (client_id, week_start, trigger, requested_by)
  values (p_client, p_week, p_trigger, p_user)
  on conflict (client_id, week_start) do nothing
  returning * into v_plan;
  v_new := found;

  if not v_new then
    update calendar_plans p set status = 'queued', error = null, requested_by = coalesce(p_user, p.requested_by), updated_at = now()
     where p.client_id = p_client and p.week_start = p_week
       and (p.status = 'failed'
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

-- The daily tick.
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

-- Nothing calls the readiness gate any more.
drop function if exists public.calendar_client_ready(uuid);

comment on column public.clients.posting_rhythm is 'Optional staff override: posts per week per platform, e.g. {"LinkedIn": 3}; 0 leaves a platform out. Null follows the rhythm each plan resolves (its own posts, its competitors, every tracked company).';
