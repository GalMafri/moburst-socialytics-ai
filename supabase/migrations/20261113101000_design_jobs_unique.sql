-- One job per slide of an option of a request: a plan that died after
-- inserting its jobs and before leaving planning must not draw a slide twice.
-- No request has a duplicate today (checked before this was written).
CREATE UNIQUE INDEX IF NOT EXISTS canva_finish_jobs_request_option_slide_key
  ON public.canva_finish_jobs (design_request_id, option_index, (COALESCE(slide_index, -1)))
  WHERE design_request_id IS NOT NULL;
