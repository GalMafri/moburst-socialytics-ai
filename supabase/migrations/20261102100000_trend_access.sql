-- Trends: who reads and who changes them, and how the Analytics screen reads a
-- client's weekly themes.
-- Plan: docs/superpowers/plans/2026-10-29-trends-redesign.md (Task 10)
--
-- Who may reach a client. Since 20260720130000_company_scoped_staff.sql a
-- Moburst user assigned specific companies may work on those companies only,
-- and public.can_access_client(client_id) is the app's check for that
-- (admin, or staff with no company restriction, or a member of the client).
-- is_moburst_staff() alone is true for a company-scoped user too, so the Phase 1
-- Trends objects (20261029100000_trends.sql) let that user read and change any
-- client's trends. This migration closes that:
--
--   1. trend_themes_in_range is gated on can_access_client.
--   2. The read policies of all five trend tables take staff who can access
--      the row's client. Client users no longer read trend_posts or
--      trend_themes directly (they never read the other three).
--   3. The three staff functions (trend_term_add, trend_term_remove,
--      trend_theme_dismiss) keep their bodies and now also require access to
--      the client the term or theme belongs to.
--
-- The Analytics screen reads a client's themes through one function. A client
-- user cannot read trend_weeks, so a screen reading the tables directly cannot
-- place a theme in a date range, and the table rows carry columns that are the
-- team's own (the weighted engagement, the fit score, the filter's reasons, the
-- tripwire flag).
--
--   trend_themes_in_range(p_client, p_from, p_to)
--     Returns { "collected": boolean, "themes": [...] }.
--     themes: the client's themes of finished weeks (done or partial) whose
--     week starts between the two dates, newest week first and then by
--     position. A dismissed theme is left out, for staff too. Each theme
--     carries the kept posts it lists, in the order it lists them. The
--     weighted engagement is returned to staff only.
--     collected: true when the client has any finished week on any date, so a
--     screen can tell "nothing collected yet" from "nothing in this period".
--     The Phase 3 report screen and the public API read themes by the same
--     rule.

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
      where c.client_id = p_client and c.status in ('done', 'partial')
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
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.trend_themes_in_range(uuid, date, date) from public, anon;
grant execute on function public.trend_themes_in_range(uuid, date, date) to authenticated;

-- ── Direct reads: staff, for the clients they may reach ─────────────────────
-- Client users read themes and posts only through the function above.

drop policy if exists "Staff read trend profiles" on public.trend_profiles;
create policy "Staff read trend profiles" on public.trend_profiles
  for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));
drop policy if exists "Staff read trend terms" on public.trend_terms;
create policy "Staff read trend terms" on public.trend_terms
  for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));
drop policy if exists "Staff read trend weeks" on public.trend_weeks;
create policy "Staff read trend weeks" on public.trend_weeks
  for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));
drop policy if exists "Read kept trend posts" on public.trend_posts;
create policy "Read kept trend posts" on public.trend_posts
  for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));
drop policy if exists "Read trend themes" on public.trend_themes;
create policy "Read trend themes" on public.trend_themes
  for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));

-- ── What staff can change: the same functions, now scoped to the client ─────

-- A person adds a topic, hashtag or exclusion. Adding one that a person
-- removed earlier brings it back, now as theirs.
create or replace function public.trend_term_add(p_client uuid, p_kind text, p_platform text, p_term text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_term text := btrim(coalesce(p_term, ''));
  v_platform text := nullif(btrim(coalesce(p_platform, '')), '');
begin
  if not (public.is_moburst_staff() and public.can_access_client(p_client)) then
    raise exception 'Only Moburst staff can change what trends track.' using errcode = '42501';
  end if;
  if v_term = '' then
    raise exception 'A term is required.' using errcode = '22023';
  end if;
  if p_kind = 'hashtag' then
    -- One tag: a single leading #, no whitespace inside, and nothing left is no term.
    v_term := '#' || ltrim(regexp_replace(v_term, '\s', '', 'g'), '#');
    if v_term = '#' then
      raise exception 'A term is required.' using errcode = '22023';
    end if;
  end if;
  if p_kind <> 'hashtag' then
    v_platform := null;
  end if;
  insert into public.trend_terms (client_id, kind, platform, term, source)
  values (p_client, p_kind, v_platform, v_term, 'person')
  on conflict (client_id, kind, coalesce(platform, ''), lower(term))
  do update set source = 'person', removed_at = null, removed_by = null
  returning id into v_id;
  return v_id;
end $$;

-- A person removes a term. The row stays, marked removed, so a later
-- profile rewrite never suggests it again. A term that does not exist is
-- left alone.
create or replace function public.trend_term_remove(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
begin
  if not public.is_moburst_staff() then
    raise exception 'Only Moburst staff can change what trends track.' using errcode = '42501';
  end if;
  select client_id into v_client from public.trend_terms where id = p_id;
  if v_client is null then
    return;
  end if;
  if not public.can_access_client(v_client) then
    raise exception 'Only Moburst staff can change what trends track.' using errcode = '42501';
  end if;
  update public.trend_terms set removed_at = now(), removed_by = auth.uid()
   where id = p_id and removed_at is null;
end $$;

-- A staff member dismisses a theme. Its pattern becomes an exclusion that the
-- next weekly filter reads; nobody has to rewrite the profile. A theme that
-- does not exist is left alone.
create or replace function public.trend_theme_dismiss(p_theme uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
  v_theme public.trend_themes%rowtype;
begin
  if not public.is_moburst_staff() then
    raise exception 'Only Moburst staff can dismiss a trend.' using errcode = '42501';
  end if;
  select client_id into v_client from public.trend_themes where id = p_theme;
  if v_client is null then
    return;
  end if;
  if not public.can_access_client(v_client) then
    raise exception 'Only Moburst staff can dismiss a trend.' using errcode = '42501';
  end if;
  update public.trend_themes set dismissed_at = now(), dismissed_by = auth.uid()
   where id = p_theme and dismissed_at is null
  returning * into v_theme;
  if v_theme.id is null then
    return;
  end if;
  insert into public.trend_terms (client_id, kind, platform, term, reason, source)
  values (v_theme.client_id, 'exclusion', null, v_theme.title, v_theme.happening, 'dismissal')
  on conflict (client_id, kind, coalesce(platform, ''), lower(term))
  do update set removed_at = null, removed_by = null;
end $$;

revoke all on function public.trend_term_add(uuid, text, text, text) from public, anon;
revoke all on function public.trend_term_remove(uuid) from public, anon;
revoke all on function public.trend_theme_dismiss(uuid) from public, anon;
grant execute on function public.trend_term_add(uuid, text, text, text) to authenticated;
grant execute on function public.trend_term_remove(uuid) to authenticated;
grant execute on function public.trend_theme_dismiss(uuid) to authenticated;
