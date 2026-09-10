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
