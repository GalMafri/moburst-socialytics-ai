-- Creative runs complete on the server. A job carries its brand review so
-- the worker never reviews twice, and a design record can exist before the
-- app has set its headline card, type and logo ("finishing").
alter table public.media_jobs add column if not exists review jsonb;
alter table public.media_jobs add column if not exists reviewed_at timestamptz;
alter table public.post_iterations add column if not exists finishing text not null default 'done';
alter table public.post_iterations drop constraint if exists post_iterations_finishing_check;
alter table public.post_iterations add constraint post_iterations_finishing_check check (finishing in ('pending','done'));
create index if not exists idx_media_jobs_open on public.media_jobs (client_id, created_at)
  where post_iteration_id is null and status in ('pending','submitted','completed');
