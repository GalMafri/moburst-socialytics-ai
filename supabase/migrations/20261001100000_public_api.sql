-- Public API: consumer keys, request audit, rate buckets, demo jobs and the
-- flags that mark what a demo created. Same shape as AdVisor's
-- 20260930180000_public_api.sql. Additive: nothing is dropped.
--
-- Also moves the operational secret the crons send out of the job command and
-- into Vault: the value is copied inside the database from the existing
-- advance-creative-plans job and never leaves it.

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{read}',
  company_slugs text[],
  client_ids uuid[],
  rate_limit_per_minute integer not null default 120,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  note text
);
alter table public.api_keys enable row level security;

create table if not exists public.api_requests (
  id bigserial primary key,
  key_id uuid references public.api_keys(id) on delete set null,
  method text not null,
  path text not null,
  status integer not null,
  duration_ms integer,
  client_id uuid,
  job_id uuid,
  ip text,
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists api_requests_key_time on public.api_requests (key_id, created_at desc);
create index if not exists api_requests_time on public.api_requests (created_at desc);
alter table public.api_requests enable row level security;

create table if not exists public.api_rate_buckets (
  key_id uuid not null references public.api_keys(id) on delete cascade,
  minute timestamptz not null,
  count integer not null default 0,
  primary key (key_id, minute)
);
alter table public.api_rate_buckets enable row level security;

create table if not exists public.demo_jobs (
  id uuid primary key default gen_random_uuid(),
  tool text not null default 'socialytics',
  key_id uuid references public.api_keys(id) on delete set null,
  idempotency_key text,
  status text not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  requester jsonb,
  callback_url text,
  callback_status jsonb,
  client_id uuid,
  run_ids uuid[] not null default '{}',
  steps jsonb not null default '[]'::jsonb,
  outputs jsonb,
  gaps jsonb not null default '[]'::jsonb,
  error text,
  lease_until timestamptz,
  next_check_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists demo_jobs_idempotency on public.demo_jobs (key_id, idempotency_key) where idempotency_key is not null;
create index if not exists demo_jobs_due on public.demo_jobs (next_check_at) where status in ('queued','running');
create index if not exists demo_jobs_client on public.demo_jobs (client_id, created_at desc);
alter table public.demo_jobs enable row level security;

create or replace function public.api_key_touch(p_key_hash text)
returns table (id uuid, name text, key_prefix text, scopes text[], company_slugs text[], client_ids uuid[], rate_limit_per_minute integer, expires_at timestamptz, revoked_at timestamptz, minute_count integer)
language plpgsql security definer set search_path = public as $$
declare
  k public.api_keys%rowtype;
  c integer;
begin
  select * into k from public.api_keys a where a.key_hash = p_key_hash;
  if not found then return; end if;
  insert into public.api_rate_buckets (key_id, minute, count) values (k.id, date_trunc('minute', now()), 1)
    on conflict (key_id, minute) do update set count = public.api_rate_buckets.count + 1
    returning public.api_rate_buckets.count into c;
  update public.api_keys set last_used_at = now() where api_keys.id = k.id;
  delete from public.api_rate_buckets b where b.key_id = k.id and b.minute < now() - interval '10 minutes';
  return query select k.id, k.name, k.key_prefix, k.scopes, k.company_slugs, k.client_ids, k.rate_limit_per_minute, k.expires_at, k.revoked_at, c;
end $$;

create or replace function public.demo_jobs_lease(p_limit integer default 3, p_lease_seconds integer default 180)
returns setof public.demo_jobs
language sql security definer set search_path = public as $$
  update public.demo_jobs j
     set lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where j.id in (
     select id from public.demo_jobs
      where status in ('queued','running')
        and (lease_until is null or lease_until < now())
        and (next_check_at is null or next_check_at <= now())
      order by created_at
      limit p_limit
      for update skip locked)
  returning *;
$$;

create or replace function public.api_purge_audit(p_days integer default 180)
returns integer
language sql security definer set search_path = public as $$
  with d as (delete from public.api_requests where created_at < now() - make_interval(days => p_days) returning 1)
  select count(*)::integer from d;
$$;

-- Service role only: these run as SECURITY DEFINER for the api edge function.
revoke all on function public.api_key_touch(text) from public, anon, authenticated;
revoke all on function public.demo_jobs_lease(integer, integer) from public, anon, authenticated;
revoke all on function public.api_purge_audit(integer) from public, anon, authenticated;
grant execute on function public.api_key_touch(text), public.demo_jobs_lease(integer, integer), public.api_purge_audit(integer) to service_role;

-- The operational secret, into Vault, copied from the existing cron command
-- inside the database; the job is then rewritten to read it from Vault.
do $$
declare v text;
begin
  if not exists (select 1 from vault.secrets where name = 'socialytics_n8n_secret') then
    select substring(command from '''X-Socialytics-Secret'',''([^'']+)''') into v from cron.job where jobname = 'advance-creative-plans';
    if v is not null then perform vault.create_secret(v, 'socialytics_n8n_secret', 'The secret the crons send as X-Socialytics-Secret / X-Cron-Secret'); end if;
  end if;
end $$;

select cron.schedule('advance-creative-plans', '*/2 * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/advance-creative-plan',
    headers := jsonb_build_object('Content-Type','application/json','X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$cron$);

select cron.schedule('api-demo-worker', '* * * * *', $cron$
  select net.http_post(url := 'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/internal/worker',
    headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
$cron$);
select cron.schedule('api-audit-purge', '15 3 * * *', $cron$ select public.api_purge_audit(180); $cron$);

-- What a demo created, so it can be shown as a demo and removed later. Null
-- for everything the team made by hand.
alter table public.clients add column if not exists demo_job_id uuid;
alter table public.competitor_sets add column if not exists demo_job_id uuid;
alter table public.reports add column if not exists demo_job_id uuid;
alter table public.competitive_reports add column if not exists demo_job_id uuid;
alter table public.post_iterations add column if not exists demo_job_id uuid;
alter table public.media_jobs add column if not exists demo_job_id uuid;
create index if not exists clients_demo_job on public.clients (demo_job_id) where demo_job_id is not null;
create index if not exists competitor_sets_demo_job on public.competitor_sets (demo_job_id) where demo_job_id is not null;
create index if not exists reports_demo_job on public.reports (demo_job_id) where demo_job_id is not null;
create index if not exists competitive_reports_demo_job on public.competitive_reports (demo_job_id) where demo_job_id is not null;
create index if not exists post_iterations_demo_job on public.post_iterations (demo_job_id) where demo_job_id is not null;
create index if not exists media_jobs_demo_job on public.media_jobs (demo_job_id) where demo_job_id is not null;
