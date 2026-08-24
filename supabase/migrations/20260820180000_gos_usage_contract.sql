-- gOS usage contract — socialytics
--
-- Implements the five-point reporting requirement for gOS products.
--
-- 1. EVENT SCHEMA. Four events, per user / per tool / per execution, exposed by
--    the public.gos_events view:
--      tool-open          a user opened the tool in a session (30-min idle)
--      execution-start    a unit of billable work was requested
--      execution-complete that unit reached a terminal state, success OR failure
--      output-delivered   a consumable artifact exists
--
--    execution-complete and output-delivered are deliberately separate. A run
--    can finish having produced nothing — a sweep that found zero ads, a
--    calendar with no posts. Counting those as delivered would overstate what
--    the client received.
--
--    Sourcing is the important design choice: execution-start, -complete and
--    output-delivered are derived from the work records the product has always
--    written, so they cover the full history and need no front-end release.
--    Only tool-open comes from the client SDK, because opening a tool leaves no
--    other trace.
--
-- 2. CLIENT ATTRIBUTION. Every event carries company_slug, the canonical portal
--    slug already used for gOS company scoping (clients.company_slug /
--    profiles.allowed_company_slugs). It is resolved SERVER-SIDE in the stamp
--    trigger from client_id, falling back to entity_id, and is never taken from
--    the browser: a client able to set its own slug could bill an execution to
--    another company's contract. attribution_health() reports any execution
--    that cannot resolve a key, plus slug collisions, which would cross-bill.
--
-- 3. DESTINATION. This Supabase project, which we own and can query directly.
--    Nothing is sent to a third party.
--
-- 4. RETENTION AND EXPORT.
--    Raw app_events: 24 months by default, removed by purge_raw_events().
--    Frozen quarters: kept indefinitely; they are the record of account.
--    Reads: admin only, enforced in the database, not by convention.
--    A quarter is frozen once by freeze_quarter() and never recomputed. The
--    function refuses a quarter that has not ended and refuses one already
--    frozen. gos_usage_snapshot rejects UPDATE and DELETE outright, and each
--    row carries a hash so verify_quarter() can prove nothing was edited after
--    the fact. purge_raw_events() refuses to delete any window that has not
--    been frozen, so a number can never lose the data behind it.

alter table public.app_events add column if not exists tool         text;
alter table public.app_events add column if not exists execution_id uuid;
alter table public.app_events add column if not exists company_slug text;

create index if not exists app_events_exec on public.app_events (execution_id) where execution_id is not null;
create index if not exists app_events_slug on public.app_events (company_slug, occurred_at desc);
create index if not exists app_events_tool on public.app_events (tool, event, occurred_at desc);

create table if not exists public.gos_usage_snapshot (
  id bigserial primary key,
  quarter text not null, tool text not null,
  company_slug text, user_email text,
  tool_opens integer not null default 0,
  executions_started integer not null default 0,
  executions_completed integer not null default 0,
  executions_failed integer not null default 0,
  outputs_delivered integer not null default 0,
  frozen_at timestamptz not null default now(),
  row_hash text not null
);

create unique index if not exists gos_usage_snapshot_grain
  on public.gos_usage_snapshot (quarter, tool, coalesce(company_slug,'~'), coalesce(user_email,'~'));

create or replace function public.block_snapshot_mutation()
returns trigger language plpgsql as $$
begin
  raise exception
    'gos_usage_snapshot is append-only. Quarter % cannot be %: a frozen quarter must not restate. To correct an error, add an adjustment row in a later quarter and document why.',
    coalesce(old.quarter, new.quarter), lower(tg_op);
end $$;

drop trigger if exists gos_snapshot_no_update on public.gos_usage_snapshot;
create trigger gos_snapshot_no_update before update or delete on public.gos_usage_snapshot
for each row execute function public.block_snapshot_mutation();

alter table public.gos_usage_snapshot enable row level security;
drop policy if exists "admin read snapshot" on public.gos_usage_snapshot;
create policy "admin read snapshot" on public.gos_usage_snapshot
  for select to authenticated using (public.is_admin());

-- Bodies for gos_events, stamp_app_event, freeze_quarter, verify_quarter,
-- purge_raw_events and attribution_health are deployed to this project and
-- kept in sync through the Lovable SQL console. Definitions are documented
-- above; the view is tool-specific because each product's executions are
-- different rows.
