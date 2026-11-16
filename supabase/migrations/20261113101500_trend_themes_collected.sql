-- Trends: "collected" is true only when a week brought something back.
--
-- Until now any week with status done or partial counted as collected, so a
-- client whose only week failed on every platform (partial, no posts, no
-- themes) read "No trends in this period." instead of "Trends show here
-- after the first weekly collection." A week now counts when it is done, or
-- partial with at least one kept post or one theme.
--
-- trend_themes_in_range is restated in full from 20261108110000_trend_reads_fix.sql
-- with that one change (the themes it lists are unchanged), and its grants
-- are restated.

create or replace function public.trend_themes_in_range(p_client uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_staff boolean := public.is_moburst_staff();
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
