-- Design references that refresh themselves (asked for by the social team
-- through Lital, 2 Nov 2026: a client's design references follow its latest
-- posts with no one stepping in).
-- Design: docs/superpowers/specs/2026-11-02-design-refs-refresh-design.md
--
--   1. design_reference_reviews: every post of a client's accounts that the
--      design_refs step looked at, designed or not, so no post is sent to a
--      model twice. Written by the service role only; staff read it.
--   2. design_reference_choices: the posts a person kept or left out, by
--      storage path, saved at once through design_reference_choose(), which
--      looks at the client's lifecycle so its design_refs step runs. A kept
--      post stays; a post left out never returns. Uploads count as kept.
--   3. lifecycle_write_design_library(): the library (reference_paths) on
--      every design settings row, a person's or the lifecycle's. The logo,
--      placement and background keep today's rule
--      (lifecycle_write_design_settings never touches a person's row).
--   4. brand_voice_learnings.platform: a preference for one platform; null
--      for all of them, as every existing preference stays.
--   5. Existing saves converted, once per row (coordinator's decision on the
--      design's open point, 2 Nov 2026, from Lital's "without the user's
--      interference"): a whole-card save on the Design settings card no
--      longer pins references. On every row a person saved, the uploads and
--      posts the card showed that person and that the person left out
--      become "left out", uploads in the saved list become "kept", and posts
--      that were simply in the list get no choice, so those clients refresh.
--      design_refs_conversion records what each row held and what was
--      written; the reversal is at the end of this file.
--
-- Additive and safe to run twice: nothing is dropped but the policies it
-- creates itself, and a row already converted is never converted again.

-- ── 1. Reviews ──────────────────────────────────────────────────────────────

create table if not exists public.design_reference_reviews (
  client_id uuid not null references public.clients(id) on delete cascade,
  source_post_id text not null,
  network text not null default '',
  posted_at timestamptz,
  source_url text,
  content_hash text,
  verdict text not null check (verdict in ('designed', 'not_designed', 'unreadable')),
  path text,
  confidence numeric,
  reason text,
  reviewed_at timestamptz not null default now(),
  primary key (client_id, source_post_id)
);
create index if not exists design_reference_reviews_hash on public.design_reference_reviews (client_id, content_hash);
create index if not exists design_reference_reviews_path on public.design_reference_reviews (client_id, path);
comment on table public.design_reference_reviews is 'Every post the design_refs step looked at: designed (path is its stored image), not designed, or unreadable (its image could not be read; looked at again on a later weekly check). No post is sent to a model twice.';

alter table public.design_reference_reviews enable row level security;
revoke all on public.design_reference_reviews from anon, authenticated;
grant select on public.design_reference_reviews to authenticated;
grant all on public.design_reference_reviews to service_role;
drop policy if exists "Staff read design reference reviews" on public.design_reference_reviews;
create policy "Staff read design reference reviews" on public.design_reference_reviews
  for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));

-- ── 2. A person's choices ───────────────────────────────────────────────────

create table if not exists public.design_reference_choices (
  client_id uuid not null references public.clients(id) on delete cascade,
  path text not null,
  choice text not null check (choice in ('kept', 'left_out')),
  chosen_by uuid,
  chosen_at timestamptz not null default now(),
  source text not null default 'person' check (source in ('person', 'conversion')),
  primary key (client_id, path)
);
comment on table public.design_reference_choices is 'Posts a person kept (they stay in their platform''s library past 90 days and through a look change) or left out (never return). source conversion: written once by 20261109150000_design_refs_refresh.sql from a saved settings row.';

alter table public.design_reference_choices enable row level security;
revoke all on public.design_reference_choices from anon, authenticated;
grant select on public.design_reference_choices to authenticated;
grant all on public.design_reference_choices to service_role;
drop policy if exists "Staff read design reference choices" on public.design_reference_choices;
create policy "Staff read design reference choices" on public.design_reference_choices
  for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));

-- Keep a post, leave it out, or take the choice back ('none'). Staff who can
-- write the client; the path must be one of the client's own references.
create or replace function public.design_reference_choose(p_client uuid, p_path text, p_choice text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_path text := btrim(coalesce(p_path, ''));
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  if not public.can_write_client(p_client) then
    raise exception 'Only Moburst staff can change this client''s design references.' using errcode = '42501';
  end if;
  if coalesce(p_choice, '') not in ('kept', 'left_out', 'none') then
    raise exception 'Unknown choice.' using errcode = '22023';
  end if;
  if v_path = '' or not (
    exists (select 1 from design_reference_reviews r where r.client_id = p_client and r.path = v_path and r.verdict = 'designed')
    or exists (select 1 from clients c where c.id = p_client and jsonb_typeof(c.design_references) = 'array' and c.design_references ? v_path)
    or exists (select 1 from clients c, jsonb_array_elements(case when jsonb_typeof(c.harvested_design_references) = 'array' then c.harvested_design_references else '[]'::jsonb end) e
                where c.id = p_client and e ->> 'path' = v_path)
  ) then
    raise exception 'That post is not one of this client''s references.' using errcode = '22023';
  end if;
  if p_choice = 'none' then
    delete from design_reference_choices where client_id = p_client and path = v_path;
  else
    insert into design_reference_choices as d (client_id, path, choice, chosen_by, chosen_at, source)
    values (p_client, v_path, p_choice, auth.uid(), now(), 'person')
    on conflict (client_id, path) do update
      set choice = excluded.choice, chosen_by = excluded.chosen_by, chosen_at = excluded.chosen_at, source = 'person';
  end if;
  -- The choice is one of design_refs' inputs: the lifecycle looks now and runs it.
  perform public.lifecycle_enqueue(p_client);
  return jsonb_build_object('path', v_path, 'choice', p_choice);
end $$;

revoke all on function public.design_reference_choose(uuid, text, text) from public, anon;
grant execute on function public.design_reference_choose(uuid, text, text) to authenticated, service_role;

-- ── 3. The library on every settings row ────────────────────────────────────

-- The design_refs step's library, each path once in the order given, at most
-- 16, on the client's settings row whoever set it. Nothing else on the row
-- changes, its date included (the card says when a person set the rest).
-- True when written; an empty list writes nothing.
create or replace function public.lifecycle_write_design_library(p_client uuid, p_reference_paths text[])
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_paths text[];
begin
  select coalesce(array_agg(p order by at), '{}') into v_paths
    from (select p, min(i) as at
            from unnest(coalesce(p_reference_paths, '{}')) with ordinality as u(p, i)
           where coalesce(btrim(p), '') <> ''
           group by p
           order by min(i)
           limit 16) s;
  if cardinality(v_paths) = 0 then
    return false;
  end if;
  update design_brand_settings set reference_paths = v_paths
   where client_id = p_client and reference_paths is distinct from v_paths;
  return found;
end $$;

revoke all on function public.lifecycle_write_design_library(uuid, text[]) from public, anon, authenticated;
grant execute on function public.lifecycle_write_design_library(uuid, text[]) to service_role;

-- ── 4. A preference for one platform ────────────────────────────────────────

alter table public.brand_voice_learnings add column if not exists platform text;
comment on column public.brand_voice_learnings.platform is 'The platform a preference is for (Instagram, LinkedIn, ...); null when it is for every platform. Writers see all-platform preferences and their own platform''s.';

-- ── 5. Existing saves, converted once ───────────────────────────────────────

create table if not exists public.design_refs_conversion (
  client_id uuid primary key references public.clients(id) on delete cascade,
  converted_at timestamptz not null default now(),
  settings_updated_at timestamptz,
  -- The row's library as the person saved it, before any refresh wrote it.
  reference_paths text[] not null,
  -- The uploads and posts on file, and whether those posts were the ones the card showed (read before the save).
  uploads text[] not null,
  posts text[] not null,
  posts_seen boolean not null,
  -- What the conversion wrote to design_reference_choices.
  left_out text[] not null,
  kept text[] not null
);
comment on table public.design_refs_conversion is 'The one-time conversion of settings rows a person saved (20261109150000_design_refs_refresh.sql): what each row held and the choices written from it. The reversal is at the end of that migration.';

alter table public.design_refs_conversion enable row level security;
revoke all on public.design_refs_conversion from anon, authenticated;
grant all on public.design_refs_conversion to service_role;

-- An upload counts as seen when its file existed when the person saved; a
-- post when the client's posts were read before the save. A row recorded
-- here is never converted again, so running this twice changes nothing.
with saved as (
  select s.client_id, s.updated_at, s.reference_paths,
         coalesce(array(select x from jsonb_array_elements_text(case when jsonb_typeof(c.design_references) = 'array' then c.design_references else '[]'::jsonb end) with ordinality as u(x, i)
                         where coalesce(btrim(x), '') <> '' order by i), '{}') as uploads,
         coalesce(array(select e ->> 'path' from jsonb_array_elements(case when jsonb_typeof(c.harvested_design_references) = 'array' then c.harvested_design_references else '[]'::jsonb end) with ordinality as u(e, i)
                         where coalesce(e ->> 'path', '') <> '' order by i), '{}') as posts,
         (c.design_refs_harvested_at is null or c.design_refs_harvested_at <= s.updated_at) as posts_seen
    from public.design_brand_settings s
    join public.clients c on c.id = s.client_id
   where s.source = 'person'
), seen as (
  select v.*,
         array(select u from unnest(v.uploads) with ordinality as x(u, i)
                where exists (select 1 from storage.objects o where o.bucket_id = 'design-references' and o.name = u and o.created_at <= v.updated_at)
                order by i) as uploads_seen
    from saved v
), recorded as (
  insert into public.design_refs_conversion (client_id, settings_updated_at, reference_paths, uploads, posts, posts_seen, left_out, kept)
  select client_id, updated_at, reference_paths, uploads, posts, posts_seen,
         array(select p from unnest(uploads_seen || case when posts_seen then posts else '{}'::text[] end) with ordinality as x(p, i)
                where not (p = any(reference_paths)) group by p order by min(i)),
         array(select p from unnest(uploads) with ordinality as x(p, i) where p = any(reference_paths) order by i)
    from seen
  on conflict (client_id) do nothing
  returning client_id, left_out, kept
)
insert into public.design_reference_choices (client_id, path, choice, chosen_by, chosen_at, source)
select client_id, p, 'left_out', null::uuid, now(), 'conversion' from recorded, unnest(left_out) as p
union all
select client_id, p, 'kept', null::uuid, now(), 'conversion' from recorded, unnest(kept) as p
on conflict (client_id, path) do nothing;

-- ── The OAuth guards on the tables this migration creates ───────────────────
-- As 20261109120000_claude_connector.sql adds them to every table with row
-- level security: a session from the Claude connector reads and never writes.

drop policy if exists "OAuth sessions cannot insert" on public.design_reference_reviews;
create policy "OAuth sessions cannot insert" on public.design_reference_reviews as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.design_reference_reviews;
create policy "OAuth sessions cannot update" on public.design_reference_reviews as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.design_reference_reviews;
create policy "OAuth sessions cannot delete" on public.design_reference_reviews as restrictive for delete to authenticated using (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot insert" on public.design_reference_choices;
create policy "OAuth sessions cannot insert" on public.design_reference_choices as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.design_reference_choices;
create policy "OAuth sessions cannot update" on public.design_reference_choices as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.design_reference_choices;
create policy "OAuth sessions cannot delete" on public.design_reference_choices as restrictive for delete to authenticated using (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot insert" on public.design_refs_conversion;
create policy "OAuth sessions cannot insert" on public.design_refs_conversion as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.design_refs_conversion;
create policy "OAuth sessions cannot update" on public.design_refs_conversion as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.design_refs_conversion;
create policy "OAuth sessions cannot delete" on public.design_refs_conversion as restrictive for delete to authenticated using (not (select public.is_oauth_session()));

-- Reversal: as the database owner; a person's own choices made since stay.
--   delete from public.design_reference_choices d using public.design_refs_conversion r
--    where d.client_id = r.client_id and d.source = 'conversion';
--   update public.design_brand_settings s set reference_paths = r.reference_paths
--     from public.design_refs_conversion r where s.client_id = r.client_id;
