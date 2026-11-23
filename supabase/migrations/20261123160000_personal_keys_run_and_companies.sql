-- Personal API keys, made on the API page (account menu > API > Tokens):
--
--   1. Read & write. A personal key is read only ({read}) or read and write
--      ({read,run}): the run scope starts the work people start in the app
--      (the public actions, supabase/functions/_shared/socialytics-api/
--      actions.ts) for the clients the key reaches, acting as its owner.
--      Still 120 calls a minute; still never admin, demo or costs, which stay
--      on tool keys an admin makes.
--   2. Companies. A personal key may name the companies it is for
--      (api_keys.company_slugs). api_key_touch, restated from
--      20261111120000_personal_api_keys.sql with the same return columns,
--      works out the owner's reach from their role on every call as before
--      (an admin every client, a Moburst user every client that is not a
--      demo, anyone else nothing) and then narrows it to those companies'
--      clients. A key that names none reaches all of it, as before. The
--      answer carries client ids only (company_slugs null), with the one id
--      no client has when nothing is left, because the API core reads an
--      empty or null list as every client.
--
-- Tool keys (no owner) answer exactly as before. Additive and safe to run twice.

alter table public.api_keys drop constraint if exists api_keys_personal_read_only;
alter table public.api_keys add constraint api_keys_personal_read_only
  check (owner_user_id is null or ((scopes = array['read']::text[] or scopes = array['read', 'run']::text[]) and rate_limit_per_minute = 120));

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
  v_named boolean;
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
    v_named := coalesce(array_length(k.company_slugs, 1), 0) > 0;
    v_company_slugs := null;
    if v_admin and not v_named then
      v_client_ids := null;
    else
      select coalesce(array_agg(cl.id order by cl.id), '{00000000-0000-0000-0000-000000000000}'::uuid[])
        into v_client_ids
        from public.clients cl
       where (v_admin or cl.demo_job_id is null)
         and (not v_named or cl.company_slug = any(k.company_slugs));
    end if;
  end if;
  insert into public.api_rate_buckets (key_id, minute, count) values (k.id, date_trunc('minute', now()), 1)
    on conflict (key_id, minute) do update set count = public.api_rate_buckets.count + 1
    returning public.api_rate_buckets.count into c;
  update public.api_keys set last_used_at = now() where api_keys.id = k.id;
  delete from public.api_rate_buckets b where b.key_id = k.id and b.minute < now() - interval '10 minutes';
  return query select k.id, k.name, k.key_prefix, k.scopes, v_company_slugs, v_client_ids, k.rate_limit_per_minute, k.expires_at, k.revoked_at, c;
end $$;

-- Service role only, as before.
revoke all on function public.api_key_touch(text) from public, anon, authenticated;
grant execute on function public.api_key_touch(text) to service_role;
