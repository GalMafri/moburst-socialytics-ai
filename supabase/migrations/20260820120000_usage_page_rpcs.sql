-- Read path for the in-app User Analytics page.
--
-- The user_activity / user_analytics views stay revoked from anon and
-- authenticated. A plain grant would have been wrong: views run with the
-- owner's privileges and have no RLS of their own, so granting select to
-- `authenticated` would have handed every client account the full list of
-- who uses the tool and how often.
--
-- These two SECURITY DEFINER functions are the only way in, and each one
-- gates on is_admin(). Not is_moburst_staff() — that would also admit
-- moburst_user accounts. Anyone below admin gets an empty set, not an error,
-- so the page shows its empty state rather than a failure.

create or replace function public.get_user_analytics()
returns setof public.user_analytics
language sql stable security definer set search_path = public as $$
  select * from public.user_analytics where public.is_admin();
$$;

create or replace function public.get_usage_trend()
returns table (day date, actions bigint, active_users bigint)
language sql stable security definer set search_path = public as $$
  select date_trunc('day', a.at)::date, count(*)::bigint, count(distinct a.user_id)::bigint
  from public.user_activity a
  where public.is_admin() and a.at is not null
  group by 1 order by 1;
$$;

revoke all on function public.get_user_analytics() from public, anon;
revoke all on function public.get_usage_trend()   from public, anon;
grant execute on function public.get_user_analytics() to authenticated;
grant execute on function public.get_usage_trend()    to authenticated;
