-- One transaction for a person's role. Both portal bridges used to delete the
-- account's role rows and then insert the new one, two calls. Between them
-- the account had no role, so a tab that loaded in that moment read "no role"
-- and signed the person out. set_user_role writes the new role first and
-- removes the others after, in one function call (one transaction), so the
-- account always has a role. Called by hub-auth-bridge and gos-auth-bridge
-- as the service role. A null role removes every role (the portal no longer
-- grants the person the tool). Safe to run twice.
--
-- set_client_access does the same for a legacy-portal client's companies. The
-- bridge reconciles on every load, and it used to delete the person's
-- client_users rows and insert them again, so another open tab read no
-- clients in between. The wanted rows are written first and the rest removed
-- after, in one function call, so the mapping is never empty while the
-- person still has access. Returns how many clients the person now has.

create or replace function public.set_user_role(p_user_id uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_role is null then
    delete from public.user_roles where user_id = p_user_id;
    return;
  end if;
  insert into public.user_roles (user_id, role) values (p_user_id, p_role)
  on conflict (user_id, role) do nothing;
  delete from public.user_roles where user_id = p_user_id and role <> p_role;
end;
$$;

revoke all on function public.set_user_role(uuid, public.app_role) from public, anon, authenticated;
grant execute on function public.set_user_role(uuid, public.app_role) to service_role;

create or replace function public.set_client_access(p_user_id uuid, p_client_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  wanted uuid[] := coalesce(p_client_ids, '{}'::uuid[]);
begin
  insert into public.client_users (user_id, client_id, role)
  select p_user_id, c, 'viewer' from (select distinct unnest(wanted) as c) w
  on conflict (user_id, client_id) do nothing;
  delete from public.client_users where user_id = p_user_id and not (client_id = any(wanted));
  return (select count(*)::integer from public.client_users where user_id = p_user_id);
end;
$$;

revoke all on function public.set_client_access(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.set_client_access(uuid, uuid[]) to service_role;
