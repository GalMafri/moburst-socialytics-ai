-- The gOS usage push (supabase/functions/gos-usage-push): sends the events of
-- public.gos_events to the gOS Auth Service, POST {AUTH_SERVICE_URL}/usage/events
-- (gOS Auth / API Integration Guide §15). Additive and safe to apply twice.
--
-- gos_usage_outbox      one row per event the Auth Service answered for, keyed
--                       by the event_id sent (the guide's idempotency key). A
--                       row exists only after an answer, so an outage loses
--                       nothing: the next run sends the same events again.
-- gos_usage_push_state  one row: the last run's result, and the fingerprint of a
--                       token the Auth Service refused (401/403), so the push
--                       stops retrying a bad token until it is replaced.
-- gos_usage_pending()   the gos_events rows not yet in the outbox, oldest first.
--                       tool-open is never sent: the Auth Service records it.
--                       gos_events does not filter test clients here, so this
--                       function leaves out every report of a client marked
--                       exclude_from_reporting: their work is never sent.

create table if not exists public.gos_usage_outbox (
  event_id      text primary key,
  source_event  text not null,
  execution_id  text not null,
  event_name    text not null check (event_name in ('execution_start', 'execution_complete', 'output_delivered')),
  occurred_at   timestamptz not null,
  company_slug  text,
  status        text not null check (status in ('sent', 'duplicate', 'rejected')),
  reject_reason text,
  payload       jsonb not null,
  sent_at       timestamptz not null default now()
);

create unique index if not exists gos_usage_outbox_source
  on public.gos_usage_outbox (source_event, execution_id);
create index if not exists gos_usage_outbox_sent_at on public.gos_usage_outbox (sent_at desc);

comment on table public.gos_usage_outbox is
  'Usage events answered by the gOS Auth Service (POST /usage/events). Written by gos-usage-push after each answered batch; status rejected keeps the reason the service gave.';

create table if not exists public.gos_usage_push_state (
  id               integer primary key default 1 check (id = 1),
  blocked_token_fp text,
  blocked_reason   text,
  blocked_at       timestamptz,
  last_run_at      timestamptz,
  last_result      jsonb
);

alter table public.gos_usage_outbox enable row level security;
alter table public.gos_usage_push_state enable row level security;
grant select on public.gos_usage_outbox, public.gos_usage_push_state to authenticated;
grant all on public.gos_usage_outbox, public.gos_usage_push_state to service_role;
revoke all on public.gos_usage_outbox, public.gos_usage_push_state from anon;
drop policy if exists "admin read gos usage outbox" on public.gos_usage_outbox;
create policy "admin read gos usage outbox" on public.gos_usage_outbox
  for select to authenticated using (public.is_admin());
drop policy if exists "admin read gos usage push state" on public.gos_usage_push_state;
create policy "admin read gos usage push state" on public.gos_usage_push_state
  for select to authenticated using (public.is_admin());

-- The Claude connector's OAuth sessions never write here (supabase/tests/mcp/schema-guards.test.ts).
drop policy if exists "OAuth sessions cannot insert" on public.gos_usage_outbox;
create policy "OAuth sessions cannot insert" on public.gos_usage_outbox as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.gos_usage_outbox;
create policy "OAuth sessions cannot update" on public.gos_usage_outbox as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.gos_usage_outbox;
create policy "OAuth sessions cannot delete" on public.gos_usage_outbox as restrictive for delete to authenticated using (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot insert" on public.gos_usage_push_state;
create policy "OAuth sessions cannot insert" on public.gos_usage_push_state as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.gos_usage_push_state;
create policy "OAuth sessions cannot update" on public.gos_usage_push_state as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.gos_usage_push_state;
create policy "OAuth sessions cannot delete" on public.gos_usage_push_state as restrictive for delete to authenticated using (not (select public.is_oauth_session()));

-- Executions are reports (kind content_calendar), the only rows gos_events has.
-- via_api:      the report was made for a demo job started through the API.
-- via_schedule: null: a report with no person and no API caller came from a
--               report schedule (the function's default machine actor).
create or replace function public.gos_usage_pending(p_since timestamptz, p_limit integer default 2000)
returns table (
  occurred_at  timestamptz,
  event        text,
  execution_id text,
  user_email   text,
  company_slug text,
  duration_ms  integer,
  ok           boolean,
  props        jsonb,
  via_api      boolean,
  via_schedule boolean
)
language sql stable security definer set search_path = public
as $$
  select g.occurred_at, g.event, g.execution_id::text, g.user_email, g.company_slug,
         g.duration_ms::integer, g.ok, g.props,
         r.demo_job_id is not null as via_api,
         null::boolean as via_schedule
    from public.gos_events g
    join public.reports r on r.id::text = g.execution_id::text
    left join public.clients c on c.id = r.client_id
   where g.event in ('execution-start', 'execution-complete', 'output-delivered')
     and g.execution_id is not null
     and g.occurred_at >= p_since
     and not coalesce(c.exclude_from_reporting, false)
     and not exists (select 1 from public.gos_usage_outbox o
                      where o.source_event = g.event and o.execution_id = g.execution_id::text)
   order by g.occurred_at, g.execution_id::text,
            case g.event when 'execution-start' then 0 when 'execution-complete' then 1 else 2 end
   limit greatest(1, least(coalesce(p_limit, 2000), 5000))
$$;

revoke all on function public.gos_usage_pending(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.gos_usage_pending(timestamptz, integer) to service_role;
