-- Claude connector: the database half.
-- Design: docs/superpowers/specs/2026-11-02-claude-connector-design.md
--
-- The connector (the mcp edge function) signs people in through Supabase
-- Auth's OAuth 2.1 server. The access token it receives carries a client_id
-- claim and is otherwise an ordinary session token for the person: Supabase
-- does not bind it to one resource, so it is valid wherever the person's app
-- session is. This migration keeps such a session read-only everywhere and
-- adds what the connector records:
--
--   1. public.is_oauth_session(): true when the request's token carries
--      client_id. App sessions, the service role, cron and the owner carry
--      none.
--   2. Audit: api_requests gets user_id and oauth_client_id for the
--      connector's rows (method MCP). The 180-day purge covers them.
--   3. Rate limit: mcp_rate_buckets and mcp_rate_touch(p_user), per person
--      per minute, the same shape as api_rate_buckets and api_key_touch.
--      Service role only.
--   4. Three restrictive policies, "OAuth sessions cannot insert / update /
--      delete", on every public table with row level security (the one this
--      migration creates included) and on storage.objects. Restrictive
--      policies are ANDed with every grant, so reads are untouched and every
--      other caller writes exactly as before. A table a later migration
--      creates needs the same three policies (mcp/schema-guards.test.ts).
--   5. The write functions the authenticated role can call run as their
--      owner, who bypasses row level security, so each refuses an OAuth
--      session first. Each is restated from its latest migration with that
--      one check added, and its grants are restated.
--
-- Additive and safe to run twice: nothing is dropped but the policies it
-- creates itself.

-- ── 1. Who is calling ───────────────────────────────────────────────────────

create or replace function public.is_oauth_session()
returns boolean
language sql stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'client_id', '') <> ''
$$;

revoke all on function public.is_oauth_session() from public;
grant execute on function public.is_oauth_session() to anon, authenticated, service_role;

-- ── 2. Audit columns ────────────────────────────────────────────────────────

alter table public.api_requests add column if not exists user_id uuid;
alter table public.api_requests add column if not exists oauth_client_id text;

-- ── 3. Rate limit ───────────────────────────────────────────────────────────

create table if not exists public.mcp_rate_buckets (
  user_id uuid not null,
  minute timestamptz not null,
  count integer not null default 0,
  primary key (user_id, minute)
);
alter table public.mcp_rate_buckets enable row level security;
revoke all on public.mcp_rate_buckets from anon, authenticated;

create or replace function public.mcp_rate_touch(p_user uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  c integer;
begin
  insert into public.mcp_rate_buckets (user_id, minute, count) values (p_user, date_trunc('minute', now()), 1)
    on conflict (user_id, minute) do update set count = public.mcp_rate_buckets.count + 1
    returning public.mcp_rate_buckets.count into c;
  delete from public.mcp_rate_buckets b where b.user_id = p_user and b.minute < now() - interval '10 minutes';
  return c;
end $$;

revoke all on function public.mcp_rate_touch(uuid) from public, anon, authenticated;
grant execute on function public.mcp_rate_touch(uuid) to service_role;

-- ── 4. Tables: an OAuth session reads, never writes ─────────────────────────

do $$
declare
  t record;
begin
  for t in
    select n.nspname as schema_name, c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and c.relrowsecurity and n.nspname = 'public'
    union all
    select 'storage', 'objects'
     where to_regclass('storage.objects') is not null
  loop
    execute format('drop policy if exists "OAuth sessions cannot insert" on %I.%I', t.schema_name, t.table_name);
    execute format('create policy "OAuth sessions cannot insert" on %I.%I as restrictive for insert to authenticated with check (not (select public.is_oauth_session()))', t.schema_name, t.table_name);
    execute format('drop policy if exists "OAuth sessions cannot update" on %I.%I', t.schema_name, t.table_name);
    execute format('create policy "OAuth sessions cannot update" on %I.%I as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()))', t.schema_name, t.table_name);
    execute format('drop policy if exists "OAuth sessions cannot delete" on %I.%I', t.schema_name, t.table_name);
    execute format('create policy "OAuth sessions cannot delete" on %I.%I as restrictive for delete to authenticated using (not (select public.is_oauth_session()))', t.schema_name, t.table_name);
  end loop;
end $$;

-- ── 5. Write functions: each refuses an OAuth session first ─────────────────

-- From 20261108110000_trend_reads_fix.sql, with the first check added.
create or replace function public.trend_term_add(p_client uuid, p_kind text, p_platform text, p_term text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_term text := btrim(coalesce(p_term, ''));
  v_platform text := nullif(btrim(coalesce(p_platform, '')), '');
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
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

-- From 20261102100000_trend_access.sql, with the first check added.
create or replace function public.trend_term_remove(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
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

revoke all on function public.trend_term_remove(uuid) from public, anon;
grant execute on function public.trend_term_remove(uuid) to authenticated;

-- From 20261102100000_trend_access.sql, with the first check added.
create or replace function public.trend_theme_dismiss(p_theme uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
  v_theme public.trend_themes%rowtype;
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
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

revoke all on function public.trend_theme_dismiss(uuid) from public, anon;
grant execute on function public.trend_theme_dismiss(uuid) to authenticated;

-- From 20261108110000_trend_reads_fix.sql, with the first check added.
create or replace function public.trend_search_override_clear(p_client uuid, p_platform text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  if not (public.is_moburst_staff() and public.can_access_client(p_client)) then
    raise exception 'Only Moburst staff can change what trends track.' using errcode = '42501';
  end if;
  update public.trend_profiles set search_overrides = search_overrides - p_platform
   where client_id = p_client and search_overrides ? p_platform;
end $$;

revoke all on function public.trend_search_override_clear(uuid, text) from public, anon;
grant execute on function public.trend_search_override_clear(uuid, text) to authenticated;

-- From 20261019220000_lifecycle_steps.sql, with the first check added.
create or replace function public.lifecycle_request(p_client uuid, p_step text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.is_oauth_session() then
    raise exception 'Connected apps can read Socialytics but cannot change it.' using errcode = '42501';
  end if;
  if not (auth.role() = 'service_role' or public.is_moburst_staff()) then
    raise exception 'Only the Moburst team can refresh this.';
  end if;
  if not exists (select 1 from clients where id = p_client and archived_at is null) then
    raise exception 'No such client.';
  end if;
  if p_step not in ('brand_read', 'brief_pillars', 'accounts', 'access', 'design_refs', 'competitors', 'tracking', 'design_settings', 'first_output') then
    raise exception 'Unknown step %', p_step;
  end if;
  insert into client_lifecycle_steps as s (client_id, step, status, attempted_at)
  values (p_client, p_step, 'running', now())
  on conflict (client_id, step) do update set status = 'running', attempted_at = now(), updated_at = now()
   where s.status <> 'running' or s.attempted_at < now() - interval '30 minutes';
  if not found then return; end if;
  insert into scheduled_jobs (kind, client_id, payload, dedupe_key, priority, available_at)
  values ('lifecycle_step', p_client, jsonb_build_object('step', p_step, 'force', true, 'why', 'person'),
          'lifecycle_step:' || p_step || ':' || p_client || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 12, now());
end $$;

revoke all on function public.lifecycle_request(uuid, text) from public, anon;
grant execute on function public.lifecycle_request(uuid, text) to authenticated, service_role;
