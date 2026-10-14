-- A client's video style, read from stills of their own published videos.
-- Video posts are planned from these stills and this profile, not from the client's static posts.
alter table public.clients add column if not exists video_style jsonb;
