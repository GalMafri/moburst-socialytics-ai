-- supabase/migrations/20261113100710_scheduled_posts_sending.sql
--
-- A post sent to Sprout is written to scheduled_posts before Sprout is asked
-- (schedule-sprout-post/send.ts), with status 'sending', and written again
-- with Sprout's post id and its final status, or 'failed' with the reason.
-- Right before Sprout is asked the row becomes 'asked': from then on the post
-- may be in Sprout. A send that ends without an answer that says what Sprout
-- did (a lost answer, a server error, a body that cannot be read) writes
-- 'unconfirmed', so every screen knows at once that the send is over.
-- Until now the row was written only after Sprout made the post, so a last
-- write that did not go through left a post in Sprout that nothing knew
-- about, and the next press sent it again; a send Sprout refused left no
-- record at all.
--
--   1. The status rule takes 'sending' (Sprout not asked yet), 'asked'
--      (Sprout being asked, answer not written down) and 'unconfirmed' (the
--      send ended and Sprout never said what it did).
--   2. failure_reason says why a send failed.
--   3. One sending, asked or unconfirmed row per post: a second press that
--      arrives while the first holds the post is told the post is being
--      sent. A sending row whose run is over (the edge function's own time
--      limit, 400 seconds, from created_at) belongs to a send that died
--      before it asked Sprout anything; the function closes it as failed
--      before it writes its own. An asked or unconfirmed row is closed only
--      when a person sends the post again: an unconfirmed row at once, an
--      asked row once its run is over.
--
-- Release order: apply this migration before the schedule-sprout-post
-- function is deployed. The function writes 'sending' rows, which the old
-- status rule refuses.
--
-- Additive and safe to run twice.

alter table public.scheduled_posts drop constraint if exists scheduled_posts_status_check;
alter table public.scheduled_posts add constraint scheduled_posts_status_check
  check (status = any (array['sending'::text, 'asked'::text, 'unconfirmed'::text, 'scheduled'::text, 'sent_now'::text, 'published'::text, 'failed'::text, 'cancelled'::text]));

alter table public.scheduled_posts add column if not exists failure_reason text;
comment on column public.scheduled_posts.failure_reason is 'Why a send failed (status failed). Null for every other status.';

create unique index if not exists scheduled_posts_one_held
  on public.scheduled_posts (client_id, calendar_post_key)
  where status in ('sending', 'asked', 'unconfirmed') and calendar_post_key is not null;
drop index if exists public.scheduled_posts_one_sending;
