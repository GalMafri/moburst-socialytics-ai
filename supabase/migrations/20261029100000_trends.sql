-- Trends: each client's industry landscape, collected every week.
-- Spec: docs/superpowers/specs/2026-10-28-trends-redesign-design.md
-- Plan: docs/superpowers/plans/2026-10-29-trends-redesign.md (Task 1)
--
--   trend_profiles  what the app tracks for a client, written by the lifecycle
--                   step trend_profile (audience, fit rubric, platforms)
--   trend_terms     the topics, hashtags and exclusions; a person's add or
--                   remove is never overwritten (a removal stays as a
--                   tombstone so the lifecycle never brings it back)
--   trend_weeks     one row per client per week; what each platform returned
--                   and what the week cost
--   trend_posts     every post the week looked at, kept or dropped, with why
--   trend_themes    the week's 3 to 6 themes; staff can dismiss one, which
--                   becomes an exclusion the next weekly filter reads
--
-- The pipeline trends_v1 writes the weeks through the service role. People
-- change terms and dismiss themes only through the three staff RPCs below.

-- ── 1. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.trend_profiles (
  client_id uuid primary key references public.clients(id) on delete cascade,
  audience text not null,
  fit_rubric text not null,
  platforms jsonb not null default '[]'::jsonb,
  search_overrides jsonb not null default '{}'::jsonb,
  inputs_key text not null,
  written_at timestamptz not null default now(),
  hashtags_at timestamptz
);

create table if not exists public.trend_terms (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('topic', 'hashtag', 'exclusion')),
  platform text check (platform in ('instagram', 'tiktok', 'linkedin')),
  term text not null check (btrim(term) <> ''),
  reason text not null default '',
  source text not null check (source in ('lifecycle', 'person', 'dismissal')),
  removed_at timestamptz,
  removed_by uuid,
  created_at timestamptz not null default now(),
  constraint trend_terms_platform_for_hashtags check ((kind = 'hashtag') = (platform is not null))
);
create unique index if not exists trend_terms_one
  on public.trend_terms (client_id, kind, coalesce(platform, ''), lower(term));

create table if not exists public.trend_weeks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  week_start date not null,
  status text not null default 'running' check (status in ('running', 'done', 'partial')),
  platforms jsonb not null default '{}'::jsonb,
  filter_status text check (filter_status in ('ok', 'failed', 'skipped')),
  cost jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (client_id, week_start)
);

create table if not exists public.trend_posts (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.trend_weeks(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram', 'linkedin', 'youtube', 'pinterest', 'facebook')),
  url text not null,
  author text not null default '',
  text text not null default '',
  posted_at timestamptz,
  format text check (format in ('short_video', 'long_video', 'carousel', 'image', 'text', 'pin')),
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  saves bigint not null default 0,
  engagement numeric not null default 0,
  search text not null default '',
  kept boolean not null default false,
  drop_reason text,
  fit smallint check (fit between 0 and 100),
  why text,
  lesson text,
  tripwire boolean not null default false,
  created_at timestamptz not null default now(),
  unique (week_id, url)
);
create index if not exists trend_posts_client_kept on public.trend_posts (client_id, week_id) where kept;

create table if not exists public.trend_themes (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.trend_weeks(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  position smallint not null default 0,
  title text not null,
  happening text not null default '',
  why_it_matters text not null default '',
  angle text not null default '',
  platforms text[] not null default '{}',
  post_ids uuid[] not null default '{}',
  dismissed_at timestamptz,
  dismissed_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists trend_themes_client on public.trend_themes (client_id, week_id);

-- ── 2. Who reads what ───────────────────────────────────────────────────────

alter table public.trend_profiles enable row level security;
alter table public.trend_terms enable row level security;
alter table public.trend_weeks enable row level security;
alter table public.trend_posts enable row level security;
alter table public.trend_themes enable row level security;

drop policy if exists "Staff read trend profiles" on public.trend_profiles;
create policy "Staff read trend profiles" on public.trend_profiles
  for select to authenticated using (public.is_moburst_staff());
drop policy if exists "Staff read trend terms" on public.trend_terms;
create policy "Staff read trend terms" on public.trend_terms
  for select to authenticated using (public.is_moburst_staff());
drop policy if exists "Staff read trend weeks" on public.trend_weeks;
create policy "Staff read trend weeks" on public.trend_weeks
  for select to authenticated using (public.is_moburst_staff());
-- Client users see only the posts that were kept; staff also see what was dropped and why.
drop policy if exists "Read kept trend posts" on public.trend_posts;
create policy "Read kept trend posts" on public.trend_posts
  for select to authenticated using (public.is_moburst_staff() or (kept and public.is_client_member(client_id)));
drop policy if exists "Read trend themes" on public.trend_themes;
create policy "Read trend themes" on public.trend_themes
  for select to authenticated using (public.is_moburst_staff() or public.is_client_member(client_id));

grant select, insert, update, delete on public.trend_profiles, public.trend_terms, public.trend_weeks,
  public.trend_posts, public.trend_themes to service_role;
grant select on public.trend_profiles, public.trend_terms, public.trend_weeks,
  public.trend_posts, public.trend_themes to authenticated;

-- ── 3. What people can change ───────────────────────────────────────────────

-- A person adds a topic, hashtag or exclusion. Adding one that a person
-- removed earlier brings it back, now as theirs.
create or replace function public.trend_term_add(p_client uuid, p_kind text, p_platform text, p_term text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_term text := btrim(coalesce(p_term, ''));
  v_platform text := nullif(btrim(coalesce(p_platform, '')), '');
begin
  if not public.is_moburst_staff() then
    raise exception 'Only Moburst staff can change what trends track.' using errcode = '42501';
  end if;
  if v_term = '' then
    raise exception 'A term is required.' using errcode = '22023';
  end if;
  if p_kind = 'hashtag' and left(v_term, 1) <> '#' then
    v_term := '#' || v_term;
  end if;
  if p_kind <> 'hashtag' then
    v_platform := null;
  end if;
  insert into public.trend_terms (client_id, kind, platform, term, source)
  values (p_client, p_kind, v_platform, v_term, 'person')
  on conflict (client_id, kind, coalesce(platform, ''), lower(term))
  do update set source = 'person', removed_at = null, removed_by = null
  returning id into v_id;
  return v_id;
end $$;

-- A person removes a term. The row stays, marked removed, so a later
-- profile rewrite never suggests it again.
create or replace function public.trend_term_remove(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_moburst_staff() then
    raise exception 'Only Moburst staff can change what trends track.' using errcode = '42501';
  end if;
  update public.trend_terms set removed_at = now(), removed_by = auth.uid()
   where id = p_id and removed_at is null;
end $$;

-- A staff member dismisses a theme. Its pattern becomes an exclusion that the
-- next weekly filter reads; nobody has to rewrite the profile.
create or replace function public.trend_theme_dismiss(p_theme uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_theme public.trend_themes%rowtype;
begin
  if not public.is_moburst_staff() then
    raise exception 'Only Moburst staff can dismiss a trend.' using errcode = '42501';
  end if;
  update public.trend_themes set dismissed_at = now(), dismissed_by = auth.uid()
   where id = p_theme and dismissed_at is null
  returning * into v_theme;
  if v_theme.id is null then
    return;
  end if;
  insert into public.trend_terms (client_id, kind, platform, term, reason, source)
  values (v_theme.client_id, 'exclusion', null, v_theme.title, v_theme.happening, 'dismissal')
  on conflict (client_id, kind, coalesce(platform, ''), lower(term))
  do update set removed_at = null, removed_by = null;
end $$;

revoke all on function public.trend_term_add(uuid, text, text, text) from public, anon;
revoke all on function public.trend_term_remove(uuid) from public, anon;
revoke all on function public.trend_theme_dismiss(uuid) from public, anon;
grant execute on function public.trend_term_add(uuid, text, text, text) to authenticated;
grant execute on function public.trend_term_remove(uuid) to authenticated;
grant execute on function public.trend_theme_dismiss(uuid) to authenticated;

-- ── 4. Pipeline runs of kind 'trends' point at their week ───────────────────

alter table public.report_pipeline_runs drop constraint if exists report_pipeline_runs_kind_check;
alter table public.report_pipeline_runs add constraint report_pipeline_runs_kind_check
  check (kind in ('social', 'competitive', 'linkedin_source', 'trends'));
alter table public.report_pipeline_runs drop constraint if exists report_pipeline_runs_real_table_check;
alter table public.report_pipeline_runs add constraint report_pipeline_runs_real_table_check
  check (real_table in ('reports', 'competitive_reports', 'rivaliq_snapshots', 'trend_weeks'));
alter table public.report_pipeline_runs drop constraint if exists report_pipeline_runs_app_target;
alter table public.report_pipeline_runs add constraint report_pipeline_runs_app_target check (
  mode <> 'app'
  or (real_table in ('reports', 'competitive_reports') and real_id is not null)
  or (kind = 'linkedin_source' and real_table = 'rivaliq_snapshots' and real_ref is not null)
  or (kind = 'trends' and real_table = 'trend_weeks' and real_id is not null)
);
