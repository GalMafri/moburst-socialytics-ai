-- The video worker's minute timer (cron video-worker) restarts its passes
-- while a video job waits at one of its steps (_shared/video/stepNames.ts
-- VIDEO_STEPS): a video's kit, title, opening frame, one clip and assembly, a
-- filmed clip's sound, and a client's style. The steps from before the
-- one-clip video (references, footage, hook, compose, clean) are gone: the
-- timer no longer runs for them, and a job at one ends with a reason at the
-- next video worker pass that reaches it. Safe to apply twice.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'video-worker') then perform cron.unschedule('video-worker'); end if;
end $$;

select cron.schedule('video-worker', '* * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/video-worker',
    headers := jsonb_build_object('Content-Type','application/json','X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 120000)
  where exists (select 1 from public.canva_finish_jobs where status in ('queued', 'running') and input->>'kind' = 'video'
    and step in ('kit', 'kit_wait', 'title', 'title_check', 'frame', 'frame_check', 'clip', 'clip_wait', 'assemble', 'assemble_wait', 'transcribe', 'transcribe_wait', 'style_cut', 'style_wait', 'style_read'));
$cron$);
