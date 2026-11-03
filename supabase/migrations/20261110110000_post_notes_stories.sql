-- Notes on regenerate, and Stories you can find (Lital, 3 Nov 2026).
-- Design: docs/superpowers/specs/2026-11-03-post-notes-stories-design.md
--
-- A person can leave a note when they regenerate a post's copy or its design.
-- The note is used for that regeneration; the app decides whether it is also
-- a lasting preference for the brand, and the post shows what was learned with
-- Undo.
--
--   1. design_requests.note: the note a design was asked for with, read by
--      its planner and its design jobs; note_learned: what the brand's design
--      memory learned from it (written by design-request).
--   2. design_learnings.source and evidence: where a design rule came from
--      ("feedback" for Not right, "regenerate_note" for a note) and the words
--      it was learned from, for Client setup > Designs.
--   3. brand_voice_learnings may now come from a rewrite note.
--
-- Stories need no column: calendar_posts.story_of exists
-- (20261109140000_stories.sql).
--
-- Additive and safe to run twice. No new table and no new function: every
-- write goes through design-request and calendar-posts with the service role
-- after a membership check, and the columns take their tables' existing row
-- level security, including the restrictive "OAuth sessions cannot ..."
-- policies of 20261109120000_claude_connector.sql.

-- ── 1. The note on a design request ─────────────────────────────────────────

alter table public.design_requests add column if not exists note text;
alter table public.design_requests add column if not exists note_learned jsonb;

alter table public.design_requests drop constraint if exists design_requests_note_length;
alter table public.design_requests add constraint design_requests_note_length check (note is null or char_length(note) <= 500);

comment on column public.design_requests.note is
  'What the person who asked for this design wrote when they pressed Regenerate (or Not right with a new design). Every option follows it.';
comment on column public.design_requests.note_learned is
  'What the brand''s design memory learned from the note: {"rules":[{"id","type","text"}]} (an empty list: used for this design only), with undone_at once someone pressed Undo. Null while nothing was learned yet.';

-- ── 2. Where a design rule came from ────────────────────────────────────────

alter table public.design_learnings add column if not exists source text not null default 'feedback';
alter table public.design_learnings add column if not exists evidence text;

alter table public.design_learnings drop constraint if exists design_learnings_source_check;
alter table public.design_learnings add constraint design_learnings_source_check check (source in ('feedback', 'regenerate_note'));

comment on column public.design_learnings.source is
  'feedback: learned from a design turned down with Not right; regenerate_note: learned from a note left on Regenerate.';
comment on column public.design_learnings.evidence is
  'The words the rule was learned from (the note), shortened.';

-- ── 3. A writing preference learned from a rewrite note ─────────────────────

alter table public.brand_voice_learnings drop constraint if exists brand_voice_learnings_source_check;
alter table public.brand_voice_learnings add constraint brand_voice_learnings_source_check
  check (source in ('copy_edit', 'revise_note', 'rewrite_note'));

-- ── Grants, restated ────────────────────────────────────────────────────────

-- design_requests: read by the client's members and staff, written only by the functions.
revoke all on public.design_requests from anon, authenticated;
grant select on public.design_requests to authenticated;
grant all on public.design_requests to service_role;

-- design_learnings and brand_voice_learnings: staff remove a rule or a preference in Client setup (their policies decide who).
revoke all on public.design_learnings from anon;
grant select, insert, update, delete on public.design_learnings to authenticated;
grant all on public.design_learnings to service_role;

revoke all on public.brand_voice_learnings from anon;
grant select, insert, update, delete on public.brand_voice_learnings to authenticated;
grant all on public.brand_voice_learnings to service_role;
