-- Removes the self-serve design pipeline from the live app (Lital, 2026-10-12 14:29): every table, function, trigger and policy it
-- added, its storage objects and bucket. The code is kept outside the app on the design-engine branch and in an archive folder.
drop trigger if exists design_runs_before_insert on public.design_runs;
drop function if exists public.design_runs_before_insert();
drop function if exists public.design_runs_finish(uuid, uuid, text, jsonb, jsonb, text, jsonb);
drop function if exists public.design_runs_extend(uuid, uuid, integer);
drop function if exists public.design_runs_extend(uuid, integer);
drop function if exists public.design_runs_lease(integer);
drop function if exists public.design_runs_status();
drop table if exists public.design_options;
drop table if exists public.design_rules;
drop table if exists public.design_runs;
drop table if exists public.platform_specs;
drop table if exists public.brand_profiles;
drop table if exists public.brand_assets;
drop function if exists public.can_act_for_client(uuid);
delete from storage.objects where bucket_id = 'generated-media' and name like 'designs/%';
delete from storage.objects where bucket_id = 'design-references';
delete from storage.buckets where id = 'design-references';
