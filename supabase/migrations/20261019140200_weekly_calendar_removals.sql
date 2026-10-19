-- The weekly calendar's cutover, step B (Lital, 19 Oct 2026). Applied after
-- the deploy: the four-week planner, the view, the trend-post schedule and the
-- old memory columns go. Step A is 20261019140100_weekly_calendar_cutover.sql.

-- Anything the old code planned between the two steps joins a plan too (the
-- same statements as step A; nothing happens when there is nothing to move).
insert into public.calendar_plans (client_id, week_start, status, trigger, ready_at, evidence)
select distinct cp.client_id, date_trunc('week', cp.post_date)::date, 'ready', 'cutover', now(),
       jsonb_build_object('note', 'Planned before the weekly calendar (19 Oct 2026).')
  from public.calendar_posts cp
 where cp.source in ('report', 'trend_slot')
on conflict (client_id, week_start) do nothing;

update public.calendar_posts cp
   set plan_id = p.id, source = 'plan'
  from public.calendar_plans p
 where p.client_id = cp.client_id
   and p.week_start = date_trunc('week', cp.post_date)::date
   and cp.source in ('report', 'trend_slot');

select cron.unschedule('calendar-keep-planned') where exists (select 1 from cron.job where jobname = 'calendar-keep-planned');
select cron.unschedule('calendar-fill-trend-slots') where exists (select 1 from cron.job where jobname = 'calendar-fill-trend-slots');

drop view if exists public.calendar_posts_current;
drop function if exists public.calendar_assign_week(uuid, date, uuid);
drop table if exists public.calendar_weeks;

alter table public.calendar_posts drop constraint if exists calendar_posts_source_check;
alter table public.calendar_posts add constraint calendar_posts_source_check
  check (source in ('plan', 'ad_hoc', 'insight'));

-- The preference memory counts confirmations now (times_confirmed, last_confirmed_at).
alter table public.brand_voice_learnings drop constraint if exists brand_voice_learnings_confidence_check;
alter table public.brand_voice_learnings drop column if exists confidence;
alter table public.brand_voice_learnings drop column if exists source_iterations;
