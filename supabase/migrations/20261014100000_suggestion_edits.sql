-- Staff can edit a competitive report's suggested tests, by hand or by
-- rewriting one with their feedback (Lital, 13 Oct). The edit is kept on the
-- suggestion's existing feedback row, keyed by the original suggestion, so a
-- verdict and an edit live together and every reader (report page, PDF,
-- monthly report context, content briefs) shows the edited version.
--
-- A row may now carry an edit without a verdict, so verdict becomes optional.
-- Safe to apply twice.

alter table public.competitive_insight_feedback alter column verdict drop not null;
alter table public.competitive_insight_feedback drop constraint if exists competitive_insight_feedback_verdict_check;
alter table public.competitive_insight_feedback add constraint competitive_insight_feedback_verdict_check
  check (verdict is null or verdict = any (array['up'::text, 'down'::text]));

alter table public.competitive_insight_feedback add column if not exists edited jsonb;
alter table public.competitive_insight_feedback add column if not exists edit_feedback text;
alter table public.competitive_insight_feedback add column if not exists edited_at timestamptz;
alter table public.competitive_insight_feedback add column if not exists edited_by uuid references auth.users(id);

comment on column public.competitive_insight_feedback.edited is
  'Staff edit of the suggestion: {gap, why_it_matters, suggested_play}. Shown instead of the original everywhere.';
comment on column public.competitive_insight_feedback.edit_feedback is
  'The feedback the last rewrite was made from, if it was rewritten rather than edited by hand.';

-- What the team's edits teach about a client's suggestions (Lital, 13 Oct:
-- "the app learns preferences for that client into its memory"). Each saved
-- edit is turned into one or two standing preferences, which the next
-- competitive run, later rewrites, the monthly report context and content
-- briefs all follow. Staff see the list and can remove a preference.
create table if not exists public.competitive_learnings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null default 'prefer' check (kind in ('prefer', 'avoid')),
  text text not null check (char_length(text) between 3 and 240),
  source_insight_key text,
  source_feedback text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists competitive_learnings_client_idx on public.competitive_learnings (client_id, created_at desc);
create unique index if not exists competitive_learnings_client_text_key on public.competitive_learnings (client_id, lower(text));
alter table public.competitive_learnings enable row level security;
drop policy if exists "Staff can read competitive_learnings" on public.competitive_learnings;
create policy "Staff can read competitive_learnings" on public.competitive_learnings for select using (can_write_client(client_id));
drop policy if exists "Staff can delete competitive_learnings" on public.competitive_learnings;
create policy "Staff can delete competitive_learnings" on public.competitive_learnings for delete using (can_write_client(client_id));
-- Rows are written by the revise-suggestion function (service role) only.
