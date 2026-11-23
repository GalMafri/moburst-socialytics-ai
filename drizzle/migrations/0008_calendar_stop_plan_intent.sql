-- "Stop planning" never removes a plan that finished meanwhile (QA 22 Nov
-- 2026, P56-07 with P05-1).
--
-- calendar_stop_plan took one action for two buttons: "Stop planning" on a
-- plan on its way and "Remove this week's plan" on a finished one. When a
-- plan finished while the stop question was open (or a resend of the stop
-- landed after it finished), the stop was read as a removal and the week's
-- freshly written posts left the calendar.
--
-- calendar_stop_plan(plan, user, intent) now hears which button was pressed:
--   'stop'    stops a plan that is queued or being written; a plan that is
--             ready by then is left as it is and answered, so the screen
--             shows it planned.
--   'remove'  removes a finished plan (and stops one that is on its way).
--   null      as before, for a caller that names no intent.
-- The decision is made with the plan row held, so it cannot race the run
-- that finishes the plan.
--
-- The two-argument function is replaced by this one: with a default on the
-- third argument, both side by side would make a call with two arguments
-- ambiguous. A caller that passes (p_plan, p_user) reaches this one. Safe to
-- run twice.

drop function if exists public.calendar_stop_plan(uuid, uuid);

create or replace function public.calendar_stop_plan(p_plan uuid, p_user uuid default null, p_intent text default null)
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
  if p_intent is not null and p_intent not in ('stop', 'remove') then
    raise exception 'Unknown intent %', p_intent using errcode = '22023';
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
  -- "Stop planning" pressed while the plan was on its way, and it finished first: nothing is removed.
  if p_intent = 'stop' and v_plan.status = 'ready' then
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

revoke all on function public.calendar_stop_plan(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.calendar_stop_plan(uuid, uuid, text) to service_role;
