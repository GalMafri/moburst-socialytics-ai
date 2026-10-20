-- The client's own figures from Sprout, and stored report text kept on the
-- figures the report shows (Lital, 20 Oct 2026: "use the most accurate
-- measurement, the team typically works with sprout for their clients";
-- "fix this" about Bader's competitive report still saying "Engagement rate
-- per post at 28.6% is inflated by small-follower TikTok"). Spec, section 4:
-- docs/superpowers/specs/2026-10-19-self-serve-lifecycle-design.md
--
--   1. correction_audit on both report tables: the report's text and client
--      figures as they were before the product first changed them, and a
--      record of every change (when, what, before and after).
--   2. report_text, a scheduled-jobs kind (run-scheduled-jobs, the module
--      _shared/reports/correctText.ts): one stored report's client figures
--      counted again from its own stored posts when they predate the rules,
--      then the sentences that quote a figure the report no longer shows
--      rewritten in one model call. A report with nothing stale finishes with
--      no model call. A job that does not finish is tried again with growing
--      waits.
--   3. Every report that finishes from now on is checked the same way (a
--      trigger on both tables): whatever wrote it, its text never keeps a
--      figure the page does not show.
--   4. Every finished report of an active client stored today is checked
--      once. Competitive reports go first, so a monthly report is checked
--      against the competitive figures it shows beside its own.

alter table public.reports add column if not exists correction_audit jsonb;
alter table public.competitive_reports add column if not exists correction_audit jsonb;
comment on column public.reports.correction_audit is 'What the product changed in this report after it was written, and what it was before: {"original": {"ai_analysis": ...}, "corrections": [{"at", "what", "model", "sentences": [{"path", "before", "after"}]}]}.';
comment on column public.competitive_reports.correction_audit is 'What the product changed in this report after it was written, and what it was before: {"original": {"ai_analysis": ..., "client_company": ...}, "corrections": [{"at", "what": "client_figures" | "text", ...}]}.';

-- The new kind is added to whatever kinds the constraint allows when this
-- runs (another migration may have added its own, such as report_pipeline).
do $$
declare
  v_def text;
  v_kinds text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.scheduled_jobs'::regclass and conname = 'scheduled_jobs_kind_check';
  select array_agg(distinct m[1] order by m[1]) into v_kinds
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m;
  v_kinds := array(select distinct k from unnest(coalesce(v_kinds, '{}'::text[])
    || array['feed_refresh', 'dispatch', 'week_plan', 'week_revise', 'voice_profile', 'lifecycle', 'lifecycle_step', 'report_text']) as k order by k);
  alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_kind_check;
  execute format('alter table public.scheduled_jobs add constraint scheduled_jobs_kind_check check (kind = any (%L::text[]))', v_kinds);
end $$;

-- Check one finished report of an active client. p_key makes the request
-- once per occasion (the release pass, or a report finishing at a minute).
create or replace function public.report_text_enqueue(p_table text, p_report uuid, p_key text, p_delay interval default interval '0')
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
    raise exception 'Unknown report table %', p_table;
  end if;
  if v_client is null then return; end if;
  insert into scheduled_jobs (kind, client_id, payload, dedupe_key, priority, max_attempts, available_at)
  values ('report_text', v_client, jsonb_build_object('table', p_table, 'report_id', p_report),
          'report_text:' || p_report || ':' || p_key,
          case when p_table = 'competitive_reports' then 65 else 70 end, 7, now() + p_delay)
  on conflict (dedupe_key) do nothing;
end $$;

revoke all on function public.report_text_enqueue(text, uuid, text, interval) from public, anon, authenticated;
grant execute on function public.report_text_enqueue(text, uuid, text, interval) to service_role;

-- A report that has just finished is checked a few minutes later (a monthly
-- report after the competitive report it shows has had its own check).
create or replace function public.report_text_on_finish()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('complete', 'completed') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform report_text_enqueue(tg_table_name::text, new.id,
      to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'),
      case when tg_table_name = 'reports' then interval '5 minutes' else interval '1 minute' end);
  end if;
  return new;
end $$;

drop trigger if exists reports_text_check on public.reports;
create trigger reports_text_check after insert or update of status on public.reports
  for each row execute function public.report_text_on_finish();
drop trigger if exists competitive_reports_text_check on public.competitive_reports;
create trigger competitive_reports_text_check after insert or update of status on public.competitive_reports
  for each row execute function public.report_text_on_finish();

-- Every finished report of an active client stored today, once.
do $$
declare
  r record;
begin
  for r in
    select 'competitive_reports'::text as t, cr.id from competitive_reports cr join clients c on c.id = cr.client_id
     where cr.status = 'complete' and c.archived_at is null
    union all
    select 'reports'::text, rp.id from reports rp join clients c on c.id = rp.client_id
     where rp.status in ('complete', 'completed') and c.archived_at is null
  loop
    perform public.report_text_enqueue(r.t, r.id, 'figures-2026-10-20',
      case when r.t = 'reports' then interval '10 minutes' else interval '0' end);
  end loop;
end $$;
