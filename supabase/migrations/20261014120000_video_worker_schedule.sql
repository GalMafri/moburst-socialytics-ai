-- The video worker (video-worker) runs a video post's footage and its join on
-- its own lease, apart from the Canva worker. Its passes start one another;
-- this minute timer restarts it if a pass ever fails to, and only while video
-- work is waiting. Safe to apply twice.
select cron.unschedule('video-worker') where exists (select 1 from cron.job where jobname = 'video-worker');
select cron.schedule('video-worker', '* * * * *', $$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/video-worker',
    headers := jsonb_build_object('Content-Type','application/json','X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 120000)
  where exists (select 1 from public.canva_finish_jobs where status in ('queued', 'running') and step in ('footage', 'footage_wait', 'compose', 'compose_wait'));
$$);
