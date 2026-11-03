-- Strategy tab, version 2. Spec: docs/superpowers/specs/2026-11-03-strategy-v2-design.md
-- Lital's answers of 3 Nov 2026 are in the build: the deck is a new copy in
-- ai@moburst.com's Drive shared as editor to the person who asked; prospects
-- are read from public data with the app's Apify actors, never RivalIQ; the
-- Google token lives in Vault and no function a person can call returns it.
--
--   1. content_strategies: the shape of the stored sections (1 = the 2 Nov
--      text sections, 2 = fields), each section as the plain lines the page
--      shows (section_texts, so the database, the connector and the page
--      read the same text), and the public read the strategy was written
--      from (reused for 7 days).
--   2. One section save for the page and for Claude: strategy_section_save_as
--      (20261110150000_claude_sync.sql) now also takes the section's fields
--      (p_value) and writes text, fields and source together, under the
--      locks it takes before reading. Its version check reads the text the
--      page shows: a person's version, else the product's text, or the
--      product's lines for a strategy written as fields. A save from Claude
--      is plain text: it clears any fields, so the page shows Claude's text
--      in the card with its chip, until someone saves the card's fields. The
--      page saves fields with strategy_section_save(p_client, p_key, p_text,
--      p_value); the three-argument save from Claude sync stays. Both refuse
--      an OAuth session and anyone but staff with access, then call save_as
--      for the signed-in person with source app. save_as's earlier signature
--      (without p_value) is dropped so the name has one signature; every
--      named-argument call to it (the connector's) still resolves.
--   3. client_public_profiles: the client's own public profiles, from
--      RivalIQ's record, the client's homepage and people. A person's entry
--      is never overwritten and a profile a person removed never comes back
--      (the competitor_handles rules). People change it only through
--      client_public_profile_set and client_public_profile_remove.
--   4. content_strategy_exports: each Google Slides deck made from a
--      strategy, with its link. strategy_deck_request queues one as a
--      strategy_deck job in the scheduled-jobs queue.
--   5. google_connection: the one Google account the decks are made in
--      (ai@moburst.com), its folder and template, and a sign-in under way.
--      Service role only. The refresh token is in Vault, written and read
--      only through google_token_save / google_token_read / google_token_clear,
--      which only the service role may execute.
--   6. strategy-decks: a private bucket for the deck's chart images and
--      template file. No policies: only the service role reads or writes it.
--
-- Staff who can access the client read the strategy tables; an OAuth session
-- (the Claude connector) reads and never writes: every new table has the three
-- restrictive "OAuth sessions cannot ..." policies and every new function a
-- person can call refuses an OAuth session first.
-- Additive and safe to run again: nothing is dropped but save_as's earlier
-- signature, replaced in the same transaction.

-- ── 1. The stored strategy ──────────────────────────────────────────────────

alter table public.content_strategies add column if not exists shape smallint not null default 1;
alter table public.content_strategies add column if not exists section_texts jsonb not null default '{}'::jsonb;
alter table public.content_strategies add column if not exists public_read jsonb;
alter table public.content_strategies add column if not exists public_read_at timestamptz;
comment on column public.content_strategies.shape is 'How sections are stored: 1 = text per section (2 Nov), 2 = fields per section (3 Nov, strategy v2).';
comment on column public.content_strategies.section_texts is 'For a strategy written as fields (shape 2): each section as the plain lines the Strategy page and the connector show (strategy/sections.ts sectionLines), by key. A section''s version is the hash of its shown text.';
comment on column public.content_strategies.public_read is 'The 90-day public read the strategy was written from: per company and platform, posts, posts a week, median engagement, rate per view where public views exist, followers; with its sources and window.';
comment on column public.content_strategies.public_read_at is 'When the public read was made; reused for 7 days.';

-- ── 2. One section save, for the page and for Claude ────────────────────────

alter table public.content_strategy_edits add column if not exists value jsonb;
comment on column public.content_strategy_edits.value is 'A person''s version in the v2 fields of its section; null for a version that is only text (a 2 Nov edit, or a save from Claude), which the page shows as text. text holds the version as the plain lines the page shows.';

-- The section save for a named person, for the page and for Claude alike:
-- 20261110150000_claude_sync.sql's save, which also takes the section's
-- fields. p_value is the section's fields (an object) or null for plain
-- text; text, fields and source are written together. A save from Claude
-- is plain text, so its fields are null: the page shows its text.
--
-- The text the page shows, which the version is the hash of: a person's
-- version, else the product's own: its text for a strategy written on
-- 2 Nov, its lines (section_texts) for one written as fields.
--
-- Handing back (the app only; a save from Claude never does): no text and
-- no fields, the product's own fields, or text with no fields equal to the
-- product's shown text.
drop function if exists public.strategy_section_save_as(uuid, uuid, text, text, text, text);
create or replace function public.strategy_section_save_as(p_user uuid, p_client uuid, p_key text, p_text text, p_source text, p_expected text default null, p_value jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
  v_text text := btrim(coalesce(p_text, ''));
  v_value jsonb := case when jsonb_typeof(p_value) = 'object' then p_value else null end;
  v_product jsonb;
  v_product_text text;
  v_edit text;
  v_shown text;
  v_version text;
  v_name text;
  v_row public.content_strategy_edits%rowtype;
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  if p_user is null then
    raise exception 'A person is required.' using errcode = '22023';
  end if;
  if coalesce(p_source, '') not in ('app', 'claude') then
    raise exception 'Unknown source.' using errcode = '22023';
  end if;
  if v_key !~ '^(goals|audience|positioning|not_now|avoid|measures|pillar:.+|platform:[a-z0-9]+:(posting|new))$' then
    raise exception 'Unknown strategy section.' using errcode = '22023';
  end if;
  if length(v_text) > 20000 or length(coalesce(v_value::text, '')) > 40000 then
    raise exception 'The text is too long.' using errcode = '22001';
  end if;
  if p_value is not null and v_value is null then
    raise exception 'A section''s fields are one object.' using errcode = '22023';
  end if;
  -- A save from Claude is plain text.
  if p_source = 'claude' then
    v_value := null;
  end if;
  -- One save of this section at a time, and no rewrite of the strategy
  -- under it, from here until the call's transaction ends.
  perform pg_advisory_xact_lock(hashtextextended('strategy_section:' || p_client::text || ':' || v_key, 0));
  perform 1 from public.content_strategies s where s.client_id = p_client for update;
  perform 1 from public.content_strategy_edits e where e.client_id = p_client and e.section_key = v_key for update;
  select s.sections -> v_key,
         case when jsonb_typeof(s.sections -> v_key) = 'string' then s.sections ->> v_key else s.section_texts ->> v_key end
    into v_product, v_product_text
    from public.content_strategies s where s.client_id = p_client;
  select e.text into v_edit
    from public.content_strategy_edits e where e.client_id = p_client and e.section_key = v_key;
  if p_expected is not null then
    v_shown := coalesce(v_edit, v_product_text, '');
    v_version := left(encode(sha256(convert_to(v_shown, 'UTF8')), 'hex'), 16);
    if v_version <> btrim(p_expected) then
      return jsonb_build_object('conflict', true, 'section_key', v_key, 'text', v_shown, 'version', v_version);
    end if;
  end if;
  v_product_text := btrim(coalesce(v_product_text, ''));
  if (v_text = '' and v_value is null)
     or (v_value is not null and v_value = v_product)
     or (v_value is null and v_text = v_product_text) then
    if p_source = 'claude' then
      raise exception 'A section saved from Claude is never handed back.' using errcode = '22023';
    end if;
    delete from public.content_strategy_edits where client_id = p_client and section_key = v_key;
    return null;
  end if;
  if v_text = '' then
    raise exception 'A section needs its text.' using errcode = '22023';
  end if;
  -- The name people know the editor by: the profile's display name, else the
  -- part of the email before the @.
  select nullif(btrim(split_part(coalesce(nullif(btrim(pr.display_name), ''), nullif(btrim(pr.email), ''), u.email::text, ''), '@', 1)), '')
    into v_name
    from auth.users u
    left join public.profiles pr on pr.user_id = u.id
   where u.id = p_user;
  insert into public.content_strategy_edits as e (client_id, section_key, text, value, edited_by, editor_name, edited_at, source)
  values (p_client, v_key, v_text, v_value, p_user, coalesce(v_name, ''), now(), p_source)
  on conflict (client_id, section_key) do update
    set text = excluded.text, value = excluded.value, edited_by = excluded.edited_by, editor_name = excluded.editor_name, edited_at = excluded.edited_at, source = excluded.source
  returning e.* into v_row;
  return jsonb_build_object('section_key', v_row.section_key, 'text', v_row.text, 'value', v_row.value, 'editor_name', v_row.editor_name, 'edited_at', v_row.edited_at, 'source', v_row.source);
end $$;

revoke all on function public.strategy_section_save_as(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.strategy_section_save_as(uuid, uuid, text, text, text, text, jsonb) to service_role;

-- The Strategy page's saves: the same guards, first, then the one save for
-- the signed-in person. The page saves a card's fields and its lines; the
-- three-argument save (text only, from 20261110150000_claude_sync.sql) stays
-- for a tab opened before this release.
create or replace function public.strategy_section_save(p_client uuid, p_key text, p_text text, p_value jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  if not (public.is_moburst_staff() and public.can_access_client(p_client)) then
    raise exception 'Only Moburst staff can change the content strategy.' using errcode = '42501';
  end if;
  return public.strategy_section_save_as(auth.uid(), p_client, p_key, p_text, 'app', null, p_value);
end $$;

create or replace function public.strategy_section_save(p_client uuid, p_key text, p_text text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  if not (public.is_moburst_staff() and public.can_access_client(p_client)) then
    raise exception 'Only Moburst staff can change the content strategy.' using errcode = '42501';
  end if;
  return public.strategy_section_save_as(auth.uid(), p_client, p_key, p_text, 'app', null, null);
end $$;

revoke all on function public.strategy_section_save(uuid, text, text, jsonb) from public, anon;
grant execute on function public.strategy_section_save(uuid, text, text, jsonb) to authenticated;
revoke all on function public.strategy_section_save(uuid, text, text) from public, anon;
grant execute on function public.strategy_section_save(uuid, text, text) to authenticated;

-- ── 3. The client's own public profiles ─────────────────────────────────────

create table if not exists public.client_public_profiles (
  client_id uuid not null references public.clients(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook', 'tiktok', 'youtube', 'x', 'linkedin')),
  handle text not null check (btrim(handle) <> ''),
  url text,
  source text not null check (source in ('rivaliq', 'website', 'person', 'removed')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (client_id, platform)
);
comment on table public.client_public_profiles is 'The client''s own public profile per platform, read without Sprout for its strategy: from RivalIQ''s record of the company, the links on its homepage, or a person. source person is never overwritten; source removed is a profile a person took away, which never comes back.';

alter table public.client_public_profiles enable row level security;
revoke all on public.client_public_profiles from anon, authenticated;
grant select on public.client_public_profiles to authenticated;
grant select, insert, update, delete on public.client_public_profiles to service_role;

drop policy if exists "Staff read client public profiles" on public.client_public_profiles;
create policy "Staff read client public profiles" on public.client_public_profiles
  for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));
drop policy if exists "OAuth sessions cannot insert" on public.client_public_profiles;
create policy "OAuth sessions cannot insert" on public.client_public_profiles as restrictive for insert to authenticated
  with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.client_public_profiles;
create policy "OAuth sessions cannot update" on public.client_public_profiles as restrictive for update to authenticated
  using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.client_public_profiles;
create policy "OAuth sessions cannot delete" on public.client_public_profiles as restrictive for delete to authenticated
  using (not (select public.is_oauth_session()));

-- A person sets the client's profile on one platform. It is kept whatever
-- the lifecycle reads later. The lifecycle looks at the client at once.
create or replace function public.client_public_profile_set(p_client uuid, p_platform text, p_handle text, p_url text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  v_handle text := regexp_replace(btrim(coalesce(p_handle, '')), '^@', '');
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_row public.client_public_profiles%rowtype;
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  if not (public.is_moburst_staff() and public.can_access_client(p_client)) then
    raise exception 'Only Moburst staff can change the client''s public profiles.' using errcode = '42501';
  end if;
  if v_platform not in ('instagram', 'facebook', 'tiktok', 'youtube', 'x', 'linkedin') then
    raise exception 'Unknown platform.' using errcode = '22023';
  end if;
  if v_handle = '' or length(v_handle) > 200 or (v_url is not null and (v_url !~ '^https://' or length(v_url) > 500)) then
    raise exception 'A profile needs its handle, and a link that starts with https://.' using errcode = '22023';
  end if;
  insert into public.client_public_profiles as p (client_id, platform, handle, url, source, updated_by, updated_at)
  values (p_client, v_platform, v_handle, v_url, 'person', auth.uid(), now())
  on conflict (client_id, platform) do update
    set handle = excluded.handle, url = excluded.url, source = 'person', updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning p.* into v_row;
  perform public.lifecycle_enqueue(p_client);
  return jsonb_build_object('platform', v_row.platform, 'handle', v_row.handle, 'url', v_row.url, 'source', v_row.source);
end $$;

-- A person removes the client's profile on one platform. The row stays as
-- removed, so the lifecycle never adds it back. True when there was one.
create or replace function public.client_public_profile_remove(p_client uuid, p_platform text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_platform text := lower(btrim(coalesce(p_platform, '')));
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  if not (public.is_moburst_staff() and public.can_access_client(p_client)) then
    raise exception 'Only Moburst staff can change the client''s public profiles.' using errcode = '42501';
  end if;
  update public.client_public_profiles
     set source = 'removed', updated_by = auth.uid(), updated_at = now()
   where client_id = p_client and platform = v_platform and source <> 'removed';
  if not found then return false; end if;
  perform public.lifecycle_enqueue(p_client);
  return true;
end $$;

revoke all on function public.client_public_profile_set(uuid, text, text, text) from public, anon;
grant execute on function public.client_public_profile_set(uuid, text, text, text) to authenticated;
revoke all on function public.client_public_profile_remove(uuid, text) from public, anon;
grant execute on function public.client_public_profile_remove(uuid, text) to authenticated;

-- ── 4. Decks made from a strategy ───────────────────────────────────────────

create table if not exists public.content_strategy_exports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null default 'slides' check (kind in ('slides')),
  status text not null default 'queued' check (status in ('queued', 'making', 'done', 'failed')),
  strategy_written_at timestamptz not null,
  edits_at timestamptz,
  requested_by uuid,
  requester_name text not null default '',
  file_id text,
  url text,
  made_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.content_strategy_exports is 'Each Google Slides deck made from a client''s strategy: a new copy in ai@moburst.com''s Drive, shared as editor to the person who asked. A deck is never rewritten after it is made.';
comment on column public.content_strategy_exports.strategy_written_at is 'The written_at of the strategy the deck was made from.';
comment on column public.content_strategy_exports.edits_at is 'The newest person''s version of a section when the deck was asked for; a later one means the page has changed since.';

create index if not exists content_strategy_exports_client on public.content_strategy_exports (client_id, created_at desc);
-- One deck under way per client at a time.
create unique index if not exists content_strategy_exports_one_open on public.content_strategy_exports (client_id)
  where status in ('queued', 'making');

alter table public.content_strategy_exports enable row level security;
revoke all on public.content_strategy_exports from anon, authenticated;
grant select on public.content_strategy_exports to authenticated;
grant select, insert, update, delete on public.content_strategy_exports to service_role;

drop policy if exists "Staff read strategy exports" on public.content_strategy_exports;
create policy "Staff read strategy exports" on public.content_strategy_exports
  for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));
drop policy if exists "OAuth sessions cannot insert" on public.content_strategy_exports;
create policy "OAuth sessions cannot insert" on public.content_strategy_exports as restrictive for insert to authenticated
  with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.content_strategy_exports;
create policy "OAuth sessions cannot update" on public.content_strategy_exports as restrictive for update to authenticated
  using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.content_strategy_exports;
create policy "OAuth sessions cannot delete" on public.content_strategy_exports as restrictive for delete to authenticated
  using (not (select public.is_oauth_session()));

-- The job kind that makes a deck (run-scheduled-jobs).
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
  v_kinds := array(select distinct k from unnest(coalesce(v_kinds, '{}'::text[]) || array['strategy_deck']) as k order by k);
  alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_kind_check;
  execute format('alter table public.scheduled_jobs add constraint scheduled_jobs_kind_check check (kind = any (%L::text[]))', v_kinds);
end $$;

-- A person asks for a Google Slides deck of the client's strategy. A deck
-- already under way for the client is answered instead of a second one.
-- Answers the export row.
create or replace function public.strategy_deck_request(p_client uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_written timestamptz;
  v_edits timestamptz;
  v_name text;
  v_row public.content_strategy_exports%rowtype;
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  if not (public.is_moburst_staff() and public.can_access_client(p_client)) then
    raise exception 'Only Moburst staff can make a strategy deck.' using errcode = '42501';
  end if;
  select written_at into v_written from public.content_strategies where client_id = p_client;
  if v_written is null then
    raise exception 'The client has no strategy yet.' using errcode = '22023';
  end if;
  select * into v_row from public.content_strategy_exports where client_id = p_client and status in ('queued', 'making') limit 1;
  if found then
    return to_jsonb(v_row) - 'file_id';
  end if;
  select max(edited_at) into v_edits from public.content_strategy_edits where client_id = p_client;
  select nullif(btrim(split_part(coalesce(nullif(btrim(pr.display_name), ''), nullif(btrim(pr.email), ''), u.email::text, ''), '@', 1)), '')
    into v_name
    from auth.users u
    left join public.profiles pr on pr.user_id = u.id
   where u.id = auth.uid();
  insert into public.content_strategy_exports (client_id, strategy_written_at, edits_at, requested_by, requester_name)
  values (p_client, v_written, v_edits, auth.uid(), coalesce(v_name, ''))
  returning * into v_row;
  insert into public.scheduled_jobs (kind, client_id, payload, dedupe_key, priority, available_at)
  values ('strategy_deck', p_client, jsonb_build_object('export_id', v_row.id), 'strategy_deck:' || v_row.id, 20, now());
  return to_jsonb(v_row) - 'file_id';
end $$;

revoke all on function public.strategy_deck_request(uuid) from public, anon;
grant execute on function public.strategy_deck_request(uuid) to authenticated;

-- ── 5. The Google connection ────────────────────────────────────────────────

create table if not exists public.google_connection (
  id boolean primary key default true check (id),
  account_email text,
  connected_at timestamptz,
  last_used_at timestamptz,
  folder_id text,
  template_id text,
  template_version text,
  pending_state text,
  pending_verifier text,
  pending_started_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table public.google_connection is 'The one Google account strategy decks are made in (ai@moburst.com): who it is, its folder and template, and a sign-in under way. Service role only; the refresh token is in Vault (google_token_save, google_token_read).';

alter table public.google_connection enable row level security;
revoke all on public.google_connection from public, anon, authenticated;
grant select, insert, update, delete on public.google_connection to service_role;
drop policy if exists "OAuth sessions cannot insert" on public.google_connection;
create policy "OAuth sessions cannot insert" on public.google_connection as restrictive for insert to authenticated
  with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.google_connection;
create policy "OAuth sessions cannot update" on public.google_connection as restrictive for update to authenticated
  using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.google_connection;
create policy "OAuth sessions cannot delete" on public.google_connection as restrictive for delete to authenticated
  using (not (select public.is_oauth_session()));

-- The refresh token, in Vault. Only the service role may execute these; the
-- check inside each is a second lock behind the grants.
create or replace function public.google_token_save(p_token text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the server can store the Google sign-in.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_token, '')) = '' then
    raise exception 'There is no Google sign-in to store.' using errcode = '22023';
  end if;
  select id into v_id from vault.secrets where name = 'socialytics_google_refresh_token';
  if v_id is null then
    perform vault.create_secret(p_token, 'socialytics_google_refresh_token', 'Google Slides and Drive sign-in of ai@moburst.com, for Socialytics strategy decks');
  else
    perform vault.update_secret(v_id, p_token);
  end if;
end $$;

create or replace function public.google_token_read()
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the server can read the Google sign-in.' using errcode = '42501';
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'socialytics_google_refresh_token';
  return v_token;
end $$;

create or replace function public.google_token_clear()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the server can clear the Google sign-in.' using errcode = '42501';
  end if;
  delete from vault.secrets where name = 'socialytics_google_refresh_token';
end $$;

revoke all on function public.google_token_save(text) from public, anon, authenticated;
revoke all on function public.google_token_read() from public, anon, authenticated;
revoke all on function public.google_token_clear() from public, anon, authenticated;
grant execute on function public.google_token_save(text) to service_role;
grant execute on function public.google_token_read() to service_role;
grant execute on function public.google_token_clear() to service_role;

-- ── 6. The deck's private files ─────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('strategy-decks', 'strategy-decks', false)
on conflict (id) do nothing;
