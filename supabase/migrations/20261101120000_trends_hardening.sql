-- Trends hardening from the 1 Nov 2026 end-to-end QA.
--
--   1. Trends runs queue after the report runs. Every app run used to get
--      priority 25, so a client's weekly Trends steps would compete with its
--      real monthly report on the 7th (Bader Law's feed weekday is Saturday,
--      and 7 Nov 2026 is a Saturday). Lower runs first: real reports 25, their
--      shadows 60, Trends 80.
--   2. Client and anonymous users get no write privilege on the trend tables
--      at all. Row-level security already let no row change; this refuses the
--      statement outright.
--   3. Client users no longer see a theme Moburst staff dismissed.

-- ── 1. Queue order ──────────────────────────────────────────────────────────

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
  -- A run that makes a real report goes before a shadow, and both before Trends.
  insert into public.scheduled_jobs (kind, client_id, payload, dedupe_key, priority, max_attempts, available_at)
  values ('report_pipeline', p_client,
          jsonb_build_object('run_id', v_run, 'pipeline', p_pipeline, 'step', p_first_step, 'state', '{}'::jsonb),
          'report_pipeline:' || v_run, case when p_kind = 'trends' then 80 when p_mode = 'app' then 25 else 60 end, 5, now())
  returning id into v_job;
  update public.report_pipeline_runs set job_id = v_job where id = v_run;
  return jsonb_build_object('run_id', v_run, 'started', true);
end $$;

-- Trends runs already queued keep their place behind the reports too.
update public.scheduled_jobs j set priority = 80
  from public.report_pipeline_runs r
 where j.kind = 'report_pipeline' and (j.payload->>'run_id')::uuid = r.id and r.kind = 'trends'
   and j.status in ('queued', 'waiting');

-- ── 2. No writes from client or anonymous users ─────────────────────────────

revoke insert, update, delete, truncate on public.trend_profiles, public.trend_terms, public.trend_weeks, public.trend_posts, public.trend_themes from anon, authenticated;
revoke all on public.trend_profiles, public.trend_terms, public.trend_weeks, public.trend_posts, public.trend_themes from anon;

-- ── 3. Dismissed themes are staff-only ──────────────────────────────────────

drop policy if exists "Read trend themes" on public.trend_themes;
create policy "Read trend themes" on public.trend_themes
  for select to authenticated using (public.is_moburst_staff() or (dismissed_at is null and public.is_client_member(client_id)));
