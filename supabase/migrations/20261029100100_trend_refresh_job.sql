-- Trends: the weekly trend_refresh job (spec section 3; plan Task 7).
-- Applied after trends_v1 is deployed and the 9 Nov trial is reviewed, since
-- from then on every active client's week is collected (and paid for).
--
-- A function and a cron line of their own, so the report enqueue
-- (enqueue_scheduled_report_jobs) is left exactly as it is. One job per
-- active client that has a trend profile, on the client's competitor-feed
-- weekday (feed_refresh_weekday, the same day its feed refreshes), so
-- Monday's calendar plan reads the newest trends and feed together. A
-- client with no week in the last 8 days is queued on any day (a new
-- client's first week, or a week that was missed).

-- ── 1. The job kind ─────────────────────────────────────────────────────────

do $$
declare
  v_def text;
  v_kinds text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.scheduled_jobs'::regclass and conname = 'scheduled_jobs_kind_check';
  select array_agg(distinct k order by k) into v_kinds from (
    select m[1] as k from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m
    union
    select btrim(e) from unnest(string_to_array(substring(coalesce(v_def, '') from '\{([a-z_,]*)\}'), ',')) as e
  ) kinds where k ~ '^[a-z_]+$';
  v_kinds := array(select distinct k from unnest(coalesce(v_kinds, '{}'::text[]) || array['trend_refresh']) as k order by k);
  alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_kind_check;
  execute format('alter table public.scheduled_jobs add constraint scheduled_jobs_kind_check check (kind = any (%L::text[]))', v_kinds);
end $$;

-- ── 2. Who is due today ─────────────────────────────────────────────────────

create or replace function public.enqueue_trend_refresh_jobs(p_now timestamptz default now(), p_dry_run boolean default false)
returns table (client_id uuid, dedupe_key text)
language plpgsql security definer set search_path = public as $$
declare
  v_day text := to_char(p_now at time zone 'UTC', 'YYYY-MM-DD');
  v_week date := date_trunc('week', p_now at time zone 'Asia/Jerusalem')::date;
begin
  create temporary table if not exists _trend_due (client_id uuid, dedupe_key text) on commit drop;
  delete from _trend_due;
  insert into _trend_due
  select c.id, 'trend_refresh:' || c.id || ':' || v_day
    from public.clients c
    join public.trend_profiles tp on tp.client_id = c.id
   where c.archived_at is null
     and not coalesce(c.exclude_from_reporting, false)
     and c.demo_job_id is null
     and not exists (select 1 from public.trend_weeks w where w.client_id = c.id and w.week_start = v_week)
     and (extract(dow from p_now at time zone 'UTC') = public.feed_refresh_weekday(c.id)
          or not exists (select 1 from public.trend_weeks w where w.client_id = c.id and w.created_at > p_now - interval '8 days'));
  if not p_dry_run then
    insert into public.scheduled_jobs (kind, client_id, dedupe_key, priority, available_at)
    select 'trend_refresh', d.client_id, d.dedupe_key, 50, p_now from _trend_due d
    on conflict (dedupe_key) do nothing;
  end if;
  return query select d.client_id, d.dedupe_key from _trend_due d;
end $$;

revoke all on function public.enqueue_trend_refresh_jobs(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_trend_refresh_jobs(timestamptz, boolean) to service_role;

-- ── 3. Its clock: daily, five minutes after the report enqueue ──────────────

select cron.schedule('trend-refresh-enqueue', '20 7 * * *', $cron$ select public.enqueue_trend_refresh_jobs(); $cron$);
