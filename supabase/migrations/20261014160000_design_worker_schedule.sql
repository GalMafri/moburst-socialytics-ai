-- Designs are made by design-worker, without Canva (13 Oct). Its minute timer
-- replaces canva-finish's; a pass starts only while a design job is active
-- or a request is being prepared (video footage and joins are video-worker's).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'canva-finish-worker') then
    perform cron.unschedule('canva-finish-worker');
  end if;
  if exists (select 1 from cron.job where jobname = 'design-worker') then
    perform cron.unschedule('design-worker');
  end if;
end $$;

select cron.schedule('design-worker', '* * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/design-worker',
    headers := jsonb_build_object('Content-Type','application/json','X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 120000)
  where exists (select 1 from public.canva_finish_jobs where status in ('queued', 'running') and step not in ('footage', 'footage_wait', 'compose', 'compose_wait'))
     or exists (select 1 from public.design_requests where status = 'preparing');
$cron$);
