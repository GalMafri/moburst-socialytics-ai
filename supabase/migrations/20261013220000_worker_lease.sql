-- The design worker runs as one pass at a time and starts its next pass itself
-- as soon as one ends, instead of waiting for the minute timer.
--
-- The timer's calls go out through pg_net, which sends a batch of requests and
-- waits for the slowest before sending the next. Other scheduled jobs in the
-- same batch take up to 150 s, so on 13 Oct the worker ran every 2 to 4
-- minutes and a carousel took about twice its usual time. The timer stays as
-- the fallback that restarts the worker if a pass ever fails to start the next.

create table if not exists public.worker_leases (
  name text primary key,
  holder uuid,
  lease_until timestamptz
);
alter table public.worker_leases enable row level security;
revoke all on public.worker_leases from anon, authenticated;

-- Claim the named worker for this pass; false while another pass holds it.
create or replace function public.claim_worker_lease(p_name text, p_holder uuid, p_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  insert into public.worker_leases (name) values (p_name) on conflict (name) do nothing;
  update public.worker_leases
     set holder = p_holder, lease_until = now() + make_interval(secs => p_seconds)
   where name = p_name and (lease_until is null or lease_until < now() or holder = p_holder)
  returning true into ok;
  return coalesce(ok, false);
end $$;

create or replace function public.release_worker_lease(p_name text, p_holder uuid)
returns void language sql security definer set search_path = public as $$
  update public.worker_leases set holder = null, lease_until = null where name = p_name and holder = p_holder;
$$;

revoke all on function public.claim_worker_lease(text, uuid, int) from public, anon, authenticated;
revoke all on function public.release_worker_lease(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_worker_lease(text, uuid, int) to service_role;
grant execute on function public.release_worker_lease(text, uuid) to service_role;

comment on table public.worker_leases is 'One row per self-scheduling worker: which pass holds it and until when.';
