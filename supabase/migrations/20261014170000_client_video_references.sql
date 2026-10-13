-- A client's own published videos (paths in the design-references bucket),
-- so its video posts are made in its own video style (13 Oct).
alter table public.clients add column if not exists video_references jsonb not null default '[]'::jsonb;
