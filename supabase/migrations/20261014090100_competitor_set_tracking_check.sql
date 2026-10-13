-- The outcome of the last RivalIQ landscape check, kept on the set it was
-- made for.
--
-- run-report, the scheduled competitive dispatch and the competitor feed
-- refresh all run the shared check (_shared/competitive/landscapeCheck.ts)
-- before they spend anything. Until now the answer was used and dropped, so
-- the Competitors screen said "Tracking connected" for any set with a
-- rivaliq_landscape_id, even one whose landscape had been deleted. Each
-- check now writes what it found here, and the screen reads it without a
-- RivalIQ call of its own.
--
-- Shape: {"code": "ok" | "RIVALIQ_CLIENT_NOT_TRACKED" | "RIVALIQ_LANDSCAPE_MISSING",
--         "landscape_id": the set's linked id when checked, or null,
--         "message": text for staff, or null,
--         "checked_at": ISO timestamp}
-- A busy or unreachable provider is not recorded: it says nothing about the
-- landscape. The writers treat this column as optional, so code deployed
-- before this migration keeps working. Safe to apply twice.

alter table public.competitor_sets add column if not exists tracking_check jsonb;

comment on column public.competitor_sets.tracking_check is
  'Last RivalIQ landscape check for this set (landscapeCheck.ts): code, landscape_id, message, checked_at. Written by run-report, run-scheduled-jobs and the feed refresh.';
