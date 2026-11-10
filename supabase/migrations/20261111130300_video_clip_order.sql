-- 20261111130300_video_clip_order.sql
--
-- A video's one paid clip is ordered once (_shared/video/clipStep.ts). The
-- order lives in its own column, canva_finish_jobs.clip_order
-- ({ price, at, job_id?, credits? }), apart from the job's state: the worker
-- saves state whole, and no such save can touch the order. Only these three
-- statements write it, each fenced on the column:
--   video_clip_order(job, order)          records the order, only while the
--                                         job is active and holds none;
--   video_clip_ordered(job, id, credits)  adds the video service's job id and
--                                         the credits, only to an order that
--                                         has no job id yet;
--   video_clip_stop(job, reason)          fails the job with the reason, only
--                                         while it is active and holds no
--                                         order, or an order with no job id
--                                         older than ten minutes (clip.ts
--                                         ORDER_GRACE_MS: its pass is gone).
-- Each answers whether it wrote. JSON null in the column counts as no order.
-- Service role only. Safe to run again.

alter table public.canva_finish_jobs add column if not exists clip_order jsonb;

comment on column public.canva_finish_jobs.clip_order is
  'A video job''s one paid clip: { price, at, job_id?, credits? }. Written only by video_clip_order, video_clip_ordered and video_clip_stop.';

create or replace function public.video_clip_order(p_job uuid, p_order jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n bigint;
begin
  update public.canva_finish_jobs
     set clip_order = p_order, updated_at = now()
   where id = p_job
     and status in ('queued', 'running')
     and jsonb_typeof(clip_order) is distinct from 'object';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

create or replace function public.video_clip_ordered(p_job uuid, p_job_id text, p_credits numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n bigint;
begin
  -- Not fenced on the job's status: a clip that was bought is recorded even on a job stopped meanwhile.
  update public.canva_finish_jobs
     set clip_order = clip_order || jsonb_build_object('job_id', p_job_id, 'credits', p_credits), updated_at = now()
   where id = p_job
     and jsonb_typeof(clip_order) = 'object'
     and not (clip_order ? 'job_id');
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

create or replace function public.video_clip_stop(p_job uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n bigint;
begin
  update public.canva_finish_jobs
     set status = 'failed', error = p_reason, lease_until = null, updated_at = now()
   where id = p_job
     and status in ('queued', 'running')
     and (jsonb_typeof(clip_order) is distinct from 'object'
          -- A lost order: no job id, and its pass stopped submitting long ago (an unreadable time counts as long ago).
          or (not (clip_order ? 'job_id')
              and (coalesce(clip_order ->> 'at', '') !~ '^\d{4}-\d{2}-\d{2}T'
                   or (clip_order ->> 'at')::timestamptz < now() - interval '10 minutes')));
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.video_clip_order(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.video_clip_order(uuid, jsonb) to service_role;
revoke all on function public.video_clip_ordered(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.video_clip_ordered(uuid, text, numeric) to service_role;
revoke all on function public.video_clip_stop(uuid, text) from public, anon, authenticated;
grant execute on function public.video_clip_stop(uuid, text) to service_role;
