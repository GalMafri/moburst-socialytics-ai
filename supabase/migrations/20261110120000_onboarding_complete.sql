-- Onboarding that completes itself from the client's social profiles (Lital,
-- 3 Nov 2026). Spec: docs/superpowers/specs/2026-11-03-onboarding-complete-design.md
--
-- The new social_read step (_shared/lifecycle/socialRead.ts) fills a
-- client's logo, brand identity, time zone, regions and languages from its
-- Sprout profiles and posts, and the website's values replace them once a
-- website is found. Which value may replace which depends on where each one
-- came from, so the lifecycle's one write records it:
--
--   1. lifecycle_write_client takes an optional "_from" object in p_fields
--      ({"logo_url": "profile_picture:linkedin", "language": "posts"}) and
--      records each written field's source as field_sources[field].from.
--      A field written without one has no "from" afterwards. Nothing else
--      about the function changes: a field a person set is still skipped,
--      the portal's still skipped by the lifecycle, and the server alone may
--      call it.
--   2. The column comments say so, and name the location's new sources.
--
-- No table, column or person-callable function is added. Additive and safe
-- to run twice.

-- ── 1. The lifecycle's write records where each value came from ────────────

-- As in 20261019220000_lifecycle_steps.sql, with "_from".
create or replace function public.lifecycle_write_client(p_client uuid, p_fields jsonb, p_by text default 'lifecycle')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.clients;
  v_rec public.clients;
  k text;
  v_gov text;
  v_owner text;
  v_from jsonb := coalesce(p_fields -> '_from', '{}'::jsonb);
  v_fields jsonb := p_fields - '_from';
  v_entry jsonb;
  v_set text[] := '{}';
  v_written text[] := '{}';
  v_skipped text[] := '{}';
  v_sources jsonb;
begin
  if p_by not in ('lifecycle', 'portal') then raise exception 'Unknown writer %', p_by; end if;
  if jsonb_typeof(v_from) <> 'object' then raise exception 'The sources of the values must be an object'; end if;
  select * into v_row from public.clients where id = p_client for update;
  if not found then return jsonb_build_object('written', '[]'::jsonb, 'skipped', '[]'::jsonb); end if;
  v_rec := jsonb_populate_record(v_row, v_fields);
  v_sources := coalesce(v_row.field_sources, '{}'::jsonb);
  for k in select jsonb_object_keys(v_fields) loop
    if not (k = any (public.lifecycle_tracked_fields() || array['location', 'pillars_source', 'pillars_derived_at'])) then
      raise exception 'The lifecycle does not write %', k;
    end if;
    v_gov := case when k in ('pillars_source', 'pillars_derived_at') then 'content_pillars' else k end;
    v_owner := v_sources -> v_gov ->> 'by';
    if k <> 'location' and (v_owner = 'person' or (v_owner = 'portal' and p_by = 'lifecycle')) then
      v_skipped := v_skipped || k;
      continue;
    end if;
    v_set := v_set || format('%I = ($1).%I', k, k);
    v_written := v_written || k;
    if k = v_gov and k <> 'location' then
      v_entry := jsonb_build_object('by', p_by, 'at', now());
      if jsonb_typeof(v_from -> k) = 'string' and btrim(v_from ->> k) <> '' then
        v_entry := v_entry || jsonb_build_object('from', left(btrim(v_from ->> k), 60));
      end if;
      v_sources := v_sources || jsonb_build_object(k, v_entry);
    end if;
  end loop;
  if cardinality(v_set) > 0 then
    execute 'update public.clients set ' || array_to_string(v_set, ', ') || ', field_sources = $3 where id = $2'
      using v_rec, p_client, v_sources;
  end if;
  return jsonb_build_object('written', to_jsonb(v_written), 'skipped', to_jsonb(v_skipped));
end $$;

revoke all on function public.lifecycle_write_client(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.lifecycle_write_client(uuid, jsonb, text) to service_role;

-- ── 2. What the columns hold ────────────────────────────────────────────────

comment on column public.clients.field_sources is 'Who set each value the client lifecycle writes, and for the lifecycle''s values where it came from: {"field": {"by": "person" | "lifecycle" | "portal", "at": "...", "from": "website" | "posts" | "followers" | "profile_picture:<network>" | ...}}. The lifecycle never writes a field a person set.';
comment on column public.clients.location is 'Where the business is, as the lifecycle read it from the website or the social profiles: timezone, source (schema.org, profile_address, page_footer, page_text, post_text, site_read, post_read, followers, country), country, region, locality, and the website it was read from (none for the social profiles).';
