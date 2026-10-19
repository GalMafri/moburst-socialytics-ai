-- The setup page as a view of what the lifecycle produced, and nothing that
-- fails in front of anyone (self-serve design, rules 3 and 7, 19 Oct 2026):
-- docs/superpowers/specs/2026-10-19-self-serve-lifecycle-design.md
--
--   1. A report run a person asks for is a dispatch job with no schedule
--      (run-report queues it; run-scheduled-jobs/dispatch.ts runs it), so it
--      gets the scheduled path's quiet retries. One open request per client
--      and kind; report_run_request tells the run pages where it stands.
--   2. competitor_sets.tracked_since: when the set was linked to RivalIQ
--      tracking, so screens state tracking as a fact.
--   3. scheduled_posts.calendar_post_key: which calendar post a Sprout post
--      was scheduled for, so the post shows its own state.
-- Safe to apply twice. No client data is changed beyond the backfill of
-- tracked_since on sets already linked to tracking.

-- ── 1. Manual report runs ───────────────────────────────────────────────────
alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_dispatch_has_schedule;
alter table public.scheduled_jobs add constraint scheduled_jobs_dispatch_has_schedule check (
  case when kind = 'dispatch'
       then (schedule_id is not null and occurrence is not null)
         or (schedule_id is null and occurrence is null and payload ->> 'run' = 'manual'
             and payload ->> 'kind' in ('social', 'competitive'))
       else not (schedule_id is not null and occurrence is not null)
  end);

create unique index if not exists scheduled_jobs_one_open_manual_run
  on public.scheduled_jobs (client_id, (payload ->> 'kind'))
  where kind = 'dispatch' and schedule_id is null and status in ('queued', 'running', 'waiting', 'blocked');

-- The newest manual run of a kind for a client, asked for in the last 8
-- days: open (queued, running, waiting or blocked: the run page shows it
-- running, or when it runs again), or finished with the report it made.
-- Staff only.
drop function if exists public.report_run_request(uuid, text);
create or replace function public.report_run_request(p_client uuid, p_kind text)
returns table (job_id uuid, status text, requested_at timestamptz, range_start date, range_end date, report_id uuid, open boolean, runs integer, next_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_moburst_staff() then return; end if;
  return query
    select j.id, j.status, j.created_at,
           nullif(j.payload #>> '{range,start}', '')::date, nullif(j.payload #>> '{range,end}', '')::date,
           coalesce(j.report_id, case when (j.result ->> 'report_id') ~ '^[0-9a-f-]{36}$' then (j.result ->> 'report_id')::uuid end),
           j.status in ('queued', 'running', 'waiting', 'blocked'),
           case when jsonb_typeof(j.result -> 'runs') = 'array' then jsonb_array_length(j.result -> 'runs') else 0 end,
           j.available_at
      from public.scheduled_jobs j
     where j.kind = 'dispatch' and j.schedule_id is null and j.client_id = p_client
       and j.payload ->> 'run' = 'manual' and j.payload ->> 'kind' = p_kind
       and j.created_at > now() - interval '8 days'
     order by j.created_at desc
     limit 1;
end $$;

revoke all on function public.report_run_request(uuid, text) from public, anon;
grant execute on function public.report_run_request(uuid, text) to authenticated, service_role;

-- ── 2. When a competitor set was linked to tracking ─────────────────────────
alter table public.competitor_sets add column if not exists tracked_since timestamptz;
comment on column public.competitor_sets.tracked_since is 'When the set was linked to the RivalIQ landscape it has now (rivaliq_landscape_id). Null while it has none.';

create or replace function public.competitor_sets_mark_tracked()
returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.rivaliq_landscape_id is distinct from old.rivaliq_landscape_id then
    new.tracked_since := case when nullif(btrim(coalesce(new.rivaliq_landscape_id, '')), '') is null then null else now() end;
  end if;
  return new;
end $$;

drop trigger if exists competitor_sets_tracked_since on public.competitor_sets;
create trigger competitor_sets_tracked_since before insert or update of rivaliq_landscape_id on public.competitor_sets
  for each row execute function public.competitor_sets_mark_tracked();

-- Sets linked before this: the app's own setup finishing for that landscape,
-- else the set's first analysis, else its confirmation. Only tracked_since
-- is written, so no other trigger on the table fires.
update public.competitor_sets cs
   set tracked_since = coalesce(
         (select min(j.updated_at) from public.rivaliq_setup_jobs j
           where j.set_id = cs.id and j.phase = 'complete' and j.landscape_id::text = cs.rivaliq_landscape_id),
         (select min(r.created_at) from public.competitive_reports r where r.set_id = cs.id and r.status = 'complete'),
         cs.confirmed_at, cs.created_at)
 where cs.tracked_since is null and nullif(btrim(coalesce(cs.rivaliq_landscape_id, '')), '') is not null;

-- ── 3. Which calendar post a Sprout post belongs to ─────────────────────────
alter table public.scheduled_posts add column if not exists calendar_post_key text;
create index if not exists scheduled_posts_calendar_post on public.scheduled_posts (client_id, calendar_post_key);
