-- Design options for calendar posts (supabase/functions/design-request,
-- worked by canva-finish).
--
-- design_brand_settings: what every design for a client is built from,
-- confirmed once by Moburst staff in client setup (decision, 12 Oct 2026):
-- the logo file, where the client habitually puts it, the background behind
-- it, and three of the client's own posts as the visual language.
--
-- design_requests: one per "Create designs" on a post. It plans the options,
-- starts one canva_finish_jobs row per option, replaces any option that does
-- not finish, and records progress so every screen can show it. Clients read
-- their own requests; every write goes through the functions.

create table if not exists public.design_brand_settings (
  client_id uuid primary key references public.clients(id) on delete cascade,
  logo_path text not null,                      -- generated-media path to a PNG
  placement jsonb not null,                     -- {anchor: left|center|right, width, top, left?} as shares of the frame
  background text not null,                     -- e.g. #0B0E1A
  reference_paths text[] not null,              -- design-references paths, the client's own posts
  confirmed_at timestamptz,
  confirmed_by uuid,
  updated_at timestamptz not null default now(),
  constraint design_brand_settings_refs check (cardinality(reference_paths) between 1 and 4),
  constraint design_brand_settings_anchor check (placement->>'anchor' in ('left', 'center', 'right'))
);
alter table public.design_brand_settings enable row level security;
revoke all on public.design_brand_settings from anon, authenticated;
grant select, insert, update on public.design_brand_settings to authenticated;
drop policy if exists "Staff read design settings" on public.design_brand_settings;
create policy "Staff read design settings" on public.design_brand_settings for select to authenticated using (public.is_moburst_staff());
drop policy if exists "Staff write design settings" on public.design_brand_settings;
create policy "Staff write design settings" on public.design_brand_settings for insert to authenticated with check (public.can_write_client(client_id));
drop policy if exists "Staff update design settings" on public.design_brand_settings;
create policy "Staff update design settings" on public.design_brand_settings for update to authenticated using (public.can_write_client(client_id)) with check (public.can_write_client(client_id));

create table if not exists public.design_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  report_id uuid references public.reports(id) on delete set null,
  calendar_post_key text not null,
  platform text,
  format text,
  post_copy text not null,
  requested_by uuid,
  status text not null default 'preparing' check (status in ('preparing', 'ready', 'needs_staff')),
  -- planning → designing → finishing → ready, for the progress shown on screen
  stage text not null default 'planning' check (stage in ('planning', 'designing', 'finishing', 'ready')),
  options_wanted int not null default 3,
  options_ready int not null default 0,
  candidates_started int not null default 0,
  briefs jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists design_requests_post on public.design_requests (client_id, calendar_post_key, created_at desc);
create index if not exists design_requests_open on public.design_requests (status) where status = 'preparing';
-- One open request per post: a second "Create designs" while one is being
-- prepared returns the open one instead of starting another.
create unique index if not exists design_requests_one_open on public.design_requests (client_id, calendar_post_key) where status = 'preparing';

alter table public.design_requests enable row level security;
revoke all on public.design_requests from anon, authenticated;
grant select on public.design_requests to authenticated;
drop policy if exists "Read own design requests" on public.design_requests;
create policy "Read own design requests" on public.design_requests for select to authenticated
  using (public.is_moburst_staff() or public.is_client_member(client_id));

alter table public.canva_finish_jobs add column if not exists design_request_id uuid references public.design_requests(id) on delete cascade;
alter table public.canva_finish_jobs add column if not exists option_index int;
create index if not exists canva_finish_jobs_request on public.canva_finish_jobs (design_request_id);

comment on table public.design_brand_settings is 'Per client: logo file, habitual logo spot, background and reference posts every design is built from. Confirmed once by staff.';
comment on table public.design_requests is 'One per Create designs on a calendar post; its options are canva_finish_jobs rows and, when finished, post_iterations rows grouped by this id.';

-- The client's own users only need to know whether designs are offered; the
-- settings themselves (logo file, references) are their own brand's.
drop policy if exists "Members read design settings" on public.design_brand_settings;
create policy "Members read design settings" on public.design_brand_settings for select to authenticated using (public.is_client_member(client_id));

-- The worker also wakes for requests that are being prepared, so a request
-- whose options all ended gets its replacement started.
select cron.schedule('canva-finish-worker', '* * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/canva-finish',
    headers := jsonb_build_object('Content-Type','application/json','X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 120000)
  where exists (select 1 from public.canva_finish_jobs where status in ('queued', 'running'))
     or exists (select 1 from public.design_requests where status = 'preparing');
$cron$);
