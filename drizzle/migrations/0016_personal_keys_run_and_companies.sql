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
    select coalesce(bool_or(r.role = 'admin'::public.app_role), false),
           coalesce(bool_or(r.role = 'moburst_user'::public.app_role), false)
      into v_admin, v_staff
      from public.user_roles r
     where r.user_id = k.owner_user_id;
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

revoke all on function public.api_key_touch(text) from public, anon, authenticated;
grant execute on function public.api_key_touch(text) to service_role;