-- supabase/migrations/20261113100720_calendar_delete_post.sql
--
-- Deleting a post was a hard delete of its calendar_posts row from the
-- browser. Its designs and open design requests stayed behind with a key that
-- named nothing, and nothing kept the post. Now the Delete button calls one
-- function, calendar_delete_post, that works in one transaction:
--
--   1. The post and its Story (the post whose story_of is this post's key)
--      leave calendar_posts for calendar_posts_archive, kept whole as every
--      other removal does (calendar_stop_plan).
--   2. Their designs are archived (post_iterations.archived_at), which takes
--      them off the board and out of the post panel.
--   3. Their design requests that are still open (preparing, needs filming)
--      are closed with the reason post_removed.
--
-- Anything already sent to Sprout stays there; scheduled_posts is untouched.
-- The caller must be able to write the client's calendar, as the table's own
-- policy required, and a connected app cannot call it.
--
-- The same migration archives the designs whose post is already gone: posts
-- deleted before this left their designs on the table. Only designs keyed to
-- a calendar post ('post:...') are looked at; the older report keys name
-- report posts, which have no calendar_posts row by design.
--
-- Additive and safe to run twice.

create or replace function public.calendar_delete_post(p_post uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_post calendar_posts;
  v_keys text[];
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  select * into v_post from calendar_posts where id = p_post for update;
  -- Asked again (a press sent twice): already gone.
  if v_post.id is null then
    return;
  end if;
  if not public.can_write_client(v_post.client_id) then
    raise exception 'You cannot change this client''s calendar.' using errcode = '42501';
  end if;

  select array_agg(post_key) into v_keys
    from calendar_posts
   where id = v_post.id or (client_id = v_post.client_id and story_of = v_post.post_key);

  with gone as (
    delete from calendar_posts cp
     where cp.id = v_post.id or (cp.client_id = v_post.client_id and cp.story_of = v_post.post_key)
    returning cp.*
  )
  insert into calendar_posts_archive
  select (jsonb_populate_record(null::calendar_posts_archive,
           to_jsonb(g) || jsonb_build_object('archived_at', now(), 'archive_reason', 'Deleted by a person (calendar_delete_post).'))).*
    from gone g;

  update post_iterations set archived_at = now()
   where client_id = v_post.client_id and calendar_post_key = any (v_keys) and archived_at is null;

  update design_requests set status = 'closed', end_reason = 'post_removed', ended_at = now()
   where client_id = v_post.client_id and calendar_post_key = any (v_keys) and status in ('preparing', 'needs_filming');
end $$;

revoke all on function public.calendar_delete_post(uuid) from public, anon;
grant execute on function public.calendar_delete_post(uuid) to authenticated, service_role;

-- Designs left behind by posts deleted before this.
update public.post_iterations pi set archived_at = now()
 where pi.archived_at is null and pi.calendar_post_key like 'post:%'
   and not exists (select 1 from public.calendar_posts cp where cp.client_id = pi.client_id and cp.post_key = pi.calendar_post_key);
