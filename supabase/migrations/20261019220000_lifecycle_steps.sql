-- The client lifecycle's steps after design_refs (Lital, 19 Oct 2026: a
-- self-serve app; nothing waits for a person or a developer session, and the
-- product never overwrites what a person set). Spec, section 1:
-- docs/superpowers/specs/2026-10-19-self-serve-lifecycle-design.md
-- The steps themselves are _shared/lifecycle/steps.ts.
--
--   1. clients.field_sources: who set each value the lifecycle writes
--      ({"timezone": {"by": "person" | "lifecycle" | "portal", "at": ...}}).
--      A person's save through the app marks the fields it changed, by
--      trigger; the lifecycle writes only through lifecycle_write_client,
--      which skips a field a person set. Every value already on a client is
--      marked as set by a person (a client the API demo made: by the
--      lifecycle), except a default nobody chose (UTC, US, en, the four
--      default platforms, the five generic pillars).
--   2. clients.location: where the business is and the source of its
--      timezone, as the brand_read step read it.
--   3. sprout_profile_removals: a profile a person removed from a client,
--      which the accounts step never assigns again.
--   4. design_brand_settings.source and derived: settings the lifecycle
--      derived (confirmed by the system, confirmed_by null) or a person set;
--      the lifecycle never replaces a person's.
--   5. 'lifecycle' as a calendar plan trigger, and lifecycle_first_output.
--   6. Every step can be asked for again (lifecycle_request), and the client
--      is looked at again when a step's input changes.

alter table public.clients add column if not exists field_sources jsonb not null default '{}'::jsonb;
alter table public.clients add column if not exists location jsonb;
comment on column public.clients.field_sources is 'Who set each value the client lifecycle writes: {"field": {"by": "person" | "lifecycle" | "portal", "at": "..."}}. The lifecycle never writes a field a person set.';
comment on column public.clients.location is 'Where the business is, as the lifecycle read it from the website: timezone, source (schema.org, page_footer, page_text, site_read, country), country, region, locality.';

-- The client fields the lifecycle writes and a person's save marks.
create or replace function public.lifecycle_tracked_fields()
returns text[]
language sql immutable as $$
  select array['brand_identity', 'logo_url', 'timezone', 'geo', 'language', 'brief_text', 'content_pillars',
               'social_keywords', 'primary_platforms', 'company_slug', 'hub_company_name']
$$;

-- Whether a value is one somebody chose: not empty, and not a default the
-- setup page or the table filled in on its own.
create or replace function public.client_value_is_set(p_field text, p_value jsonb)
returns boolean
language plpgsql immutable as $$
declare
  v_names text[];
begin
  if p_value is null or p_value = 'null'::jsonb then return false; end if;
  if jsonb_typeof(p_value) = 'string' and btrim(p_value #>> '{}') = '' then return false; end if;
  if p_value = '[]'::jsonb or p_value = '{}'::jsonb then return false; end if;
  if p_field = 'timezone' and p_value #>> '{}' = 'UTC' then return false; end if;
  if p_field = 'geo' and p_value #>> '{}' = 'US' then return false; end if;
  if p_field = 'language' and p_value #>> '{}' = 'en' then return false; end if;
  if p_field = 'primary_platforms' and p_value = '["Instagram", "TikTok", "Facebook", "LinkedIn"]'::jsonb then return false; end if;
  if p_field = 'content_pillars' and jsonb_typeof(p_value) = 'array' then
    select array_agg(coalesce(e ->> 'name', e #>> '{}') order by o) into v_names
      from jsonb_array_elements(p_value) with ordinality as t(e, o);
    if v_names = array['Thought Leadership', 'Product Education', 'Client Wins', 'Industry Trends', 'Team Culture']
       and not exists (select 1 from jsonb_array_elements(p_value) e
                        where jsonb_typeof(e) = 'object' and coalesce(btrim(e ->> 'description'), '') <> '') then
      return false;
    end if;
  end if;
  return true;
end $$;

-- Every value already on a client was set by a person (or, on a client the
-- API demo made, by the onboarding chain), unless it is a default. Rows keep
-- their updated_at.
alter table public.clients disable trigger update_clients_updated_at;
update public.clients c
   set field_sources = coalesce(c.field_sources, '{}'::jsonb) || coalesce((
         select jsonb_object_agg(f, jsonb_build_object('by', case when c.demo_job_id is null then 'person' else 'lifecycle' end,
                                                      'at', now(), 'from', 'before_lifecycle'))
           from unnest(public.lifecycle_tracked_fields()) f
          where public.client_value_is_set(f, to_jsonb(c) -> f)), '{}'::jsonb);
alter table public.clients enable trigger update_clients_updated_at;

-- A person's save marks what it changed. A person is a signed-in user of the
-- app; the server (the service role) and migrations mark nothing here, and
-- the lifecycle marks its own writes in lifecycle_write_client. A new client
-- a person creates has its chosen values marked, never the defaults. A
-- person who empties a field, or puts a default back (UTC, the generic
-- pillars), hands the field back to the product: a stale form that still
-- holds a default can never pin it.
create or replace function public.clients_mark_person_fields()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f text;
  v_new jsonb;
  v_old jsonb;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  v_new := to_jsonb(new);
  if tg_op = 'UPDATE' then v_old := to_jsonb(old); end if;
  foreach f in array public.lifecycle_tracked_fields() loop
    if tg_op = 'UPDATE' and (v_new -> f) is not distinct from (v_old -> f) then continue; end if;
    if public.client_value_is_set(f, v_new -> f) then
      new.field_sources := coalesce(new.field_sources, '{}'::jsonb) || jsonb_build_object(f, jsonb_build_object('by', 'person', 'at', now()));
    elsif tg_op = 'UPDATE' then
      new.field_sources := coalesce(new.field_sources, '{}'::jsonb) - f;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists clients_field_sources on public.clients;
create trigger clients_field_sources before insert or update on public.clients
  for each row execute function public.clients_mark_person_fields();

-- The lifecycle's (and the portal sign-in's) only way to write client
-- fields: a field a person set is skipped, a field the portal set is skipped
-- by the lifecycle, and what was written is recorded. pillars_source and
-- pillars_derived_at follow content_pillars; location is the lifecycle's own
-- record and always written. One update, under the row's lock.
create or replace function public.lifecycle_write_client(p_client uuid, p_fields jsonb, p_by text default 'lifecycle')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.clients;
  v_rec public.clients;
  k text;
  v_gov text;
  v_owner text;
  v_set text[] := '{}';
  v_written text[] := '{}';
  v_skipped text[] := '{}';
  v_sources jsonb;
begin
  if p_by not in ('lifecycle', 'portal') then raise exception 'Unknown writer %', p_by; end if;
  select * into v_row from public.clients where id = p_client for update;
  if not found then return jsonb_build_object('written', '[]'::jsonb, 'skipped', '[]'::jsonb); end if;
  v_rec := jsonb_populate_record(v_row, p_fields);
  v_sources := coalesce(v_row.field_sources, '{}'::jsonb);
  for k in select jsonb_object_keys(p_fields) loop
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
      v_sources := v_sources || jsonb_build_object(k, jsonb_build_object('by', p_by, 'at', now()));
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

-- A Sprout profile a person removed from a client. The accounts step never
-- assigns it to that client again; a person adding it back clears the record.
create table if not exists public.sprout_profile_removals (
  client_id uuid not null references public.clients(id) on delete cascade,
  sprout_profile_id bigint not null,
  removed_at timestamptz not null default now(),
  removed_by uuid,
  primary key (client_id, sprout_profile_id)
);
alter table public.sprout_profile_removals enable row level security;
drop policy if exists "Staff read removed accounts" on public.sprout_profile_removals;
create policy "Staff read removed accounts" on public.sprout_profile_removals
  for select to authenticated using (public.is_moburst_staff());

create or replace function public.sprout_profiles_record_removal()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.is_active = false and old.is_active is distinct from false) then
    insert into sprout_profile_removals (client_id, sprout_profile_id, removed_by)
    values (old.client_id, old.sprout_profile_id, auth.uid())
    on conflict (client_id, sprout_profile_id) do update set removed_at = now(), removed_by = excluded.removed_by;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.is_active is distinct from false and old.is_active = false) then
    delete from sprout_profile_removals where client_id = new.client_id and sprout_profile_id = new.sprout_profile_id;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists sprout_profiles_removals on public.sprout_profiles;
create trigger sprout_profiles_removals after insert or update of is_active or delete on public.sprout_profiles
  for each row execute function public.sprout_profiles_record_removal();

-- Design settings: who set them, and what the lifecycle derived them from.
-- Every row that exists today was set by a person (the default).
alter table public.design_brand_settings add column if not exists source text not null default 'person';
alter table public.design_brand_settings drop constraint if exists design_brand_settings_source_check;
alter table public.design_brand_settings add constraint design_brand_settings_source_check check (source in ('person', 'lifecycle'));
alter table public.design_brand_settings add column if not exists derived jsonb;
comment on column public.design_brand_settings.source is 'person: a person confirmed or changed these settings, and the lifecycle never replaces them. lifecycle: derived from the client''s data (confirmed_by null).';
comment on column public.design_brand_settings.derived is 'What the lifecycle derived the settings from: logo_from, logo_file, placement_from, logo_read, background_from, at.';

create or replace function public.design_settings_mark_person()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then new.source := 'person'; end if;
  return new;
end $$;

drop trigger if exists design_brand_settings_source on public.design_brand_settings;
create trigger design_brand_settings_source before insert or update on public.design_brand_settings
  for each row execute function public.design_settings_mark_person();

-- The lifecycle's write of derived settings: a new row is confirmed by the
-- system; a row the lifecycle wrote before is refreshed; a person's row is
-- never touched. True when written. Automatic designs keep the column's
-- default (off): decision 3 waits until the Higgsfield spend since 14 Oct is
-- explained (Lital, 19 Oct 16:40, 20261019200000_pipeline_recovery.sql).
create or replace function public.lifecycle_write_design_settings(p_client uuid, p_logo_path text, p_placement jsonb, p_background text, p_reference_paths text[], p_derived jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into design_brand_settings as s (client_id, logo_path, placement, background, reference_paths, confirmed_at, confirmed_by, source, derived, updated_at)
  values (p_client, p_logo_path, p_placement, p_background, p_reference_paths[1:16], now(), null, 'lifecycle', p_derived, now())
  on conflict (client_id) do update
     set logo_path = excluded.logo_path, placement = excluded.placement, background = excluded.background,
         reference_paths = excluded.reference_paths, confirmed_at = now(), confirmed_by = null, derived = excluded.derived, updated_at = now()
   where s.source = 'lifecycle';
  return found;
end $$;

revoke all on function public.lifecycle_write_design_settings(uuid, text, jsonb, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.lifecycle_write_design_settings(uuid, text, jsonb, text, text[], jsonb) to service_role;

-- A plan the lifecycle asked for (a new client's first weeks).
alter table public.calendar_plans drop constraint if exists calendar_plans_trigger_check;
alter table public.calendar_plans add constraint calendar_plans_trigger_check
  check (trigger in ('monday', 'button', 'cutover', 'lifecycle'));

-- A client's first output: this week (while it has a day to come) and next
-- week planned, and the first monthly report for the last full month when
-- the client has none. The report goes through the scheduled dispatch path:
-- the client's social schedule is brought forward to now and its occurrence
-- queued, so the dispatch rules (pairing, phases, recovery) apply and the
-- regular monthly occurrence after it is untouched. Never a second run: a
-- report running or made in the last 7 days, or a dispatch on its way,
-- answers the request.
create or replace function public.lifecycle_first_output(p_client uuid, p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_client record;
  v_today date;
  v_monday date;
  v_next date;
  v_weeks jsonb := '[]'::jsonb;
  v_sched record;
  v_at timestamptz;
  v_report text;
begin
  select id, timezone, archived_at, demo_job_id, exclude_from_reporting into v_client from clients where id = p_client;
  if not found or v_client.archived_at is not null or v_client.demo_job_id is not null or v_client.exclude_from_reporting then
    return jsonb_build_object('skipped', true);
  end if;
  begin
    v_today := (p_now at time zone coalesce(nullif(btrim(v_client.timezone), ''), 'UTC'))::date;
  exception when others then
    v_today := (p_now at time zone 'UTC')::date;
  end;
  v_monday := v_today - (extract(isodow from v_today)::int - 1);
  v_next := v_monday + 7;

  if extract(isodow from v_today) < 7 and not exists (select 1 from calendar_plans where client_id = p_client and week_start = v_monday) then
    perform calendar_request_week(p_client, v_monday, 'lifecycle', null);
    v_weeks := v_weeks || to_jsonb(v_monday);
  end if;
  if not exists (select 1 from calendar_plans where client_id = p_client and week_start = v_next) then
    perform calendar_request_week(p_client, v_next, 'lifecycle', null);
    v_weeks := v_weeks || to_jsonb(v_next);
  end if;

  if exists (select 1 from reports where client_id = p_client and status = 'completed') then
    v_report := 'exists';
  elsif exists (select 1 from reports where client_id = p_client and (status = 'running' or created_at > p_now - interval '7 days')) then
    v_report := 'under_way';
  else
    select id, next_run_at into v_sched from report_schedules
     where client_id = p_client and report_kind = 'social' and is_active and next_run_at is not null
     order by created_at limit 1;
    if not found then
      v_report := 'no_active_schedule';
    elsif exists (select 1 from scheduled_jobs j where j.kind = 'dispatch' and j.schedule_id = v_sched.id
                     and j.status in ('queued', 'running', 'waiting', 'blocked')) then
      v_report := 'under_way';
    else
      v_at := least(v_sched.next_run_at, date_trunc('second', p_now));
      if v_sched.next_run_at > v_at then
        update report_schedules set next_run_at = v_at where id = v_sched.id;
      end if;
      insert into scheduled_jobs (kind, client_id, schedule_id, occurrence, dedupe_key, priority, available_at)
      values ('dispatch', p_client, v_sched.id, v_at,
              'dispatch:' || v_sched.id || ':' || to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), 30, p_now)
      on conflict (dedupe_key) do nothing;
      v_report := 'started';
    end if;
  end if;
  return jsonb_build_object('week', v_monday, 'weeks_requested', v_weeks, 'first_report', v_report);
end $$;

revoke all on function public.lifecycle_first_output(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.lifecycle_first_output(uuid, timestamptz) to service_role;

-- A person asking for a step to run again now, as in
-- 20261019180000_client_lifecycle.sql, for every step.
create or replace function public.lifecycle_request(p_client uuid, p_step text)
returns void
language plpgsql security definer set search_path = public as $$
begin
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

-- Look at the client again when an input of a step changes: the website and
-- name (as before), the brief, brief file, strategy document and competitor
-- notes (brief_pillars, competitors), the logo and brand colors
-- (design_settings), the timezone (first_output's weeks), and who set what
-- (a person handing a field back to the product).
create or replace function public.lifecycle_on_client_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT'
     or new.website_url is distinct from old.website_url
     or new.name is distinct from old.name
     or (old.archived_at is not null and new.archived_at is null)
     or new.brief_text is distinct from old.brief_text
     or new.brief_file_id is distinct from old.brief_file_id
     or new.strategy_doc_file_path is distinct from old.strategy_doc_file_path
     or new.competitor_seed_notes is distinct from old.competitor_seed_notes
     or new.logo_url is distinct from old.logo_url
     or new.brand_identity is distinct from old.brand_identity
     or new.timezone is distinct from old.timezone
     or new.field_sources is distinct from old.field_sources then
    perform lifecycle_enqueue(new.id);
  end if;
  return new;
end $$;

drop trigger if exists clients_lifecycle on public.clients;
create trigger clients_lifecycle after insert or update of website_url, name, archived_at, brief_text, brief_file_id, strategy_doc_file_path,
  competitor_seed_notes, logo_url, brand_identity, timezone, field_sources on public.clients
  for each row execute function public.lifecycle_on_client_change();

-- A competitor set confirmed, linked to tracking, or found missing its
-- landscape: the tracking step looks at it.
create or replace function public.lifecycle_on_set_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform lifecycle_enqueue(coalesce(new.client_id, old.client_id));
  return coalesce(new, old);
end $$;

drop trigger if exists competitor_sets_lifecycle on public.competitor_sets;
create trigger competitor_sets_lifecycle after insert or delete or update of status, rivaliq_landscape_id, tracking_check on public.competitor_sets
  for each row execute function public.lifecycle_on_set_change();
