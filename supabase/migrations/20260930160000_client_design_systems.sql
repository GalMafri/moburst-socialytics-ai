-- A client's design system as data: tokens, locked templates and the imagery
-- rule, built from its own posts and approved once. Every post is rendered
-- from the approved system. Fonts and logo assets live in brand-assets.
insert into storage.buckets (id, name, public) values ('brand-assets','brand-assets', true) on conflict (id) do nothing;
create table if not exists public.client_design_systems (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  system jsonb not null,
  previews jsonb not null default '[]'::jsonb,
  built_from jsonb not null default '[]'::jsonb,
  approved_by uuid, approved_at timestamptz,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_client_design_systems_client on public.client_design_systems (client_id, created_at desc);
alter table public.client_design_systems enable row level security;
create policy "Client members and staff can view design systems" on public.client_design_systems for select to authenticated using (can_access_client(client_id));
create policy "Moburst staff manage design systems" on public.client_design_systems for all to authenticated using (is_moburst_staff() and can_write_client(client_id)) with check (is_moburst_staff() and can_write_client(client_id));
