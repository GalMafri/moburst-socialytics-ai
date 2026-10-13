-- Canva finishing jobs (supabase/functions/canva-finish).
--
-- A generated design is finished in Canva by Socialytics' own Canva app: the
-- drawn logo's layers are deleted, the copy is set exactly, and the client's
-- logo file is placed where the drawn logo was. Each design is one row that
-- the minute worker moves through its steps.

-- Canva rotates refresh tokens on every use, so a refresh is claimed first
-- (see _shared/canva/oauth.ts). Harmless for the other providers.
alter table public.integration_tokens add column if not exists refreshing_until timestamptz;

create table if not exists public.canva_finish_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  created_by uuid,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  step text not null default 'upload',
  -- design_path, logo_path, logo_size [w,h], copy [lines], placement {anchor,width,top,left}, title
  input jsonb not null,
  -- Canva asset/design/job ids, the page, the deleted layers' boxes, stored export paths
  state jsonb not null default '{}'::jsonb,
  output_path text,
  error text,
  attempts int not null default 0,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists canva_finish_jobs_due on public.canva_finish_jobs (status, lease_until);
create index if not exists canva_finish_jobs_client on public.canva_finish_jobs (client_id, created_at desc);

alter table public.canva_finish_jobs enable row level security;
revoke all on public.canva_finish_jobs from anon, authenticated;
grant select on public.canva_finish_jobs to authenticated;
-- Staff read; every write goes through the function with the service role.
drop policy if exists "Staff read canva finish jobs" on public.canva_finish_jobs;
create policy "Staff read canva finish jobs" on public.canva_finish_jobs for select to authenticated using (public.is_moburst_staff());

comment on table public.canva_finish_jobs is 'One generated design being finished in Canva (exact logo file, exact copy). Written only by the canva-finish function.';

-- The worker: every minute, only while a job is waiting.
select cron.schedule('canva-finish-worker', '* * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/canva-finish',
    headers := jsonb_build_object('Content-Type','application/json','X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 120000)
  where exists (select 1 from public.canva_finish_jobs where status in ('queued', 'running'));
$cron$);
