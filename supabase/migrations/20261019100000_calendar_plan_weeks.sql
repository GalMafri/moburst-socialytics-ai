-- One plan in force per week on a client's calendar (Lital, 19 Oct 2026).
--
-- The calendar stored posts but not plans, so nothing said which plan was in
-- force for a week: a newer report's posts were added beside an older plan's
-- (Moburst, 19-25 Oct). A plan is a report's strategy: the report's own week
-- and every week planned from its findings carry its report_id.
--
--   calendar_weeks           which plan is in force for each client's week
--                            (one row per week, so one plan per week)
--   calendar_assign_week()   a plan takes a week; the newest report wins, and
--                            weeks already past are never re-planned
--   calendar_post_worked()   whether someone has worked on a post
--   calendar_posts_current   the one read path: what the calendar shows
--
-- Nothing is deleted when a newer plan takes a week: the older plan's posts
-- stay stored and leave the view, except those someone has worked on, which
-- stay on the calendar and keep their day and platform.

alter table public.calendar_posts add column if not exists touched_at timestamptz;
comment on column public.calendar_posts.touched_at is 'When a person last moved this post or saved its copy.';

-- Replaced by calendar_post_worked() below.
drop function if exists public.calendar_posts_worked_on(uuid[]);

create table if not exists public.calendar_weeks (
  client_id uuid not null references public.clients(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  report_id uuid not null references public.reports(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (client_id, week_start)
);
comment on table public.calendar_weeks is 'The plan (a report''s strategy) in force for each week of a client''s calendar. Written only through calendar_assign_week().';

alter table public.calendar_weeks enable row level security;
drop policy if exists "Read calendar weeks" on public.calendar_weeks;
create policy "Read calendar weeks" on public.calendar_weeks
  for select to authenticated using (is_moburst_staff() or is_client_member(client_id));

-- Look-ups the worked-on test makes for every planned post.
create index if not exists post_iterations_calendar_key on public.post_iterations (client_id, calendar_post_key) where calendar_post_key is not null;
create index if not exists scheduled_posts_client on public.scheduled_posts (client_id, lower(platform));

create or replace function public.calendar_assign_week(p_client uuid, p_week date, p_report uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created timestamptz;
  v_owner uuid;
begin
  if extract(isodow from p_week) <> 1 then
    raise exception 'A calendar week starts on a Monday, not %', p_week;
  end if;
  select created_at into v_created from reports where id = p_report and client_id = p_client;
  if v_created is null then
    raise exception 'Report % does not belong to client %', p_report, p_client;
  end if;
  -- Weeks already past keep the plan they had.
  if p_week < date_trunc('week', current_date)::date then
    return false;
  end if;
  insert into calendar_weeks as w (client_id, week_start, report_id)
  values (p_client, p_week, p_report)
  on conflict (client_id, week_start) do update
    set report_id = excluded.report_id, assigned_at = now()
    where w.report_id <> excluded.report_id
      and (select r.created_at from reports r where r.id = w.report_id) < v_created;
  select report_id into v_owner from calendar_weeks where client_id = p_client and week_start = p_week;
  return v_owner = p_report;
end $$;

revoke all on function public.calendar_assign_week(uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.calendar_assign_week(uuid, date, uuid) to service_role;

-- Someone has worked on a post: moved it or saved its copy, made or asked for
-- a design (a request later canceled counts only if a design came of it), or
-- scheduled it. Reads tables a client member may not see, and answers only
-- yes or no, and only about a client the caller may read.
create or replace function public.calendar_post_worked(p_client uuid, p_key text, p_platform text, p_copy text, p_touched timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (auth.role() = 'service_role' or is_moburst_staff() or is_client_member(p_client)) and (
    p_touched is not null
    or exists (select 1 from post_iterations pi where pi.client_id = p_client and pi.calendar_post_key = p_key)
    or exists (select 1 from design_requests dr where dr.client_id = p_client and dr.calendar_post_key = p_key and dr.status <> 'canceled')
    or (coalesce(p_copy, '') <> '' and exists (
      select 1 from scheduled_posts sp
      where sp.client_id = p_client and lower(coalesce(sp.platform, '')) = lower(p_platform)
        and left(btrim(coalesce(sp.post_content, '')), 200) = left(btrim(p_copy), 200))));
$$;

revoke all on function public.calendar_post_worked(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.calendar_post_worked(uuid, text, text, text, timestamptz) to authenticated, service_role;

-- What the calendar shows. Every screen and every job that reads the calendar
-- reads this view; the table is read directly only by the code that writes it.
--   * posts a person added (any source other than a plan's) always show;
--   * a week no plan has taken shows everything in it (weeks before 19 Oct 2026);
--   * a week's plan shows its posts;
--   * another plan's post in that week shows only if someone worked on it, and
--     then the week's plan leaves that day and platform to it.
create or replace view public.calendar_posts_current
with (security_invoker = true)
as
select cp.*
from public.calendar_posts cp
left join public.calendar_weeks w
  on w.client_id = cp.client_id and w.week_start = date_trunc('week', cp.post_date)::date
where cp.source not in ('report', 'trend_slot')
   or w.report_id is null
   or (cp.report_id is distinct from w.report_id
       and public.calendar_post_worked(cp.client_id, cp.post_key, cp.platform, cp.copy, cp.touched_at))
   or (cp.report_id = w.report_id and (
         not exists (
           select 1 from public.calendar_posts o
           where o.client_id = cp.client_id and o.post_date = cp.post_date and lower(o.platform) = lower(cp.platform)
             and o.source in ('report', 'trend_slot') and o.report_id is distinct from w.report_id
             and public.calendar_post_worked(o.client_id, o.post_key, o.platform, o.copy, o.touched_at))
         or public.calendar_post_worked(cp.client_id, cp.post_key, cp.platform, cp.copy, cp.touched_at)));

comment on view public.calendar_posts_current is 'The posts the calendar shows: each week''s plan in force (calendar_weeks), worked-on posts of earlier plans, and posts people added.';
grant select on public.calendar_posts_current to authenticated, service_role;

-- Existing weeks from this week on: the newest plan with posts in a week takes it.
insert into public.calendar_weeks (client_id, week_start, report_id)
select distinct on (cp.client_id, date_trunc('week', cp.post_date)::date)
       cp.client_id, date_trunc('week', cp.post_date)::date, cp.report_id
from public.calendar_posts cp
join public.reports r on r.id = cp.report_id and r.client_id = cp.client_id
where cp.source in ('report', 'trend_slot')
  and cp.post_date >= date_trunc('week', current_date)::date
order by cp.client_id, date_trunc('week', cp.post_date)::date, r.created_at desc
on conflict (client_id, week_start) do nothing;

-- The calendar keeps itself planned: every morning at 04:30 UTC (07:30 in
-- Israel), before trend slots are written at 05:00, each active client's next
-- four weeks are planned from its latest report where they need it.
select cron.unschedule('calendar-keep-planned') where exists (select 1 from cron.job where jobname = 'calendar-keep-planned');
select cron.schedule('calendar-keep-planned', '30 4 * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/calendar-posts',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name = 'socialytics_n8n_secret'),
      'X-Socialytics-User','04b86c53-de62-4d3d-a661-c714f337c8fc'),
    body := '{"action":"keep_planned"}'::jsonb, timeout_milliseconds := 60000);
$cron$);
