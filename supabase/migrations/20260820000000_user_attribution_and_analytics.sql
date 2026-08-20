-- User attribution fixes + usage analytics views.
--
-- Attribution was almost entirely missing: 0 of 132 post_iterations and only
-- 12 of 55 reports carried a created_by, so per-user numbers were meaningless.
-- The columns existed; nothing was filling them.
--
-- Browser inserts run under the user's JWT, so a column default of auth.uid()
-- fixes every current and future call site at once. Two places still need the
-- value passed explicitly and are handled in application code:
--   * trigger-scheduled-reports runs on the service role (auth.uid() is null),
--     so it now attributes the run to the schedule's owner.
--   * approvals are an UPDATE, and defaults only apply on INSERT, so
--     ContentIdeasTab now sets approved_by alongside approved_at.


-- 1. Attribute new rows to the caller. ---------------------------------------

alter table public.post_iterations alter column created_by set default auth.uid();
alter table public.reports         alter column created_by set default auth.uid();


-- 2. Usage analytics. Views, not tables: they read the rows the product has
--    already been writing, so they cover history from day one and stay current
--    with no instrumentation to maintain.

create or replace view public.user_activity as
  select r.created_by as user_id, r.client_id, 'report_run'::text as action,
         r.created_at as at,
         case when r.status in ('completed','complete','done') then 'ok'
              when r.status in ('failed','error','cancelled')  then 'failed'
              else 'incomplete' end as outcome,
         (r.duration_minutes * 60)::numeric as seconds
    from public.reports r
  union all
  select i.created_by, i.client_id,
         case when i.version > 1 then 'post_iterated' else 'post_created' end,
         i.created_at, 'ok', null::numeric
    from public.post_iterations i
  union all
  select i.approved_by, i.client_id, 'post_approved', i.approved_at, 'ok', null::numeric
    from public.post_iterations i where i.approved_at is not null
  union all
  -- scheduled_posts.created_by is text, unlike every other table; ignore
  -- anything that is not a uuid rather than letting the cast blow up.
  select case when s.created_by ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              then s.created_by::uuid end,
         s.client_id, 'post_scheduled', s.created_at,
         case when s.status in ('failed','error') then 'failed' else 'ok' end, null::numeric
    from public.scheduled_posts s
  union all
  select c.created_by, c.id, 'client_created', c.created_at, 'ok', null::numeric
    from public.clients c;

-- Keyed off auth.users rather than profiles: only 6 of 21 profiles carry an
-- email, so joining through profiles would silently drop three quarters of
-- the user base.
create or replace view public.user_analytics as
select
  u.email,
  coalesce(pr.display_name, split_part(u.email,'@',1)) as name,
  coalesce(pr.hub_company_name, u.raw_user_meta_data->>'hub_company_name') as company,
  ur.role::text as role,
  u.created_at as provisioned_at,
  u.last_sign_in_at,
  min(a.at) as first_action_at,
  max(a.at) as last_action_at,
  count(a.at) as actions_total,
  count(a.at) filter (where a.action='report_run' and a.outcome='ok') as reports_ok,
  count(a.at) filter (where a.action='post_created')   as posts_created,
  count(a.at) filter (where a.action='post_iterated')  as posts_iterated,
  count(a.at) filter (where a.action='post_approved')  as posts_approved,
  count(a.at) filter (where a.action='client_created') as clients_created,
  count(distinct a.client_id) as clients_touched,
  count(distinct date_trunc('day', a.at)) as active_days,
  count(a.at) filter (where a.outcome='failed')     as failures,
  count(a.at) filter (where a.outcome='incomplete') as abandoned,
  case
    when u.last_sign_in_at is null then 'never logged in'
    when count(a.at) = 0 then 'logged in, no output'
    when max(a.at) < now() - interval '60 days' then 'lapsed'
    when count(a.at) filter (where a.action='report_run' and a.outcome='ok') >= 3 then 'habit'
    else 'active'
  end as state
from auth.users u
left join public.profiles    pr on pr.user_id = u.id
left join public.user_roles  ur on ur.user_id = u.id
left join public.user_activity a on a.user_id = u.id
group by u.email, pr.display_name, pr.hub_company_name, u.raw_user_meta_data,
         ur.role, u.created_at, u.last_sign_in_at;


-- 3. Staff read these in the SQL editor or a BI tool, never through the app.

revoke all on public.user_activity  from anon, authenticated;
revoke all on public.user_analytics from anon, authenticated;
