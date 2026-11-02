-- Trends: the measures each client's weekly run is judged by (spec, "How
-- we'll know it works"). Plan: docs/superpowers/plans/2026-10-29-trends-redesign.md (Task 13)
--
-- trend_measures(p_client) returns one row per client and week, for Moburst
-- staff only and only for the clients each may reach (can_access_client, as
-- every Trends object since 20261102100000_trend_access.sql). With no client
-- named, it covers every client the caller may reach. Everything is computed
-- from what each weekly run stores:
--
--   kept_per_platform  kept posts on each platform the week watched (coverage:
--                      at least 5 a week; the coverage rewrite in trends_v1 is
--                      the one measure that acts on its own)
--   tripwire_hits      kept posts the tripwire flagged (should stay 0)
--   dismissed          the week's themes staff dismissed
--   terms_removed      topics and hashtags a person removed that week, Monday
--                      to Monday in Israel time, as the weekly job counts weeks
--   used_share         of the client's calendar posts dated that Monday to
--                      Sunday, the share whose first reason is a trend; null
--                      when the week has no calendar posts
--   week_cost          what the week cost (Apify dollars, Claude tokens per model)
--   run_status         running, done or partial
--
-- The output columns are named apart from every column the statements use: a
-- PL/pgSQL output column is also a variable, and one named like a column
-- fails as ambiguous on a real run (see 20261029100100_trend_refresh_job.sql).

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
    (select round(count(*) filter (where cp.reasons->0->>'type' = 'trend')::numeric / nullif(count(*), 0), 3)
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
