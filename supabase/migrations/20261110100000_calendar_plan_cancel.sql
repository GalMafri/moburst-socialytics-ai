-- Stop a week's plan, or remove one that is done (Lital, 3 Nov 2026).
--
-- "Plan next week" could not be stopped once it started: the week of Nov 9
-- was planned by accident and stayed planned. Now a person can stop a plan
-- while it is queued or being written, and remove a finished plan while its
-- week has days to come. Either way the week has no plan again: the posts
-- nobody worked on leave the calendar, and every post a person worked on
-- (calendar_post_worked) stays where it is.
--
--   1. calendar_plans.status 'canceled', with canceled_at and canceled_by.
--      The row stays, so no automatic run plans the week again: the Monday
--      run and the client lifecycle plan only weeks with no plan row, and
--      the daily safety net only plans that are failed, queued or planning.
--      A person can plan it again with "Plan next week"
--      (calendar_request_week with trigger 'button').
--   2. calendar_stop_plan(plan, user): the one place that decides, called by
--      calendar-posts (stop_plan) after its member check. It holds the plan
--      row, closes the week's plan and revision jobs, moves the plan's
--      untouched posts to calendar_posts_archive, leaves the posts people
--      worked on as posts of no plan (a later plan for the week plans around
--      them), and marks the plan canceled.
--   3. calendar_posts_plan_open, before insert on calendar_posts: a plan that
--      was stopped takes no posts. A run checks before its model call and
--      before writing (_shared/calendar/runWeek.ts); this holds for a run
--      that is between its check and its write. Its share lock and the
--      stop's row lock put the two in order: the run's posts are added
--      before the stop reads the plan's posts, or not at all.
--   4. calendar_posts_archive gets story_of, which calendar_posts gained in
--      20261109140000_stories.sql, so a removed Story is kept whole.
--
-- Additive and safe to run twice. calendar_request_week is restated from
-- 20261019190000_calendar_self_serve.sql with the one change in step 1.

-- ── 1. A plan a person stopped ──────────────────────────────────────────────

alter table public.calendar_plans drop constraint if exists calendar_plans_status_check;
alter table public.calendar_plans add constraint calendar_plans_status_check
  check (status in ('queued', 'planning', 'ready', 'failed', 'expired', 'canceled'));
alter table public.calendar_plans add column if not exists canceled_at timestamptz;
alter table public.calendar_plans add column if not exists canceled_by uuid;
comment on column public.calendar_plans.canceled_at is 'When a person stopped this plan or removed it (status canceled). Cleared when the week is planned again.';
comment on column public.calendar_plans.canceled_by is 'Who stopped or removed this plan.';

alter table public.calendar_posts_archive add column if not exists story_of text;

-- ── 2. Stop or remove ───────────────────────────────────────────────────────

create or replace function public.calendar_stop_plan(p_plan uuid, p_user uuid default null)
returns public.calendar_plans
language plpgsql security definer set search_path = public as $$
declare
  v_plan calendar_plans;
  v_zone text;
  v_today date;
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  -- Held to the end, so a run's posts are added before this reads them or not at all (calendar_posts_plan_open).
  select * into v_plan from calendar_plans where id = p_plan for update;
  if v_plan.id is null then
    raise exception 'No such plan.' using errcode = 'P0002';
  end if;
  -- Asked again (a press sent twice): already stopped.
  if v_plan.status = 'canceled' then
    return v_plan;
  end if;
  if v_plan.status = 'ready' then
    -- A finished plan is removed only while its week has days to come, in the client's time zone.
    select nullif(btrim(timezone), '') into v_zone from clients where id = v_plan.client_id;
    begin
      v_today := (now() at time zone coalesce(v_zone, 'UTC'))::date;
    exception when others then
      v_today := (now() at time zone 'UTC')::date;
    end;
    if v_plan.week_start + 6 < v_today then
      raise exception 'This week is over, so its plan stays.' using errcode = '22023';
    end if;
  elsif v_plan.status not in ('queued', 'planning') then
    raise exception 'This week has no plan to stop.' using errcode = '22023';
  end if;

  -- No run starts after this: the week's plan and revision jobs that have not finished close.
  update scheduled_jobs
     set status = 'skipped', reason = 'Stopped by a person.', lease_until = null, finished_at = now(), updated_at = now()
   where kind in ('week_plan', 'week_revise') and client_id = v_plan.client_id
     and occurrence = v_plan.week_start::timestamptz and status in ('queued', 'running', 'waiting', 'blocked');

  -- The plan's posts nobody worked on leave the calendar, kept in the archive so any can be restored.
  with gone as (
    delete from calendar_posts cp
     where cp.plan_id = v_plan.id
       and not calendar_post_worked(cp.client_id, cp.post_key, cp.platform, cp.copy, cp.touched_at)
    returning cp.*
  )
  insert into calendar_posts_archive
  select (jsonb_populate_record(null::calendar_posts_archive,
           to_jsonb(g) || jsonb_build_object('archived_at', now(), 'archive_reason', 'Its week''s plan was stopped or removed by a person (calendar_stop_plan).'))).*
    from gone g;

  -- The posts someone worked on stay on their day as posts of no plan; a later plan for the week plans around them.
  update calendar_posts set plan_id = null where plan_id = v_plan.id;

  -- A revision that was waiting is kept in the plan's history, marked stopped.
  update calendar_plans
     set status = 'canceled', claimed_at = null, pending_revision = null, error = null,
         revisions = case when pending_revision is null then revisions
                          else coalesce(revisions, '[]'::jsonb) || jsonb_build_array(pending_revision || jsonb_build_object('stopped_at', now(), 'rewritten', 0)) end,
         canceled_at = now(), canceled_by = p_user, updated_at = now()
   where id = v_plan.id
  returning * into v_plan;
  return v_plan;
end $$;

revoke all on function public.calendar_stop_plan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.calendar_stop_plan(uuid, uuid) to service_role;

-- ── 3. A plan that was stopped takes no posts ───────────────────────────────

create or replace function public.calendar_posts_plan_open()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.plan_id is not null then
    -- A share lock on the plan: calendar_stop_plan waits for this insert, or this insert waits for it and then sees the plan stopped.
    perform 1 from calendar_plans where id = new.plan_id and status <> 'canceled' for share;
    if not found then
      raise exception 'This week''s plan was stopped, so it takes no posts.' using errcode = '55000';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.calendar_posts_plan_open() from public, anon, authenticated;

drop trigger if exists calendar_posts_plan_open on public.calendar_posts;
create trigger calendar_posts_plan_open before insert on public.calendar_posts
  for each row execute function public.calendar_posts_plan_open();

-- ── 4. Plan a stopped week again, when a person asks ───────────────────────

-- As in 20261019190000_calendar_self_serve.sql, plus: a plan a person
-- stopped or removed is queued again only by a person's own request
-- ("Plan next week", trigger 'button'), never by the Monday run, the client
-- lifecycle or the daily safety net.
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

-- The tables' grants, restated: the new columns are read and written like the rest of each row.
revoke all on public.calendar_plans from anon, authenticated;
grant select on public.calendar_plans to authenticated;
grant all on public.calendar_plans to service_role;
revoke all on public.calendar_posts_archive from anon, authenticated;
grant all on public.calendar_posts_archive to service_role;
