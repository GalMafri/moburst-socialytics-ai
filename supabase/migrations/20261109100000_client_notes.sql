-- Client notes: what the client told the team reaches every post the app
-- writes. Design: docs/superpowers/specs/2026-11-02-client-notes-import-design.md
--
-- Staff add a typed note or files (meeting notes, feedback, the files of the
-- client's Claude project) on Client setup's Brief tab. The notes_read job
-- (run-scheduled-jobs, _shared/notes/run.ts) reads each note once and keeps
-- what it learned as points: things to avoid, things to do, what is coming
-- up and facts. The copy writers read the points in use through the voice
-- block (_shared/voice); which points are in use is worked out in code at
-- every read (_shared/notes/notes.ts pointsInUse), so nothing here is ever
-- rewritten when a newer note says otherwise.
--
--   1. client_notes, client_note_points, client_note_links
--   2. the client-notes bucket (private, 20 MB, the note file types)
--   3. the notes_read job: one per client while queued or running
--   4. calendar_post_worked also sees a post scheduled to Sprout by its key
--
-- Staff with access to the client only: every policy is can_write_client.
-- People read the tables; every change goes through the client-notes
-- function. Additive and safe to apply twice.

-- ── 1. The tables ───────────────────────────────────────────────────────────

create table if not exists public.client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('typed', 'file')),
  -- The file's name, or the typed note's first line.
  title text not null default '',
  -- {client_id}/{fileKey} in the client-notes bucket (src/hooks/useQuietUpload.ts fileKey).
  file_path text,
  file_type text check (file_type in ('pdf', 'docx', 'xlsx', 'csv', 'txt', 'md', 'png', 'jpg')),
  -- The typed text, or the text read from the file, up to 400,000 characters.
  text text check (text is null or char_length(text) <= 400000),
  -- The length of the file's whole text, when more was there than was read.
  text_chars integer,
  -- Parts of the text read so far (text over 60,000 characters is read in parts).
  parts_done integer not null default 0,
  note_date date not null default current_date,
  -- person: a person set the date, and it beats any date the reading finds.
  date_set_by text not null default 'app' check (date_set_by in ('person', 'app')),
  state text not null default 'reading' check (state in ('reading', 'learned', 'nothing')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  added_by uuid references auth.users(id) on delete set null,
  added_by_name text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  updated_at timestamptz not null default now(),
  -- The same file dropped twice is stored and read once.
  constraint client_notes_one_per_file unique (client_id, file_path),
  constraint client_notes_kind_fields check (
    case when kind = 'file' then file_path is not null and file_type is not null
         else file_path is null and text is not null and char_length(text) <= 20000 end)
);
create index if not exists client_notes_client on public.client_notes (client_id, created_at desc);
create index if not exists client_notes_reading on public.client_notes (client_id, created_at) where state = 'reading';

comment on table public.client_notes is 'Notes staff add for a client (typed, or a file in the client-notes bucket). Read once by the notes_read job into client_note_points.';
comment on column public.client_notes.date_set_by is 'person when a person set note_date; then the note''s points take that date. app when it defaulted to the day it was added or came from the note''s own text.';

create table if not exists public.client_note_points (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.client_notes(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('avoid', 'do', 'fact', 'upcoming')),
  text text not null check (char_length(btrim(text)) between 1 and 240),
  -- One platform the point is for; null for every platform.
  platform text,
  -- The date the note gives for this point; null means the note's date.
  said_on date,
  -- The last day an upcoming item applies.
  until date,
  -- Which part of the note it was read from.
  part integer not null default 1,
  removed_by uuid references auth.users(id) on delete set null,
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists client_note_points_client on public.client_note_points (client_id) where removed_at is null;
create index if not exists client_note_points_note on public.client_note_points (note_id, part);

comment on table public.client_note_points is 'What a client note taught, one instruction each. Never edited: a newer note that says otherwise wins (client_note_links), and a person may remove one.';

create table if not exists public.client_note_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  point_id uuid not null references public.client_note_points(id) on delete cascade,
  other_id uuid not null references public.client_note_points(id) on delete cascade,
  relation text not null check (relation in ('same', 'conflict')),
  created_at timestamptz not null default now(),
  constraint client_note_links_one unique (point_id, other_id),
  constraint client_note_links_two_points check (point_id <> other_id)
);
create index if not exists client_note_links_client on public.client_note_links (client_id);
create index if not exists client_note_links_other on public.client_note_links (other_id);

comment on table public.client_note_links is 'Two points that say the same thing or disagree. Of the two, the one with the later date is in use; worked out at every read.';

alter table public.client_notes enable row level security;
alter table public.client_note_points enable row level security;
alter table public.client_note_links enable row level security;

drop policy if exists "Staff read client notes" on public.client_notes;
create policy "Staff read client notes" on public.client_notes
  for select to authenticated using (public.can_write_client(client_id));
drop policy if exists "Staff read client note points" on public.client_note_points;
create policy "Staff read client note points" on public.client_note_points
  for select to authenticated using (public.can_write_client(client_id));
drop policy if exists "Staff read client note links" on public.client_note_links;
create policy "Staff read client note links" on public.client_note_links
  for select to authenticated using (public.can_write_client(client_id));

revoke all on public.client_notes from public, anon;
revoke all on public.client_note_points from public, anon;
revoke all on public.client_note_links from public, anon;
grant select on public.client_notes to authenticated;
grant select on public.client_note_points to authenticated;
grant select on public.client_note_links to authenticated;
grant select, insert, update, delete on public.client_notes, public.client_note_points, public.client_note_links to service_role;

-- ── 2. The files ────────────────────────────────────────────────────────────

-- Its own private bucket: meeting notes are more sensitive than brand books,
-- which are opened by public URL elsewhere. Upserts need insert, update and
-- select; files are removed by the client-notes function only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-notes', 'client-notes', false, 20971520, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- The client is the path's first folder. A folder that is not a client id
-- is refused before the cast is tried.
drop policy if exists "Staff upload client notes" on storage.objects;
create policy "Staff upload client notes" on storage.objects for insert to authenticated
  with check (bucket_id = 'client-notes' and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.can_write_client(((storage.foldername(name))[1])::uuid) else false end);
drop policy if exists "Staff replace client notes" on storage.objects;
create policy "Staff replace client notes" on storage.objects for update to authenticated
  using (bucket_id = 'client-notes' and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.can_write_client(((storage.foldername(name))[1])::uuid) else false end)
  with check (bucket_id = 'client-notes' and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.can_write_client(((storage.foldername(name))[1])::uuid) else false end);
drop policy if exists "Staff read client notes files" on storage.objects;
create policy "Staff read client notes files" on storage.objects for select to authenticated
  using (bucket_id = 'client-notes' and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.can_write_client(((storage.foldername(name))[1])::uuid) else false end);

-- ── 3. The reading job ──────────────────────────────────────────────────────

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
  v_kinds := array(select distinct k from unnest(coalesce(v_kinds, '{}'::text[]) || array['notes_read']) as k order by k);
  alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_kind_check;
  execute format('alter table public.scheduled_jobs add constraint scheduled_jobs_kind_check check (kind = any (%L::text[]))', v_kinds);
end $$;

-- One reading job per client while queued or running: it reads every note
-- the client has waiting, one at a time, and asks to run again while any
-- is left.
create unique index if not exists scheduled_jobs_one_open_notes_read
  on public.scheduled_jobs (client_id)
  where kind = 'notes_read' and status in ('queued', 'running');

-- Queue the client's reading job, unless one is already queued or running.
create or replace function public.client_notes_queue_read(p_client uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into scheduled_jobs (kind, client_id, dedupe_key, priority, available_at)
  values ('notes_read', p_client, 'notes_read:' || p_client || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 35, now())
  on conflict do nothing;
end $$;

revoke all on function public.client_notes_queue_read(uuid) from public, anon, authenticated;
grant execute on function public.client_notes_queue_read(uuid) to service_role;

-- The daily repair sweep (run-scheduled-jobs, mode status): a note still
-- waiting to be read with no job on its way gets one. Returns how many
-- clients it queued.
create or replace function public.client_notes_queue_waiting()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
  v_count integer := 0;
begin
  for v_client in
    select distinct n.client_id
      from client_notes n
      join clients c on c.id = n.client_id
     where n.state = 'reading'
       and c.archived_at is null
       and not exists (select 1 from scheduled_jobs j
                        where j.kind = 'notes_read' and j.client_id = n.client_id and j.status in ('queued', 'running'))
  loop
    perform client_notes_queue_read(v_client);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function public.client_notes_queue_waiting() from public, anon, authenticated;
grant execute on function public.client_notes_queue_waiting() to service_role;

-- ── 4. A post scheduled to Sprout is a post someone worked on ───────────────

-- As in 20261019100000_calendar_plan_weeks.sql, plus the Sprout post that
-- names the calendar post (scheduled_posts.calendar_post_key, since
-- 20261019230000_setup_view.sql): copy changed while scheduling no longer
-- hides it. Nothing that writes copy on its own (a week's revision, the
-- rewrite the client notes ask for) touches a post this answers yes for.
create or replace function public.calendar_post_worked(p_client uuid, p_key text, p_platform text, p_copy text, p_touched timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (auth.role() = 'service_role' or is_moburst_staff() or is_client_member(p_client)) and (
    p_touched is not null
    or exists (select 1 from post_iterations pi where pi.client_id = p_client and pi.calendar_post_key = p_key)
    or exists (select 1 from design_requests dr where dr.client_id = p_client and dr.calendar_post_key = p_key and dr.status <> 'canceled')
    or exists (select 1 from scheduled_posts sp where sp.client_id = p_client and sp.calendar_post_key = p_key)
    or (coalesce(p_copy, '') <> '' and exists (
      select 1 from scheduled_posts sp
      where sp.client_id = p_client and lower(coalesce(sp.platform, '')) = lower(p_platform)
        and left(btrim(coalesce(sp.post_content, '')), 200) = left(btrim(p_copy), 200))));
$$;

revoke all on function public.calendar_post_worked(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.calendar_post_worked(uuid, text, text, text, timestamptz) to authenticated, service_role;
