-- A look at a client is never lost (3 Nov 2026).
--
-- A lifecycle look was one job per client per minute: dedupe_key
-- 'lifecycle:<client>:<minute>', unique over every job, finished ones
-- included. A step that finished in the same minute as a look that had
-- already run asked for the next look and got nothing, so the steps after
-- it waited for the weekly look (Yangra, 3 Nov 11:51 UTC: brand_read done
-- 9 seconds after the look that left brief_pillars waiting for it).
--
-- lifecycle_enqueue(p_client, p_priority, p_at) is now the one way a look is
-- asked for: the triggers and the daily tick as before (p_at now), and the
-- lifecycle runner after a step (_shared/lifecycle/run.ts queueLook, p_at now
-- or when a wait ends). A look that has not started yet reads the client when
-- it runs, so a request is skipped only when such a look covers it: one
-- queued for the same minute, or, for a request due now, one already due.
-- Otherwise a new look is queued. Two looks at once are harmless: a step is
-- claimed before its job exists.

drop function if exists public.lifecycle_enqueue(uuid, smallint);

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
       and (date_trunc('minute', available_at) = v_minute
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
