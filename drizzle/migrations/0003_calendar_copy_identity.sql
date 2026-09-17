-- Additive only: legacy iteration rows, permissions and media remain unchanged.
alter table public.post_iterations add column if not exists calendar_post_key text;