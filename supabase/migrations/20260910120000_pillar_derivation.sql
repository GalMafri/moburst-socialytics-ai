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

-- OAuth credentials for third-party integrations, starting with Higgsfield.
--
-- RLS is enabled with NO policies on purpose: only the service role reaches
-- this table. app_settings is the counter-example — it is SELECT-able by
-- every staff session and Settings.tsx pulls the whole table into the
-- browser, so a refresh token there would be readable by anyone on the team.
create table if not exists public.integration_tokens (
  provider text primary key,
  account_email text,
  client_id text,
  refresh_token text,
  access_token text,
  expires_at timestamptz,
  -- The in-flight authorisation: PKCE verifier held between the redirect out
  -- and the callback back.
  pending_state text,
  pending_verifier text,
  pending_started_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.integration_tokens enable row level security;
revoke all on public.integration_tokens from anon, authenticated;
comment on table public.integration_tokens is 'OAuth credentials for third-party integrations. RLS is on with NO policies on purpose: only the service role reaches this. Never readable from the browser, unlike app_settings.';
