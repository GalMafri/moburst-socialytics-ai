-- The Higgsfield refresh and access tokens move from plain columns on
-- integration_tokens into Vault, the way Google's refresh token is kept
-- (20261110170000_strategy_v2.sql). Only the service role may run these; the
-- check inside each is a second lock behind the grants.
--
-- The release works in either order, with nobody doing a step by hand. This
-- migration only adds the functions and copies the stored pair into Vault; it
-- leaves the columns as they are, so the code that is still running reads
-- them. The new code reads the columns first (a pair there is newer than any
-- copy in Vault, because the old code keeps rotating it there) and then
-- Vault, and falls back to the columns when these functions do not exist yet.
-- The first save through higgsfield_tokens_save (a refresh or a sign-in) puts
-- both tokens in Vault and empties the columns in the same transaction, so
-- there is no moment with a stale pair on the columns beside a newer one in
-- Vault. The columns stay (Canva's row uses them).

create or replace function public.higgsfield_tokens_save(p_refresh text, p_access text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the server can store the Higgsfield sign-in.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_refresh, '')) = '' or btrim(coalesce(p_access, '')) = '' then
    raise exception 'There is no Higgsfield sign-in to store.' using errcode = '22023';
  end if;

  select id into v_id from vault.secrets where name = 'socialytics_higgsfield_refresh_token';
  if v_id is null then
    perform vault.create_secret(p_refresh, 'socialytics_higgsfield_refresh_token', 'Higgsfield refresh token of the team account, for Socialytics generation');
  else
    perform vault.update_secret(v_id, p_refresh);
  end if;

  select id into v_id from vault.secrets where name = 'socialytics_higgsfield_access_token';
  if v_id is null then
    perform vault.create_secret(p_access, 'socialytics_higgsfield_access_token', 'Higgsfield access token of the team account, for Socialytics generation');
  else
    perform vault.update_secret(v_id, p_access);
  end if;

  -- Same transaction: the pair now lives in Vault only.
  update public.integration_tokens set refresh_token = null, access_token = null where provider = 'higgsfield';
end $$;

create or replace function public.higgsfield_tokens_read()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_refresh text;
  v_access text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the server can read the Higgsfield sign-in.' using errcode = '42501';
  end if;
  select decrypted_secret into v_refresh from vault.decrypted_secrets where name = 'socialytics_higgsfield_refresh_token';
  select decrypted_secret into v_access from vault.decrypted_secrets where name = 'socialytics_higgsfield_access_token';
  if v_refresh is null then
    return null;
  end if;
  return jsonb_build_object('refresh_token', v_refresh, 'access_token', v_access);
end $$;

revoke all on function public.higgsfield_tokens_save(text, text) from public, anon, authenticated;
revoke all on function public.higgsfield_tokens_read() from public, anon, authenticated;
grant execute on function public.higgsfield_tokens_save(text, text) to service_role;
grant execute on function public.higgsfield_tokens_read() to service_role;

-- Copy what is stored now into Vault, and leave the columns alone. No refresh
-- token stored means nothing to copy, and a pair already in Vault is kept. A
-- link with no access token is copied with a placeholder, which the server
-- reads as expired (the row's expiry is empty) and refreshes on first use.
do $$
declare
  v_refresh text;
  v_access text;
begin
  select refresh_token, access_token into v_refresh, v_access
  from public.integration_tokens where provider = 'higgsfield';
  if btrim(coalesce(v_refresh, '')) <> '' then
    if not exists (select 1 from vault.secrets where name = 'socialytics_higgsfield_refresh_token') then
      perform vault.create_secret(v_refresh, 'socialytics_higgsfield_refresh_token', 'Higgsfield refresh token of the team account, for Socialytics generation');
    end if;
    if not exists (select 1 from vault.secrets where name = 'socialytics_higgsfield_access_token') then
      perform vault.create_secret(coalesce(nullif(btrim(v_access), ''), 'expired'), 'socialytics_higgsfield_access_token', 'Higgsfield access token of the team account, for Socialytics generation');
    end if;
  end if;
end $$;
