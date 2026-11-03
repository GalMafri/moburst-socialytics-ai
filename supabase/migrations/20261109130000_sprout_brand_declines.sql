-- Sprout brands a person chose not to add as clients. Spec:
-- docs/superpowers/specs/2026-11-02-sprout-auto-onboarding-design.md
--
-- The weekly Sprout onboarding (run-scheduled-jobs/sproutOnboarding.ts)
-- makes a client of every new Sprout brand it may. On 2 Nov 2026 the team
-- chose to add all of the dry run's brands but two. Lital's rule forbids a
-- hand-kept list in code, so that decision is data, the way a person's
-- removal of a profile is (sprout_profile_removals): the job reads this
-- table once a run and leaves a brand alone for good when its Sprout group,
-- or any of its profiles, is declined here.
--
--   1. public.sprout_brand_declines: one row per decision, by Sprout group
--      (one per group) and by profile ids. Staff read it; the service role
--      does anything; an OAuth session (the Claude connector) never writes.
--   2. sprout_brand_decline and sprout_brand_undecline: how staff record and
--      take back a decision. Each refuses an OAuth session first, then
--      anyone who is not staff (the service role may).
--
-- Additive and safe to run twice.

-- ── 1. The decisions ────────────────────────────────────────────────────────

create table if not exists public.sprout_brand_declines (
  id uuid primary key default gen_random_uuid(),
  sprout_group_id text,
  profile_ids bigint[] not null default '{}',
  brand text not null,
  declined_by uuid references auth.users(id) on delete set null,
  declined_at timestamptz not null default now(),
  note text,
  constraint sprout_brand_declines_brand_named check (btrim(brand) <> ''),
  constraint sprout_brand_declines_has_target check (sprout_group_id is not null or cardinality(profile_ids) > 0)
);

create unique index if not exists sprout_brand_declines_group on public.sprout_brand_declines (sprout_group_id)
  where sprout_group_id is not null;

comment on table public.sprout_brand_declines is 'Sprout brands a person chose not to add as clients. The weekly Sprout onboarding leaves a brand alone for good when its Sprout group, or any of its profiles, is here.';
comment on column public.sprout_brand_declines.sprout_group_id is 'The Sprout group the decision covers (group_id from Sprout''s metadata/customer/groups); one decision per group.';
comment on column public.sprout_brand_declines.profile_ids is 'Sprout profile ids the decision covers (customer_profile_id); a brand with any of them is declined.';
comment on column public.sprout_brand_declines.brand is 'The brand as the person saw it when they decided.';

alter table public.sprout_brand_declines enable row level security;
revoke all on public.sprout_brand_declines from public, anon, authenticated;
grant select on public.sprout_brand_declines to authenticated;
grant select, insert, update, delete on public.sprout_brand_declines to service_role;

drop policy if exists "Staff read Sprout brand declines" on public.sprout_brand_declines;
create policy "Staff read Sprout brand declines" on public.sprout_brand_declines
  for select to authenticated using (public.is_moburst_staff());

drop policy if exists "Service role manages Sprout brand declines" on public.sprout_brand_declines;
create policy "Service role manages Sprout brand declines" on public.sprout_brand_declines
  for all to service_role using (true) with check (true);

-- As 20261109120000_claude_connector.sql gives every table: an OAuth session reads, never writes.
drop policy if exists "OAuth sessions cannot insert" on public.sprout_brand_declines;
create policy "OAuth sessions cannot insert" on public.sprout_brand_declines as restrictive for insert to authenticated
  with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.sprout_brand_declines;
create policy "OAuth sessions cannot update" on public.sprout_brand_declines as restrictive for update to authenticated
  using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.sprout_brand_declines;
create policy "OAuth sessions cannot delete" on public.sprout_brand_declines as restrictive for delete to authenticated
  using (not (select public.is_oauth_session()));

-- ── 2. Recording and taking back a decision ─────────────────────────────────

-- A brand a person chose not to add, by its Sprout group and its profiles.
-- Deciding again for the same group keeps the first decision's date and
-- person and adds the profiles; the same profiles with no group are one
-- decision too. Answers the decision's id.
create or replace function public.sprout_brand_decline(p_group_id text, p_profile_ids bigint[], p_brand text, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_group text := nullif(btrim(coalesce(p_group_id, '')), '');
  v_ids bigint[] := array(select distinct x from unnest(coalesce(p_profile_ids, '{}'::bigint[])) as x where x is not null order by x);
  v_brand text := btrim(coalesce(p_brand, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  if not (coalesce(auth.role(), '') = 'service_role' or public.is_moburst_staff()) then
    raise exception 'Only Moburst staff can decide which Sprout brands become clients.' using errcode = '42501';
  end if;
  if v_brand = '' then raise exception 'A declined brand needs its name.'; end if;
  if v_group is null and cardinality(v_ids) = 0 then raise exception 'A declined brand needs its Sprout group or its profiles.'; end if;

  if v_group is not null then
    insert into public.sprout_brand_declines as d (sprout_group_id, profile_ids, brand, declined_by, note)
    values (v_group, v_ids, v_brand, auth.uid(), v_note)
    on conflict (sprout_group_id) where sprout_group_id is not null do update
       set profile_ids = array(select distinct x from unnest(d.profile_ids || excluded.profile_ids) as x order by x),
           brand = excluded.brand,
           note = coalesce(excluded.note, d.note)
    returning d.id into v_id;
  else
    select id into v_id from public.sprout_brand_declines where sprout_group_id is null and profile_ids = v_ids limit 1;
    if v_id is null then
      insert into public.sprout_brand_declines (profile_ids, brand, declined_by, note)
      values (v_ids, v_brand, auth.uid(), v_note)
      returning id into v_id;
    end if;
  end if;
  return v_id;
end $$;

-- A decision taken back: the brand is looked at again on the next run. True when there was one.
create or replace function public.sprout_brand_undecline(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  if not (coalesce(auth.role(), '') = 'service_role' or public.is_moburst_staff()) then
    raise exception 'Only Moburst staff can decide which Sprout brands become clients.' using errcode = '42501';
  end if;
  delete from public.sprout_brand_declines where id = p_id;
  return found;
end $$;

revoke all on function public.sprout_brand_decline(text, bigint[], text, text) from public, anon;
grant execute on function public.sprout_brand_decline(text, bigint[], text, text) to authenticated, service_role;
revoke all on function public.sprout_brand_undecline(uuid) from public, anon;
grant execute on function public.sprout_brand_undecline(uuid) to authenticated, service_role;
