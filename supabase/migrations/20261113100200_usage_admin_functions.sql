-- The six admin Usage functions that were live but written in no migration
-- (QA finding DBOPS-12): the Behavior tab's four readers, and the per-person
-- detail and timeline. Each is SECURITY DEFINER and gated on is_admin() inside
-- the query, so anyone below admin gets an empty set. Five bodies are the
-- live definitions (pg_get_functiondef) exactly. get_user_detail changes its
-- live output: it returns the dates as timestamps and the median analysis
-- minutes as a number, with a kind column saying how each row reads, and the
-- app formats them for the viewer (formatDate and one rounding rule), so the
-- People table and the detail panel show the same day. The database no longer
-- writes a date or a rounded figure itself. Grants are the live ones:
-- signed-in users and the service role, never anon. Safe to apply twice.

create or replace function public.get_funnel(days integer default 90)
 returns table(step text, step_order integer, users bigint, events bigint)
 language sql stable security definer set search_path to 'public'
as $function$
  with w as (
    select * from public.app_events
    where public.is_admin() and occurred_at > now() - make_interval(days => days)
  ),
  steps(step, step_order, match) as (values
    ('Signed in',         1, 'page_viewed'),
    ('Ran an analysis',   2, 'analysis_started'),
    ('Analysis finished', 3, 'analysis_completed'),
    ('Opened the report', 4, 'report_opened'),
    ('Edited a post',     5, 'post_copy_edited'),
    ('Approved a post',   6, 'post_approved')
  )
  select s.step, s.step_order,
         count(distinct w.user_id)::bigint,
         count(w.id)::bigint
  from steps s
  left join w on w.event = s.match
  group by s.step, s.step_order
  order by s.step_order;
$function$;

create or replace function public.get_ai_quality(days integer default 90)
 returns table(metric text, value numeric, sample bigint)
 language sql stable security definer set search_path to 'public'
as $function$
  with w as (
    select * from public.app_events
    where public.is_admin() and occurred_at > now() - make_interval(days => days)
  )
  select 'drafts edited', count(*) filter (where event='post_copy_edited' and ok)::numeric,
         count(*) filter (where event='post_copy_edited')::bigint from w
  union all
  -- edit_distance_pct = 0 means the draft went out exactly as generated
  select 'accepted verbatim %',
         round(100.0 * count(*) filter (where event='post_copy_edited'
                                          and (props->>'edit_distance_pct')::numeric = 0)
               / nullif(count(*) filter (where event='post_copy_edited'),0), 1),
         count(*) filter (where event='post_copy_edited')::bigint from w
  union all
  select 'heavily rewritten % (>50 edit dist)',
         round(100.0 * count(*) filter (where event='post_copy_edited'
                                          and (props->>'edit_distance_pct')::numeric > 50)
               / nullif(count(*) filter (where event='post_copy_edited'),0), 1),
         count(*) filter (where event='post_copy_edited')::bigint from w
  union all
  select 'median edit distance %',
         round((percentile_cont(0.5) within group (order by (props->>'edit_distance_pct')::numeric)
                filter (where event='post_copy_edited' and props ? 'edit_distance_pct'))::numeric, 1),
         count(*) filter (where event='post_copy_edited')::bigint from w
  union all
  select 'regenerations per edited draft',
         round(( count(*) filter (where event='post_copy_regenerated')::numeric
               / nullif(count(*) filter (where event='post_copy_edited'),0) ), 2),
         count(*) filter (where event='post_copy_regenerated')::bigint from w
  union all
  select 'edit abandon rate %',
         round(100.0 * count(*) filter (where event='post_copy_edit_cancelled')
               / nullif(count(*) filter (where event='post_copy_edit_started'),0), 1),
         count(*) filter (where event='post_copy_edit_started')::bigint from w
  union all
  -- cognitive latency: long deliberation before committing means the user is
  -- manually verifying rather than trusting the output
  select 'median deliberation seconds',
         round(((percentile_cont(0.5) within group (order by duration_ms)
                filter (where event='post_copy_edited' and duration_ms > 0))/1000.0)::numeric, 1),
         count(*) filter (where event='post_copy_edited')::bigint from w
  union all
  select 'analysis failure rate %',
         round(100.0 * count(*) filter (where event in ('analysis_failed','analysis_timed_out'))
               / nullif(count(*) filter (where event in ('analysis_completed','analysis_failed','analysis_timed_out')),0), 1),
         count(*) filter (where event in ('analysis_completed','analysis_failed','analysis_timed_out'))::bigint from w
  union all
  select 'median analysis minutes',
         round(((percentile_cont(0.5) within group (order by duration_ms)
                filter (where event='analysis_completed'))/60000.0)::numeric, 1),
         count(*) filter (where event='analysis_completed')::bigint from w;
$function$;

create or replace function public.get_report_engagement(days integer default 90)
 returns table(metric text, value numeric, sample bigint)
 language sql stable security definer set search_path to 'public'
as $function$
  with w as (
    select * from public.app_events
    where public.is_admin() and occurred_at > now() - make_interval(days => days)
  ),
  produced as (
    select count(*)::numeric n from public.reports
    where status='completed' and created_at > now() - make_interval(days => days)
  )
  select 'reports opened', count(*) filter (where event='report_opened')::numeric,
         (select n from produced)::bigint from w
  union all
  select 'distinct reports opened',
         count(distinct entity_id) filter (where event='report_opened')::numeric,
         (select n from produced)::bigint from w
  union all
  select 'read rate % of produced',
         round(100.0 * count(distinct entity_id) filter (where event='report_opened')
               / nullif((select n from produced),0), 1),
         (select n from produced)::bigint from w
  union all
  select 'median read seconds',
         round(((percentile_cont(0.5) within group (order by duration_ms)
                filter (where event='report_closed' and duration_ms > 1000))/1000.0)::numeric, 1),
         count(*) filter (where event='report_closed')::bigint from w
  union all
  select 'median scroll depth %',
         round((percentile_cont(0.5) within group (order by (props->>'scroll_pct')::numeric)
                filter (where event='report_closed' and props ? 'scroll_pct'))::numeric, 0),
         count(*) filter (where event='report_closed')::bigint from w;
$function$;

create or replace function public.get_session_quality(days integer default 90)
 returns table(metric text, value numeric, sample bigint)
 language sql stable security definer set search_path to 'public'
as $function$
  with w as (
    select * from public.app_events
    where public.is_admin() and occurred_at > now() - make_interval(days => days)
      and session_id is not null
  ),
  s as (
    select session_id,
           count(*) events,
           count(*) filter (where event not in ('page_viewed','page_left','ui_clicked')) actions,
           extract(epoch from (max(occurred_at) - min(occurred_at))) secs
    from w group by session_id
  )
  select 'sessions', count(*)::numeric, count(*)::bigint from s
  union all
  select 'median events per session',
         round((percentile_cont(0.5) within group (order by events))::numeric, 1),
         count(*)::bigint from s
  union all
  select 'median session minutes',
         round(((percentile_cont(0.5) within group (order by secs))/60.0)::numeric, 1),
         count(*)::bigint from s
  union all
  select 'dead-end sessions %',
         round(100.0 * count(*) filter (where actions = 0) / nullif(count(*),0), 1),
         count(*)::bigint from s;
$function$;

-- A function cannot change its return type in place, and the live one has three text columns.
drop function if exists public.get_user_detail(text);

create or replace function public.get_user_detail(p_email text)
 returns table(metric text, tone text, kind text, value text, at timestamp with time zone, amount numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  with me as (select id, email, created_at, last_sign_in_at from auth.users where lower(email)=lower(p_email) limit 1),
  runs as (select * from reports where created_by = (select id from me)),
  posts as (select * from post_iterations where created_by = (select id from me)),
  acts as (
    select created_at at from runs
    union all select created_at from posts
    union all select created_at from clients where created_by = (select id from me)
  ),
  gaps as (select at, at - lag(at) over (order by at) gap from (select distinct date_trunc('day', at) at from acts) d)
  -- kind says how the app reads a row: "date" is the timestamp in at (empty means never), "number" is amount
  -- (empty means no data), and "text" is value as written. The app formats all of them for the viewer.
  select * from (values
    ('Provisioned',  'plain', 'date', null::text, (select created_at from me)::timestamptz, null::numeric),
    ('Last sign-in', 'plain', 'date', null, (select last_sign_in_at from me)::timestamptz, null),
    ('First action', 'plain', 'date', null, (select min(at) from acts)::timestamptz, null),
    ('Last action',  'plain', 'date', null, (select max(at) from acts)::timestamptz, null),
    ('Days to first action', 'plain', 'text',
       coalesce((select extract(day from min(at) - (select created_at from me))::int from acts)::text,'No data'), null, null),
    ('Days since last action',
       case when (select extract(day from now() - max(at))::int from acts) > 60 then 'bad' else 'plain' end, 'text',
       coalesce((select extract(day from now() - max(at))::int from acts)::text,'No data'), null, null),
    ('Active days', 'plain', 'text', (select count(distinct date_trunc('day', at)) from acts)::text, null, null),
    ('Longest gap (days)',
       case when (select extract(day from max(gap))::int from gaps) > 30 then 'warn' else 'plain' end, 'text',
       coalesce((select extract(day from max(gap))::int from gaps)::text,'No data'), null, null),
    ('Analyses run', 'plain', 'text', (select count(*) from runs)::text, null, null),
    ('Analyses failed',
       case when (select count(*) filter (where status in ('failed','error','cancelled')) from runs) > 0 then 'bad' else 'good' end, 'text',
       (select count(*) filter (where status in ('failed','error','cancelled')) from runs)::text, null, null),
    ('Median analysis minutes', 'plain', 'number', null, null,
       (select percentile_cont(0.5) within group (order by duration_minutes) from runs)::numeric),
    ('Posts created', 'plain', 'text', (select count(*) from posts)::text, null, null),
    ('Posts approved', 'plain', 'text',
       (select count(*) from post_iterations where approved_by = (select id from me))::text, null, null),
    ('Clients touched', 'plain', 'text',
       (select count(distinct x) from (select client_id x from runs union select client_id from posts) z
         where x is not null)::text, null, null),
    ('Reports they opened', 'plain', 'text',
       (select count(distinct entity_id) from app_events
         where user_id=(select id from me) and event='report_opened')::text, null, null)
  ) v(metric, tone, kind, value, at, amount)
  where public.is_admin();
$function$;

create or replace function public.get_user_timeline(p_email text, p_limit integer default 300)
 returns table(at timestamp with time zone, kind text, label text, status text, detail text, entity_id text, client_name text)
 language sql stable security definer set search_path to 'public'
as $function$
  with me as (select id from auth.users where lower(email) = lower(p_email) limit 1)
  select * from (
    select r.created_at, 'run'::text, 'Ran an analysis'::text,
           case when r.status in ('completed','complete','done') then 'ok'
                when r.status in ('failed','error','cancelled') then 'failed' else 'running' end,
           concat_ws(' · ', r.report_type,
                     case when r.duration_minutes is not null then r.duration_minutes || 'm' end),
           r.id::text, c.name
      from reports r left join clients c on c.id = r.client_id
     where r.created_by = (select id from me)

    union all
    select i.created_at, 'post',
           case when i.version > 1 then 'Iterated a post' else 'Created a post' end, 'ok',
           concat_ws(' · ', i.platform, i.format, 'v' || i.version),
           i.id::text, c.name
      from post_iterations i left join clients c on c.id = i.client_id
     where i.created_by = (select id from me)

    union all
    select i.approved_at, 'post', 'Approved a post', 'ok',
           concat_ws(' · ', i.platform, i.format), i.id::text, c.name
      from post_iterations i left join clients c on c.id = i.client_id
     where i.approved_by = (select id from me) and i.approved_at is not null

    union all
    select s.created_at, 'publish', 'Scheduled a post',
           case when s.status in ('failed','error') then 'failed' else 'ok' end,
           concat_ws(' · ', s.platform, s.status), s.id::text, c.name
      from scheduled_posts s left join clients c on c.id = s.client_id
     where s.created_by ~ '^[0-9a-fA-F-]{36}$'
       and s.created_by::uuid = (select id from me)

    union all
    select c.created_at, 'setup', 'Added a client', 'ok', null, c.id::text, c.name
      from clients c where c.created_by = (select id from me)

    union all
    select rs.created_at, 'setup', 'Created a schedule', 'ok', rs.frequency,
           rs.id::text, c.name
      from report_schedules rs left join clients c on c.id = rs.client_id
     where rs.created_by = (select id from me)

    union all
    select e.occurred_at, 'event', e.event,
           case when e.ok is false then 'failed' when e.ok then 'ok' else null end,
           concat_ws(' · ', e.path,
                     case when e.duration_ms is not null then round(e.duration_ms/1000.0,1) || 's' end,
                     e.error_code),
           e.entity_id, null
      from app_events e
     where e.user_id = (select id from me)
       and e.event not in ('page_left','ui_clicked')
  ) t(at, kind, label, status, detail, entity_id, client_name)
  where public.is_admin() and at is not null
  order by at desc limit p_limit;
$function$;

revoke all on function public.get_funnel(integer), public.get_ai_quality(integer), public.get_report_engagement(integer),
  public.get_session_quality(integer), public.get_user_detail(text), public.get_user_timeline(text, integer) from public, anon;
grant execute on function public.get_funnel(integer), public.get_ai_quality(integer), public.get_report_engagement(integer),
  public.get_session_quality(integer), public.get_user_detail(text), public.get_user_timeline(text, integer) to authenticated, service_role;
