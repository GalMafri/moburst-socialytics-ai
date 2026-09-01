-- media_jobs: async generation jobs (Higgsfield).
--
-- WHY THIS TABLE EXISTS. The Gemini/Veo video path polled inline inside the
-- edge function for up to 3 minutes. Higgsfield is async-only and video chains
-- two requests (image seed → image-to-video), which can exceed any inline
-- budget. So generate-post-video now records a job row, Higgsfield calls our
-- webhook at terminal state, the webhook copies the media into our storage
-- (Higgsfield CDN URLs expire after ~7 days) and stamps the row, and the
-- frontend watches the row over realtime. Inline polling remains only as the
-- documented recovery path when a webhook never arrives.
--
-- provider/request_id: request_id is Higgsfield's stable identifier; webhook
-- deliveries can arrive MORE THAN ONCE, so terminal transitions must be
-- idempotent — the webhook only updates rows still in a non-terminal status
-- (see the partial unique index + the function's guarded update).

create table if not exists public.media_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade not null,
  post_iteration_id uuid references public.post_iterations(id) on delete set null,
  kind text not null check (kind in ('image', 'video', 'video_seed')),
  provider text not null default 'higgsfield',
  request_id text,                 -- provider's id; set once submitted
  model_path text,                 -- which model route served this job
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'completed', 'failed', 'nsfw', 'canceled', 'timed_out')),
  input jsonb not null default '{}'::jsonb,   -- prompt + params, for reruns/debugging
  output_url text,                 -- OUR storage URL after the copy, never the provider CDN
  seed_image_url text,             -- for videos: the anchor still (our storage)
  error text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_media_jobs_client on public.media_jobs (client_id, created_at desc);
create index if not exists idx_media_jobs_iteration on public.media_jobs (post_iteration_id)
  where post_iteration_id is not null;
-- One row per provider request; webhook lookups come in by request_id.
create unique index if not exists idx_media_jobs_request on public.media_jobs (provider, request_id)
  where request_id is not null;

alter table public.media_jobs enable row level security;

-- Same shape as every other client-scoped table (company-scoped staff model):
-- read via can_access_client, write via can_write_client, admin override via
-- the is_admin policy. NO USING(true) policies — that class of leak was
-- already purged once in 20260720130000_company_scoped_staff.sql.
drop policy if exists "Admins can do everything with media_jobs" on public.media_jobs;
create policy "Admins can do everything with media_jobs" on public.media_jobs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Moburst staff can select media_jobs" on public.media_jobs;
create policy "Moburst staff can select media_jobs" on public.media_jobs
  for select to authenticated using (public.can_access_client(client_id));
drop policy if exists "Moburst staff can insert media_jobs" on public.media_jobs;
create policy "Moburst staff can insert media_jobs" on public.media_jobs
  for insert to authenticated with check (public.can_write_client(client_id));
drop policy if exists "Moburst staff can update media_jobs" on public.media_jobs;
create policy "Moburst staff can update media_jobs" on public.media_jobs
  for update to authenticated using (public.can_write_client(client_id))
  with check (public.can_write_client(client_id));
-- The webhook writes via the service role, which bypasses RLS; no anon policy.

drop trigger if exists update_media_jobs_updated_at on public.media_jobs;
create trigger update_media_jobs_updated_at before update on public.media_jobs
  for each row execute function public.update_updated_at_column();

-- Realtime, same recipe as post_iterations: REPLICA IDENTITY FULL so UPDATE
-- events carry the full row for client-side filters.
alter table public.media_jobs replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'media_jobs'
  ) then
    alter publication supabase_realtime add table public.media_jobs;
  end if;
end $$;
