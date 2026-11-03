-- Report insights from the data (Lital, 3 Nov 2026).
-- Design: docs/superpowers/specs/2026-11-03-seasonal-insights-design.md, part 2.
-- Applied only after the 7 Nov reports are compared.
--
-- Code works out what a report says (_shared/reports/facts.ts); Sonnet 5.5
-- only words the numbered facts, and code checks every number and direction
-- (_shared/reports/insights.ts). The screens show these insights in place of
-- the model-written fields, which stay stored untouched.
--
--   1. report_insights: one answer per report and exact input (its hash), so
--      the same data always shows the same words
--   2. report_insights_live_from(): when insights went live; reports stored
--      before keep their text (decision 4)
--   3. the report_insights job, at most one waiting per report, queued by
--      report_text when it finishes (report_insights_queue) and when the
--      team's verdict on a competitive suggestion changes
--
-- People read the insights of the reports they can see; only the service
-- role writes them. The new table gets the three restrictive "OAuth sessions
-- cannot ..." policies of 20261109120000_claude_connector.sql. Additive and
-- safe to apply twice.

-- ── 1. The insights ─────────────────────────────────────────────────────────

create table if not exists public.report_insights (
  id uuid primary key default gen_random_uuid(),
  report_table text not null check (report_table in ('reports', 'competitive_reports')),
  report_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('social', 'competitive')),
  -- SHA-256 of the facts, the post sample, the team's verdicts, the prompt version and the model.
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  -- The numbered facts, worked out in code: [{id, key, kind, ..., sentence, basis}].
  facts jsonb not null,
  -- What the screens show, each piece with the fact ids it cites.
  fields jsonb not null,
  -- model: the answer checked out; template: the facts in code's own words.
  source text not null check (source in ('model', 'template')),
  model text,
  prompt_version integer not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  -- What was wrong with an answer that was asked again; for developers.
  problems jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint report_insights_one_per_input unique (report_id, input_hash)
);
create index if not exists report_insights_report on public.report_insights (report_id, created_at desc);
create index if not exists report_insights_client on public.report_insights (client_id);

comment on table public.report_insights is 'A report''s insights: facts worked out in code, worded by one model call and checked in code. The newest row of a report is the one shown.';

alter table public.report_insights enable row level security;

drop policy if exists "Read report insights" on public.report_insights;
create policy "Read report insights" on public.report_insights
  for select to authenticated using (public.is_moburst_staff() or public.is_client_member(client_id));

drop policy if exists "OAuth sessions cannot insert" on public.report_insights;
create policy "OAuth sessions cannot insert" on public.report_insights as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.report_insights;
create policy "OAuth sessions cannot update" on public.report_insights as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.report_insights;
create policy "OAuth sessions cannot delete" on public.report_insights as restrictive for delete to authenticated using (not (select public.is_oauth_session()));

revoke all on public.report_insights from public, anon;
grant select on public.report_insights to authenticated;
grant select, insert, update, delete on public.report_insights to service_role;

-- ── 2. Go-live ──────────────────────────────────────────────────────────────

-- The moment this migration first ran. Created once: running the migration
-- again keeps the first moment, so no stored report gains insights.
do $$
begin
  if to_regprocedure('public.report_insights_live_from()') is null then
    execute format('create function public.report_insights_live_from() returns timestamptz language sql immutable as %L',
      'select ' || quote_literal(now()::text) || '::timestamptz');
  end if;
end $$;

revoke all on function public.report_insights_live_from() from public, anon, authenticated;
grant execute on function public.report_insights_live_from() to service_role;

-- ── 3. The job ──────────────────────────────────────────────────────────────

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
  v_kinds := array(select distinct k from unnest(coalesce(v_kinds, '{}'::text[]) || array['report_insights']) as k order by k);
  alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_kind_check;
  execute format('alter table public.scheduled_jobs add constraint scheduled_jobs_kind_check check (kind = any (%L::text[]))', v_kinds);
end $$;

-- One waiting job per report: it reads the newest verdicts when it runs.
create unique index if not exists scheduled_jobs_one_queued_report_insights
  on public.scheduled_jobs ((payload ->> 'report_id'))
  where kind = 'report_insights' and status = 'queued';

-- Queue a finished report's insights, unless one is already waiting.
create or replace function public.report_insights_queue(p_table text, p_report uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
begin
  if p_table = 'competitive_reports' then
    select r.client_id into v_client from competitive_reports r join clients c on c.id = r.client_id
     where r.id = p_report and r.status = 'complete' and c.archived_at is null;
  elsif p_table = 'reports' then
    select r.client_id into v_client from reports r join clients c on c.id = r.client_id
     where r.id = p_report and r.status in ('complete', 'completed') and c.archived_at is null;
  else
    return;
  end if;
  if v_client is null then return; end if;
  insert into scheduled_jobs (kind, client_id, payload, dedupe_key, priority, available_at)
  values ('report_insights', v_client, jsonb_build_object('table', p_table, 'report_id', p_report),
          'report_insights:' || p_report || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
          case when p_table = 'competitive_reports' then 66 else 71 end, now())
  on conflict do nothing;
end $$;

revoke all on function public.report_insights_queue(text, uuid) from public, anon, authenticated;
grant execute on function public.report_insights_queue(text, uuid) to service_role;

-- A changed verdict on a competitive suggestion changes the input of the
-- client's newest competitive report's insights: they are worded again over
-- the same facts. Nothing here can fail the verdict's own write.
create or replace function public.report_insights_on_feedback()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid := coalesce(new.client_id, old.client_id);
  v_report uuid;
begin
  begin
    select r.id into v_report from competitive_reports r
     where r.client_id = v_client and r.status = 'complete' and r.created_at >= report_insights_live_from()
     order by r.created_at desc limit 1;
    if v_report is not null then perform report_insights_queue('competitive_reports', v_report); end if;
  exception when others then
    raise warning 'report_insights_on_feedback: %', sqlerrm;
  end;
  return coalesce(new, old);
end $$;

revoke all on function public.report_insights_on_feedback() from public, anon, authenticated;

drop trigger if exists competitive_insight_feedback_insights on public.competitive_insight_feedback;
create trigger competitive_insight_feedback_insights after insert or delete or update of verdict, edited on public.competitive_insight_feedback
  for each row execute function public.report_insights_on_feedback();
