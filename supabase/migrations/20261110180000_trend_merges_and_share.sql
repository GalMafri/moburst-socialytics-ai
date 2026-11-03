-- Trends: two writes merged in the database, and the share of calendar posts
-- trends informed counted fully (3 Nov 2026).
--
--   1. trend_search_override_put: a week's rewrite of one platform's searches,
--      merged into trend_profiles.search_overrides in one statement. The
--      writer (trends/writer.ts) read the whole object and wrote it back, so a
--      "Go back" on another platform between the read and the write came back.
--      Written only while the profile the run read stands, and for Instagram
--      only while the hashtags the run read stand, as before.
--   2. trend_hashtags_refreshed: the monthly hashtag refresh drops the
--      Instagram rewrite made from the old hashtags in the same statement that
--      records the refresh (lifecycle trend_hashtags read, merged and wrote
--      back the whole object too).
--   3. trend_measures.used_share counts a calendar post when any of its reasons
--      is a trend or cites a trend. It counted only posts whose first reason is
--      a trend, and 7 of the 18 posts trends informed from 26 Oct lead with
--      the client's own performance.
--
-- 1 and 2 are the service role's alone. 3 keeps its signature and its guards.

create or replace function public.trend_search_override_put(
  p_client uuid, p_platform text, p_searches jsonb, p_written_at timestamptz,
  p_hashtags_at timestamptz default null, p_check_hashtags boolean default false)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_platform, '')) = '' or jsonb_typeof(p_searches) is distinct from 'array' or jsonb_array_length(p_searches) = 0 then
    raise exception 'A search rewrite must name its platform and its searches.' using errcode = '22023';
  end if;
  update public.trend_profiles
     set search_overrides = coalesce(search_overrides, '{}'::jsonb) || jsonb_build_object(p_platform, p_searches)
   where client_id = p_client
     and written_at = p_written_at
     and (not coalesce(p_check_hashtags, false) or hashtags_at is not distinct from p_hashtags_at);
  return found;
end $$;

revoke all on function public.trend_search_override_put(uuid, text, jsonb, timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.trend_search_override_put(uuid, text, jsonb, timestamptz, timestamptz, boolean) to service_role;

create or replace function public.trend_hashtags_refreshed(p_client uuid, p_at timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  update public.trend_profiles
     set hashtags_at = p_at,
         search_overrides = coalesce(search_overrides, '{}'::jsonb) - 'instagram'
   where client_id = p_client;
end $$;

revoke all on function public.trend_hashtags_refreshed(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.trend_hashtags_refreshed(uuid, timestamptz) to service_role;

-- As in 20261108100000_trend_measures.sql, with used_share counting every
-- post a trend informed.
create or replace function public.trend_measures(p_client uuid default null)
returns table (
  client uuid,
  client_name text,
  week date,
  run_status text,
  kept_per_platform jsonb,
  tripwire_hits integer,
  dismissed integer,
  terms_removed integer,
  used_share numeric,
  week_cost jsonb
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_moburst_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_client is not null and not public.can_access_client(p_client) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return query
  select
    w.client_id,
    c.name::text,
    w.week_start, w.status,
    coalesce((
      select jsonb_object_agg(e.key, coalesce((e.value->>'kept')::int, 0))
        from jsonb_each(w.platforms) e
       where e.value->>'status' is distinct from 'not_watched'
    ), '{}'::jsonb),
    (select count(*)::int from public.trend_posts p where p.week_id = w.id and p.kept and p.tripwire),
    (select count(*)::int from public.trend_themes th where th.week_id = w.id and th.dismissed_at is not null),
    (select count(*)::int from public.trend_terms t
      where t.client_id = w.client_id and t.kind in ('topic', 'hashtag')
        and t.removed_at >= (w.week_start::timestamp at time zone 'Asia/Jerusalem')
        and t.removed_at < ((w.week_start + 7)::timestamp at time zone 'Asia/Jerusalem')),
    (select round(count(*) filter (where exists (
              select 1
                from jsonb_array_elements(case when jsonb_typeof(cp.reasons) = 'array' then cp.reasons else '[]'::jsonb end) r
               where r.value->>'type' = 'trend'
                  or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(r.value->'evidence') = 'array' then r.value->'evidence' else '[]'::jsonb end) ev
                              where ev.value->>'kind' = 'trend')
            ))::numeric / nullif(count(*), 0), 3)
       from public.calendar_posts cp
      where cp.client_id = w.client_id and cp.post_date between w.week_start and w.week_start + 6),
    w.cost
  from public.trend_weeks w
  join public.clients c on c.id = w.client_id
  where (p_client is null or w.client_id = p_client)
    and public.can_access_client(w.client_id)
  order by c.name, w.client_id, w.week_start desc;
end $$;

revoke all on function public.trend_measures(uuid) from public, anon;
grant execute on function public.trend_measures(uuid) to authenticated;
