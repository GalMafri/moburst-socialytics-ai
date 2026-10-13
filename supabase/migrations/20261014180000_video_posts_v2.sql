-- Video posts, made again (13 Oct): the post's planned visual travels with
-- the request (the planner reads it), and the two workers pick their jobs by
-- kind rather than by step names, so new video steps never fall between them.
alter table public.design_requests add column if not exists visual_direction text;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'design-worker') then perform cron.unschedule('design-worker'); end if;
  if exists (select 1 from cron.job where jobname = 'video-worker') then perform cron.unschedule('video-worker'); end if;
end $$;

select cron.schedule('design-worker', '* * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/design-worker',
    headers := jsonb_build_object('Content-Type','application/json','X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 120000)
  where exists (select 1 from public.canva_finish_jobs where status in ('queued', 'running') and coalesce(input->>'kind', '') <> 'video')
     or exists (select 1 from public.design_requests where status = 'preparing');
$cron$);

select cron.schedule('video-worker', '* * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/video-worker',
    headers := jsonb_build_object('Content-Type','application/json','X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 120000)
  where exists (select 1 from public.canva_finish_jobs where status in ('queued', 'running') and input->>'kind' = 'video');
$cron$);
