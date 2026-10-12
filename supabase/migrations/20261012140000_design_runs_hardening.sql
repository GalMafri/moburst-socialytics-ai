-- Hardening after the first live week of design runs (2026-10-12).
--
-- 1. A run is owned by the worker that leased it: lease_token is set on lease and
--    required on extend, finish and option writes, so a run picked up twice
--    (a turn that outlasted its lease) can only be finished by its current owner.
-- 2. A client may queue a run but never shape it: an insert trigger resets the
--    worker-owned columns to server defaults, caps the copy, refuses a second
--    run while one is queued or running for the same post and format, and caps
--    runs per client per day.
-- 3. Options and rules are read-only for signed-in users; every change goes
--    through design-pick (service role).

alter table public.design_runs add column if not exists lease_token uuid;

-- 1. ownership -----------------------------------------------------------------
create or replace function public.design_runs_lease(p_lease_seconds integer default 900)
returns setof public.design_runs
language sql security definer set search_path = public as $$
  update public.design_runs r
     set status = 'running',
         attempts = r.attempts + 1,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         lease_token = gen_random_uuid(),
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

drop function if exists public.design_runs_extend(uuid, integer);
create or replace function public.design_runs_extend(p_run_id uuid, p_token uuid, p_lease_seconds integer default 900)
returns boolean language sql security definer set search_path = public as $$
  with u as (
    update public.design_runs set lease_until = now() + make_interval(secs => p_lease_seconds)
     where id = p_run_id and status = 'running' and lease_token is not distinct from p_token and p_token is not null
    returning id)
  select exists (select 1 from u);
$$;
revoke all on function public.design_runs_extend(uuid, uuid, integer) from public, anon, authenticated;

create or replace function public.design_runs_finish(p_run_id uuid, p_token uuid, p_status text, p_spent jsonb, p_sizes jsonb, p_failure text, p_plan jsonb)
returns boolean language sql security definer set search_path = public as $$
  with u as (
    update public.design_runs
       set status = p_status, spent = coalesce(p_spent, '{}'::jsonb), sizes = coalesce(p_sizes, '[]'::jsonb), failure = p_failure,
           plan = coalesce(p_plan, plan), finished_at = now(), lease_until = null, lease_token = null
     where id = p_run_id and status = 'running' and lease_token is not distinct from p_token and p_token is not null
    returning id)
  select exists (select 1 from u);
$$;
revoke all on function public.design_runs_finish(uuid, uuid, text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;

-- an option is written once per run and key; a second owner's write is a conflict, not a duplicate
create unique index if not exists design_options_run_key on public.design_options (run_id, option_key);

-- 2. what a client may set --------------------------------------------------------
create or replace function public.design_runs_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_open integer;
  v_today integer;
begin
  -- the worker-owned columns always start at the server defaults
  new.status := 'queued';
  new.budget := '{"max_turns": 24, "max_usd": 6, "max_credits": 30}'::jsonb;
  new.spent := '{}'::jsonb;
  new.plan := '{}'::jsonb;
  new.sizes := '[]'::jsonb;
  new.attempts := 0;
  new.lease_until := null;
  new.lease_token := null;
  new.failure := null;
  new.started_at := null;
  new.finished_at := null;
  new.copy := left(coalesce(new.copy, ''), 4000);
  if length(trim(new.copy)) = 0 then
    raise exception 'A design run needs the post copy.' using errcode = 'check_violation';
  end if;
  if new.platform is null or length(new.platform) > 40 or new.format is null or length(new.format) > 40 then
    raise exception 'A design run needs a platform and a format.' using errcode = 'check_violation';
  end if;
  select count(*) into v_open from public.design_runs
   where client_id = new.client_id and post_key = new.post_key and format = new.format and status in ('queued', 'running');
  if v_open > 0 then
    raise exception 'A % run is already in progress for this post.', new.format using errcode = 'unique_violation';
  end if;
  select count(*) into v_today from public.design_runs where client_id = new.client_id and created_at > now() - interval '1 day';
  if v_today >= 60 then
    raise exception 'This client has reached today''s limit of design runs.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists design_runs_before_insert on public.design_runs;
create trigger design_runs_before_insert before insert on public.design_runs
  for each row execute function public.design_runs_before_insert();

-- 3. options and rules are the server's to change ----------------------------------
revoke update on public.design_options from authenticated;
revoke update on public.design_rules from authenticated;
drop policy if exists "Client members and staff can pick design options" on public.design_options;
drop policy if exists "Client members and staff can retire design rules" on public.design_rules;
