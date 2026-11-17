-- Trends: a week is written in one step, a dismissed theme is never erased by
-- a rewrite, and the Trends list can tell "not in yet" from "nothing stood out"
-- (17 Nov 2026). Functions only; safe to apply twice.
--
-- 1. trend_week_write: the whole write of a trend week in one transaction.
--    The writer (supabase/functions/_shared/trends/writer.ts) deleted the
--    week's themes, deleted its posts, inserted the posts in chunks, inserted
--    the themes and updated the week as separate requests. A week is now also
--    written again when a failed source is collected later, after people have
--    looked at it, so a reader in between (the Trends screen, the calendar
--    planner) could see a week with no themes, and a failure partway left the
--    week without them. Here a reader sees the week as it was or as it is
--    now, and a failure leaves it as it was.
--
--    Posts are matched by their link: a post still in the week keeps its row
--    (and its id), a new one is added, one no longer in the week is removed.
--
--    A theme a person dismissed is a recorded decision. Its row stays as it
--    is (who dismissed it and when; trend_measures counts it), and a theme in
--    the new set with the same title, compared as the exclusion a dismissal
--    makes is compared (lower(title), the key of trend_terms_one), is left
--    out. Every other theme of the week is replaced by the new set.
--
-- 2. trend_themes_in_range also answers this_week_collected: true when the
--    client's week of today (its Monday in Israel time, as trend weeks are
--    named) brought something back, by the same rule as "collected" (done, or
--    partial with a kept post or a theme). A client user cannot read week
--    rows, so without it the screen cannot tell a week that is not collected
--    yet from one that was collected and has no theme to show. The rest of
--    the function is as 20261113101500_trend_themes_collected.sql made it.

-- ── 1. The week, written in one step ────────────────────────────────────────

create or replace function public.trend_week_write(
  p_week uuid, p_client uuid, p_posts jsonb, p_themes jsonb, p_status text,
  p_platforms jsonb, p_filter_status text, p_cost jsonb, p_finished_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_posts jsonb := coalesce(p_posts, '[]'::jsonb);
  v_themes jsonb := coalesce(p_themes, '[]'::jsonb);
  v_urls text[];
  v_post_count integer;
  v_theme_count integer;
  v_dismissed integer;
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_posts) is distinct from 'array' or jsonb_typeof(v_themes) is distinct from 'array' then
    raise exception 'A week is written from a list of posts and a list of themes.' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('done', 'partial') then
    raise exception 'A written week is done or partial.' using errcode = '22023';
  end if;

  -- One writer at a time per week.
  perform 1 from public.trend_weeks w where w.id = p_week and w.client_id = p_client for update;
  if not found then
    raise exception 'The week to write does not exist.' using errcode = '22023';
  end if;

  -- Posts: gone from the week, then kept in place or added. A link listed twice is one post.
  select coalesce(array_agg(distinct e.value ->> 'url'), '{}'::text[]) into v_urls from jsonb_array_elements(v_posts) as e;
  delete from public.trend_posts p where p.week_id = p_week and not (p.url = any (v_urls));

  insert into public.trend_posts (week_id, client_id, platform, url, author, text, posted_at, format,
                                  views, likes, comments, shares, saves, engagement, search, kept, drop_reason, fit, why, lesson, tripwire)
  select distinct on (x.url)
         p_week, p_client, x.platform, x.url, coalesce(x.author, ''), coalesce(x.text, ''), x.posted_at, x.format,
         coalesce(round(x.views), 0)::bigint, coalesce(round(x.likes), 0)::bigint, coalesce(round(x.comments), 0)::bigint,
         coalesce(round(x.shares), 0)::bigint, coalesce(round(x.saves), 0)::bigint, coalesce(x.engagement, 0), coalesce(x.search, ''),
         coalesce(x.kept, false), x.drop_reason, round(x.fit)::smallint, x.why, x.lesson, coalesce(x.tripwire, false)
    from jsonb_to_recordset(v_posts) as x(
           platform text, url text, author text, text text, posted_at timestamptz, format text,
           views numeric, likes numeric, comments numeric, shares numeric, saves numeric, engagement numeric, search text,
           kept boolean, drop_reason text, fit numeric, why text, lesson text, tripwire boolean)
   where x.url is not null
   order by x.url
  on conflict (week_id, url) do update set
    platform = excluded.platform, author = excluded.author, text = excluded.text, posted_at = excluded.posted_at, format = excluded.format,
    views = excluded.views, likes = excluded.likes, comments = excluded.comments, shares = excluded.shares, saves = excluded.saves,
    engagement = excluded.engagement, search = excluded.search, kept = excluded.kept, drop_reason = excluded.drop_reason,
    fit = excluded.fit, why = excluded.why, lesson = excluded.lesson, tripwire = excluded.tripwire;

  -- A dismissed theme stays as it is; of its posts, the ones the week still holds.
  update public.trend_themes t
     set post_ids = coalesce((
           select array_agg(i.id order by i.ord)
             from unnest(t.post_ids) with ordinality as i(id, ord)
            where exists (select 1 from public.trend_posts p where p.id = i.id)), '{}'::uuid[])
   where t.week_id = p_week and t.dismissed_at is not null;

  -- Every other theme is replaced by the new set, less any a person dismissed.
  delete from public.trend_themes t where t.week_id = p_week and t.dismissed_at is null;
  insert into public.trend_themes (week_id, client_id, position, title, happening, why_it_matters, angle, platforms, post_ids)
  select p_week, p_client, (e.ord - 1)::smallint, e.theme ->> 'title',
         coalesce(e.theme ->> 'happening', ''), coalesce(e.theme ->> 'why_it_matters', ''), coalesce(e.theme ->> 'angle', ''),
         coalesce((select array_agg(pl.value order by pl.ord)
                     from jsonb_array_elements_text(case when jsonb_typeof(e.theme -> 'platforms') = 'array' then e.theme -> 'platforms' else '[]'::jsonb end) with ordinality as pl(value, ord)), '{}'::text[]),
         coalesce((select array_agg(p.id order by u.ord)
                     from jsonb_array_elements_text(case when jsonb_typeof(e.theme -> 'post_urls') = 'array' then e.theme -> 'post_urls' else '[]'::jsonb end) with ordinality as u(url, ord)
                     join public.trend_posts p on p.week_id = p_week and p.url = u.url), '{}'::uuid[])
    from jsonb_array_elements(v_themes) with ordinality as e(theme, ord)
   where btrim(coalesce(e.theme ->> 'title', '')) <> ''
     and not exists (
           select 1 from public.trend_themes d
            where d.week_id = p_week and d.dismissed_at is not null and lower(d.title) = lower(e.theme ->> 'title'));

  update public.trend_weeks
     set status = p_status, platforms = coalesce(p_platforms, '{}'::jsonb), filter_status = p_filter_status,
         cost = coalesce(p_cost, '{}'::jsonb), finished_at = coalesce(p_finished_at, now())
   where id = p_week;

  select count(*) into v_post_count from public.trend_posts p where p.week_id = p_week;
  select count(*) filter (where t.dismissed_at is null), count(*) filter (where t.dismissed_at is not null)
    into v_theme_count, v_dismissed from public.trend_themes t where t.week_id = p_week;
  return jsonb_build_object('posts', v_post_count, 'themes', v_theme_count, 'dismissed_kept', v_dismissed);
end $$;

revoke all on function public.trend_week_write(uuid, uuid, jsonb, jsonb, text, jsonb, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.trend_week_write(uuid, uuid, jsonb, jsonb, text, jsonb, text, jsonb, timestamptz) to service_role;

-- ── 2. The themes of a range, and whether this week brought something back ──

create or replace function public.trend_themes_in_range(p_client uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_staff boolean := public.is_moburst_staff();
  v_this_week date := date_trunc('week', now() at time zone 'Asia/Jerusalem')::date;
begin
  if not public.can_access_client(p_client) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'collected', exists (
      select 1 from public.trend_weeks c
      where c.client_id = p_client
        and (
          c.status = 'done'
          or (c.status = 'partial' and (
            exists (select 1 from public.trend_posts cp where cp.week_id = c.id and cp.kept)
            or exists (select 1 from public.trend_themes ct where ct.week_id = c.id)
          ))
        )
    ),
    'this_week_collected', exists (
      select 1 from public.trend_weeks c
      where c.client_id = p_client
        and c.week_start = v_this_week
        and (
          c.status = 'done'
          or (c.status = 'partial' and (
            exists (select 1 from public.trend_posts cp where cp.week_id = c.id and cp.kept)
            or exists (select 1 from public.trend_themes ct where ct.week_id = c.id)
          ))
        )
    ),
    'themes', coalesce((
      select jsonb_agg(t.theme order by t.week_start desc, t.position)
      from (
        select w.week_start, th.position, jsonb_build_object(
          'id', th.id,
          'week_start', w.week_start,
          'title', th.title,
          'happening', th.happening,
          'why_it_matters', th.why_it_matters,
          'angle', th.angle,
          'platforms', to_jsonb(th.platforms),
          'posts', coalesce((
            select jsonb_agg(jsonb_build_object(
              'platform', p.platform,
              'url', p.url,
              'author', p.author,
              'text', p.text,
              'posted_at', p.posted_at,
              'format', p.format,
              'views', p.views,
              'likes', p.likes,
              'comments', p.comments,
              'shares', p.shares,
              'saves', p.saves,
              'engagement', case when v_staff then p.engagement end
            ) order by array_position(th.post_ids, p.id))
            from public.trend_posts p
            where p.id = any (th.post_ids) and p.kept and not p.tripwire and p.client_id = p_client
          ), '[]'::jsonb)
        ) as theme
        from public.trend_themes th
        join public.trend_weeks w on w.id = th.week_id
        where th.client_id = p_client
          and w.client_id = p_client
          and w.status in ('done', 'partial')
          and w.week_start <= p_to and w.week_start + 6 >= p_from
          and th.dismissed_at is null
      ) t
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.trend_themes_in_range(uuid, date, date) from public, anon;
grant execute on function public.trend_themes_in_range(uuid, date, date) to authenticated;
