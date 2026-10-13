-- Trend slots (calendar posts left open when a week is planned) are written
-- shortly before their date from what is trending then: every morning,
-- calendar-posts writes the open slots due in the next 10 days.
select cron.schedule('calendar-fill-trend-slots', '0 5 * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/calendar-posts',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret'),
      'X-Socialytics-User','04b86c53-de62-4d3d-a661-c714f337c8fc'),
    body := '{"action":"fill_trend_slots"}'::jsonb, timeout_milliseconds := 150000)
  where exists (select 1 from public.calendar_posts where source = 'trend_slot' and copy = '' and post_date between current_date and current_date + 10);
$cron$);
