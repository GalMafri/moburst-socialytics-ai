-- A look waiting covers a request only when it runs at or after it (9 Nov 2026).
--
-- 20261110160000_lifecycle_looks.sql let a queued look cover any request in
-- the same minute. A look queued for 06:14:03 UTC covered BetterBee's request
-- for 06:14:41 (its content strategy, one minute after a phase), ran 24
-- seconds before the step was due, and the strategy waited a day for the next
-- look.
--
-- A queued look now covers a request when it runs no earlier than the request
-- and less than a minute after it, or, for a request due now, when it is
-- already due (as before: it has not started, so it runs after now). Any
-- other request queues its own look. Two looks at once stay harmless: a step
-- is claimed before its job exists.

create or replace function public.lifecycle_enqueue(p_client uuid, p_priority smallint default 30, p_at timestamptz default now())
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_at timestamptz := coalesce(p_at, now());
  v_minute timestamptz := date_trunc('minute', coalesce(p_at, now()));
begin
  if not exists (select 1 from clients where id = p_client and archived_at is null) then return; end if;
  -- One request per client at a time decides, so two never both queue.
  perform pg_advisory_xact_lock(hashtextextended('lifecycle_look:' || p_client::text, 0));
  if exists (
    select 1 from scheduled_jobs
     where kind = 'lifecycle' and client_id = p_client and status = 'queued'
       and ((available_at >= v_at and available_at < v_at + interval '1 minute')
            or (v_at <= now() and available_at <= now()))
  ) then
    return;
  end if;
  insert into scheduled_jobs (kind, client_id, dedupe_key, priority, available_at)
  values ('lifecycle', p_client,
          'lifecycle:' || p_client || ':' || to_char(v_minute at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') || ':' || gen_random_uuid(),
          coalesce(p_priority, 30), v_at);
end $$;

revoke all on function public.lifecycle_enqueue(uuid, smallint, timestamptz) from public, anon, authenticated;
grant execute on function public.lifecycle_enqueue(uuid, smallint, timestamptz) to service_role;
