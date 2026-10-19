-- The daily repair sweep runs inside the project (Lital, 19 Oct 2026: nothing
-- may fail and flag anyone). run-scheduled-jobs {"mode":"status"} puts stopped
-- work back in the queue, queues due work that was never queued and runs the
-- worker; it always answers 200 and emails nobody. It replaces the n8n
-- "Socialytics - Scheduled Jobs Check" workflow (m6hj4kWuT1tPSeJg), which
-- emailed through n8n's error workflow and was unpublished the same day.
-- Applied live on 19 Oct 2026.
select cron.unschedule('scheduled-jobs-repair') where exists (select 1 from cron.job where jobname = 'scheduled-jobs-repair');
select cron.schedule('scheduled-jobs-repair', '30 8 * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/run-scheduled-jobs',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{"mode":"status"}'::jsonb, timeout_milliseconds := 120000);
$cron$);
