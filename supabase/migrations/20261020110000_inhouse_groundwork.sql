-- Groundwork for moving Socialytics' report workflows from n8n into the app,
-- behind switches that all start on n8n, so nothing changes when this ships.
-- n8n stays the live engine and the backup (Lital, 20 Oct 2026: "Can we do
-- this while n8n is still running as a backup without ruining/duplicating
-- anything in the app?", "don't mess up anything that works now").
--
--   1. report_engines: the engine per report kind (social, competitive,
--      linkedin_source), with optional rows per client that win. n8n | shadow
--      | app, every default n8n. Shadow only per client: paid shadow runs are
--      allowed for one client, Moburst (owner's decision, 20 Oct). App is
--      refused until an app-capable in-app pipeline has finished a shadow run.
--   2. Pipeline runs and their step log (the run history n8n's executions
--      gave), shadow result tables per kind that no screen reads, and a
--      payload store for large in-between data (bucket pipeline-payloads plus
--      an index with an expiry date).
--   3. A report_pipeline job kind on the scheduled-jobs queue, leased by its
--      own function so pipeline steps run in their own lane, up to four at a
--      time, and never through the main lease.
--   4. release_ready_dispatches: a report the app makes is watched through its
--      run's heartbeat, not the 90-minute clock. Today's rule is unchanged for
--      every n8n run.
--   5. Retention: old runs, step logs and shadow results go after 90 days;
--      payloads after 30 (removed by the daily sweep through the Storage API).
--
-- Code: supabase/functions/_shared/pipelines and run-scheduled-jobs.
-- Safe to apply twice. Writes no client data.
--
-- To shadow Moburst's reports once a pipeline worth shadowing exists (the
-- placeholders only record that they ran):
--   insert into public.report_engines (kind, client_id, engine)
--   values ('social', 'd00ce604-2bcc-455a-9826-f80250db75cf', 'shadow')
--   on conflict (kind, client_id) where client_id is not null do update set engine = excluded.engine;
-- and back: update public.report_engines set engine = 'n8n' where client_id = 'd00ce604-2bcc-455a-9826-f80250db75cf';

-- ── 2. Pipeline runs (before the switch, whose guard reads them) ────────────

create table if not exists public.report_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('social', 'competitive', 'linkedin_source')),
  pipeline text not null,
  mode text not null check (mode in ('shadow', 'app')),
  -- The pipeline can make the real report (it is not a placeholder).
  app_capable boolean not null default false,
  client_id uuid not null references public.clients(id) on delete cascade,
  -- The real run: the report a shadow shadows, or the report an app run makes.
  -- No foreign key on purpose: the dispatch deletes a report that did not
  -- finish and makes it again, and neither may block or take the other.
  real_table text check (real_table in ('reports', 'competitive_reports', 'rivaliq_snapshots')),
  real_id uuid,
  real_ref jsonb,
  -- The range, the competitor set, and the request n8n gets for the same report.
  input jsonb not null default '{}'::jsonb,
  -- One run per real run and mode: asking again returns the run already made.
  dedupe_key text not null unique,
  status text not null default 'running' check (status in ('running', 'done', 'stopped')),
  step text,
  steps_done integer not null default 0,
  -- When the runner last ran a step of the run, whatever came of it.
  heartbeat_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Why a run stopped, for developers.
  outcome text,
  job_id uuid,
  constraint report_pipeline_runs_app_target check (mode <> 'app' or (real_table in ('reports', 'competitive_reports') and real_id is not null))
);
create index if not exists report_pipeline_runs_real on public.report_pipeline_runs (real_id) where real_id is not null;
create index if not exists report_pipeline_runs_client on public.report_pipeline_runs (client_id, kind, started_at desc);
create index if not exists report_pipeline_runs_running on public.report_pipeline_runs (heartbeat_at) where status = 'running';
comment on table public.report_pipeline_runs is 'In-app report pipeline runs: shadows of n8n runs (shadow tables only) or runs that make the real report (app). Nothing client-facing reads it.';

create table if not exists public.report_pipeline_steps (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.report_pipeline_runs(id) on delete cascade,
  job_id uuid,
  step text not null,
  attempt integer not null,
  started_at timestamptz not null default now(),
  -- Null: the worker was cut off during the step.
  finished_at timestamptz,
  outcome text check (outcome in ('next', 'poll', 'done', 'retry', 'stopped')),
  detail jsonb,
  constraint report_pipeline_steps_detail_small check (detail is null or pg_column_size(detail) <= 4096)
);
create index if not exists report_pipeline_steps_run on public.report_pipeline_steps (run_id, id);
comment on table public.report_pipeline_steps is 'One row per step a pipeline run took: when, what came of it, a small detail. The run history n8n''s executions list gave.';

-- ── Shadow results, per kind. Shaped like the real rows they shadow. ────────

create table if not exists public.shadow_social_reports (
  run_id uuid primary key references public.report_pipeline_runs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  -- The reports row it shadows (no foreign key: see report_pipeline_runs.real_id).
  real_report_id uuid,
  date_range_start date,
  date_range_end date,
  report_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shadow_social_reports_real on public.shadow_social_reports (real_report_id);

create table if not exists public.shadow_competitive_reports (
  run_id uuid primary key references public.report_pipeline_runs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  real_report_id uuid,
  set_id uuid,
  date_range_start date,
  date_range_end date,
  report_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shadow_competitive_reports_real on public.shadow_competitive_reports (real_report_id);

create table if not exists public.shadow_linkedin_sources (
  run_id uuid primary key references public.report_pipeline_runs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  -- The feed snapshot it shadows: {client_id, endpoint, window, requested_at}.
  real_ref jsonb,
  period_start date,
  period_end date,
  sources jsonb not null default '[]'::jsonb,
  -- { socialPosts, additional_metrics }, as the n8n workflow answers.
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shadow_social_reports is 'In-app social report results made next to the n8n run (shadow). Never shown to anyone.';
comment on table public.shadow_competitive_reports is 'In-app competitive analysis results made next to the n8n run (shadow). Never shown to anyone.';
comment on table public.shadow_linkedin_sources is 'In-app LinkedIn source results made next to the n8n call (shadow). Never shown to anyone.';

-- ── Payload store ───────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public) values ('pipeline-payloads', 'pipeline-payloads', false) on conflict (id) do nothing;

create table if not exists public.pipeline_payloads (
  -- No foreign key: an index row outlives its run until its file is removed.
  run_id uuid not null,
  key text not null,
  storage_path text not null unique,
  bytes integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (run_id, key)
);
create index if not exists pipeline_payloads_expiry on public.pipeline_payloads (expires_at);
comment on table public.pipeline_payloads is 'Large in-between pipeline data (raw scraper datasets, long model answers) in the private pipeline-payloads bucket. Removed after expires_at by the daily sweep.';

-- ── 1. The engine switch ────────────────────────────────────────────────────

create table if not exists public.report_engines (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('social', 'competitive', 'linkedin_source')),
  -- Null: the kind's default for every client. Set: this client only, and it wins.
  client_id uuid references public.clients(id) on delete cascade,
  engine text not null default 'n8n' check (engine in ('n8n', 'shadow', 'app')),
  note text,
  updated_at timestamptz not null default now(),
  -- Shadow runs cost provider credits, so they are switched on per client.
  constraint report_engines_shadow_per_client check (engine <> 'shadow' or client_id is not null)
);
create unique index if not exists report_engines_kind_default on public.report_engines (kind) where client_id is null;
create unique index if not exists report_engines_kind_client on public.report_engines (kind, client_id) where client_id is not null;
comment on table public.report_engines is 'Which engine runs each report kind: n8n (today), shadow (n8n for real plus an in-app run into shadow tables) or app (the in-app pipeline only). A client row wins over the kind default. Read by run-scheduled-jobs (dispatch) and the competitor feed refresh (LinkedIn source).';

-- App is refused until an app-capable pipeline (not a placeholder) has
-- finished a shadow run of the kind: the database cannot see the deployed
-- code, but it can see that the deployed code ran one.
create or replace function public.report_engines_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.engine = 'app' and not exists (
    select 1 from public.report_pipeline_runs r
     where r.kind = new.kind and r.mode = 'shadow' and r.status = 'done' and r.app_capable) then
    raise exception 'No in-app % pipeline has finished a shadow run yet, so % stays on n8n or shadow.', new.kind, new.kind;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists report_engines_guard on public.report_engines;
create trigger report_engines_guard before insert or update on public.report_engines
  for each row execute function public.report_engines_guard();

insert into public.report_engines (kind, engine, note) values
  ('social', 'n8n', 'Monthly social report: n8n SZbRTV7yOdXTNHHf'),
  ('competitive', 'n8n', 'Competitive analysis: n8n EBiAwSay3H2R8krv'),
  ('linkedin_source', 'n8n', 'Verified LinkedIn Source: n8n xm3ZFPjysyQCkWsc')
on conflict do nothing;

-- ── Access: the service role only. Nothing client-facing reads any of it. ───

alter table public.report_engines enable row level security;
alter table public.report_pipeline_runs enable row level security;
alter table public.report_pipeline_steps enable row level security;
alter table public.shadow_social_reports enable row level security;
alter table public.shadow_competitive_reports enable row level security;
alter table public.shadow_linkedin_sources enable row level security;
alter table public.pipeline_payloads enable row level security;
revoke all on public.report_engines, public.report_pipeline_runs, public.report_pipeline_steps, public.shadow_social_reports,
  public.shadow_competitive_reports, public.shadow_linkedin_sources, public.pipeline_payloads from public, anon, authenticated;
grant select, insert, update, delete on public.report_engines, public.report_pipeline_runs, public.report_pipeline_steps, public.shadow_social_reports,
  public.shadow_competitive_reports, public.shadow_linkedin_sources, public.pipeline_payloads to service_role;

-- ── 3. The report_pipeline job kind and its lane ────────────────────────────

-- Added to whatever kinds the constraint allows when this runs, so a kind
-- another change adds (in either order) is kept.
do $$
declare
  v_def text;
  v_kinds text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.scheduled_jobs'::regclass and conname = 'scheduled_jobs_kind_check';
  -- Either way Postgres prints the list: ARRAY['a'::text, ...] or '{a,b}'::text[].
  select array_agg(distinct k order by k) into v_kinds from (
    select m[1] as k from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m
    union
    select btrim(e) from unnest(string_to_array(substring(coalesce(v_def, '') from '\{([a-z_,]*)\}'), ',')) as e
  ) kinds where k ~ '^[a-z_]+$';
  v_kinds := array(select distinct k from unnest(coalesce(v_kinds, '{}'::text[])
    || array['feed_refresh', 'dispatch', 'week_plan', 'week_revise', 'voice_profile', 'lifecycle', 'lifecycle_step', 'report_pipeline']) as k order by k);
  alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_kind_check;
  execute format('alter table public.scheduled_jobs add constraint scheduled_jobs_kind_check check (kind = any (%L::text[]))', v_kinds);
end $$;

create index if not exists scheduled_jobs_pipeline_ready on public.scheduled_jobs (priority, available_at)
  where kind = 'report_pipeline' and status in ('queued', 'running');

-- The main lease, as before, except that it never hands out a pipeline step.
create or replace function public.scheduled_jobs_lease(p_lease_seconds integer default 300)
returns setof public.scheduled_jobs
language sql security definer set search_path = public as $$
  update public.scheduled_jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(j.started_at, now()),
         updated_at = now()
   where j.id = (
     select id from public.scheduled_jobs
      where kind <> 'report_pipeline'
        and ((status = 'queued' and available_at <= now())
          or (status = 'running' and lease_until < now()))
      order by priority, available_at, created_at
      limit 1
      for update skip locked)
  returning j.*;
$$;

-- The pipeline lane's lease: due pipeline steps, as many as keep the steps
-- running across every worker at or under p_max_running. Serialized, so two
-- workers never both fill the same free room.
create or replace function public.scheduled_jobs_lease_pipelines(p_lease_seconds integer default 300, p_max_running integer default 4)
returns setof public.scheduled_jobs
language plpgsql security definer set search_path = public as $$
declare
  v_free integer;
begin
  perform pg_advisory_xact_lock(hashtext('scheduled_jobs_lease_pipelines'));
  select greatest(0, p_max_running - count(*))::int into v_free
    from public.scheduled_jobs
   where kind = 'report_pipeline' and status = 'running' and lease_until >= now();
  if v_free = 0 then return; end if;
  return query
    with leased as (
      update public.scheduled_jobs j
         set status = 'running',
             attempts = j.attempts + 1,
             lease_until = now() + make_interval(secs => p_lease_seconds),
             started_at = coalesce(j.started_at, now()),
             updated_at = now()
       where j.id in (
         select id from public.scheduled_jobs
          where kind = 'report_pipeline'
            and ((status = 'queued' and available_at <= now())
              or (status = 'running' and lease_until < now()))
          order by priority, available_at, created_at
          limit v_free
          for update skip locked)
      returning j.*)
    select * from leased;
end $$;

-- A run and its first step's job, in one transaction. Asking again for the
-- same dedupe key returns the run already made and queues nothing.
create or replace function public.report_pipeline_start(
  p_kind text, p_mode text, p_pipeline text, p_app_capable boolean, p_client uuid,
  p_real_table text, p_real_id uuid, p_real_ref jsonb, p_input jsonb, p_first_step text, p_dedupe text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run uuid;
  v_job uuid;
begin
  insert into public.report_pipeline_runs (kind, pipeline, mode, app_capable, client_id, real_table, real_id, real_ref, input, dedupe_key, step)
  values (p_kind, p_pipeline, p_mode, coalesce(p_app_capable, false), p_client, p_real_table, p_real_id, p_real_ref, coalesce(p_input, '{}'::jsonb), p_dedupe, p_first_step)
  on conflict (dedupe_key) do nothing
  returning id into v_run;
  if v_run is null then
    select id into v_run from public.report_pipeline_runs where dedupe_key = p_dedupe;
    return jsonb_build_object('run_id', v_run, 'started', false);
  end if;
  -- A run that makes a real report goes before a shadow.
  insert into public.scheduled_jobs (kind, client_id, payload, dedupe_key, priority, max_attempts, available_at)
  values ('report_pipeline', p_client,
          jsonb_build_object('run_id', v_run, 'pipeline', p_pipeline, 'step', p_first_step, 'state', '{}'::jsonb),
          'report_pipeline:' || v_run, case when p_mode = 'app' then 25 else 60 end, 5, now())
  returning id into v_job;
  update public.report_pipeline_runs set job_id = v_job where id = v_run;
  return jsonb_build_object('run_id', v_run, 'started', true);
end $$;

-- ── 4. A report the app makes is watched through its run ────────────────────

-- As in 20261019200000_pipeline_recovery.sql, with one addition: a sent
-- dispatch whose report the app makes (result.engine = 'app') is released
-- when the report finished, or its run ended, or the runner has not touched
-- the run for 90 minutes. A run still taken step by step is never released
-- for its age. Every n8n dispatch follows today's rule unchanged.
create or replace function public.release_ready_dispatches()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_held integer;
  v_sent integer;
begin
  update public.scheduled_jobs j
     set status = 'queued', available_at = now(), lease_until = null, updated_at = now()
    from public.report_schedules s
    join public.competitive_reports c on c.id = s.pending_competitive_report_id
   where j.schedule_id = s.id and j.kind = 'dispatch' and s.report_kind = 'social'
     and coalesce(j.phase, '') not in ('posting', 'sent')
     and ((j.status in ('waiting', 'blocked') and c.status = 'complete')
       or (j.status = 'waiting' and c.status = 'failed'));
  get diagnostics v_held = row_count;

  update public.scheduled_jobs j
     set status = 'queued', available_at = now(), lease_until = null, updated_at = now()
   where j.kind = 'dispatch' and j.status = 'waiting' and j.phase = 'sent'
     and case
       when coalesce(j.result ->> 'engine', '') = 'app' then
         (not exists (select 1 from public.reports r
                       where r.id = j.report_id and r.status in ('running', 'pending'))
          and not exists (select 1 from public.competitive_reports c
                           where c.id = j.report_id and c.status in ('running', 'pending')))
         or not exists (select 1 from public.report_pipeline_runs p
                         where p.real_id = j.report_id and p.mode = 'app' and p.status = 'running'
                           and p.heartbeat_at > now() - interval '90 minutes')
       else
         not exists (select 1 from public.reports r
                      where r.id = j.report_id and r.status in ('running', 'pending') and r.created_at > now() - interval '90 minutes')
         and not exists (select 1 from public.competitive_reports c
                          where c.id = j.report_id and c.status in ('running', 'pending') and c.created_at > now() - interval '90 minutes')
     end;
  get diagnostics v_sent = row_count;
  return v_held + v_sent;
end;
$$;

-- ── 5. Retention ────────────────────────────────────────────────────────────

-- Run by the daily sweep after it removes expired payload files. A run no
-- step has touched for a day is past every limit a run has (12 hours), so it
-- is closed; runs older than 90 days go, with their step log and shadow
-- results.
create or replace function public.report_pipeline_retention(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_closed integer;
  v_removed integer;
begin
  update public.report_pipeline_runs
     set status = 'stopped', outcome = coalesce(outcome, 'No step of the run was taken for a day.'), finished_at = p_now
   where status = 'running' and heartbeat_at < p_now - interval '1 day';
  get diagnostics v_closed = row_count;
  delete from public.report_pipeline_runs
   where started_at < p_now - interval '90 days' and status <> 'running';
  get diagnostics v_removed = row_count;
  return jsonb_build_object('closed', v_closed, 'removed', v_removed);
end $$;

revoke all on function public.report_engines_guard() from public, anon, authenticated;
revoke all on function public.scheduled_jobs_lease(integer) from public, anon, authenticated;
revoke all on function public.scheduled_jobs_lease_pipelines(integer, integer) from public, anon, authenticated;
revoke all on function public.report_pipeline_start(text, text, text, boolean, uuid, text, uuid, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.release_ready_dispatches() from public, anon, authenticated;
revoke all on function public.report_pipeline_retention(timestamptz) from public, anon, authenticated;
grant execute on function public.scheduled_jobs_lease(integer), public.scheduled_jobs_lease_pipelines(integer, integer),
  public.report_pipeline_start(text, text, text, boolean, uuid, text, uuid, jsonb, jsonb, text, text),
  public.release_ready_dispatches(), public.report_pipeline_retention(timestamptz) to service_role;
