-- AI-learned brand voice preferences per client
create table if not exists public.brand_voice_learnings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade not null,
  pattern_type text not null,
  pattern_description text not null,
  confidence float default 0.5 check (confidence >= 0 and confidence <= 1),
  source_iterations int default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(client_id, pattern_type, pattern_description)
);

create index idx_brand_voice_learnings_client on public.brand_voice_learnings(client_id);

alter table public.brand_voice_learnings enable row level security;

create policy "Users can read brand voice learnings"
  on public.brand_voice_learnings for select using (true);

create policy "Service role can manage brand voice learnings"
  on public.brand_voice_learnings for all using (true);
