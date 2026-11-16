-- The API demo worker ran every minute with nothing to do: 60,947 answered
-- POST /internal/worker calls filled the API log. It now posts only when a
-- demo job is ready for a pass: the same test demo_jobs_lease uses to pick one
-- (waiting or running, not leased by another pass, not waiting on its next check time). The
-- stored rows of those empty passes are removed. Safe to apply twice.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'api-demo-worker') then perform cron.unschedule('api-demo-worker'); end if;
end $$;

select cron.schedule('api-demo-worker', '* * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/internal/worker',
    headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 150000)
  where exists (select 1 from public.demo_jobs where status in ('queued','running')
    and (lease_until is null or lease_until < now())
    and (next_check_at is null or next_check_at <= now()));
$cron$);

delete from public.api_requests where method = 'POST' and path = '/internal/worker' and status = 200;
