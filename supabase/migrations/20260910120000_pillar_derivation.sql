-- Content pillars a client did not have to type.
--
-- Applied by hand against the live project (Lovable-managed; there is no CLI
-- push), and mirrored here so the schema is readable from the repo.
--
-- The strategy document reuses the brand-books bucket rather than adding a
-- third one, so the storage policies closed in 20260906000001 stay as they
-- are.
alter table public.clients add column if not exists strategy_doc_file_path text;
alter table public.clients add column if not exists pillars_derived_at timestamptz;
-- 'strategy_doc' | 'social_posts' | 'brief' — what the pillars were read from,
-- so the card can say where they came from and a person can tell a derived
-- pillar from one they typed.
alter table public.clients add column if not exists pillars_source text;

-- Design references the app pulls from the client's own published posts,
-- weekly. Kept in their own column: clients.design_references is overwritten
-- wholesale by the setup page's save, so a harvest appended there would be
-- erased by the next edit of any field, and a staff upload would be erased
-- by the next harvest.
alter table public.clients add column if not exists harvested_design_references jsonb not null default '[]'::jsonb;
alter table public.clients add column if not exists design_refs_harvested_at timestamptz;
comment on column public.clients.harvested_design_references is 'Auto-pulled from the client''s own RivalIQ focus-company posts, weekly. Kept apart from design_references so a harvest never overwrites what staff uploaded.';

-- Who put a handle there. A re-detect overwrites what the scraper found and
-- leaves alone what a person typed; without this, correcting a wrong handle
-- lasted until the next refresh.
alter table public.competitor_handles add column if not exists source text not null default 'auto';
comment on column public.competitor_handles.source is 'auto = found by detect-competitor-handles; manual = entered by a person. A refresh never overwrites a manual row.';
