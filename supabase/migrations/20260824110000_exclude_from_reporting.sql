-- Parity with AdVisor: separate "hidden in the UI" from "not billable".
--
-- archived_at means hide the client in the app; its delivered history still
-- counts. exclude_from_reporting means no billable work was ever delivered and
-- is the only thing the usage contract filters on.
--
-- Nothing is flagged yet. Socialytics has no obvious test rows, though
-- "Moburst" (18 reports, 73 posts) is Moburst's own brand rather than a client
-- and is likely internal — flag it only if that is the call.
alter table public.clients
  add column if not exists exclude_from_reporting boolean not null default false;

comment on column public.clients.exclude_from_reporting is
  'True only for internal/test accounts that were never billable. Distinct from archiving, which merely hides a client in the UI — archived real clients keep their delivered history in the usage contract.';
