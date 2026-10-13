-- One count of Canva calls per tool across every worker request (13 Oct).
-- Each design job now advances in its own request, so an in-memory pace no
-- longer sees the others. claim_rate_slot keeps a sliding one-minute window
-- per key: it records the call and returns 0 when there is room, or returns
-- how many milliseconds until there will be. Service role only.
-- Safe to apply twice.
create table if not exists public.rate_calls (
  key text not null,
  at timestamptz not null default clock_timestamp()
);
create index if not exists rate_calls_key_at on public.rate_calls (key, at);
alter table public.rate_calls enable row level security;

create or replace function public.claim_rate_slot(p_key text, p_limit integer, p_window_ms integer default 60000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  window_start timestamptz := clock_timestamp() - make_interval(secs => p_window_ms / 1000.0);
  used integer;
  oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('rate:' || p_key));
  delete from public.rate_calls where key = p_key and at < window_start;
  select count(*), min(at) into used, oldest from public.rate_calls where key = p_key;
  if used < p_limit then
    insert into public.rate_calls (key) values (p_key);
    return 0;
  end if;
  return greatest(25, ceil(extract(epoch from (oldest - window_start)) * 1000)::integer + 25);
end;
$$;

revoke all on function public.claim_rate_slot(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_rate_slot(text, integer, integer) to service_role;
