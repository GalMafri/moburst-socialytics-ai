-- What to film or record for a video post that is filmed rather than generated.
-- Moburst staff and admins only (Lital, 14 Oct): clients never read these.
create table if not exists public.design_shot_briefs (
  request_id uuid primary key references public.design_requests(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  calendar_post_key text not null,
  brief jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists design_shot_briefs_post on public.design_shot_briefs (client_id, calendar_post_key);
alter table public.design_shot_briefs enable row level security;
drop policy if exists "Staff read shot briefs" on public.design_shot_briefs;
create policy "Staff read shot briefs" on public.design_shot_briefs for select using (public.is_moburst_staff());
