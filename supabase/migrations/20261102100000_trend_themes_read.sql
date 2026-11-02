-- Trends: how the Analytics screen reads a client's weekly themes.
-- Plan: docs/superpowers/plans/2026-10-29-trends-redesign.md (Task 10)
--
-- A client user cannot read trend_weeks, so a screen reading the tables
-- directly cannot place a theme in a date range, and the table rows carry
-- columns that are the team's own (the weighted engagement, the fit score,
-- the filter's reasons, the tripwire flag). So the screen reads through one
-- function, and client users no longer read trend_posts or trend_themes
-- themselves. Staff keep their direct reads.
--
--   trend_themes_in_range(p_client, p_from, p_to)
--     Themes of the client's finished weeks (done or partial) whose week
--     starts between the two dates, newest week first and then by position.
--     A dismissed theme is left out, for staff too. Each theme carries the
--     kept posts it lists, in the order it lists them. The weighted
--     engagement is returned to staff only. The Phase 3 report screen and the
--     public API read themes by the same rule.

create or replace function public.trend_themes_in_range(p_client uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_staff boolean := public.is_moburst_staff();
begin
  if not (v_staff or public.is_client_member(p_client)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return coalesce((
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
          where p.id = any (th.post_ids) and p.kept and p.client_id = p_client
        ), '[]'::jsonb)
      ) as theme
      from public.trend_themes th
      join public.trend_weeks w on w.id = th.week_id
      where th.client_id = p_client
        and w.client_id = p_client
        and w.status in ('done', 'partial')
        and w.week_start between p_from and p_to
        and th.dismissed_at is null
    ) t
  ), '[]'::jsonb);
end $$;

revoke all on function public.trend_themes_in_range(uuid, date, date) from public, anon;
grant execute on function public.trend_themes_in_range(uuid, date, date) to authenticated;

-- Client users read themes and posts only through the function above.
drop policy if exists "Read kept trend posts" on public.trend_posts;
create policy "Read kept trend posts" on public.trend_posts
  for select to authenticated using (public.is_moburst_staff());
drop policy if exists "Read trend themes" on public.trend_themes;
create policy "Read trend themes" on public.trend_themes
  for select to authenticated using (public.is_moburst_staff());
