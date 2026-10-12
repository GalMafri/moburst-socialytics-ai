-- The design engine's runs, options and rules, and the authorization helper that
-- lets a client's own members act for their client.
-- Spec: docs/superpowers/specs/2026-10-08-design-engine-design.md, sections 11, 12 and 14.

-- True for staff with write access to the client and for a client-role member of it.
create or replace function public.can_act_for_client(_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_write_client(_client_id) or public.is_client_member(_client_id)
$$;
comment on function public.can_act_for_client(uuid) is
  'Staff with write access, or a member of the client itself: who may create design runs, pick options and schedule the client''s posts.';

create table if not exists public.design_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  post_key text not null,                       -- the calendar post this run designs (CalendarPost._calendarPostKey)
  report_id uuid references public.reports(id) on delete set null,
  platform text not null,
  format text not null default 'Single Image',   -- Single Image | Carousel | Story | Video
  copy text not null,
  pillar text,
  sizes jsonb not null default '[]'::jsonb,     -- [{name, w, h}] the worker built
  status text not null default 'queued' check (status in ('queued', 'running', 'offered', 'picked', 'failed', 'dropped')),
  lease_until timestamptz,
  attempts integer not null default 0,
  budget jsonb not null default '{"max_turns": 24, "max_usd": 6, "max_credits": 30}'::jsonb,
  spent jsonb not null default '{}'::jsonb,     -- {usd, credits, turns, ended, model_calls}
  plan jsonb not null default '{}'::jsonb,      -- the worker's progress notes for the panel
  failure text,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists design_runs_client_post on public.design_runs (client_id, post_key, created_at desc);
create index if not exists design_runs_queue on public.design_runs (status, created_at) where status in ('queued', 'running');

create table if not exists public.design_options (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.design_runs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  option_key text not null,                     -- the run's own id for the option (A, B, K.1 ...)
  rank integer,
  kind text not null default 'static' check (kind in ('static', 'carousel', 'slide')),
  parent_key text,                              -- a slide's carousel
  slide_role text,
  family_key text,
  arrangement text,
  files jsonb not null default '{}'::jsonb,     -- {size_name: {path, url, w, h}} in the generated-media bucket
  picture_jobs jsonb not null default '[]'::jsonb,
  measurements jsonb not null default '{}'::jsonb,
  status text not null default 'offered' check (status in ('offered', 'picked', 'rejected')),
  rejection_note text,
  picked_iteration_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists design_options_run on public.design_options (run_id, rank);
create index if not exists design_options_client on public.design_options (client_id, created_at desc);

create table if not exists public.design_rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  text text not null,
  source_option_id uuid references public.design_options(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
create index if not exists design_rules_client on public.design_rules (client_id, status);

create table if not exists public.platform_specs (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  placement text not null,
  spec jsonb not null,
  source_url text,
  fetched_at timestamptz not null default now(),
  snapshot_sha text,
  previous_id uuid references public.platform_specs(id)
);
create index if not exists platform_specs_platform on public.platform_specs (platform, placement, fetched_at desc);

alter table public.design_runs enable row level security;
alter table public.design_options enable row level security;
alter table public.design_rules enable row level security;
alter table public.platform_specs enable row level security;

revoke all on public.design_runs, public.design_options, public.design_rules, public.platform_specs from public, anon, authenticated;
grant select, insert on public.design_runs to authenticated;
grant select, update on public.design_options to authenticated;
grant select, update on public.design_rules to authenticated;
grant select on public.platform_specs to authenticated;
grant select, insert, update, delete on public.design_runs, public.design_options, public.design_rules, public.platform_specs to service_role;

-- Reads: the client's members and staff. Writes: a member or writing staff may queue
-- a run and may pick or reject an option; everything else is the worker's.
drop policy if exists "Client members and staff can view design runs" on public.design_runs;
create policy "Client members and staff can view design runs" on public.design_runs
  for select to authenticated using (public.can_access_client(client_id));
drop policy if exists "Client members and staff can queue design runs" on public.design_runs;
create policy "Client members and staff can queue design runs" on public.design_runs
  for insert to authenticated with check (public.can_act_for_client(client_id) and status = 'queued' and created_by = auth.uid());

drop policy if exists "Client members and staff can view design options" on public.design_options;
create policy "Client members and staff can view design options" on public.design_options
  for select to authenticated using (public.can_access_client(client_id));
drop policy if exists "Client members and staff can pick design options" on public.design_options;
create policy "Client members and staff can pick design options" on public.design_options
  for update to authenticated using (public.can_act_for_client(client_id)) with check (public.can_act_for_client(client_id));

drop policy if exists "Client members and staff can view design rules" on public.design_rules;
create policy "Client members and staff can view design rules" on public.design_rules
  for select to authenticated using (public.can_access_client(client_id));
drop policy if exists "Client members and staff can retire design rules" on public.design_rules;
create policy "Client members and staff can retire design rules" on public.design_rules
  for update to authenticated using (public.can_act_for_client(client_id)) with check (public.can_act_for_client(client_id));

drop policy if exists "Anyone signed in can read platform specs" on public.platform_specs;
create policy "Anyone signed in can read platform specs" on public.platform_specs
  for select to authenticated using (true);

-- Restrictive client-scope guards, as on the other client tables; writes here are a member's or writing staff's.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['design_runs', 'design_options', 'design_rules'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Enforce client scope" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Enforce client scope" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.can_access_client(client_id)) WITH CHECK (public.can_act_for_client(client_id))', t);
  END LOOP;
END $$;

-- The worker's lease: the next queued run, or a running one whose worker died.
create or replace function public.design_runs_lease(p_lease_seconds integer default 900)
returns setof public.design_runs
language sql security definer set search_path = public as $$
  update public.design_runs r
     set status = 'running',
         attempts = r.attempts + 1,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(r.started_at, now())
   where r.id = (
     select id from public.design_runs
      where status = 'queued'
         or (status = 'running' and lease_until < now() and attempts < 3)
      order by created_at
      limit 1
      for update skip locked)
  returning r.*;
$$;
revoke all on function public.design_runs_lease(integer) from public, anon, authenticated;

-- What the n8n check reads: counts by status and the runs that need a person.
create or replace function public.design_runs_status()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'queued', (select count(*) from public.design_runs where status = 'queued'),
    'running', (select count(*) from public.design_runs where status = 'running'),
    'stuck', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'client_id', client_id, 'post_key', post_key)), '[]'::jsonb)
                from public.design_runs where status = 'running' and lease_until < now()),
    'failed_today', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'client_id', client_id, 'failure', failure)), '[]'::jsonb)
                from public.design_runs where status = 'failed' and finished_at > now() - interval '1 day'))
$$;
revoke all on function public.design_runs_status() from public, anon, authenticated;

-- Client members schedule their own client's posts: the policy change is in
-- schedule-sprout-post (can_act_for_client in place of requireStaff's write check).

-- The worker's heartbeat: a long run extends its lease.
create or replace function public.design_runs_extend(p_run_id uuid, p_lease_seconds integer default 900)
returns void language sql security definer set search_path = public as $$
  update public.design_runs set lease_until = now() + make_interval(secs => p_lease_seconds) where id = p_run_id and status = 'running';
$$;
revoke all on function public.design_runs_extend(uuid, integer) from public, anon, authenticated;
