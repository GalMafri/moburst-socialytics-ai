-- Designs for upcoming calendar posts, for clients whose staff switched
-- automatic designs on (design_brand_settings.auto_designs). Every 10 minutes
-- design-request starts designs for the soonest posts without one, at most
-- two being prepared at a time; it does nothing while no client has it on.
select cron.schedule('design-auto-upcoming', '*/10 * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/design-request',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret'),
      'X-Socialytics-User','04b86c53-de62-4d3d-a661-c714f337c8fc'),
    body := '{"action":"auto"}'::jsonb, timeout_milliseconds := 60000)
  where exists (select 1 from public.design_brand_settings where auto_designs and confirmed_at is not null);
$cron$);
