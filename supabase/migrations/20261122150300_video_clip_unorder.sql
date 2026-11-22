-- 20261122150300_video_clip_unorder.sql
--
-- QA 22 Nov 2026 (P53-02): a clip submit that Higgsfield refused outright (a
-- tool error, a 401 from a token that lapsed during the pass) made and
-- charged nothing, yet its order stayed on the job without a job id, and ten
-- minutes later video_clip_stop ended the video as a lost order, after its
-- title and frame were paid for. The clip step now clears such an order
-- (_shared/video/clipStep.ts, submitRefused), so a later pass orders again.
--
--   video_clip_unorder(job, at)  clears the order placed at that time, only
--                                while the job is active and the order still
--                                has no job id. An order a pass has since
--                                recorded a clip on is never touched.
--
-- Answers whether it wrote. Service role only. Safe to run again.

create or replace function public.video_clip_unorder(p_job uuid, p_at text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n bigint;
begin
  update public.canva_finish_jobs
     set clip_order = null, updated_at = now()
   where id = p_job
     and status in ('queued', 'running')
     and jsonb_typeof(clip_order) = 'object'
     and not (clip_order ? 'job_id')
     and clip_order ->> 'at' = p_at;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

comment on column public.canva_finish_jobs.clip_order is
  'A video job''s one paid clip: { price, at, job_id?, credits? }. Written only by video_clip_order, video_clip_ordered, video_clip_unorder and video_clip_stop.';

revoke all on function public.video_clip_unorder(uuid, text) from public, anon, authenticated;
grant execute on function public.video_clip_unorder(uuid, text) to service_role;
