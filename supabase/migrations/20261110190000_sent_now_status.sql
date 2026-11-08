-- supabase/migrations/20261110190000_sent_now_status.sql
--
-- A post sent to Sprout "now" is recorded with status 'sent_now'
-- (schedule-sprout-post/send.ts), and the Sprout dialog reads both
-- 'scheduled' and 'sent_now' as sent (SchedulePostModal.tsx). The table's
-- status rule predates "send now" and allowed only scheduled, published,
-- failed and cancelled, so every "now" send reached Sprout but its row was
-- refused: the screens never saw the post as sent, and nothing stopped it
-- being sent again. Found 8 Nov 2026 on Moburst's LinkedIn carousel
-- (Sprout draft 285902815).

alter table public.scheduled_posts drop constraint if exists scheduled_posts_status_check;
alter table public.scheduled_posts add constraint scheduled_posts_status_check
  check (status = any (array['scheduled'::text, 'sent_now'::text, 'published'::text, 'failed'::text, 'cancelled'::text]));
