-- supabase/migrations/20261113103300_scheduled_posts_supersedes.sql
--
-- A person can send again a post whose send ended without Sprout's answer
-- (status 'unconfirmed', or 'asked' once its run is over). The earlier row
-- has to leave the held states before the new row can be written (the
-- one-held-row-per-post index), and the earlier send may have made the post
-- in Sprout. Until now the function closed the earlier row first and the new
-- row after, so a new send that did not get written (a database error, a
-- second press that won the post) left the earlier row closed, and one that
-- failed was put back only by the run that had closed it.
--
--   1. scheduled_posts.supersedes names the row a send superseded.
--   2. A before-insert trigger closes that row as failed (with the reason
--      the function writes) in the same statement as the insert, so the two
--      happen together or not at all.
--   3. A new send that ends without making anything in Sprout (its row
--      closes as failed, whichever way: the send settles failed, the stale
--      "sending" close of a later press, or the row is deleted) puts the
--      earlier row back as unconfirmed, in the database, next to the close,
--      so no run has to survive to do it. It is put back only while it is
--      still failed with the superseded reason and has no post id, and it is
--      left closed when another send holds the post (the held-row index
--      refuses a second held row). A send that was itself closed by a later
--      press (the superseded reason) does not put its earlier row back: the
--      later press holds the post.
--
-- Release order: apply this migration before the schedule-sprout-post
-- function is deployed. A send that supersedes a row writes the new column.
--
-- Additive and safe to run twice.

alter table public.scheduled_posts add column if not exists supersedes uuid references public.scheduled_posts (id) on delete set null;
comment on column public.scheduled_posts.supersedes is 'The unconfirmed row this send superseded. The database closed that row when this one was written; a send that made nothing in Sprout puts it back.';

create or replace function public.scheduled_posts_supersede() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.supersedes is null then
    return new;
  end if;
  update public.scheduled_posts
     set status = 'failed', failure_reason = 'Sprout never confirmed the post, and it was sent again.'
   where id = new.supersedes
     and client_id = new.client_id
     and calendar_post_key = new.calendar_post_key
     and sprout_post_id is null
     and status in ('unconfirmed', 'asked');
  if not found then
    new.supersedes := null;
  end if;
  return new;
end;
$$;

drop trigger if exists scheduled_posts_supersede on public.scheduled_posts;
create trigger scheduled_posts_supersede before insert on public.scheduled_posts
  for each row execute function public.scheduled_posts_supersede();

create or replace function public.scheduled_posts_reopen() returns trigger
language plpgsql set search_path = public as $$
declare
  closed public.scheduled_posts;
begin
  if tg_op = 'DELETE' then
    closed := old;
  else
    closed := new;
    if old.status = 'failed' or new.status <> 'failed' then
      return null;
    end if;
  end if;
  if closed.supersedes is null
     or closed.sprout_post_id is not null
     or closed.failure_reason is not distinct from 'Sprout never confirmed the post, and it was sent again.'
     or (tg_op = 'DELETE' and closed.status = 'failed') then
    return null;
  end if;
  begin
    update public.scheduled_posts
       set status = 'unconfirmed', failure_reason = null
     where id = closed.supersedes
       and status = 'failed'
       and failure_reason = 'Sprout never confirmed the post, and it was sent again.'
       and sprout_post_id is null;
  exception when unique_violation then
    null;
  end;
  return null;
end;
$$;

drop trigger if exists scheduled_posts_reopen_update on public.scheduled_posts;
create trigger scheduled_posts_reopen_update after update of status on public.scheduled_posts
  for each row execute function public.scheduled_posts_reopen();
drop trigger if exists scheduled_posts_reopen_delete on public.scheduled_posts;
create trigger scheduled_posts_reopen_delete after delete on public.scheduled_posts
  for each row execute function public.scheduled_posts_reopen();
