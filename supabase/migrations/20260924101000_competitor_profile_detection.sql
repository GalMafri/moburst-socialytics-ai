-- Persist lookup outcomes so reopening a draft resumes unfinished work without
-- repeating completed searches or requiring a user to press a lookup button.
ALTER TABLE public.competitors ADD COLUMN IF NOT EXISTS profile_detection jsonb;
COMMENT ON COLUMN public.competitors.profile_detection IS 'Latest automatic profile lookup status, public diagnostic and checked_at timestamp. No credentials or raw provider response.';
