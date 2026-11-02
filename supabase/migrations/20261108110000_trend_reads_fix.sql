-- Trends: fixes from the final review of Phase 2.
-- Plan: docs/superpowers/plans/2026-10-29-trends-redesign.md
--
-- Named after 20261108100000_trend_measures.sql so a fresh replay runs it
-- last. Each function is restated in full from 20261102100000_trend_access.sql
-- with its change, and its grants are restated.

-- ── trend_themes_in_range ───────────────────────────────────────────────────
-- Unchanged from 20261102100000_trend_access.sql except:
--   * A kept post the tripwire flagged (a junk phrase in a kept post) is left
--     out of every theme, for staff too. trend_measures still counts it.
--   * A week counts when any of its seven days (Monday to Sunday) falls in
--     the window, so a week that starts before a month and ends in it is in
--     that month's themes. Before, only a week starting inside the window was.

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

-- ── trend_term_add ──────────────────────────────────────────────────────────
-- Unchanged from 20261102100000_trend_access.sql except the hashtag rule. A
-- hashtag is # followed by letters, digits or underscores only, the same rule
-- as the Client setup add box, the Instagram source and the profile writer
-- (supabase/functions/_shared/trends/hashtag.ts). Everything else is taken
-- out, # included, and one # goes in front; a tag with nothing left is
-- refused. Before, only whitespace was taken out, so "#café-life" was stored
-- with its dash and the profile writer's rule did not hold for a person's tag.

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
    -- One tag: one # and letters, digits or underscores only; nothing left is no term.
    v_term := '#' || regexp_replace(v_term, '[^[:alnum:]_]', '', 'g');
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

revoke all on function public.trend_term_add(uuid, text, text, text) from public, anon;
grant execute on function public.trend_term_add(uuid, text, text, text) to authenticated;

-- ── trend_search_override_clear (new) ───────────────────────────────────────
-- Staff undo a coverage rewrite. When a platform keeps too few posts two weeks
-- running, the weekly run rewrites its searches and stores them in
-- trend_profiles.search_overrides ({platform: [search]}); Client setup shows
-- them under "Trends we track". Clearing one platform's searches sends it
-- back to the profile's own topics (Instagram: its hashtags) from the next
-- weekly run. Only that platform's key goes, in one update; the other
-- platforms' rewrites stay. A platform with no rewrite changes nothing.
create or replace function public.trend_search_override_clear(p_client uuid, p_platform text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_moburst_staff() and public.can_access_client(p_client)) then
    raise exception 'Only Moburst staff can change what trends track.' using errcode = '42501';
  end if;
  update public.trend_profiles set search_overrides = search_overrides - p_platform
   where client_id = p_client and search_overrides ? p_platform;
end $$;

revoke all on function public.trend_search_override_clear(uuid, text) from public, anon;
grant execute on function public.trend_search_override_clear(uuid, text) to authenticated;
