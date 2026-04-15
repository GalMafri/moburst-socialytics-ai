-- Fabric.js canvas states for the in-app editor
create table if not exists public.design_states (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade not null,
  post_iteration_id uuid references public.post_iterations(id) on delete set null,
  canvas_json jsonb not null,
  thumbnail_url text,
  is_template boolean default false,
  template_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_design_states_client on public.design_states(client_id);

alter table public.design_states enable row level security;

create policy "Users can manage design states"
  on public.design_states for all using (true);
