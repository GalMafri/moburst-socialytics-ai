-- Personal API keys: the database half.
-- Design: docs/superpowers/specs/2026-11-09-personal-api-keys-design.md
-- Plan:   docs/superpowers/plans/2026-11-09-personal-api-keys.md (Task 1)
--
-- A personal key belongs to one person and reaches what that person can see
-- in Socialytics, worked out on every call from their role at that moment:
--
--   1. api_keys.owner_user_id: the person a key belongs to. Null for a tool
--      key (made by an admin for a tool, such as the gOS key). The key goes
--      when the person's account goes. A personal key is read only at 120
--      calls a minute, held by a check constraint.
--   2. api_key_touch(p_key_hash), restated from 20261001100000_public_api.sql
--      with the same return columns. A tool key answers exactly as before.
--      For a personal key, reach comes from the owner's roles in user_roles
--      (read by the key's owner, never auth.uid(): the api edge function calls
--      this as the service role):
--        admin         every client: client_ids null and company_slugs null.
--        moburst_user  every client that is not a demo (demo_job_id is null),
--                      sorted. With none, the one id no client has
--                      (00000000-0000-0000-0000-000000000000), because the API
--                      core reads an empty or null list as every client.
--        anything else no row, so the core answers 401. Nothing is served, so
--                      the rate bucket and last_used_at are left as they are.
--      revoked_at and expires_at come back as stored: the core judges them,
--      for personal keys as for tool keys.
--   3. Audit: a trigger on api_requests writes the key's owner as user_id
--      when the row has none, so a personal key's calls read per person. Tool
--      keys have no owner and stay null; a user_id the caller set is kept.
--
-- Additive and safe to run twice.

-- ── 1. Owner ────────────────────────────────────────────────────────────────

alter table public.api_keys add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
create index if not exists api_keys_owner on public.api_keys (owner_user_id);

-- A personal key is read only, at the standard 120 calls a minute, whatever
-- code writes the row. api_key_touch returns scopes as stored and the API core
-- trusts them, so a personal key stored with admin or demo would pass the
-- core's admin and demo checks. Tool keys (no owner) keep any scopes and rate.
alter table public.api_keys drop constraint if exists api_keys_personal_read_only;
alter table public.api_keys add constraint api_keys_personal_read_only
  check (owner_user_id is null or (scopes = array['read']::text[] and rate_limit_per_minute = 120));

-- ── 2. Live reach ───────────────────────────────────────────────────────────

create or replace function public.api_key_touch(p_key_hash text)
returns table (id uuid, name text, key_prefix text, scopes text[], company_slugs text[], client_ids uuid[], rate_limit_per_minute integer, expires_at timestamptz, revoked_at timestamptz, minute_count integer)
language plpgsql security definer set search_path = public as $$
declare
  k public.api_keys%rowtype;
  c integer;
  v_company_slugs text[];
  v_client_ids uuid[];
  v_admin boolean;
  v_staff boolean;
begin
  select * into k from public.api_keys a where a.key_hash = p_key_hash;
  if not found then return; end if;
  v_company_slugs := k.company_slugs;
  v_client_ids := k.client_ids;
  if k.owner_user_id is not null then
    -- A person may have more than one role row: admin wins, then moburst_user.
    select coalesce(bool_or(r.role = 'admin'::public.app_role), false),
           coalesce(bool_or(r.role = 'moburst_user'::public.app_role), false)
      into v_admin, v_staff
      from public.user_roles r
     where r.user_id = k.owner_user_id;
    -- Not staff, or no role at all: no row, and nothing counted against the key.
    if not (v_admin or v_staff) then return; end if;
    v_company_slugs := null;
    if v_admin then
      v_client_ids := null;
    else
      select coalesce(array_agg(cl.id order by cl.id), '{00000000-0000-0000-0000-000000000000}'::uuid[])
        into v_client_ids
        from public.clients cl
       where cl.demo_job_id is null;
    end if;
  end if;
  insert into public.api_rate_buckets (key_id, minute, count) values (k.id, date_trunc('minute', now()), 1)
    on conflict (key_id, minute) do update set count = public.api_rate_buckets.count + 1
    returning public.api_rate_buckets.count into c;
  update public.api_keys set last_used_at = now() where api_keys.id = k.id;
  delete from public.api_rate_buckets b where b.key_id = k.id and b.minute < now() - interval '10 minutes';
  return query select k.id, k.name, k.key_prefix, k.scopes, v_company_slugs, v_client_ids, k.rate_limit_per_minute, k.expires_at, k.revoked_at, c;
end $$;

-- Service role only, as in 20261001100000_public_api.sql.
revoke all on function public.api_key_touch(text) from public, anon, authenticated;
grant execute on function public.api_key_touch(text) to service_role;

-- ── 3. Audit owner ──────────────────────────────────────────────────────────

create or replace function public.api_requests_owner()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null and new.key_id is not null then
    new.user_id := (select k.owner_user_id from public.api_keys k where k.id = new.key_id);
  end if;
  return new;
end $$;

revoke all on function public.api_requests_owner() from public, anon, authenticated;

drop trigger if exists api_requests_owner on public.api_requests;
create trigger api_requests_owner before insert on public.api_requests
  for each row execute function public.api_requests_owner();
