-- Designs in each platform's upload size (17 Nov 2026).
-- Spec: docs/superpowers/specs/2026-11-17-platform-sizes-design.md
--
-- Every still was planned on one 4:5 page and delivered 1440 wide, whatever
-- platform it was for. A design now reads its size from platform_sizes when
-- it is requested: one row per platform and format with the size that
-- platform is uploaded in. A weekly job in the app's own queue reads Sprout
-- Social's image sizes guide and updates a row when its size has changed
-- (_shared/design/platformSizeRefresh.ts). Nobody sets or maintains a size.
--
--   1. platform_sizes: the sizes, seeded so designs are right at once.
--   2. platform_size_reads: what each run of the job read and did, for the
--      team's own diagnosis in the database. No screen reads it.
--   3. design_requests.upload_size: the row a request read, kept on it.
--   4. record_platform_size_read: the job's one write.
--   5. The platform_sizes job kind, which belongs to no client, and when it
--      is queued.
--   6. A size the image model refuses never fails a design:
--      platform_size_outcomes (what the model did with each size) and
--      design_size_refused (the design made as it was before this table).
--
-- Everything here is additive and this file can be run twice. Code from
-- before it reads none of it: a request with no upload_size is designed as
-- it always was.

-- ── 1. The sizes ────────────────────────────────────────────────────────────

create table if not exists public.platform_sizes (
  platform text not null,
  format text not null,
  width integer not null,
  height integer not null,
  source text not null default 'seed',
  changed_at timestamptz not null default now(),
  previous_width integer,
  previous_height integer,
  checked_at timestamptz,
  pending_width integer,
  pending_height integer,
  pending_at timestamptz,
  pending_misses integer not null default 0,
  usable boolean not null default true,
  primary key (platform, format),
  constraint platform_sizes_platform check (platform ~ '^[a-z]+$'),
  constraint platform_sizes_format check (format in ('image', 'carousel', 'story')),
  constraint platform_sizes_source check (source in ('seed', 'guide')),
  -- The same bounds the code checks (_shared/design/platformSize.ts, MIN_EDGE and MAX_EDGE).
  constraint platform_sizes_edges check (width between 600 and 2560 and height between 600 and 2560),
  constraint platform_sizes_pending check (
    (pending_width is null and pending_height is null)
    or (pending_width between 600 and 2560 and pending_height between 600 and 2560)
  )
);

comment on table public.platform_sizes is 'The size a design is uploaded in, per platform and format (image, carousel, story). A design request reads its row when it is made. Seeded on 17 Nov 2026 and kept current by the weekly platform_sizes job from Sprout Social''s image sizes guide.';
comment on column public.platform_sizes.platform is 'The network key the publish path uses: instagram, facebook, linkedin, x.';
comment on column public.platform_sizes.source is 'seed: the size this migration wrote. guide: a size the weekly job read from the guide.';
comment on column public.platform_sizes.checked_at is 'The last run of the weekly job that read this row from the guide.';
comment on column public.platform_sizes.pending_width is 'A size far from the one in use, read once. It replaces the size when the next read of the row gives it again; a read that gives anything else clears it, and it is dropped after three runs that read the guide and refused this row (pending_misses).';
comment on column public.platform_sizes.usable is 'False: the image model refused the size (a design was refused in it and drawn at once in another picture size). Requests then read no size and are designed on the 4:5 page. The next weekly run that reads the guide and still finds the size listed sets it true again, so the size is tried again; a run that finds another size changes the row.';

-- The sizes read from the guide on 17 Nov 2026 (the page says it was updated
-- on 2 Nov 2026). A row that is already there is left as it is, so running
-- this again never puts a seed over a size the job has read since.
insert into public.platform_sizes (platform, format, width, height, source) values
  ('instagram', 'image', 1080, 1350, 'seed'),
  ('instagram', 'carousel', 1080, 1350, 'seed'),
  ('instagram', 'story', 1080, 1920, 'seed'),
  ('facebook', 'image', 1080, 1350, 'seed'),
  ('facebook', 'story', 1080, 1920, 'seed'),
  ('linkedin', 'image', 1200, 1200, 'seed'),
  ('x', 'image', 1600, 900, 'seed')
on conflict (platform, format) do nothing;

-- ── 2. What each run read ───────────────────────────────────────────────────

create table if not exists public.platform_size_reads (
  id uuid primary key default gen_random_uuid(),
  read_at timestamptz not null default now(),
  ok boolean not null,
  source text,
  source_updated text,
  error text,
  rows jsonb not null default '[]'::jsonb
);

comment on table public.platform_size_reads is 'One row per run of the weekly platform_sizes job: whether the guide was read, and per size row what was read, the outcome (same, changed, held, confirmed, refused) and why a read was refused. For diagnosis in the database; no screen reads it.';

create index if not exists platform_size_reads_read_at_idx on public.platform_size_reads (read_at);

-- As moments and moment_lists (20261110140000_seasonal_relevance.sql): staff
-- may read, an OAuth session can never write, the service role writes.
alter table public.platform_sizes enable row level security;
alter table public.platform_size_reads enable row level security;

drop policy if exists "Staff read platform sizes" on public.platform_sizes;
create policy "Staff read platform sizes" on public.platform_sizes
  for select to authenticated using (public.is_moburst_staff());
drop policy if exists "Staff read platform size reads" on public.platform_size_reads;
create policy "Staff read platform size reads" on public.platform_size_reads
  for select to authenticated using (public.is_moburst_staff());

drop policy if exists "OAuth sessions cannot insert" on public.platform_sizes;
create policy "OAuth sessions cannot insert" on public.platform_sizes as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.platform_sizes;
create policy "OAuth sessions cannot update" on public.platform_sizes as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.platform_sizes;
create policy "OAuth sessions cannot delete" on public.platform_sizes as restrictive for delete to authenticated using (not (select public.is_oauth_session()));

drop policy if exists "OAuth sessions cannot insert" on public.platform_size_reads;
create policy "OAuth sessions cannot insert" on public.platform_size_reads as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.platform_size_reads;
create policy "OAuth sessions cannot update" on public.platform_size_reads as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.platform_size_reads;
create policy "OAuth sessions cannot delete" on public.platform_size_reads as restrictive for delete to authenticated using (not (select public.is_oauth_session()));

revoke all on public.platform_sizes, public.platform_size_reads from public, anon, authenticated;
grant select on public.platform_sizes, public.platform_size_reads to authenticated;
grant select, insert, update, delete on public.platform_sizes, public.platform_size_reads to service_role;

-- ── 3. The row a request read ───────────────────────────────────────────────

alter table public.design_requests add column if not exists upload_size jsonb;
comment on column public.design_requests.upload_size is 'The platform_sizes row this request read when it was made: {"platform", "format", "width", "height"}. Every option, slide and replacement of the request is drawn in it. Null: no row for the post, or a request from before 17 Nov 2026; designed on the 4:5 page (a Story on 9:16) and delivered 1440 wide.';

-- ── 4. The job's one write ──────────────────────────────────────────────────

-- One run of the weekly job, written with what it changed, in one
-- transaction. p_read: {"ok", "source", "source_updated", "error", "rows"},
-- each row {"platform", "format", "outcome", "from": [w, h], "to": [w, h],
-- ...}. The code decides each outcome (_shared/design/platformSizeRead.ts);
-- this applies it, and only while the row still holds the size the run
-- compared against ("from"), so two runs can never cross:
--   changed    the size becomes "to";
--   confirmed  the same, and only while "to" is the pending size;
--   held       "to" becomes the pending size;
--   same       the row was read and stands; a pending size is cleared;
--   refused    no size changes; a held size is one read nearer to being
--              dropped (after three).
-- A run that failed as a whole (ok false) applies none of those. Two
-- outcomes come from what the image model did, not from the guide, and are
-- applied either way (section 6):
--   reverted   the size in use was refused: the row goes back to "to", the
--              size before it, which the model has drawn;
--   unusable   the size in use was refused and there is no drawn size to go
--              back to: the row is read by no request.
-- And one that makes such a row readable again, on a run that read the guide:
--   retried    the guide still lists the size of a row no request reads:
--              it is read again, so the next design tries the size.
-- Runs older than 400 days are cleared here, so the table needs no job of
-- its own.
create or replace function public.record_platform_size_read(p_read jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ok boolean := coalesce((p_read ->> 'ok')::boolean, false);
  v_rows jsonb := case when jsonb_typeof(p_read -> 'rows') = 'array' then p_read -> 'rows' else '[]'::jsonb end;
  v_row jsonb;
  v_outcome text;
  v_from_w integer; v_from_h integer; v_to_w integer; v_to_h integer;
  v_hit integer;
  v_applied integer := 0;
begin
  insert into public.platform_size_reads (ok, source, source_updated, error, rows)
  values (v_ok, left(p_read ->> 'source', 500), left(p_read ->> 'source_updated', 100), left(p_read ->> 'error', 2000), v_rows)
  returning id into v_id;

  for v_row in select e from jsonb_array_elements(v_rows) as e loop
    v_outcome := v_row ->> 'outcome';
    v_from_w := (v_row -> 'from' ->> 0)::integer; v_from_h := (v_row -> 'from' ->> 1)::integer;
    v_to_w := (v_row -> 'to' ->> 0)::integer; v_to_h := (v_row -> 'to' ->> 1)::integer;
    v_hit := 0;
    -- What the image model refused does not wait for the guide: applied whether or not the guide was read.
    if v_outcome = 'reverted' and v_to_w is not null and v_to_h is not null then
      update public.platform_sizes
         set width = v_to_w, height = v_to_h, previous_width = null, previous_height = null,
             changed_at = now(), usable = true,
             pending_width = null, pending_height = null, pending_at = null, pending_misses = 0
       where platform = v_row ->> 'platform' and format = v_row ->> 'format'
         and width = v_from_w and height = v_from_h;
      get diagnostics v_hit = row_count;
    elsif v_outcome = 'unusable' then
      update public.platform_sizes
         set usable = false, changed_at = now(),
             pending_width = null, pending_height = null, pending_at = null, pending_misses = 0
       where platform = v_row ->> 'platform' and format = v_row ->> 'format'
         and width = v_from_w and height = v_from_h and usable;
      get diagnostics v_hit = row_count;
    elsif not v_ok then
      null;
    elsif v_outcome in ('changed', 'confirmed') and v_to_w is not null and v_to_h is not null then
      update public.platform_sizes
         set previous_width = width, previous_height = height, width = v_to_w, height = v_to_h,
             source = 'guide', changed_at = now(), checked_at = now(), usable = true,
             pending_width = null, pending_height = null, pending_at = null, pending_misses = 0
       where platform = v_row ->> 'platform' and format = v_row ->> 'format'
         and width = v_from_w and height = v_from_h
         and (v_outcome = 'changed' or (pending_width = v_to_w and pending_height = v_to_h));
      get diagnostics v_hit = row_count;
    elsif v_outcome = 'held' and v_to_w is not null and v_to_h is not null then
      update public.platform_sizes
         set pending_width = v_to_w, pending_height = v_to_h, pending_at = now(), pending_misses = 0, checked_at = now()
       where platform = v_row ->> 'platform' and format = v_row ->> 'format'
         and width = v_from_w and height = v_from_h;
    elsif v_outcome = 'same' then
      update public.platform_sizes
         set checked_at = now(), pending_width = null, pending_height = null, pending_at = null, pending_misses = 0
       where platform = v_row ->> 'platform' and format = v_row ->> 'format'
         and width = v_from_w and height = v_from_h;
    elsif v_outcome = 'retried' then
      -- A row no request read, whose size the guide still lists: read again from now on, and the
      -- refusal that switched it off no longer counts, so the size is tried by the next design.
      update public.platform_sizes
         set usable = true, checked_at = now(), pending_width = null, pending_height = null, pending_at = null, pending_misses = 0
       where platform = v_row ->> 'platform' and format = v_row ->> 'format'
         and width = v_from_w and height = v_from_h and not usable;
      update public.platform_size_outcomes
         set refusal_confirmed_at = null
       where platform = v_row ->> 'platform' and format = v_row ->> 'format'
         and width = v_from_w and height = v_from_h;
    elsif v_outcome = 'refused' then
      -- A refused read neither confirms nor clears a held size, and a held size is dropped
      -- once three runs that read the guide have refused its row.
      update public.platform_sizes
         set pending_misses = pending_misses + 1
       where platform = v_row ->> 'platform' and format = v_row ->> 'format' and pending_width is not null;
      update public.platform_sizes
         set pending_width = null, pending_height = null, pending_at = null, pending_misses = 0
       where platform = v_row ->> 'platform' and format = v_row ->> 'format' and pending_width is not null and pending_misses >= 3;
    end if;
    v_applied := v_applied + v_hit;
  end loop;

  delete from public.platform_size_reads where read_at < now() - interval '400 days';
  return jsonb_build_object('id', v_id, 'changed', v_applied);
end $$;

revoke all on function public.record_platform_size_read(jsonb) from public, anon, authenticated;
grant execute on function public.record_platform_size_read(jsonb) to service_role;

-- ── 5. The job, which belongs to no client, and when it runs ────────────────

-- Added to whatever kinds each constraint allows when this runs, so a kind
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
  v_kinds := array(select distinct k from unnest(coalesce(v_kinds, '{}'::text[]) || array['platform_sizes']) as k order by k);
  alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_kind_check;
  execute format('alter table public.scheduled_jobs add constraint scheduled_jobs_kind_check check (kind = any (%L::text[]))', v_kinds);

  -- The kinds whose job has no client: those the constraint names now, and this one.
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.scheduled_jobs'::regclass and conname = 'scheduled_jobs_client_required';
  select array_agg(distinct k order by k) into v_kinds from (
    select m[1] as k from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m
    union
    select btrim(e) from unnest(string_to_array(substring(coalesce(v_def, '') from '\{([a-z_,]*)\}'), ',')) as e
  ) kinds where k ~ '^[a-z_]+$';
  v_kinds := array(select distinct k from unnest(coalesce(v_kinds, '{}'::text[]) || array['platform_sizes']) as k order by k);
  alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_client_required;
  execute format('alter table public.scheduled_jobs add constraint scheduled_jobs_client_required check (client_id is not null or kind = any (%L::text[]))', v_kinds);
end $$;

create index if not exists scheduled_jobs_platform_sizes on public.scheduled_jobs (finished_at)
  where kind = 'platform_sizes';

-- One job on Monday (Israel time), or on any day when no run finished in the
-- last 8 days (a failed Monday is caught up the next day, and the first run
-- is the morning after this is applied). Never while a run is queued or
-- running, and at most one a day. A dry run says what it would do.
create or replace function public.enqueue_platform_sizes_job(p_now timestamptz default now(), p_dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (p_now at time zone 'Asia/Jerusalem')::date;
  v_monday boolean := extract(isodow from p_now at time zone 'Asia/Jerusalem') = 1;
  v_key text := 'platform_sizes:' || to_char((p_now at time zone 'Asia/Jerusalem')::date, 'YYYY-MM-DD');
  v_last date;
  v_open boolean;
  v_due boolean;
  v_queued integer := 0;
begin
  select max((finished_at at time zone 'Asia/Jerusalem')::date) into v_last
    from public.scheduled_jobs where kind = 'platform_sizes' and status = 'done';
  select exists (select 1 from public.scheduled_jobs where kind = 'platform_sizes' and status in ('queued', 'running')) into v_open;
  v_due := not v_open and (v_monday or v_last is null or v_last <= v_today - 8);
  if v_due and not p_dry_run then
    insert into public.scheduled_jobs (kind, client_id, dedupe_key, priority, available_at)
    values ('platform_sizes', null, v_key, 50, p_now)
    on conflict (dedupe_key) do nothing;
    get diagnostics v_queued = row_count;
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'at', p_now, 'due', v_due, 'queued', v_queued > 0,
                            'dedupe_key', case when v_due then v_key end, 'last_run', v_last);
end $$;

revoke all on function public.enqueue_platform_sizes_job(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_platform_sizes_job(timestamptz, boolean) to service_role;

-- Daily at 05:30 UTC, 07:30 Israel time (08:30 in summer time). The
-- per-minute worker runs the job. Scheduling the same name again replaces
-- the line, so this applies twice.
select cron.schedule('platform-sizes-enqueue', '30 5 * * *', $cron$ select public.enqueue_platform_sizes_job(); $cron$);

-- ── 6. A size the image model refuses never fails a design ─────────────────

-- The existing column on a database that ran this file before section 6 was written.
alter table public.platform_sizes add column if not exists pending_misses integer not null default 0;
alter table public.platform_sizes add column if not exists usable boolean not null default true;

-- What the image model did with each size, per platform and format. Written
-- by the design worker; read by the weekly job. A size is recorded as
-- refused only when a design was refused in it and the same design was then
-- drawn, at once, in another picture size: a refusal for any other cause
-- (a key, billing, the picture's content, a platform whose shape is
-- today's) records nothing. For diagnosis in the database; no screen reads
-- it.
create table if not exists public.platform_size_outcomes (
  platform text not null,
  format text not null,
  width integer not null,
  height integer not null,
  drawn_at timestamptz,
  refused_at timestamptz,
  refused_reason text,
  refusal_confirmed_at timestamptz,
  primary key (platform, format, width, height)
);

comment on table public.platform_size_outcomes is 'What the image model did with a platform''s upload size: drawn_at (it drew a design in it); refused_at and refused_reason (it refused a design in it and drew the same design at once in another picture size, with what it said); refusal_confirmed_at (that refusal still counts: the row is read by no request until the weekly platform_sizes job tries the size again and clears this).';

alter table public.platform_size_outcomes enable row level security;
drop policy if exists "Staff read platform size outcomes" on public.platform_size_outcomes;
create policy "Staff read platform size outcomes" on public.platform_size_outcomes
  for select to authenticated using (public.is_moburst_staff());
drop policy if exists "OAuth sessions cannot insert" on public.platform_size_outcomes;
create policy "OAuth sessions cannot insert" on public.platform_size_outcomes as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.platform_size_outcomes;
create policy "OAuth sessions cannot update" on public.platform_size_outcomes as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.platform_size_outcomes;
create policy "OAuth sessions cannot delete" on public.platform_size_outcomes as restrictive for delete to authenticated using (not (select public.is_oauth_session()));
revoke all on public.platform_size_outcomes from public, anon, authenticated;
grant select on public.platform_size_outcomes to authenticated;
grant select, insert, update, delete on public.platform_size_outcomes to service_role;

-- One thing the image model did with a size: 'drawn' or 'refusal_confirmed'
-- (refused, and the same design drawn at once in another picture size). A
-- confirmed refusal switches the row off at once when that size is the one
-- in use, so the next request reads no size: one refused design, not one
-- per request. A size with no platform or format is not recorded.
create or replace function public.note_platform_size_outcome(p_platform text, p_format text, p_width integer, p_height integer, p_outcome text, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_platform is null or p_format is null or p_width is null or p_height is null
     or p_outcome not in ('drawn', 'refusal_confirmed') then
    return;
  end if;
  insert into public.platform_size_outcomes (platform, format, width, height, drawn_at, refused_at, refused_reason, refusal_confirmed_at)
  values (p_platform, p_format, p_width, p_height,
          case when p_outcome = 'drawn' then now() end,
          case when p_outcome = 'refusal_confirmed' then now() end,
          case when p_outcome = 'refusal_confirmed' then left(p_reason, 500) end,
          case when p_outcome = 'refusal_confirmed' then now() end)
  on conflict (platform, format, width, height) do update
     set drawn_at = coalesce(excluded.drawn_at, public.platform_size_outcomes.drawn_at),
         refused_at = coalesce(excluded.refused_at, public.platform_size_outcomes.refused_at),
         refused_reason = case when excluded.refused_at is not null then excluded.refused_reason else public.platform_size_outcomes.refused_reason end,
         refusal_confirmed_at = coalesce(excluded.refusal_confirmed_at, public.platform_size_outcomes.refusal_confirmed_at);
  if p_outcome = 'refusal_confirmed' then
    update public.platform_sizes set usable = false
     where platform = p_platform and format = p_format and width = p_width and height = p_height and usable;
  end if;
end $$;

revoke all on function public.note_platform_size_outcome(text, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.note_platform_size_outcome(text, text, integer, integer, text, text) to service_role;

-- The image model refused a design job's size. Every job of the job's
-- option that still carries an upload size is made as it would have been
-- without this table, in one statement, so all slides of a carousel end in
-- one size: the page and the delivered size go, the stored placement comes
-- back (input.as_before, written when the job was started), and the refused
-- size is kept on the job (input.size_refused). The request stops carrying
-- the size, so an option started later is made as before too. Nothing is
-- recorded against the size here: that takes the design drawn at once in
-- another picture size (note_platform_size_outcome). Answers how many jobs
-- changed: none the second time, since no job carries the size any more.
-- (The same change in code: _shared/design/sizeFallback.ts, asBeforeInput.)
create or replace function public.design_size_refused(p_job uuid, p_reason text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_request uuid;
  v_option integer;
  v_deliver jsonb;
  v_changed integer := 0;
begin
  select design_request_id, option_index, input -> 'generate' -> 'deliver'
    into v_request, v_option, v_deliver
    from public.canva_finish_jobs where id = p_job;
  if v_deliver is null or jsonb_typeof(v_deliver) <> 'object' then return 0; end if;

  update public.canva_finish_jobs
     set input = (input - 'as_before') || jsonb_build_object(
           'placement', input -> 'as_before' -> 'placement',
           'generate', ((input -> 'generate') - 'deliver' - 'size')
             || case when (input -> 'as_before') ? 'size' then jsonb_build_object('size', input -> 'as_before' -> 'size') else '{}'::jsonb end,
           'size_refused', jsonb_build_object(
             'platform', input -> 'generate' -> 'deliver' -> 'platform', 'format', input -> 'generate' -> 'deliver' -> 'format',
             'width', input -> 'generate' -> 'deliver' -> 'width', 'height', input -> 'generate' -> 'deliver' -> 'height')),
         updated_at = now()
   where (id = p_job or (v_request is not null and design_request_id = v_request and option_index is not distinct from v_option))
     and status in ('queued', 'running')
     and (input -> 'generate') ? 'deliver'
     and (input -> 'as_before') ? 'placement';
  get diagnostics v_changed = row_count;

  if v_request is not null then
    update public.design_requests set upload_size = null where id = v_request and upload_size is not null;
  end if;
  return v_changed;
end $$;

revoke all on function public.design_size_refused(uuid, text) from public, anon, authenticated;
grant execute on function public.design_size_refused(uuid, text) to service_role;
