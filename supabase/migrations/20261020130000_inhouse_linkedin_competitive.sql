-- The first two in-app report pipelines: the LinkedIn source (n8n
-- xm3ZFPjysyQCkWsc) and the competitive analysis (n8n EBiAwSay3H2R8krv).
-- Code: supabase/functions/_shared/pipelines (definitions/linkedinSource.ts,
-- definitions/competitive.ts). Every switch stays where it is (n8n); this
-- changes no client's engine and writes no client data. Safe to apply twice.
--
--   1. An in-app LinkedIn source run that makes the real answer (mode app)
--      has no report row: the competitor feed refresh runs it in-process
--      and saves the feed itself, so its run points at the feed snapshot
--      (real_table rivaliq_snapshots, real_ref), as the shadow does. The
--      groundwork's check allowed app runs only for report rows.
--   2. A replay (a shadow run of a past competitive report from its saved
--      RivalIQ answers, input.replay) proves the aggregation and the
--      analysis but not the provider calls, so it does not count as the
--      finished shadow run the app engine waits for.
--
-- To shadow Moburst (paid shadow runs for one client, owner's decision of
-- 20 Oct 2026), once this and the functions are deployed:
--   insert into public.report_engines (kind, client_id, engine, note) values
--     ('linkedin_source', 'd00ce604-2bcc-455a-9826-f80250db75cf', 'shadow', 'Moburst: in-app LinkedIn source next to n8n'),
--     ('competitive', 'd00ce604-2bcc-455a-9826-f80250db75cf', 'shadow', 'Moburst: in-app competitive analysis next to n8n')
--   on conflict (kind, client_id) where client_id is not null do update set engine = excluded.engine, note = excluded.note;
-- and back:
--   update public.report_engines set engine = 'n8n'
--    where client_id = 'd00ce604-2bcc-455a-9826-f80250db75cf' and kind in ('linkedin_source', 'competitive');

-- ── 1. App runs of the LinkedIn source point at the feed snapshot ───────────

alter table public.report_pipeline_runs drop constraint if exists report_pipeline_runs_app_target;
alter table public.report_pipeline_runs add constraint report_pipeline_runs_app_target check (
  mode <> 'app'
  or (real_table in ('reports', 'competitive_reports') and real_id is not null)
  or (kind = 'linkedin_source' and real_table = 'rivaliq_snapshots' and real_ref is not null)
);

-- ── 2. A replay is not the shadow run the app engine waits for ──────────────

create or replace function public.report_engines_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.engine = 'app' and not exists (
    select 1 from public.report_pipeline_runs r
     where r.kind = new.kind and r.mode = 'shadow' and r.status = 'done' and r.app_capable
       and not (r.input ? 'replay')) then
    raise exception 'No in-app % pipeline has finished a shadow run yet, so % stays on n8n or shadow.', new.kind, new.kind;
  end if;
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.report_engines_guard() from public, anon, authenticated;
