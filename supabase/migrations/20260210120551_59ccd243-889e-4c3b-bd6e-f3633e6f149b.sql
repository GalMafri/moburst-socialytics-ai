
-- Drop the default first, change type, then set new default
ALTER TABLE public.clients ALTER COLUMN content_pillars DROP DEFAULT;
ALTER TABLE public.clients ALTER COLUMN content_pillars TYPE JSONB USING to_jsonb(content_pillars);
ALTER TABLE public.clients ALTER COLUMN content_pillars SET DEFAULT '[]'::jsonb;
