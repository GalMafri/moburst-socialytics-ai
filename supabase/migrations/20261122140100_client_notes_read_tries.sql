-- Client notes: a note that is never read stops blocking the client's later
-- notes, and a note that could not be read says why.
--
-- QA 22 Nov 2026 (P41-01, P41-06):
--   * read_tries: runs that began reading the note's current part. The
--     notes_read job (_shared/notes/run.ts) counts a try before each reading
--     call and clears it when a part is read; past NOTE_READ_MAX_TRIES the
--     note is finished, so the next note is read. Notes are read oldest first,
--     and before this one note the model never read kept every later note
--     Reading for good.
--   * unread_reason: why a finished note was not read (a file that could not
--     be opened, an image too large, a note given up after its tries), in
--     plain words for the Client notes screen. Null when the note was read.
--
-- Additive and safe to apply twice. Apply before the code that reads them.

alter table public.client_notes add column if not exists read_tries integer not null default 0;
alter table public.client_notes add column if not exists unread_reason text;

comment on column public.client_notes.read_tries is 'Runs of the notes_read job that began reading the current part; cleared when a part is read. Past the cap in _shared/notes/run.ts the note is finished with unread_reason.';
comment on column public.client_notes.unread_reason is 'Why the note was finished without being read, in plain words for the screen; null when it was read.';
