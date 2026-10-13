-- A design being prepared can be cancelled by whoever could start it
-- (Lital, 13 Oct: "allow the user to cancel if they accidentally clicked or
-- don't want to wait any longer"). The request and its unfinished jobs become
-- 'canceled'; the workers only take queued and running jobs, so nothing more
-- is spent on it. Safe to apply twice.
alter table public.design_requests drop constraint if exists design_requests_status_check;
alter table public.design_requests add constraint design_requests_status_check
  check (status = any (array['preparing'::text, 'ready'::text, 'needs_staff'::text, 'canceled'::text]));
alter table public.canva_finish_jobs drop constraint if exists canva_finish_jobs_status_check;
alter table public.canva_finish_jobs add constraint canva_finish_jobs_status_check
  check (status = any (array['queued'::text, 'running'::text, 'done'::text, 'failed'::text, 'canceled'::text]));
