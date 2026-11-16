-- A trend week that is over is never left running (13 Nov 2026).
--
-- A week whose run stopped (every watched platform failed, or a stop on the
-- week's last day) stays running so the weekly enqueue collects it again, but
-- only the current week is ever collected (startTrendWeek names this week).
-- A week whose runs stopped fewer than three times and then ended, or whose
-- retries crossed Monday, was therefore never closed and never collected. The
-- close step now also covers every week before this one that has no run going.
-- The rest of the function is as 20261029100100 made it. Safe to apply twice.

create or replace function public.enqueue_trend_refresh_jobs(p_now timestamptz default now(), p_dry_run boolean default false)
returns table (due_client uuid, due_key text)
language plpgsql security definer set search_path = public as $$
declare
  v_day text := to_char(p_now at time zone 'UTC', 'YYYY-MM-DD');
  v_week date := date_trunc('week', p_now at time zone 'Asia/Jerusalem')::date;
begin
  -- A week with no run going is closed as partial when its runs stopped three
  -- times, or when the week is over: a past week is never collected again
  -- (the run reads "this week"), so one left running by a stop on its last day
  -- or a retry that crossed Monday would otherwise stay running for good. Only
  -- stopped runs count: a replay or a finished run never uses up a week's tries.
  if not p_dry_run then
    update public.trend_weeks set status = 'partial', finished_at = p_now
     where status = 'running'
       and not exists (select 1 from public.report_pipeline_runs r where r.real_id = trend_weeks.id and r.status = 'running')
       and (trend_weeks.week_start < v_week
            or (select count(*) from public.report_pipeline_runs r where r.real_id = trend_weeks.id and r.status = 'stopped') >= 3);
  end if;

  return query
  with due as (
    select c.id as client, 'trend_refresh:' || c.id || ':' || v_day as job_key
      from public.clients c
      join public.trend_profiles tp on tp.client_id = c.id
     where c.archived_at is null
       and not coalesce(c.exclude_from_reporting, false)
       and c.demo_job_id is null
       and (
         -- No week yet this week: on the client's feed weekday, or after 8 days without a week.
         (not exists (select 1 from public.trend_weeks w where w.client_id = c.id and w.week_start = v_week)
          and (extract(dow from p_now at time zone 'UTC') = public.feed_refresh_weekday(c.id)
               or not exists (select 1 from public.trend_weeks w where w.client_id = c.id and w.created_at > p_now - interval '8 days')))
         -- Or this week's run stopped, fewer than three times so far.
         or exists (select 1 from public.trend_weeks w
                     where w.client_id = c.id and w.week_start = v_week and w.status = 'running'
                       and not exists (select 1 from public.report_pipeline_runs r where r.real_id = w.id and r.status = 'running')
                       and (select count(*) from public.report_pipeline_runs r where r.real_id = w.id and r.status = 'stopped') < 3)
       )
  ), queued as (
    insert into public.scheduled_jobs (kind, client_id, dedupe_key, priority, available_at)
    select 'trend_refresh', d.client, d.job_key, 50, p_now from due d where not p_dry_run
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select d.client, d.job_key from due d;
end $$;

revoke all on function public.enqueue_trend_refresh_jobs(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_trend_refresh_jobs(timestamptz, boolean) to service_role;
