-- A claim on a client's kit that was held by a job that has ended is taken over
-- by compare-and-set on that job: the claim changes hands only while the ended
-- job still holds it. video_style_claim_kit with a stale interval of zero took
-- any earlier claim, including a fresh one another live job had made since the
-- caller read the row, so two jobs could both make the kit.

create or replace function public.video_style_take_kit(p_client uuid, p_job uuid, p_ended uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taken boolean;
begin
  update public.clients
     set video_style = coalesce(video_style, '{}'::jsonb) || jsonb_build_object('kit_started_at', to_jsonb(now()), 'kit_job', to_jsonb(p_job::text))
   where id = p_client
     and coalesce(jsonb_typeof(video_style -> 'kit'), 'null') = 'null'
     and video_style ->> 'kit_job' = p_ended::text;
  get diagnostics v_taken = row_count;
  return v_taken;
end;
$$;

revoke all on function public.video_style_take_kit(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.video_style_take_kit(uuid, uuid, uuid) to service_role;
