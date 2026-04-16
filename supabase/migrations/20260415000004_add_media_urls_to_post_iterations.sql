-- Add media_urls column to post_iterations for persisting generated designs and videos
alter table public.post_iterations add column if not exists media_urls text[];
