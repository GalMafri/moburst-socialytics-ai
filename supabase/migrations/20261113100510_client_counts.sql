-- The per-client counts the API reports (reports, competitive reports, posts, active schedules) and the id of
-- each client's newest report, grouped in the database. The API read these as whole tables and counted in code,
-- and one request answers at most 1,000 rows, so a count could stop short. It runs with the caller's own row
-- access (security invoker): the API calls it with the service role, the MCP connector as the signed-in person,
-- so each sees the counts of the rows it may read.
create or replace function public.client_counts(client_ids uuid[])
returns table (client_id uuid, reports bigint, competitive_reports bigint, posts bigint, schedules bigint, last_report_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id as client_id,
    (select count(*) from public.reports r where r.client_id = c.id) as reports,
    (select count(*) from public.competitive_reports k where k.client_id = c.id) as competitive_reports,
    (select count(*) from public.post_iterations p where p.client_id = c.id and p.archived_at is null) as posts,
    (select count(*) from public.report_schedules s where s.client_id = c.id and s.is_active) as schedules,
    (select r.id from public.reports r where r.client_id = c.id order by r.created_at desc, r.id desc limit 1) as last_report_id
  from unnest(client_ids) as c(id)
$$;

revoke all on function public.client_counts(uuid[]) from public, anon;
grant execute on function public.client_counts(uuid[]) to authenticated, service_role;
