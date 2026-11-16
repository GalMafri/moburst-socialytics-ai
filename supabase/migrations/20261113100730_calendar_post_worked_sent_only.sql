-- supabase/migrations/20261113100730_calendar_post_worked_sent_only.sql
--
-- calendar_post_worked (20261109100000_client_notes.sql) counted any
-- scheduled_posts row for a post as work done on it. Since
-- 20261113100710_scheduled_posts_sending.sql a row also exists while a send
-- is going ('sending') and after Sprout refused one ('failed'), so a
-- send that reached nothing marked the post as worked on. 'asked' and
-- 'unconfirmed' count: Sprout was asked and may hold the post. That shielded it
-- from week revisions and client-notes rewrites and kept it on the calendar
-- when a plan was stopped. Only the statuses a post sent to Sprout is
-- recorded with count again.
--
-- Same signature and grants; safe to run twice.

create or replace function public.calendar_post_worked(p_client uuid, p_key text, p_platform text, p_copy text, p_touched timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (auth.role() = 'service_role' or is_moburst_staff() or is_client_member(p_client)) and (
    p_touched is not null
    or exists (select 1 from post_iterations pi where pi.client_id = p_client and pi.calendar_post_key = p_key)
    or exists (select 1 from design_requests dr where dr.client_id = p_client and dr.calendar_post_key = p_key and dr.status <> 'canceled')
    or exists (select 1 from scheduled_posts sp where sp.client_id = p_client and sp.calendar_post_key = p_key
      and sp.status in ('scheduled', 'sent_now', 'asked', 'unconfirmed', 'published'))
    or (coalesce(p_copy, '') <> '' and exists (
      select 1 from scheduled_posts sp
      where sp.client_id = p_client and lower(coalesce(sp.platform, '')) = lower(p_platform)
        and sp.status in ('scheduled', 'sent_now', 'asked', 'unconfirmed', 'published')
        and left(btrim(coalesce(sp.post_content, '')), 200) = left(btrim(p_copy), 200))));
$$;

revoke all on function public.calendar_post_worked(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.calendar_post_worked(uuid, text, text, text, timestamptz) to authenticated, service_role;
