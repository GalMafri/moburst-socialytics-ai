-- 20261111130300_video_clip_order.sql
--
-- A video's one paid clip is ordered once (_shared/video/clipStep.ts). Before
-- Higgsfield is called, the video worker records the order on the job with
-- video_clip_order(job, order): one statement that sets state.clip_order only
-- while the job is active and holds no order yet, and answers whether it did.
-- false means another pass already ordered (or the job was stopped): that
-- pass orders nothing. Service role only. Safe to run again.

create or replace function public.video_clip_order(p_job uuid, p_order jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_done boolean;
begin
  update public.canva_finish_jobs
     set state = coalesce(state, '{}'::jsonb) || jsonb_build_object('clip_order', p_order),
         updated_at = now()
   where id = p_job
     and status in ('queued', 'running')
     and (state -> 'clip_order') is null;
  get diagnostics v_done = row_count;
  return v_done;
end;
$$;

revoke all on function public.video_clip_order(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.video_clip_order(uuid, jsonb) to service_role;
