-- The daily cost reconciliation moves from 09:00 to 09:30 UTC. AdVisor's runs at
-- 09:00 with the same OpenAI admin key, and OpenAI allows that key 30
-- organization requests a minute; on 24 Nov 2026 the two checks ran at once
-- and both were refused ("too many requests"). Safe to apply twice.
select cron.unschedule('cost-reconcile-daily') where exists (select 1 from cron.job where jobname = 'cost-reconcile-daily');
select cron.schedule('cost-reconcile-daily', '30 9 * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/cost-reconcile',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$cron$);
