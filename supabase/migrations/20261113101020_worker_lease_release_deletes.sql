-- A released worker lease leaves no row behind. release_worker_lease only
-- cleared the holder, so every request's 'settle:<id>' and every client's
-- 'plan:<id>' kept a row in worker_leases for good. The row is made again by
-- the next claim (claim_worker_lease inserts it when it is missing), so
-- deleting it loses nothing. Only the holder's own row is deleted; a lease
-- another pass took over is left alone.
--
-- A claim is one statement. It used to insert the row and then update it, and
-- a release that deleted the row between the two made the update find nothing,
-- so a pass that should have run right after a release was skipped once.
create or replace function public.claim_worker_lease(p_name text, p_holder uuid, p_seconds int)
returns boolean language sql security definer set search_path = public as $$
  with claimed as (
    insert into public.worker_leases as w (name, holder, lease_until)
    values (p_name, p_holder, now() + make_interval(secs => p_seconds))
    on conflict (name) do update
      set holder = excluded.holder, lease_until = excluded.lease_until
      where w.lease_until is null or w.lease_until < now() or w.holder = excluded.holder
    returning true as ok
  )
  select coalesce((select ok from claimed), false);
$$;

create or replace function public.release_worker_lease(p_name text, p_holder uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.worker_leases where name = p_name and holder = p_holder;
$$;

-- The rows already left behind by earlier releases (no holder, no lease).
delete from public.worker_leases where holder is null and (lease_until is null or lease_until < now());
