-- Store video edit metadata (text overlays, trim points) alongside media URLs
alter table public.post_iterations add column if not exists video_edits jsonb;
