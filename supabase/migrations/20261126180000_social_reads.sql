-- Own competitor reads, step 1: the tables and the read job (26 Nov 2026).
-- Plan: docs/superpowers/specs/2026-11-25-own-competitive-cutover-plan.md,
-- sections 4 and 6 (step 1). Lital approved decisions 1, 2 and 4 on 26 Nov.
--
-- Public profiles on Instagram, Facebook, TikTok and LinkedIn are read
-- through Apify, one profile per job, by the existing scheduled-jobs worker
-- (social-read/readJob.ts, a function of its own). Handles keep living in competitor_handles and
-- client_public_profiles, where people edit them; social_profiles links to
-- them by platform and handle.
--
--   1. social_profiles: one row per public profile a client's work reads,
--      with whether it is confirmed and why.
--   2. social_profile_snapshots: followers per profile per day.
--   3. social_posts: one row per post.
--   4. social_post_metrics: each time a post's counts were read.
--   5. social_reads: one row per read, with its outcome and cost.
--   6. The social_read job kind.
--
-- Nothing here starts a read: no cron queues the job in this step. The first
-- read (step 2) is started by hand once Lital approves its spend. Staff read
-- these tables; only the service role writes them. Everything is additive
-- and this file can be run twice.

-- ── 1. Profiles ─────────────────────────────────────────────────────────────

create table if not exists public.social_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  competitor_id uuid references public.competitors(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook', 'tiktok', 'linkedin')),
  handle text not null check (btrim(handle) <> ''),
  url text not null,
  handle_source text not null,
  active boolean not null default true,
  confirmed boolean,
  confirmed_reason text,
  confirmed_at timestamptz,
  checked_at timestamptz,
  display_name text,
  followers bigint,
  last_read_at timestamptz,
  last_read_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per company, platform and handle within a client's work. A handle a
-- person replaces leaves its old row inactive, with its posts.
create unique index if not exists social_profiles_company_handle
  on public.social_profiles (client_id, coalesce(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid), platform, lower(handle));
create index if not exists social_profiles_client on public.social_profiles (client_id) where active;

comment on table public.social_profiles is 'A public profile a client''s competitive work reads: the client''s own (competitor_id null) or a competitor''s. Kept in line with competitor_handles and client_public_profiles by social-read/profiles.ts. Staff read it; only the service role writes it.';
comment on column public.social_profiles.handle_source is 'Where the handle came from: competitor_handles.source (auto, manual, rivaliq) or client_public_profiles.source (website, person, rivaliq).';
comment on column public.social_profiles.confirmed is 'null: not checked yet. true: read. false: not read, for the reason in confirmed_reason (social-read/confirm.ts).';
comment on column public.social_profiles.confirmed_reason is 'entered_by_person, tracked_in_rivaliq, links_brand_site, name_and_site_link; or, when not confirmed: profile_not_found, private, not_a_page, name_differs, no_link_to_brand.';

-- ── 2. Followers per day ────────────────────────────────────────────────────

create table if not exists public.social_profile_snapshots (
  profile_id uuid not null references public.social_profiles(id) on delete cascade,
  day date not null,
  followers bigint not null check (followers >= 0),
  read_id uuid,
  created_at timestamptz not null default now(),
  primary key (profile_id, day)
);
comment on table public.social_profile_snapshots is 'A profile''s follower count on the day it was read. Growth is measured from the first read on.';

-- ── 3. Posts ────────────────────────────────────────────────────────────────

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.social_profiles(id) on delete cascade,
  platform text not null,
  post_key text not null,
  published_at timestamptz not null,
  url text,
  text text not null default '',
  format text not null,
  hashtags text[] not null default '{}',
  paid boolean,
  media_url text,
  first_read_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  unique (profile_id, post_key)
);
create index if not exists social_posts_published on public.social_posts (profile_id, published_at desc);
comment on table public.social_posts is 'One post of a read profile. post_key is the platform''s own id. paid: the platform''s own paid label (Instagram paid partnership, TikTok ad or sponsored); null where the read does not show it.';

-- ── 4. Counts per read ──────────────────────────────────────────────────────

create table if not exists public.social_post_metrics (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  read_id uuid not null,
  read_at timestamptz not null,
  likes bigint,
  comments bigint,
  shares bigint,
  views bigint,
  engagement bigint,
  primary key (post_id, read_id)
);
comment on table public.social_post_metrics is 'A post''s public counts each time it was read. likes is reactions on Facebook. null: the platform hides the count (Instagram''s hidden likes) or does not show it; engagement is null when likes are hidden, never 0.';

-- ── 5. Reads ────────────────────────────────────────────────────────────────

create table if not exists public.social_reads (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.social_profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  job_id uuid,
  status text not null default 'running' check (status in ('running', 'done', 'failed', 'not_confirmed', 'skipped')),
  reason text,
  window_start date,
  window_end date,
  runs jsonb not null default '[]'::jsonb,
  posts integer,
  followers bigint,
  usd numeric(12, 4),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists social_reads_profile on public.social_reads (profile_id, started_at desc);
comment on table public.social_reads is 'One read of a profile: its outcome, the Apify runs it made and what they cost (usd, as Apify reported it; the paying desk records the same cost in cost_events). A failed read never becomes "no posts": its profile is not compared for that period.';

-- ── Access: staff read, the service role writes ─────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['social_profiles', 'social_profile_snapshots', 'social_posts', 'social_post_metrics', 'social_reads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

drop policy if exists "Staff read social profiles" on public.social_profiles;
create policy "Staff read social profiles" on public.social_profiles
  for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));

drop policy if exists "Staff read social reads" on public.social_reads;
create policy "Staff read social reads" on public.social_reads
  for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));

drop policy if exists "Staff read social profile snapshots" on public.social_profile_snapshots;
create policy "Staff read social profile snapshots" on public.social_profile_snapshots
  for select to authenticated using (exists (
    select 1 from public.social_profiles p
     where p.id = profile_id and public.is_moburst_staff() and public.can_access_client(p.client_id)));

drop policy if exists "Staff read social posts" on public.social_posts;
create policy "Staff read social posts" on public.social_posts
  for select to authenticated using (exists (
    select 1 from public.social_profiles p
     where p.id = profile_id and public.is_moburst_staff() and public.can_access_client(p.client_id)));

drop policy if exists "Staff read social post metrics" on public.social_post_metrics;
create policy "Staff read social post metrics" on public.social_post_metrics
  for select to authenticated using (exists (
    select 1 from public.social_posts s join public.social_profiles p on p.id = s.profile_id
     where s.id = post_id and public.is_moburst_staff() and public.can_access_client(p.client_id)));


-- A connected app (an OAuth session) can never write them, as with every table (the connector's guards).
drop policy if exists "OAuth sessions cannot insert" on public.social_profiles;
create policy "OAuth sessions cannot insert" on public.social_profiles as restrictive for insert to authenticated
  with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.social_profiles;
create policy "OAuth sessions cannot update" on public.social_profiles as restrictive for update to authenticated
  using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.social_profiles;
create policy "OAuth sessions cannot delete" on public.social_profiles as restrictive for delete to authenticated
  using (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot insert" on public.social_profile_snapshots;
create policy "OAuth sessions cannot insert" on public.social_profile_snapshots as restrictive for insert to authenticated
  with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.social_profile_snapshots;
create policy "OAuth sessions cannot update" on public.social_profile_snapshots as restrictive for update to authenticated
  using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.social_profile_snapshots;
create policy "OAuth sessions cannot delete" on public.social_profile_snapshots as restrictive for delete to authenticated
  using (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot insert" on public.social_posts;
create policy "OAuth sessions cannot insert" on public.social_posts as restrictive for insert to authenticated
  with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.social_posts;
create policy "OAuth sessions cannot update" on public.social_posts as restrictive for update to authenticated
  using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.social_posts;
create policy "OAuth sessions cannot delete" on public.social_posts as restrictive for delete to authenticated
  using (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot insert" on public.social_post_metrics;
create policy "OAuth sessions cannot insert" on public.social_post_metrics as restrictive for insert to authenticated
  with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.social_post_metrics;
create policy "OAuth sessions cannot update" on public.social_post_metrics as restrictive for update to authenticated
  using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.social_post_metrics;
create policy "OAuth sessions cannot delete" on public.social_post_metrics as restrictive for delete to authenticated
  using (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot insert" on public.social_reads;
create policy "OAuth sessions cannot insert" on public.social_reads as restrictive for insert to authenticated
  with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.social_reads;
create policy "OAuth sessions cannot update" on public.social_reads as restrictive for update to authenticated
  using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.social_reads;
create policy "OAuth sessions cannot delete" on public.social_reads as restrictive for delete to authenticated
  using (not (select public.is_oauth_session()));

-- ── 6. The job kind ─────────────────────────────────────────────────────────

-- Added to whatever kinds the constraint allows when this runs, so a kind
-- another change adds (in either order) is kept. A social_read job always
-- belongs to a client, so scheduled_jobs_client_required is left as it is.
do $$
declare
  v_def text;
  v_kinds text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.scheduled_jobs'::regclass and conname = 'scheduled_jobs_kind_check';
  select array_agg(distinct k order by k) into v_kinds from (
    select m[1] as k from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m
    union
    select btrim(e) from unnest(string_to_array(substring(coalesce(v_def, '') from '\{([a-z_,]*)\}'), ',')) as e
  ) kinds where k ~ '^[a-z_]+$';
  v_kinds := array(select distinct k from unnest(coalesce(v_kinds, '{}'::text[]) || array['social_read']) as k order by k);
  alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_kind_check;
  execute format('alter table public.scheduled_jobs add constraint scheduled_jobs_kind_check check (kind = any (%L::text[]))', v_kinds);
end $$;

create index if not exists scheduled_jobs_social_read on public.scheduled_jobs (client_id, status)
  where kind = 'social_read';
