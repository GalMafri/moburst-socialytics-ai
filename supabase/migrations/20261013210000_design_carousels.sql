-- Carousel design options: an option is a set of slides, one canva_finish_jobs
-- row per slide, delivered to the post as one post_iterations row whose
-- media_urls are the slides in order.

alter table public.design_requests add column if not exists kind text not null default 'single';
alter table public.design_requests drop constraint if exists design_requests_kind;
alter table public.design_requests add constraint design_requests_kind check (kind in ('single', 'carousel'));

alter table public.canva_finish_jobs add column if not exists slide_index int;
alter table public.canva_finish_jobs add column if not exists slide_count int;
create index if not exists canva_finish_jobs_option on public.canva_finish_jobs (design_request_id, option_index, slide_index);
