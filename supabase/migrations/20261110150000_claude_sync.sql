-- Two-way sync between the team's Claude work and Socialytics: the database half.
-- Design: docs/superpowers/specs/2026-11-03-claude-sync-design.md
--
-- Staff save notes, approved copy, strategy sections and finished decks from
-- Claude through the connector (the mcp edge function). The database guards
-- of 20261109120000_claude_connector.sql stay exactly as they are: an OAuth
-- session still writes no table and calls no write function. The connector
-- writes in one module (mcp/writes.ts), through the service role, after it
-- has checked can_write_client as the signed-in person; every row it writes
-- names that person and source 'claude'. This migration adds what those
-- writes need:
--
--   1. client_notes.source ('app' or 'claude') and text_hash, the SHA-256 of
--      a typed note's text with its whitespace collapsed, filled in for the
--      notes already typed. One note from Claude per client and text.
--   2. post_iterations.source takes 'claude'.
--   3. content_strategy_edits.source, and strategy_section_save_as(p_user,
--      p_client, p_key, p_text, p_source): the section save for a named
--      person, the service role's alone. strategy_section_save keeps its
--      guards and calls it for the signed-in person. A save from Claude never
--      hands a section back.
--   4. report_decks and the private report-decks bucket (.pptx and .pdf, up
--      to 50 MB): finished decks on a social or competitive report, read by
--      whoever can see the report, the client included. Written by the
--      service role only.
--   5. api_requests.target: what a connector write wrote (a note id, a post
--      key, a section key, a deck id), never its text.
--
-- Additive and safe to run twice: nothing is dropped but the constraints,
-- policies and indexes it creates itself.

-- ── 1. Notes: where each came from, and its text's hash ─────────────────────

alter table public.client_notes add column if not exists source text not null default 'app';
alter table public.client_notes drop constraint if exists client_notes_source_check;
alter table public.client_notes add constraint client_notes_source_check check (source in ('app', 'claude'));
alter table public.client_notes add column if not exists text_hash text;

comment on column public.client_notes.source is 'app when a person added the note in Socialytics; claude when a person saved it from Claude through the connector.';
comment on column public.client_notes.text_hash is 'A typed note''s text, SHA-256 in hex, after trimming and collapsing runs of spaces, tabs and line breaks to one space (_shared/notes/add.ts noteTextHash). Finds the same note saved again.';

-- The notes typed before this change, hashed exactly as the connector hashes.
update public.client_notes
   set text_hash = encode(sha256(convert_to(
         regexp_replace(regexp_replace(text, '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g'), '[ \t\n\r\f\v]+', ' ', 'g'),
         'UTF8')), 'hex')
 where kind = 'typed' and text is not null and text_hash is null;

create index if not exists client_notes_text_hash on public.client_notes (client_id, text_hash) where text_hash is not null;
-- The same text saved from Claude twice (a retry, a rerun, two people) is one note.
create unique index if not exists client_notes_claude_text on public.client_notes (client_id, text_hash) where source = 'claude' and text_hash is not null;

-- ── 2. Copy saved from Claude ───────────────────────────────────────────────

-- The sources post_iterations already takes, whatever they are, and claude.
do $$
declare
  v_def text;
  v_sources text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.post_iterations'::regclass and conname = 'post_iterations_source_check';
  select array_agg(distinct m[1] order by m[1]) into v_sources
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m;
  v_sources := array(select distinct s from unnest(coalesce(v_sources, array['calendar', 'ad_hoc', 'regeneration']) || array['claude']) as s order by s);
  alter table public.post_iterations drop constraint if exists post_iterations_source_check;
  execute format('alter table public.post_iterations add constraint post_iterations_source_check check (source = any (%L::text[]))', v_sources);
end $$;

-- ── 3. Strategy sections saved from Claude ──────────────────────────────────

alter table public.content_strategy_edits add column if not exists source text not null default 'app';
alter table public.content_strategy_edits drop constraint if exists content_strategy_edits_source_check;
alter table public.content_strategy_edits add constraint content_strategy_edits_source_check check (source in ('app', 'claude'));

comment on column public.content_strategy_edits.source is 'app when the person saved the section on the Strategy page; claude when they saved it from Claude through the connector.';

-- The section save for a named person: the body of strategy_section_save,
-- with the person and the source as arguments. The service role's alone:
-- the connector calls it after checking can_write_client as that person.
-- Empty text, or the product's own words, hands the section back for the
-- app; a save from Claude never does.
create or replace function public.strategy_section_save_as(p_user uuid, p_client uuid, p_key text, p_text text, p_source text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
  v_text text := btrim(coalesce(p_text, ''));
  v_product text;
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
  if length(v_text) > 20000 then
    raise exception 'The text is too long.' using errcode = '22001';
  end if;
  select btrim(coalesce(s.sections ->> v_key, '')) into v_product
    from public.content_strategies s where s.client_id = p_client;
  if v_text = '' or v_text = coalesce(v_product, '') then
    if p_source = 'claude' then
      raise exception 'A section saved from Claude is never handed back.' using errcode = '22023';
    end if;
    delete from public.content_strategy_edits where client_id = p_client and section_key = v_key;
    return null;
  end if;
  -- The name people know the editor by: the profile's display name, else the
  -- part of the email before the @.
  select nullif(btrim(split_part(coalesce(nullif(btrim(pr.display_name), ''), nullif(btrim(pr.email), ''), u.email::text, ''), '@', 1)), '')
    into v_name
    from auth.users u
    left join public.profiles pr on pr.user_id = u.id
   where u.id = p_user;
  insert into public.content_strategy_edits as e (client_id, section_key, text, edited_by, editor_name, edited_at, source)
  values (p_client, v_key, v_text, p_user, coalesce(v_name, ''), now(), p_source)
  on conflict (client_id, section_key) do update
    set text = excluded.text, edited_by = excluded.edited_by, editor_name = excluded.editor_name, edited_at = excluded.edited_at, source = excluded.source
  returning e.* into v_row;
  return jsonb_build_object('section_key', v_row.section_key, 'text', v_row.text, 'editor_name', v_row.editor_name, 'edited_at', v_row.edited_at, 'source', v_row.source);
end $$;

revoke all on function public.strategy_section_save_as(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.strategy_section_save_as(uuid, uuid, text, text, text) to service_role;

-- The Strategy page's save (20261109120000_claude_connector.sql): the same
-- guards, first, then the save for the signed-in person.
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
  return public.strategy_section_save_as(auth.uid(), p_client, p_key, p_text, 'app');
end $$;

revoke all on function public.strategy_section_save(uuid, text, text) from public, anon;
grant execute on function public.strategy_section_save(uuid, text, text) to authenticated;

-- ── 4. Decks on reports ─────────────────────────────────────────────────────

create table if not exists public.report_decks (
  -- For a file, the deck id the upload was signed for; for a link, made from
  -- the report and the link, so the same deck saved twice is one row.
  id uuid primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  report_id uuid references public.reports(id) on delete cascade,
  competitive_report_id uuid references public.competitive_reports(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  kind text not null check (kind in ('pptx', 'pdf', 'link')),
  -- {client_id}/{report id}/{deck id}.{pptx|pdf} in the report-decks bucket.
  file_path text unique,
  -- A Google Slides or Drive link.
  link text check (link is null or (link ~ '^https://' and char_length(link) <= 2000)),
  source text not null default 'claude' check (source in ('app', 'claude')),
  added_by uuid references auth.users(id) on delete set null,
  added_by_name text,
  created_at timestamptz not null default now(),
  constraint report_decks_one_report check (num_nonnulls(report_id, competitive_report_id) = 1),
  constraint report_decks_file_or_link check (case when kind = 'link' then link is not null and file_path is null else file_path is not null and link is null end)
);
create index if not exists report_decks_report on public.report_decks (report_id, created_at desc) where report_id is not null;
create index if not exists report_decks_competitive on public.report_decks (competitive_report_id, created_at desc) where competitive_report_id is not null;
create index if not exists report_decks_client on public.report_decks (client_id);

comment on table public.report_decks is 'Finished decks on a social or competitive report, saved from Claude. Read by whoever can see the report; written by the service role only.';

alter table public.report_decks enable row level security;

drop policy if exists "People who see the report read its decks" on public.report_decks;
create policy "People who see the report read its decks" on public.report_decks
  for select to authenticated using (
    public.can_access_client(client_id) and (
      exists (select 1 from public.reports r where r.id = report_decks.report_id and r.client_id = report_decks.client_id)
      or exists (select 1 from public.competitive_reports c where c.id = report_decks.competitive_report_id and c.client_id = report_decks.client_id)));

-- As on every table: an OAuth session reads, never writes.
drop policy if exists "OAuth sessions cannot insert" on public.report_decks;
create policy "OAuth sessions cannot insert" on public.report_decks as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.report_decks;
create policy "OAuth sessions cannot update" on public.report_decks as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.report_decks;
create policy "OAuth sessions cannot delete" on public.report_decks as restrictive for delete to authenticated using (not (select public.is_oauth_session()));

revoke all on public.report_decks from public, anon, authenticated;
grant select on public.report_decks to authenticated;
grant select, insert, update, delete on public.report_decks to service_role;

-- The files: private, decks and PDFs, 50 MB. Claude puts a file through a
-- signed upload URL the connector makes for one path; nobody else uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-decks', 'report-decks', false, 52428800, array[
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- A file is read once its deck is recorded, by whoever can read that deck.
drop policy if exists "People who see the report read its deck files" on storage.objects;
create policy "People who see the report read its deck files" on storage.objects for select to authenticated
  using (bucket_id = 'report-decks' and exists (select 1 from public.report_decks d where d.file_path = objects.name));

-- ── 5. What a connector write wrote ─────────────────────────────────────────

alter table public.api_requests add column if not exists target text;
comment on column public.api_requests.target is 'For a connector write (method MCP): the note id, post key, section key or deck id written. Never the text.';

-- The connector counts a client's writes over the last day from these rows.
create index if not exists api_requests_mcp_writes on public.api_requests (client_id, created_at desc) where target is not null;
