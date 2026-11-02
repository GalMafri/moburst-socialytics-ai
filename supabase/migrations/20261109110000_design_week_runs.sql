-- The week's design button (Lital, 2 Nov 2026: "one button to design a whole
-- week's posts, on request only, never automatic"). Spec:
-- docs/superpowers/specs/2026-11-02-design-week-button-design.md
--
-- design_week_runs: one per client and week while it is being designed. A
-- press starts it; a second press, by anyone, adds only posts that became
-- eligible since. Each post starts through the same design request a single
-- post's "Create design" makes (design-request week_continue, asked by the
-- design worker's minute pass), naming the person who added it and carrying
-- the run's id (design_requests.batch_id).
--
-- The automatic designs leave for good: their switch, their schedule, and
-- every request without a person. Filming requests still close on their own
-- (that spends nothing), on a schedule of their own.
--
-- Checked on production before this was written (2 Nov 2026, 13:08 Israel
-- time): no client had auto_designs on, and no request without requested_by
-- was made since 20 Oct, so nothing is lost. Safe to apply twice.

-- ── 1. The automatic designs' schedule ──────────────────────────────────────
-- It reads design_brand_settings.auto_designs, so it goes before the column.
select cron.unschedule('design-auto-upcoming') where exists (select 1 from cron.job where jobname = 'design-auto-upcoming');

-- ── 2. Week runs ────────────────────────────────────────────────────────────
create table if not exists public.design_week_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  status text not null default 'running' check (status in ('running', 'done', 'stopped')),
  -- [{post_key, kind, post_at, state: queued|started|filming|left_out, why, waits_for, added_by, added_at, request_id, started_at}]
  posts jsonb not null default '[]'::jsonb,
  -- What staff were shown at the press: {posts, single, carousel, video, credits, minutes}. Staff only.
  estimate jsonb,
  requested_by uuid not null,
  stopped_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
-- One running week per client and week: a second press adds to it.
create unique index if not exists design_week_runs_one_running on public.design_week_runs (client_id, week_start) where status = 'running';
create index if not exists design_week_runs_client on public.design_week_runs (client_id, week_start, created_at desc);

alter table public.design_week_runs enable row level security;
revoke all on public.design_week_runs from anon, authenticated;
grant all on public.design_week_runs to service_role;
-- The client's own users see the week's progress; what it was estimated to
-- cost stays with Moburst (read through design-request week_preview).
grant select (id, client_id, week_start, status, posts, requested_by, stopped_by, created_at, updated_at, finished_at) on public.design_week_runs to authenticated;
drop policy if exists "Read design week runs" on public.design_week_runs;
create policy "Read design week runs" on public.design_week_runs for select to authenticated
  using (public.is_moburst_staff() or public.is_client_member(client_id));

comment on table public.design_week_runs is 'One per press of the week''s design button for a client''s calendar week; its posts start as design_requests carrying its id (batch_id). Written only by the service role.';

-- ── 3. Requests carry their week ────────────────────────────────────────────
alter table public.design_requests add column if not exists batch_id uuid references public.design_week_runs(id) on delete set null;
create index if not exists design_requests_batch on public.design_requests (batch_id) where batch_id is not null;
comment on column public.design_requests.batch_id is 'The week run (design_week_runs) that started this request; null for a single post''s own button.';

-- ── 4. Every new request names a person ─────────────────────────────────────
-- Not valid: requests the automatic designs made before 20 Oct keep their
-- empty requested_by; every request from now on must name who asked.
alter table public.design_requests drop constraint if exists design_requests_requested_by_named;
alter table public.design_requests add constraint design_requests_requested_by_named check (requested_by is not null) not valid;

-- ── 5. The automatic designs' switch ────────────────────────────────────────
alter table public.design_brand_settings drop column if exists auto_designs;

-- ── 6. Filming requests close on their own ──────────────────────────────────
-- Closed once footage arrived, once the post passed or left the calendar, and
-- a day before the post when no footage came (design-request close_filming).
-- Nothing is designed by it: the week's button counts such a post again.
select cron.unschedule('design-close-filming') where exists (select 1 from cron.job where jobname = 'design-close-filming');
select cron.schedule('design-close-filming', '*/10 * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/design-request',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{"action":"close_filming"}'::jsonb, timeout_milliseconds := 60000)
  where exists (select 1 from public.design_requests where status = 'needs_filming');
$cron$);

-- ── 7. The design worker runs while a week is being designed ────────────────
-- Its pass asks design-request to start the week's next posts, so it also
-- runs while a week has posts waiting their turn and nothing is designing.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'design-worker') then perform cron.unschedule('design-worker'); end if;
end $$;
select cron.schedule('design-worker', '* * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/design-worker',
    headers := jsonb_build_object('Content-Type','application/json','X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 120000)
  where exists (select 1 from public.canva_finish_jobs where status in ('queued', 'running') and coalesce(input->>'kind', '') <> 'video')
     or exists (select 1 from public.design_requests where status = 'preparing')
     or exists (select 1 from public.design_week_runs where status = 'running');
$cron$);
