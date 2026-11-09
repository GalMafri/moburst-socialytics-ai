-- Trends plan Task 18: drop clients.trends_keywords.
-- Plan: docs/superpowers/plans/2026-10-29-trends-redesign.md, Task 18 and
-- point 5 of "Phase 3 on today's main".
--
-- The column was the hand-typed trend keywords of the old trend scraping. It
-- is empty for every client, and trends now come from each client's trend
-- profile (trend_terms), so nothing reads it: the app's screens never showed
-- or saved it, the public API stopped reading it, and the in-app social
-- report reads stored trends. n8n's social workflow, unpublished but kept as
-- a fallback until the 7 Dec reports run clean, still reads the field from
-- the report request, so the request keeps sending it empty, from no column
-- (_shared/reports/payloads.ts).
--
-- Release the edge functions first (api, run-report, run-scheduled-jobs),
-- then apply this. Safe to apply twice. No cascade: anything that still
-- depended on the column would stop the drop rather than go with it.

alter table public.clients drop column if exists trends_keywords;
