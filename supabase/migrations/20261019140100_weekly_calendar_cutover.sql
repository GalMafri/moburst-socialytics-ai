-- The weekly calendar's cutover, step A (Lital, 19 Oct 2026). Applied before
-- the deploy of the code that reads calendar_posts directly; the old view
-- keeps showing the same posts. Step B is 20261019140200_weekly_calendar_removals.sql.
-- Spec: docs/superpowers/specs/2026-10-19-weekly-calendar-design.md
--
--   1. Posts the calendar hides today are moved to calendar_posts_archive.
--      These are untouched posts of a plan that lost its week to a newer one.
--      Nothing anyone worked on is moved.
--   2. Every week with planned posts gets a plan (trigger cutover), and its
--      posts become source 'plan' with the plan's id.

-- ── Step A ───────────────────────────────────────────────────────────────────

create table if not exists public.calendar_posts_archive (like public.calendar_posts);
alter table public.calendar_posts_archive add column if not exists archived_at timestamptz not null default now();
alter table public.calendar_posts_archive add column if not exists archive_reason text;
comment on table public.calendar_posts_archive is 'Posts taken off the calendar, kept so any can be restored. Service role only.';
alter table public.calendar_posts_archive enable row level security;
revoke all on public.calendar_posts_archive from anon, authenticated;
grant all on public.calendar_posts_archive to service_role;

-- Someone worked on a post: the same test as calendar_post_worked(), written
-- out so the answer never depends on who runs this.
drop table if exists pg_temp.cutover_worked;
create temporary table cutover_worked as
select cp.id
  from public.calendar_posts cp
 where cp.touched_at is not null
    or exists (select 1 from public.post_iterations pi where pi.client_id = cp.client_id and pi.calendar_post_key = cp.post_key)
    or exists (select 1 from public.design_requests dr where dr.client_id = cp.client_id and dr.calendar_post_key = cp.post_key and dr.status <> 'canceled')
    or (coalesce(cp.copy, '') <> '' and exists (
          select 1 from public.scheduled_posts sp
           where sp.client_id = cp.client_id and lower(coalesce(sp.platform, '')) = lower(cp.platform)
             and left(btrim(coalesce(sp.post_content, '')), 200) = left(btrim(cp.copy), 200)));

-- What the view hid: in a week a plan holds, another plan's untouched post,
-- and the plan's own untouched post on a day and platform an older plan's
-- worked-on post kept.
insert into public.calendar_posts_archive
select cp.*, now(), 'An older plan''s post the calendar no longer showed (weekly calendar cutover, 19 Oct 2026)'
  from public.calendar_posts cp
  join public.calendar_weeks w on w.client_id = cp.client_id and w.week_start = date_trunc('week', cp.post_date)::date
 where cp.source in ('report', 'trend_slot')
   and cp.id not in (select id from cutover_worked)
   and (cp.report_id is distinct from w.report_id
        or exists (
          select 1 from public.calendar_posts o
           where o.client_id = cp.client_id and o.post_date = cp.post_date and lower(o.platform) = lower(cp.platform)
             and o.source in ('report', 'trend_slot') and o.report_id is distinct from w.report_id
             and o.id in (select id from cutover_worked)))
   and not exists (select 1 from public.calendar_posts_archive a where a.id = cp.id);

delete from public.calendar_posts cp
 using public.calendar_posts_archive a
 where a.id = cp.id;

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

drop table if exists pg_temp.cutover_worked;
