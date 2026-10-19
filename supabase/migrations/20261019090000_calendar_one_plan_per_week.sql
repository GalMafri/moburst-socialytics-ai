-- One plan per week on a client's calendar (Lital, 19 Oct 2026).
-- A newer report's plan takes over the weeks it places; posts of an older plan
-- there leave the calendar unless someone has worked on them. This records the
-- one way of working on a post that left no trace (moving it, or a copy edit
-- saved straight to the post) and defines "worked on" once, for every caller.

alter table public.calendar_posts add column if not exists touched_at timestamptz;
comment on column public.calendar_posts.touched_at is 'When a person last moved this post or saved its copy. A worked-on post is never taken off the calendar by a newer plan.';

create or replace function public.calendar_posts_worked_on(p_ids uuid[])
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select cp.id
  from public.calendar_posts cp
  where cp.id = any(p_ids)
    and (
      cp.touched_at is not null
      or exists (select 1 from public.post_iterations pi where pi.client_id = cp.client_id and pi.calendar_post_key = cp.post_key)
      or exists (select 1 from public.design_requests dr where dr.client_id = cp.client_id and dr.calendar_post_key = cp.post_key)
      or exists (
        select 1 from public.scheduled_posts sp
        where sp.client_id = cp.client_id
          and lower(coalesce(sp.platform, '')) = lower(cp.platform)
          and cp.copy <> ''
          and left(btrim(coalesce(sp.post_content, '')), 200) = left(btrim(cp.copy), 200)
      )
    );
$$;

revoke all on function public.calendar_posts_worked_on(uuid[]) from public, anon, authenticated;
grant execute on function public.calendar_posts_worked_on(uuid[]) to service_role;
