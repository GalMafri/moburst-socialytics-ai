-- Seasonal posts that fit the client (Lital, 3 Nov 2026).
-- Design: docs/superpowers/specs/2026-11-03-seasonal-insights-design.md, part 1.
--
-- The week planner no longer picks holidays, awareness days or events from
-- its own knowledge. A country's dated moments are listed once a week with a
-- source link (moments_list), each client's week keeps only the moments its
-- own data supports (week_moments, kept on calendar_plans.moments), and a
-- person removing a planned seasonal post teaches the client's memory
-- (moment_feedback) and keeps that moment off its calendar for good
-- (_shared/calendar/runMoments.ts).
--
--   1. moments, moment_lists: the listed moments, and which country's list
--      was made for which week (a list that found nothing is still a list)
--   2. moment_removals: a person's removal of a planned seasonal post
--   3. calendar_plans.moments: the week's judged moments
--   4. moment_removed as a source of the preference memory
--   5. the three job kinds; a country's list belongs to no client
--   6. the delete trigger on calendar_posts, which never fails the delete
--
-- Staff read the new tables; only the service role writes them. Every new
-- table with row level security gets the three restrictive "OAuth sessions
-- cannot ..." policies of 20261109120000_claude_connector.sql. Additive and
-- safe to apply twice.

-- ── 1. The moments ──────────────────────────────────────────────────────────

create table if not exists public.moments (
  id uuid primary key default gen_random_uuid(),
  -- Country and name with no year ("us:election-day"): the same moment every year.
  key text not null check (key ~ '^[a-z]+:[a-z0-9-]+$'),
  -- ISO 3166 code, or GLOBAL for moments marked worldwide.
  country text not null check (country ~ '^([A-Z]{2}|GLOBAL)$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  date date not null,
  last_year_date date,
  category text not null check (category in ('public_holiday', 'cultural_commercial', 'awareness_day', 'sports', 'civic_political', 'religious', 'remembrance_tragedy', 'conflict_disaster')),
  -- The page that gave this year's date; a moment without one is never kept.
  link text not null check (link ~* '^https?://'),
  hashtags text[] not null default '{}',
  aliases text[] not null default '{}',
  terms text[] not null default '{}',
  -- The Monday of the week whose list last named it.
  listed_for date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint moments_one_per_date unique (key, date)
);
create index if not exists moments_country_date on public.moments (country, date);

comment on table public.moments is 'Dated moments a country (or the world) marks, each with a source link, listed by the moments_list job. Shared by every client in that market.';

create table if not exists public.moment_lists (
  country text not null check (country ~ '^([A-Z]{2}|GLOBAL)$'),
  week_start date not null check (extract(isodow from week_start) = 1),
  -- The last day the list covers: five weeks from week_start.
  through date not null,
  listed_at timestamptz not null default now(),
  found integer not null default 0,
  model text,
  input_tokens integer,
  output_tokens integer,
  searches integer,
  primary key (country, week_start)
);

comment on table public.moment_lists is 'One row per country list made for a week, found or not, so a week never waits for a list twice.';

-- ── 2. Removals ─────────────────────────────────────────────────────────────

create table if not exists public.moment_removals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- Null for a seasonal post planned before moments had keys (3 Nov 2026).
  moment_key text,
  moment_name text not null default '',
  category text check (category is null or category in ('public_holiday', 'cultural_commercial', 'awareness_day', 'sports', 'civic_political', 'religious', 'remembrance_tragedy', 'conflict_disaster')),
  post_date date,
  post_key text,
  plan_id uuid,
  removed_by uuid,
  removed_at timestamptz not null default now()
);
create index if not exists moment_removals_client on public.moment_removals (client_id, removed_at desc);

comment on table public.moment_removals is 'A person removed a planned seasonal post. Its moment is never offered to the client again; two removals in a category with no seasonal post of it kept through its week block the category.';

alter table public.moments enable row level security;
alter table public.moment_lists enable row level security;
alter table public.moment_removals enable row level security;

drop policy if exists "Staff read moments" on public.moments;
create policy "Staff read moments" on public.moments
  for select to authenticated using (public.is_moburst_staff());
drop policy if exists "Staff read moment lists" on public.moment_lists;
create policy "Staff read moment lists" on public.moment_lists
  for select to authenticated using (public.is_moburst_staff());
drop policy if exists "Staff read moment removals" on public.moment_removals;
create policy "Staff read moment removals" on public.moment_removals
  for select to authenticated using (public.can_write_client(client_id));

-- An OAuth session (the Claude connector) reads, never writes.
drop policy if exists "OAuth sessions cannot insert" on public.moments;
create policy "OAuth sessions cannot insert" on public.moments as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.moments;
create policy "OAuth sessions cannot update" on public.moments as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.moments;
create policy "OAuth sessions cannot delete" on public.moments as restrictive for delete to authenticated using (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot insert" on public.moment_lists;
create policy "OAuth sessions cannot insert" on public.moment_lists as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.moment_lists;
create policy "OAuth sessions cannot update" on public.moment_lists as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.moment_lists;
create policy "OAuth sessions cannot delete" on public.moment_lists as restrictive for delete to authenticated using (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot insert" on public.moment_removals;
create policy "OAuth sessions cannot insert" on public.moment_removals as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.moment_removals;
create policy "OAuth sessions cannot update" on public.moment_removals as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.moment_removals;
create policy "OAuth sessions cannot delete" on public.moment_removals as restrictive for delete to authenticated using (not (select public.is_oauth_session()));

revoke all on public.moments, public.moment_lists, public.moment_removals from public, anon;
grant select on public.moments, public.moment_lists, public.moment_removals to authenticated;
grant select, insert, update, delete on public.moments, public.moment_lists, public.moment_removals to service_role;

-- ── 3. The week's judged moments ────────────────────────────────────────────

alter table public.calendar_plans add column if not exists moments jsonb;
comment on column public.calendar_plans.moments is 'The week''s dated moments as week_moments judged them: {judged_at, countries, model, input_tokens, output_tokens, sprout, kept: [...], dropped: [{key, name, date, category, why}]}. Null until judged.';

-- ── 4. A removal teaches the memory ─────────────────────────────────────────

-- Added to the sources there (rewrite_note since 20261110110000_post_notes_stories.sql), never in place of them.
do $$
declare
  v_def text;
  v_sources text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.brand_voice_learnings'::regclass and conname = 'brand_voice_learnings_source_check';
  select array_agg(distinct k order by k) into v_sources from (
    select m[1] as k from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m
    union
    select btrim(e) from unnest(string_to_array(substring(coalesce(v_def, '') from '\{([a-z_,]*)\}'), ',')) as e
  ) sources where k ~ '^[a-z_]+$';
  v_sources := array(select distinct k from unnest(coalesce(v_sources, '{}'::text[]) || array['copy_edit', 'revise_note', 'moment_removed']) as k order by k);
  alter table public.brand_voice_learnings drop constraint if exists brand_voice_learnings_source_check;
  execute format('alter table public.brand_voice_learnings add constraint brand_voice_learnings_source_check check (source = any (%L::text[]))', v_sources);
end $$;

-- ── 5. The jobs ─────────────────────────────────────────────────────────────

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
  v_kinds := array(select distinct k from unnest(coalesce(v_kinds, '{}'::text[]) || array['moments_list', 'week_moments', 'moment_feedback']) as k order by k);
  alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_kind_check;
  execute format('alter table public.scheduled_jobs add constraint scheduled_jobs_kind_check check (kind = any (%L::text[]))', v_kinds);
end $$;

-- A country's list is shared by every client in that market, so it belongs to none.
alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_client_required;
alter table public.scheduled_jobs add constraint scheduled_jobs_client_required
  check (client_id is not null or kind in ('sprout_onboarding', 'moments_list'));

-- ── 6. A person's removal of a planned seasonal post ────────────────────────

-- After a signed-in person deletes a post the week planner wrote for a dated
-- moment: a moment_removals row and a moment_feedback job. A service delete
-- (cron, functions) or any other post does neither. Whatever goes wrong in
-- here is a warning: the delete itself always goes through.
create or replace function public.calendar_posts_moment_removed()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_reason jsonb := case when jsonb_typeof(old.reasons) = 'array' then old.reasons -> 0 else null end;
  v_moment jsonb;
  v_removal uuid;
  v_category text;
begin
  if auth.uid() is null or coalesce(auth.role(), '') <> 'authenticated' then return old; end if;
  if old.plan_id is null or coalesce(v_reason ->> 'type', '') <> 'seasonal' then return old; end if;
  begin
    select e into v_moment
      from jsonb_array_elements(case when jsonb_typeof(v_reason -> 'evidence') = 'array' then v_reason -> 'evidence' else '[]'::jsonb end) as e
     where e ->> 'kind' = 'moment'
     limit 1;
    v_category := case when v_moment ->> 'category' in ('public_holiday', 'cultural_commercial', 'awareness_day', 'sports', 'civic_political', 'religious', 'remembrance_tragedy', 'conflict_disaster')
                       then v_moment ->> 'category' end;
    insert into moment_removals (client_id, moment_key, moment_name, category, post_date, post_key, plan_id, removed_by)
    values (old.client_id, nullif(v_moment ->> 'key', ''), left(coalesce(v_moment ->> 'text', v_reason ->> 'moment', ''), 200), v_category,
            old.post_date, old.post_key, old.plan_id, auth.uid())
    returning id into v_removal;
    insert into scheduled_jobs (kind, client_id, dedupe_key, payload, priority, available_at)
    values ('moment_feedback', old.client_id, 'moment_feedback:' || v_removal, jsonb_build_object('removal_id', v_removal), 45, now())
    on conflict do nothing;
  exception when others then
    raise warning 'calendar_posts_moment_removed: %', sqlerrm;
  end;
  return old;
end $$;

revoke all on function public.calendar_posts_moment_removed() from public, anon, authenticated;

drop trigger if exists calendar_posts_moment_removed on public.calendar_posts;
create trigger calendar_posts_moment_removed after delete on public.calendar_posts
  for each row execute function public.calendar_posts_moment_removed();
