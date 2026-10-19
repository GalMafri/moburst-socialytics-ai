-- Shared layers (self-serve design, 19 Oct 2026, sections 4 and 5): one
-- definition per number, used by every screen.
--
-- 1. Open competitor topics: the newest feed window's topics that nobody
--    dismissed. The dashboard, the feed page and the weekly planner read it.
-- 2. Usage: one function for actions and the ones that did not finish. The
--    usage tiles, the activity chart, the Features tab and the per-person
--    table all read it.
-- 3. Competitor profiles: a display name, filled for YouTube channels from
--    their own pages, and YouTube channel ids linked under /channel/.
--
-- Not applied by this commit; the release applies it before the app ships.


-- ── 1. Open competitor topics ──────────────────────────────────────────────

-- SECURITY INVOKER: the caller's row access applies (staff read alerts and
-- feed snapshots; the planner runs as the service role).
create or replace function public.open_competitor_topics(p_client_id uuid)
returns setof public.competitive_alerts
language sql
stable
security invoker
set search_path = public
as $$
  select a.*
  from public.competitive_alerts a
  where a.client_id = p_client_id
    and a.status <> 'dismissed'
    and a.window_start = (
      select (s.payload->'window'->>'start')::date
      from public.rivaliq_snapshots s
      where s.client_id = p_client_id
        and s.endpoint = 'feed'
        and s.payload->'window'->>'start' ~ '^\d{4}-\d{2}-\d{2}$'
      order by s.fetched_at desc
      limit 1
    )
  order by a.confidence desc, a.created_at;
$$;

comment on function public.open_competitor_topics(uuid) is
  'Open competitor topics: the newest feed window''s topics that nobody dismissed. The one definition the dashboard, the feed page and the weekly planner read.';

revoke all on function public.open_competitor_topics(uuid) from public, anon;
grant execute on function public.open_competitor_topics(uuid) to authenticated, service_role;


-- ── 2. Usage: one source for actions and failures ──────────────────────────

-- Every action the product recorded, one row each: monthly reports, posts,
-- approvals, scheduling and new clients (user_activity), competitive
-- analyses, competitor sets found and confirmed, images and videos, design
-- requests, and the two requests that leave no record of their own when
-- they do not finish (finding competitors, starting a competitive analysis).
-- Rows with no author are counted too. Admins only.
create or replace function public.usage_actions(p_since timestamptz default null)
returns table (user_id uuid, client_id uuid, action text, at timestamptz, outcome text, seconds numeric)
language sql
stable
security definer
set search_path = public
as $$
  select x.user_id, x.client_id, x.action, x.at, x.outcome, x.seconds
  from (
    select ua.user_id, ua.client_id, ua.action, ua.at, ua.outcome, ua.seconds
    from public.user_activity ua

    union all
    select cr.created_by, cr.client_id, 'competitive_report_run', cr.created_at,
           case when cr.status in ('complete', 'completed', 'done') then 'ok'
                when cr.status in ('failed', 'error', 'cancelled') then 'failed'
                else 'incomplete' end,
           (cr.duration_minutes * 60)::numeric
    from public.competitive_reports cr

    union all
    select cs.generated_by, cs.client_id, 'competitors_found', cs.created_at, 'ok', null::numeric
    from public.competitor_sets cs

    union all
    select cs.confirmed_by, cs.client_id, 'competitors_confirmed', cs.confirmed_at, 'ok', null::numeric
    from public.competitor_sets cs
    where cs.confirmed_at is not null

    union all
    select mj.created_by, mj.client_id, 'media_' || coalesce(nullif(mj.kind, ''), 'image'), mj.created_at,
           case when mj.status in ('completed', 'complete', 'done', 'ready') then 'ok'
                when mj.status in ('failed', 'error') then 'failed'
                else 'incomplete' end,
           extract(epoch from (mj.updated_at - mj.created_at))::numeric
    from public.media_jobs mj

    union all
    select dr.requested_by, dr.client_id, 'design_request', dr.created_at,
           case when dr.status in ('ready', 'completed', 'complete') then 'ok'
                when dr.status in ('failed', 'error') then 'failed'
                when dr.status in ('canceled', 'cancelled') then 'canceled'
                else 'incomplete' end,
           null::numeric
    from public.design_requests dr

    union all
    select e.user_id, e.client_id,
           case when e.event = 'competitor_identification_failed' then 'competitors_found' else 'competitive_report_run' end,
           e.occurred_at, 'failed', (e.duration_ms / 1000.0)::numeric
    from public.app_events e
    where e.ok is false
      and (e.event = 'competitor_identification_failed'
           or (e.event = 'competitive_analysis_failed' and e.props->>'stage' = 'submit'))
  ) x
  where public.is_admin()
    and x.at is not null
    and (p_since is null or x.at >= p_since);
$$;

comment on function public.usage_actions(timestamptz) is
  'Every recorded action with its outcome (ok, failed, incomplete, canceled). The one source for /usage tiles, chart, Features tab and per-person counts.';

revoke all on function public.usage_actions(timestamptz) from public, anon;
grant execute on function public.usage_actions(timestamptz) to authenticated;

-- The per-person table reads the same actions. Same columns as before.
create or replace view public.user_analytics as
 select u.email,
    coalesce(pr.display_name, split_part(u.email::text, '@'::text, 1)) as name,
    coalesce(pr.hub_company_name, u.raw_user_meta_data ->> 'hub_company_name'::text) as company,
    ur.role::text as role,
    u.created_at as provisioned_at,
    u.last_sign_in_at,
    min(a.at) as first_action_at,
    max(a.at) as last_action_at,
    count(a.at) as actions_total,
    count(a.at) filter (where a.action = 'report_run'::text and a.outcome = 'ok'::text) as reports_ok,
    count(a.at) filter (where a.action = 'post_created'::text) as posts_created,
    count(a.at) filter (where a.action = 'post_iterated'::text) as posts_iterated,
    count(a.at) filter (where a.action = 'post_approved'::text) as posts_approved,
    count(a.at) filter (where a.action = 'client_created'::text) as clients_created,
    count(distinct a.client_id) as clients_touched,
    count(distinct date_trunc('day'::text, a.at)) as active_days,
    count(a.at) filter (where a.outcome = 'failed'::text) as failures,
    count(a.at) filter (where a.outcome = 'incomplete'::text) as abandoned,
        case
            when u.last_sign_in_at is null then 'never logged in'::text
            when count(a.at) = 0 then 'logged in, no output'::text
            when max(a.at) < (now() - '60 days'::interval) then 'lapsed'::text
            when count(a.at) filter (where a.action = 'report_run'::text and a.outcome = 'ok'::text) >= 3 then 'habit'::text
            else 'active'::text
        end as state
   from auth.users u
     left join public.profiles pr on pr.user_id = u.id
     left join public.user_roles ur on ur.user_id = u.id
     left join public.usage_actions(null) a on a.user_id = u.id
  group by u.email, pr.display_name, pr.hub_company_name, u.raw_user_meta_data, ur.role, u.created_at, u.last_sign_in_at;

revoke all on public.user_analytics from anon, authenticated;

-- The activity chart and the usage tiles: actions, people and the actions
-- that did not finish, per day. A new column, so the function is recreated.
drop function if exists public.get_usage_trend();
create function public.get_usage_trend()
returns table (day date, actions bigint, active_users bigint, failures bigint)
language sql
stable
security definer
set search_path = public
as $$
  select date_trunc('day', a.at)::date,
         count(*)::bigint,
         count(distinct a.user_id)::bigint,
         count(*) filter (where a.outcome = 'failed')::bigint
  from public.usage_actions(null) a
  where public.is_admin()
  group by 1
  order by 1;
$$;

revoke all on function public.get_usage_trend() from public, anon;
grant execute on function public.get_usage_trend() to authenticated;

-- The Features tab: the same actions in the window, by kind.
create or replace function public.get_feature_adoption(days integer default 90)
returns table (event text, users bigint, uses bigint, failures bigint, median_ms numeric)
language sql
stable
security definer
set search_path = public
as $$
  select a.action,
         count(distinct a.user_id)::bigint,
         count(*)::bigint,
         count(*) filter (where a.outcome = 'failed')::bigint,
         round((percentile_cont(0.5) within group (order by a.seconds * 1000))::numeric, 0)
  from public.usage_actions(now() - make_interval(days => days)) a
  where public.is_admin()
  group by a.action
  order by count(*) desc;
$$;


-- ── 3. Competitor profiles: a readable name, and working YouTube links ─────

alter table public.competitor_handles add column if not exists display_name text;

comment on column public.competitor_handles.display_name is
  'The profile''s own name (a YouTube channel title, a page name), shown instead of a raw id. Null when not known; screens then show the competitor''s name.';

-- YouTube channel titles read from each channel's own page on 19 Oct 2026
-- (39 channels). A join on the handle value, for every client that tracks
-- the channel; a name already set is kept.
update public.competitor_handles h
set display_name = v.name
from (values
  ('UC5iRJ_LUrENqWwDCjyW6nKA', 'North American Savings Bank'),
  ('UCBMtBT-QHons-bry2QihNKw', 'Summer Fridays'),
  ('UC0z1De60vOzyWNA-7GKkTPw', 'Darren Tobin'),
  ('UCaWpIzrenFxcg8vXKjl9z8w', 'Ken Nugent Law Firm'),
  ('UCA1raD2uELPTbm-J3h1Z34g', 'Insight Timer'),
  ('UCaf8ut2dP0w08kKw-jPXx5Q', 'Directive'),
  ('UC5JcRfswre-c0qSeNpkwM9Q', 'Tinuiti'),
  ('UCDXuGXQOV1A0Ivhpny9LPjQ', 'BatteryMINDer'),
  ('UC1NZzFAsL5uadlVMaqIqcpg', 'Morgan & Morgan'),
  ('UCcC4UfRS2Mu_4eb5l5ZqUdw', 'John Foy & Associates'),
  ('UCG9_lcAM6-S0ny-GpCQgbyg', 'Wysa'),
  ('UClA15cxd3LL0aVtzKNAASCQ', 'Van Sant Law'),
  ('UCGNEGrWlTG0LRTA11hvEDpA', 'Angel Reyes & Associates'),
  ('UCjqXTMgHNd0LlncJBGeV8cA', 'Earkick'),
  ('UCkCHq2dk1ZsxiG5AjeJWfMA', 'IgniteVisibility'),
  ('UCNl0R0OQcxu39RCh9x64DbA', 'NOCO'),
  ('UCNbbbaKtyKHBbatPiVnffAQ', 'Consultus Digital'),
  ('UCmA0PaDYqW2J2tJR56Mk91A', 'Housecall Pro'),
  ('UCnfDrHrielQcTF0fFusUIRQ', 'ILIA Beauty'),
  ('UCLZBtNXF4-mpYes5sHpZWyQ', 'Montlick Injury Attorneys'),
  ('UCOEUwpuTcWkVycXes7jWK0g', 'ACOSTA INJURY LAW'),
  ('UCodd0J19soHWV-g2MbCjvEg', 'OptiMate1'),
  ('UCOHqDOu9oP8NsEiKz3vpczw', 'Melio Payments'),
  ('UCRB-vLBzzsrpQ41QeHKSqbg', 'Service Fusion'),
  ('UCqTpoYKRl0Ini-WBMiOgkpA', 'Veterans First Mortgage'),
  ('UCoi-XJT3UfouhAT0GkkayVw', 'Nataly Kogan'),
  ('UCpKXKCb2orfbM8N5GwLTO9w', 'Cruz and Associates'),
  ('UCQ55dSxTO0PROjHRvAWqVPw', 'Hasner Law, PC'),
  ('UCSeHRgbV1EjTORq19mucyPA', 'FieldPulse'),
  ('UCxjizySfwZ0LyRwKaPobXdA', 'TOPDOGLAW'),
  ('UCuhZOIiPtaiTvQcxca9a9jg', 'Vive Health'),
  ('UCZ4qs1SgV7wTkM2VjHByuRQ', 'NoGood'),
  ('UCW3rPTecKq_pz9FX1H5a5rQ', 'Woebot Health'),
  ('UCvOtsjwO04Seaep0J2clYEw', 'Rare Beauty'),
  ('UCZeYuwBrLCYDZZM5ibwhOiw', 'Milk Makeup'),
  ('UCvBrsgjJrUA4Vube-mE7nHg', 'American Financing'),
  ('UCzbNs5Sf_YEISZ1FkY4KfLQ', 'Yodel Mobile'),
  ('UCZUg9QTOHBdasciePfwnwFg', 'AppTweak - App Store Marketing Platform'),
  ('UCZL4mE2L0U9k3SDz6pQuUQg', 'Mutual of Omaha Mortgage')
) as v(handle, name)
where h.platform = 'youtube'
  and h.handle = v.handle
  and h.display_name is null;

-- A YouTube channel id (UC and 22 more characters) lives under /channel/.
-- Stored as youtube.com/@<id>, the link is a 404 (11 active rows).
update public.competitor_handles
set profile_url = 'https://www.youtube.com/channel/' || handle
where platform = 'youtube'
  and handle ~ '^UC[A-Za-z0-9_-]{22}$'
  and profile_url ~* '^https?://(www\.)?youtube\.com/@UC[A-Za-z0-9_-]{22}/?$';
