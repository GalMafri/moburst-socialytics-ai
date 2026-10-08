-- The brand learner's inputs and outputs.
-- Spec: docs/superpowers/specs/2026-10-08-design-engine-design.md, section 11.
--
-- brand_assets: one row per file the learner used, with where it came from.
-- Posts and video thumbnails are filed by design-harvest from Sprout; logos,
-- fonts, brand books and website captures by uploads and the website read.
-- brand_profiles: one learned profile per version, confirmed by a person.
--
-- Client members and staff read their client's rows; every write is the
-- worker's (service role). The restrictive client-scope guard is the one the
-- other client tables carry (20260929120000_enforce_client_scope_guards.sql).

create table if not exists public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('logo', 'font', 'brand_book', 'post', 'video', 'website_capture', 'harvest_job')),
  -- Object path in the design-references bucket; null for a progress row (harvest_job).
  path text,
  -- Where the file came from: {source, source_post_id, source_url, profile_id,
  -- platform, posted_at, slide_index, impressions, text, classification, confidence}
  -- for a Sprout post; the upload or capture facts for the others.
  provenance jsonb not null default '{}'::jsonb,
  -- Width and height of the file as stored, when measured.
  native_px integer[],
  sha256 text,
  created_at timestamptz not null default now()
);

-- The same bytes are filed once per client; a re-run skips them.
create unique index if not exists brand_assets_client_sha on public.brand_assets (client_id, sha256)
  where sha256 is not null;
create index if not exists brand_assets_client_kind on public.brand_assets (client_id, kind);

create table if not exists public.brand_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  version integer not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'retired')),
  -- Tokens, each with its source (spec section 4).
  profile jsonb not null default '{}'::jsonb,
  -- Measured floors from the client's own posts.
  calibration jsonb not null default '{}'::jsonb,
  -- Layout families over the posts (spec section 5).
  families jsonb not null default '[]'::jsonb,
  -- The brand_assets this version was learned from.
  sources jsonb not null default '[]'::jsonb,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, version)
);
create index if not exists brand_profiles_client on public.brand_profiles (client_id, version desc);

alter table public.brand_assets enable row level security;
alter table public.brand_profiles enable row level security;

revoke all on public.brand_assets from public, anon, authenticated;
revoke all on public.brand_profiles from public, anon, authenticated;
grant select on public.brand_assets to authenticated;
grant select on public.brand_profiles to authenticated;
grant select, insert, update, delete on public.brand_assets to service_role;
grant select, insert, update, delete on public.brand_profiles to service_role;

-- Reads for the client's members and staff; no insert, update or delete
-- policy for authenticated, so writes are the service role's alone.
drop policy if exists "Client members and staff can view brand assets" on public.brand_assets;
create policy "Client members and staff can view brand assets" on public.brand_assets
  for select to authenticated using (public.can_access_client(client_id));
drop policy if exists "Client members and staff can view brand profiles" on public.brand_profiles;
create policy "Client members and staff can view brand profiles" on public.brand_profiles
  for select to authenticated using (public.can_access_client(client_id));

-- Restrictive guards, ANDed with every grant above and any policy added later,
-- so no later permissive policy can reach past company scope.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['brand_assets', 'brand_profiles'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Enforce client scope" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Enforce client scope" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.can_access_client(client_id)) WITH CHECK (public.can_write_client(client_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Enforce client delete scope" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Enforce client delete scope" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_write_client(client_id))', t);
  END LOOP;
END $$;
