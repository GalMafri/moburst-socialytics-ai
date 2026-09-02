-- Link a competitor set to the RivalIQ landscape it was imported from, and
-- record how the set came to be. The first live run showed the agency's
-- RivalIQ landscapes ARE the curated competitor sets; importing one makes
-- identification and analysis agree, and the workflow can resolve the
-- landscape by explicit id instead of matching by focus-company name.
ALTER TABLE public.competitor_sets ADD COLUMN IF NOT EXISTS rivaliq_landscape_id TEXT;
ALTER TABLE public.competitor_sets ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ai';
