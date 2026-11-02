-- Sprout auto-onboarding (Lital approved building it on 2 Nov 2026). Spec:
-- docs/superpowers/specs/2026-11-02-sprout-auto-onboarding-design.md
--
-- A weekly job in the app's own queue turns a new Sprout brand into a client
-- (run-scheduled-jobs/sproutOnboarding.ts); the client lifecycle sets it up
-- from there. This adds what the job needs and nothing that runs on its own:
--
--   1. clients.origin: where a client the product made came from
--      ({"source": "sprout", "brand", "profile_ids", "at"}), shown to staff.
--   2. website_url joins the lifecycle's tracked fields (the new website step
--      writes it), and every website a client has now is marked as set by a
--      person, so no step ever replaces one. The backfill adds that marker
--      and changes nothing else: no updated_at, no trigger.
--   3. The sprout_onboarding job kind, the one kind whose job belongs to no
--      client.
--   4. sprout_onboard_client: the job's one write, under a lock.
--   5. enqueue_sprout_onboarding_job: on Monday, or when no run finished in
--      8 days, so a failed Monday is caught up the next day.
--
-- The cron line is 20261108130100_sprout_onboarding_cron.sql, applied after
-- the dry run on the live list (spec section 9). Until then nothing here runs.

-- ── 1. Where a client came from ─────────────────────────────────────────────

alter table public.clients add column if not exists origin jsonb;
comment on column public.clients.origin is 'Where a client the product made came from: {"source": "sprout", "brand": the Sprout brand name, "profile_ids": [...], "at": ...}. Null for a client a person made.';

-- ── 2. The website as a lifecycle field ─────────────────────────────────────

-- As in 20261019220000_lifecycle_steps.sql, with website_url.
create or replace function public.lifecycle_tracked_fields()
returns text[]
language sql immutable as $$
  select array['brand_identity', 'logo_url', 'timezone', 'geo', 'language', 'brief_text', 'content_pillars',
               'social_keywords', 'primary_platforms', 'company_slug', 'hub_company_name', 'website_url']
$$;

-- Every website a client has now was set by a person (or by the API demo,
-- which no step replaces either). Only the marker is added: every trigger on
-- clients is off for this one update (so updated_at stays and no lifecycle
-- look is queued) and back on as it was. A marker already there is kept.
do $$
declare
  v_trigger record;
  v_off text[] := '{}';
  v_state "char"[] := '{}';
  i integer;
begin
  for v_trigger in
    select tgname, tgenabled from pg_trigger
     where tgrelid = 'public.clients'::regclass and not tgisinternal and tgenabled <> 'D'
  loop
    execute format('alter table public.clients disable trigger %I', v_trigger.tgname);
    v_off := v_off || v_trigger.tgname::text;
    v_state := v_state || v_trigger.tgenabled;
  end loop;

  update public.clients
     set field_sources = coalesce(field_sources, '{}'::jsonb)
       || jsonb_build_object('website_url', jsonb_build_object('by', 'person', 'at', now(), 'from', 'before_sprout_onboarding'))
   where nullif(btrim(website_url), '') is not null
     and not (coalesce(field_sources, '{}'::jsonb) ? 'website_url');

  for i in 1 .. coalesce(array_length(v_off, 1), 0) loop
    execute format('alter table public.clients enable %s trigger %I',
                   case v_state[i] when 'A' then 'always' when 'R' then 'replica' else '' end, v_off[i]);
  end loop;
end $$;

-- ── 3. The job kind, which belongs to no client ─────────────────────────────

-- Added to whatever kinds the constraint allows when this runs, so a kind
-- another change adds (in either order) is kept.
do $$
declare
  v_def text;
  v_kinds text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.scheduled_jobs'::regclass and conname = 'scheduled_jobs_kind_check';
  select array_agg(distinct k order by k) into v_kinds from (
    select m[1] as k from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m
    union
    select btrim(e) from unnest(string_to_array(substring(coalesce(v_def, '') from '\{([a-z_,]*)\}'), ',')) as e
  ) kinds where k ~ '^[a-z_]+$';
  v_kinds := array(select distinct k from unnest(coalesce(v_kinds, '{}'::text[]) || array['sprout_onboarding']) as k order by k);
  alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_kind_check;
  execute format('alter table public.scheduled_jobs add constraint scheduled_jobs_kind_check check (kind = any (%L::text[]))', v_kinds);
end $$;

alter table public.scheduled_jobs alter column client_id drop not null;
alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_client_required;
alter table public.scheduled_jobs add constraint scheduled_jobs_client_required
  check (client_id is not null or kind = 'sprout_onboarding');

create index if not exists scheduled_jobs_sprout_onboarding on public.scheduled_jobs (finished_at)
  where kind = 'sprout_onboarding';

-- ── 4. The job's one write ──────────────────────────────────────────────────

-- A client for a new Sprout brand: its name as Sprout spells it, its website
-- when the search confirmed one (recorded as set by the lifecycle), its
-- profiles and its origin. Nothing else: the lifecycle, which the insert
-- triggers start within a minute, sets up the rest, and created_by stays
-- empty. One onboarding at a time, and none when one of the brand's
-- profiles was assigned meanwhile or removed by a person, so overlapping
-- runs create one client and a removal is never reversed.
create or replace function public.sprout_onboard_client(p_name text, p_website text, p_profiles jsonb, p_brand text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ids bigint[];
  v_holder uuid;
  v_client uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_website text := nullif(btrim(coalesce(p_website, '')), '');
begin
  if v_name = '' then raise exception 'A client needs a name.'; end if;
  if jsonb_typeof(p_profiles) is distinct from 'array' or jsonb_array_length(p_profiles) = 0 then
    raise exception 'A client from Sprout needs its profiles.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_profiles) e where coalesce(e ->> 'id', '') !~ '^[0-9]+$') then
    raise exception 'Every profile needs its Sprout id.';
  end if;
  select array_agg(distinct (e ->> 'id')::bigint order by (e ->> 'id')::bigint) into v_ids from jsonb_array_elements(p_profiles) e;

  perform pg_advisory_xact_lock(hashtext('sprout_onboard_client'));
  select client_id into v_holder from public.sprout_profiles where sprout_profile_id = any (v_ids) limit 1;
  if found then return jsonb_build_object('created', false, 'reason', 'assigned', 'client_id', v_holder); end if;
  select client_id into v_holder from public.sprout_profile_removals where sprout_profile_id = any (v_ids) limit 1;
  if found then return jsonb_build_object('created', false, 'reason', 'removed', 'client_id', v_holder); end if;

  insert into public.clients (name, website_url, field_sources, origin)
  values (v_name, v_website,
          case when v_website is null then '{}'::jsonb
               else jsonb_build_object('website_url', jsonb_build_object('by', 'lifecycle', 'at', now())) end,
          jsonb_build_object('source', 'sprout', 'brand', coalesce(nullif(btrim(p_brand), ''), v_name), 'profile_ids', to_jsonb(v_ids), 'at', now()))
  returning id into v_client;

  insert into public.sprout_profiles (client_id, sprout_profile_id, profile_name, native_name, network_type, native_link, is_active)
  select v_client, (e ->> 'id')::bigint, coalesce(e ->> 'name', ''), coalesce(e ->> 'native_name', ''), coalesce(e ->> 'network_type', ''),
         coalesce(e ->> 'native_link', ''), true
    from jsonb_array_elements(p_profiles) e
  on conflict (client_id, sprout_profile_id) do nothing;

  return jsonb_build_object('created', true, 'client_id', v_client);
end $$;

revoke all on function public.sprout_onboard_client(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.sprout_onboard_client(text, text, jsonb, text) to service_role;

-- ── 5. When it runs ─────────────────────────────────────────────────────────

-- One job on Monday (Israel time), or on any day when no run finished in the
-- last 8 days (a failed Monday is caught up the next day; the first run after
-- the cron line is applied happens the next morning). Never while a run is
-- queued or running, and at most one a day. A dry run says what it would do.
create or replace function public.enqueue_sprout_onboarding_job(p_now timestamptz default now(), p_dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (p_now at time zone 'Asia/Jerusalem')::date;
  v_monday boolean := extract(isodow from p_now at time zone 'Asia/Jerusalem') = 1;
  v_key text := 'sprout_onboarding:' || to_char((p_now at time zone 'Asia/Jerusalem')::date, 'YYYY-MM-DD');
  v_last date;
  v_open boolean;
  v_due boolean;
  v_queued integer := 0;
begin
  select max((finished_at at time zone 'Asia/Jerusalem')::date) into v_last
    from public.scheduled_jobs where kind = 'sprout_onboarding' and status = 'done';
  select exists (select 1 from public.scheduled_jobs where kind = 'sprout_onboarding' and status in ('queued', 'running')) into v_open;
  v_due := not v_open and (v_monday or v_last is null or v_last <= v_today - 8);
  if v_due and not p_dry_run then
    insert into public.scheduled_jobs (kind, client_id, dedupe_key, priority, available_at)
    values ('sprout_onboarding', null, v_key, 50, p_now)
    on conflict (dedupe_key) do nothing;
    get diagnostics v_queued = row_count;
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'at', p_now, 'due', v_due, 'queued', v_queued > 0,
                            'dedupe_key', case when v_due then v_key end, 'last_run', v_last);
end $$;

revoke all on function public.enqueue_sprout_onboarding_job(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_sprout_onboarding_job(timestamptz, boolean) to service_role;
