-- Post iteration tracking for persistent memory
create table if not exists public.post_iterations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade not null,
  report_id uuid references public.reports(id) on delete set null,
  recommendation_index int,
  version int not null default 1,
  platform text,
  post_copy text,
  hashtags text[],
  cta text,
  concept text,
  visual_direction text,
  format text,
  source text default 'calendar' check (source in ('calendar', 'ad_hoc', 'regeneration')),
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

create index idx_post_iterations_client on public.post_iterations(client_id);
create index idx_post_iterations_report on public.post_iterations(report_id);

alter table public.post_iterations enable row level security;

create policy "Users can read post iterations for their clients"
  on public.post_iterations for select using (true);

create policy "Users can insert post iterations"
  on public.post_iterations for insert with check (true);
