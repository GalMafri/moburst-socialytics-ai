-- The scheduled report queue's clock (design:
-- docs/superpowers/specs/2026-10-06-scheduled-report-queue-design.md).
-- Applied after run-scheduled-jobs is deployed. cron.schedule with an existing
-- name updates that job, so this is safe to run again.

-- Once a day at 07:15 UTC, the time n8n's Daily Scheduler used: enqueue the due
-- dispatches and feed refreshes. Pure SQL, no HTTP.
select cron.schedule('scheduled-reports-enqueue', '15 7 * * *', $cron$ select public.enqueue_scheduled_report_jobs(); $cron$);

-- Every minute: the worker leases and runs due jobs one at a time.
select cron.schedule('scheduled-jobs-worker', '* * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/run-scheduled-jobs',
    headers := jsonb_build_object('Content-Type','application/json','X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
$cron$);
