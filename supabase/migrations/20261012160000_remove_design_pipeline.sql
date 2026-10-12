-- Removes the self-serve design pipeline from the live app (Lital, 2026-10-12 14:29): every table, function, trigger and policy it
-- added, its storage objects and bucket. The code is kept outside the app on the design-engine branch and in an archive folder.
drop trigger if exists design_runs_before_insert on public.design_runs;
drop function if exists public.design_runs_before_insert() cascade;
drop function if exists public.design_runs_finish(uuid, uuid, text, jsonb, jsonb, text, jsonb) cascade;
drop function if exists public.design_runs_extend(uuid, uuid, integer) cascade;
drop function if exists public.design_runs_extend(uuid, integer) cascade;
drop function if exists public.design_runs_lease(integer) cascade;
drop function if exists public.design_runs_status() cascade;
drop table if exists public.design_rules cascade;
drop table if exists public.design_options cascade;
drop table if exists public.design_runs cascade;
drop table if exists public.platform_specs cascade;
drop table if exists public.brand_profiles cascade;
drop table if exists public.brand_assets cascade;
drop function if exists public.can_act_for_client(uuid) cascade;
-- Storage is not touched here: Supabase refuses direct deletes from storage tables. The objects under generated-media/designs/
-- and the design-references bucket were removed through the Storage API on 2026-10-12.
