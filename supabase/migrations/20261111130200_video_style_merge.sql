-- 20261111130200_video_style_merge.sql
--
-- clients.video_style is written by the video worker's style and kit steps
-- (_shared/video/steps.ts). Each write was a read, a spread and a whole-value
-- update, so two jobs could undo each other's keys. These make each write one
-- statement:
--   video_style_merge(client, patch)   the patch's keys over the stored ones
--                                      (a key set to JSON null stays as null;
--                                      the readers take null as missing);
--   video_style_claim_kit(client, job, stale)  the claim on making the kit:
--                                      only when no kit is stored and no other
--                                      job started one less than `stale` ago
--                                      (the holder renews its own claim).
-- Service role only. Safe to run again.

create or replace function public.video_style_merge(p_client uuid, p_patch jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.clients set video_style = coalesce(video_style, '{}'::jsonb) || p_patch where id = p_client;
$$;

create or replace function public.video_style_claim_kit(p_client uuid, p_job uuid, p_stale interval)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  update public.clients
     set video_style = coalesce(video_style, '{}'::jsonb) || jsonb_build_object('kit_started_at', to_jsonb(now()), 'kit_job', to_jsonb(p_job::text))
   where id = p_client
     and coalesce(jsonb_typeof(video_style -> 'kit'), 'null') = 'null'
     and (coalesce(jsonb_typeof(video_style -> 'kit_started_at'), 'null') = 'null'
          or (video_style ->> 'kit_started_at')::timestamptz < now() - p_stale
          -- The job that holds the claim renews it (the kit is cleaned a few stills per pass).
          or video_style ->> 'kit_job' = p_job::text);
  get diagnostics v_claimed = row_count;
  return v_claimed;
end;
$$;

revoke all on function public.video_style_merge(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.video_style_merge(uuid, jsonb) to service_role;
revoke all on function public.video_style_claim_kit(uuid, uuid, interval) from public, anon, authenticated;
grant execute on function public.video_style_claim_kit(uuid, uuid, interval) to service_role;
