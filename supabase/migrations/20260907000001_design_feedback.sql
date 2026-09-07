-- Design feedback: reject or archive a generated variant, and learn from the rejections.
--
-- Applied to the live database on 2026-09-07 via Lovable (this file mirrors it).
-- Rejecting a design hides it and records why; record-design-feedback turns the
-- reason into one or two "avoid"/"prefer" learnings that generate-post-image and
-- generate-post-video read back into every later prompt for that client.
-- Archiving hides without teaching. Staff only, like approval.

alter table public.post_iterations
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists rejection_note text,
  add column if not exists archived_at timestamptz;

create table if not exists public.design_learnings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  pattern_type text not null check (pattern_type in ('avoid','prefer')),
  pattern_description text not null,
  confidence numeric not null default 0.6 check (confidence >= 0 and confidence <= 1),
  source_iteration_id uuid references public.post_iterations(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
alter table public.design_learnings enable row level security;
create policy "Client members and staff can view design_learnings" on public.design_learnings
  for select to authenticated using (public.can_access_client(client_id));
create policy "Moburst staff can manage design_learnings" on public.design_learnings
  for all to authenticated using (public.is_moburst_staff()) with check (public.is_moburst_staff());
create index if not exists design_learnings_client_idx on public.design_learnings (client_id, created_at desc);
