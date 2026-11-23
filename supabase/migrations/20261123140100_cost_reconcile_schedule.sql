-- The daily cost reconciliation (supabase/functions/cost-reconcile): every day
-- at 09:00 UTC, after the providers' overnight figures settle, it compares the
-- last two days of cost_events with each provider's own bill. Safe to apply twice.
select cron.unschedule('cost-reconcile-daily') where exists (select 1 from cron.job where jobname = 'cost-reconcile-daily');
select cron.schedule('cost-reconcile-daily', '0 9 * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/cost-reconcile',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$cron$);
