-- Trends are queued before the week plans (9 Nov 2026).
--
-- trend-refresh-enqueue ran at 07:20 UTC, five minutes after the report
-- enqueue (07:15) that also queues each Monday's week plans. A client whose
-- feed weekday is Monday was planned while its new trend week was still
-- collecting, so its plan read the week-old trends (9 Nov: Buzznow, European
-- Wax Center, Yangra). The trends are now queued at 07:10, and a plan waits
-- while its client's collection is queued or running, for at most two hours
-- (_shared/calendar/runWeek.ts trendsPending).
--
-- cron.schedule with an existing name replaces that job's schedule, so this
-- is safe to apply twice.

select cron.schedule('trend-refresh-enqueue', '10 7 * * *', $cron$ select public.enqueue_trend_refresh_jobs(); $cron$);
