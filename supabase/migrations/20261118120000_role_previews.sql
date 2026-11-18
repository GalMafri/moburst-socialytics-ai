-- supabase/migrations/20261118120000_role_previews.sql
--
-- Preview as a client (18 Nov 2026): the record of each preview, and the
-- two functions that switch a person into one and back.
--
-- Since 9 Nov every moburst.com address signs in as a Moburst user, never as
-- a client, in both Hubs. That rule stays. It left nobody at Moburst able to
-- see what a client sees, so a staff member can now choose one client and
-- use Socialytics as a client user of exactly that client until they choose
-- "Exit preview". The switch is real: the person holds the client role, one
-- client link (client_users) and a profile with no company of its own, so
-- every access rule answers for them as for a real client user of that
-- client.
--
-- 1. The table. One row per preview: who, which client, when it started and
--    ended, and what the person had before (role, client links, the two
--    profile fields the access rules read), so Exit puts back exactly that.
--    A person has at most one open preview (the partial unique index).
--
--    The client is kept by name as well as by id, and the id is cleared (not
--    the row removed) if the client is deleted while the preview is open:
--    the row is the person's only way back to their own role.
--
--    Who reaches the table:
--      * a person reads their own rows (the app needs to know a preview is
--        open to show the band and the Exit button);
--      * an admin reads every row;
--      * nobody writes it directly, the service role included: rows are
--        written only by the two functions below. A row names the role a
--        person goes back to, so a row someone could write would be a way
--        to become an admin.
--      * the three restrictive policies every table carries keep a
--        connected app (an OAuth session) from writing even if a policy
--        were ever added (supabase/tests/mcp/schema-guards.test.ts).
--
-- 2. role_preview_begin and role_preview_end. Each switch is ONE function
--    call, so one transaction: the role, the client link, the profile
--    fields and the row change together or not at all. A person is never a
--    client without an open row to leave by, and never staff with one.
--
--    Each function first locks the person's rows in user_roles, then decides
--    from what it reads under that lock. A sign-in through either Hub
--    writes the role with set_user_role, in a transaction of its own that
--    knows nothing about previews. With the lock, that write either
--    finished before the decision, and the decision sees it, or waits and
--    lands after the switch, and wins. So a person the Hub removed a moment
--    ago cannot be made a client, and Exit cannot write a saved staff role
--    over a role a sign-in or a removal has just written. The role is
--    changed by updating the locked row in place, never by adding a second
--    row, so a waiting sign-in write sees the changed row and replaces it.
--
--    Only the role-preview edge function calls them, as the service role.
--
-- Safe to run twice.

create table if not exists public.role_previews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text,
  previous_role public.app_role not null,
  previous_client_ids uuid[] not null default '{}'::uuid[],
  previous_hub_company_name text,
  previous_allowed_company_slugs text[],
  constraint role_previews_previous_role_is_staff check (previous_role in ('admin'::public.app_role, 'moburst_user'::public.app_role)),
  constraint role_previews_ended_reason_known check (ended_reason is null or ended_reason in ('exited', 'expired', 'role_changed')),
  constraint role_previews_ended_with_reason check ((ended_at is null) = (ended_reason is null))
);

comment on table public.role_previews is 'Each time a staff member used Socialytics as a client user of one client: who, which client, when, and what they had before, so leaving the preview puts it back. Written only by role_preview_begin and role_preview_end.';
comment on column public.role_previews.client_id is 'The client previewed. Cleared, with the row kept, if that client is deleted.';
comment on column public.role_previews.ended_reason is 'exited: the person chose Exit preview. expired: it was open longer than 8 hours. role_changed: the person no longer held the preview''s role when it was checked (a sign-in rewrote it), so nothing was put back.';
comment on column public.role_previews.previous_role is 'The staff role the person held when the preview started, and goes back to.';
comment on column public.role_previews.previous_client_ids is 'The client links (client_users) the person had before the preview.';
comment on column public.role_previews.previous_hub_company_name is 'profiles.hub_company_name before the preview. The preview clears it so a company name cannot open a second client.';
comment on column public.role_previews.previous_allowed_company_slugs is 'profiles.allowed_company_slugs before the preview. The preview empties it for the same reason.';

-- One open preview per person.
create unique index if not exists role_previews_one_open on public.role_previews (user_id) where ended_at is null;

alter table public.role_previews enable row level security;
revoke all on table public.role_previews from public, anon, authenticated;
grant select on table public.role_previews to authenticated;
revoke all on table public.role_previews from service_role;
grant select on table public.role_previews to service_role;

drop policy if exists "A person reads their own previews" on public.role_previews;
create policy "A person reads their own previews" on public.role_previews
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Admins read every preview" on public.role_previews;
create policy "Admins read every preview" on public.role_previews
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "OAuth sessions cannot insert" on public.role_previews;
create policy "OAuth sessions cannot insert" on public.role_previews as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.role_previews;
create policy "OAuth sessions cannot update" on public.role_previews as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.role_previews;
create policy "OAuth sessions cannot delete" on public.role_previews as restrictive for delete to authenticated using (not (select public.is_oauth_session()));

-- True when the person is in exactly the state a preview of this client put
-- them in: the client role and no other, the one client link (none once the
-- client is deleted), and no company on the profile. No sign-in leaves that
-- state behind: a sign-in that links clients also writes a company name, and
-- one that writes no company name links no client.
create or replace function public.role_preview_holds(p_user uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select count(*) = 1 and bool_and(role = 'client'::public.app_role) from public.user_roles where user_id = p_user), false)
    and (select coalesce(array_agg(client_id order by client_id), '{}'::uuid[]) from public.client_users where user_id = p_user)
        = (case when p_client is null then '{}'::uuid[] else array[p_client] end)
    and not exists (
      select 1 from public.profiles
      where user_id = p_user
        and (hub_company_name is not null or allowed_company_slugs is null or cardinality(allowed_company_slugs) > 0)
    )
$$;

revoke all on function public.role_preview_holds(uuid, uuid) from public, anon, authenticated;
grant execute on function public.role_preview_holds(uuid, uuid) to service_role;

-- Starts a preview of one client for a staff member. Answers with a code:
--   started            the person is now a client user of that client
--   already_previewing they are in a preview already (it is returned)
--   not_staff          their role, read here under the lock, is not admin
--                      or moburst_user (a client, or someone the Hub removed)
--   client_not_found   no such client, or a demo client and not an admin
--   client_archived    the client is archived
-- Nothing is written for the last three.
create or replace function public.role_preview_begin(p_user uuid, p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open public.role_previews;
  v_row public.role_previews;
  v_role_id uuid;
  v_previous public.app_role;
  v_name text;
  v_archived timestamptz;
  v_demo uuid;
  v_links uuid[];
  v_company text;
  v_slugs text[];
begin
  -- The lock, taken twice. The first statement may have waited for a sign-in
  -- that replaced the person's role row; a row written by that sign-in is
  -- not in the first statement's view, so the second locks what is there now.
  perform 1 from public.user_roles where user_id = p_user for update;
  perform 1 from public.user_roles where user_id = p_user for update;

  select * into v_open from public.role_previews where user_id = p_user and ended_at is null for update;
  if found then
    if public.role_preview_holds(p_user, v_open.client_id) then
      return jsonb_build_object('code', 'already_previewing', 'preview', jsonb_build_object(
        'id', v_open.id, 'client_id', v_open.client_id, 'client_name', v_open.client_name, 'started_at', v_open.started_at));
    end if;
    -- A sign-in took the person out of that preview: its row is closed and
    -- nothing is put back, as in role_preview_end.
    update public.role_previews set ended_at = now(), ended_reason = 'role_changed' where id = v_open.id;
  end if;

  select id, role into v_role_id, v_previous
    from public.user_roles
   where user_id = p_user and role in ('admin'::public.app_role, 'moburst_user'::public.app_role)
   order by (role = 'admin'::public.app_role) desc
   limit 1;
  if not found then
    return jsonb_build_object('code', 'not_staff');
  end if;

  select name, archived_at, demo_job_id into v_name, v_archived, v_demo from public.clients where id = p_client;
  -- A demo client is for admins only: to anyone else it does not exist.
  if not found or (v_demo is not null and v_previous <> 'admin'::public.app_role) then
    return jsonb_build_object('code', 'client_not_found');
  end if;
  if v_archived is not null then
    return jsonb_build_object('code', 'client_archived');
  end if;

  select coalesce(array_agg(client_id order by client_id), '{}'::uuid[]) into v_links from public.client_users where user_id = p_user;
  select hub_company_name, allowed_company_slugs into v_company, v_slugs from public.profiles where user_id = p_user;

  insert into public.role_previews (user_id, client_id, client_name, previous_role, previous_client_ids, previous_hub_company_name, previous_allowed_company_slugs)
  values (p_user, p_client, v_name, v_previous, v_links, v_company, v_slugs)
  returning * into v_row;

  -- No company name and an empty company list, so only the client link below
  -- can open a client. The link is written with the bridges' own function.
  update public.profiles set hub_company_name = null, allowed_company_slugs = '{}'::text[] where user_id = p_user;
  perform public.set_client_access(p_user, array[p_client]);
  -- The role: the locked staff row becomes the client row, and any other
  -- role row the person held goes.
  delete from public.user_roles where user_id = p_user and id <> v_role_id;
  update public.user_roles set role = 'client'::public.app_role where id = v_role_id;

  return jsonb_build_object('code', 'started', 'preview', jsonb_build_object(
    'id', v_row.id, 'client_id', v_row.client_id, 'client_name', v_row.client_name, 'started_at', v_row.started_at));
end;
$$;

revoke all on function public.role_preview_begin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.role_preview_begin(uuid, uuid) to service_role;

-- Ends a preview, or leaves it open. p_reason is why the caller asks:
--   exited  the person chose Exit preview: end it now
--   check   a routine look: end it only if it is already over
-- What it answers, as {open, ended}:
--   * the row is closed already, or does not exist: open false, ended null;
--   * the person is no longer in the preview's exact state, because a
--     sign-in or a removal wrote their role since it began: the row is
--     closed as role_changed and NOTHING is put back, since what the Hub
--     wrote is newer and correct;
--   * a check of a preview less than 8 hours old: open true, nothing changes;
--   * otherwise the person is put back exactly as they were (the role by
--     updating the locked row, the client links, the two profile fields) and
--     the row is closed, as exited or, for a check after 8 hours, expired.
create or replace function public.role_preview_end(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_row public.role_previews;
  v_reason text;
begin
  if p_reason is null or p_reason not in ('exited', 'check') then
    raise exception 'role_preview_end: unknown reason %', p_reason using errcode = '22023';
  end if;

  select user_id into v_user from public.role_previews where id = p_id;
  if not found then
    return jsonb_build_object('open', false, 'ended', null);
  end if;

  -- The same lock, in the same order, as role_preview_begin.
  perform 1 from public.user_roles where user_id = v_user for update;
  perform 1 from public.user_roles where user_id = v_user for update;
  select * into v_row from public.role_previews where id = p_id and ended_at is null for update;
  if not found then
    return jsonb_build_object('open', false, 'ended', null);
  end if;

  if not public.role_preview_holds(v_user, v_row.client_id) then
    update public.role_previews set ended_at = now(), ended_reason = 'role_changed' where id = p_id;
    return jsonb_build_object('open', false, 'ended', 'role_changed');
  end if;

  if p_reason = 'check' then
    if v_row.started_at > now() - interval '8 hours' then
      return jsonb_build_object('open', true, 'ended', null);
    end if;
    v_reason := 'expired';
  else
    v_reason := 'exited';
  end if;

  -- The person holds exactly one role row, the client one (checked above).
  update public.user_roles set role = v_row.previous_role where user_id = v_user;
  perform public.set_client_access(v_user, v_row.previous_client_ids);
  update public.profiles
     set hub_company_name = v_row.previous_hub_company_name, allowed_company_slugs = v_row.previous_allowed_company_slugs
   where user_id = v_user;
  update public.role_previews set ended_at = now(), ended_reason = v_reason where id = p_id;
  return jsonb_build_object('open', false, 'ended', v_reason);
end;
$$;

revoke all on function public.role_preview_end(uuid, text) from public, anon, authenticated;
grant execute on function public.role_preview_end(uuid, text) to service_role;
