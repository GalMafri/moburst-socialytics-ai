-- supabase/migrations/20261118110000_calendar_replan.sql
--
-- Copy sources (17 Nov 2026): a third kind of week revision, 'replan', and
-- the record of an own account the app parked.
--
-- 1. calendar_request_revision accepts the scope 'replan'.
--
-- A week's copy could mix brands from three sources: display names with
-- decorations learned as the client's voice, two own accounts of one client
-- on one network, and other companies' posts retold as the client's own. The
-- code now closes all three. This lets the app repair the weeks that were
-- already planned, by itself: the client lifecycle (step calendar_recheck)
-- asks for one revision of scope 'replan' for each upcoming week that holds
-- posts nobody worked on which were written from an outside post, carry time
-- codes, or were planned before the client's accounts changed. A replan
-- writes those posts again from fresh evidence with their earlier copy left
-- out (_shared/calendar/runWeek.ts runWeekRevise); every post a person
-- worked on keeps its copy, as in any revision (calendar_post_worked).
--
-- The only change is the list of scopes calendar_request_revision accepts:
-- 'untouched', 'empty' and now 'replan'. Everything else is restated as
-- 20261019140000_weekly_calendar.sql has it: one revision at a time, only on
-- a plan that is ready, a voice profile first for a client with none, and
-- the week_revise job. The daily 'empty' filler
-- (20261019190000_calendar_self_serve.sql) and the client notes' rewrite
-- read the scope by value, so they work as before.
--
-- Same signature and grants.
--
-- 2. sprout_profiles.parked_at and parked_reason.
--
-- A client has at most one own account per network
-- (_shared/lifecycle/accounts.ts ownPerNetwork). The account that is not the
-- brand's is parked: is_active = false, with when and why written on its own
-- row. Until now nothing recorded that a row was switched off by the app and
-- not by a person, so the only record would have been one run's result in
-- client_lifecycle_steps, which a later failed run clears. With the record
-- on the row, every run of the accounts step, and the calendar's re-plan of
-- the weeks planned before the accounts changed, read the same fact however
-- many runs fail in between. parked_at is also how the rule tells a row it
-- parked (which it may bring back when the kept account is gone) from a row
-- a person switched off (which it never touches), and a parked row a person
-- added back (active with parked_at still set) from any other active row.
-- Both columns are null on every row that exists today: no account is parked
-- until the accounts step runs under the rule.
--
-- Two columns added if missing, one function made again: safe to run twice.

alter table public.sprout_profiles add column if not exists parked_at timestamptz;
alter table public.sprout_profiles add column if not exists parked_reason text;
comment on column public.sprout_profiles.parked_at is 'When the one-account-per-network rule parked this account (is_active = false). Null for an account it never parked, or one it brought back.';
comment on column public.sprout_profiles.parked_reason is 'Why the account was parked, in a sentence: which account was kept on the network and by which fact.';

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
