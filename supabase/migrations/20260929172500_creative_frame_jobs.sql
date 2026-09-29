-- A video has one job; an image sequence has one per frame and reviewed retry.
DROP INDEX IF EXISTS public.media_jobs_creative_plan_unique;
CREATE UNIQUE INDEX IF NOT EXISTS media_jobs_creative_frame_unique ON public.media_jobs
  ((input->>'creative_plan_id'), COALESCE(input->>'creative_frame_index','-1'), COALESCE(input->>'creative_attempt','0'))
  WHERE input ? 'creative_plan_id';
