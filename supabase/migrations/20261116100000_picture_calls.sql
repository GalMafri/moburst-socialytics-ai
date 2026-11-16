-- How the picture service knows a call is ours, with no shared secret
-- (16 Nov 2026). The worker opens a call here before each attempt and sends
-- its id with the request; the service asks the database to claim that id
-- before it reads anything else. A claim succeeds once, and only within 120
-- seconds of the call being opened, so an id that leaked could not be used
-- again. Nothing is typed in by a person and nothing needs rotating. Of the
-- roles the app and its REST endpoint can use (anon, authenticated,
-- service_role), only the service role, which the workers already hold, can
-- open a call. The database owner and the hosting platform's own roles can
-- too, as for every table and function here: the default privileges of this
-- schema grant them, and this migration leaves those grants alone.
--
-- The table is closed to everyone: row level security is on, no policy lets
-- anyone in and the app's roles hold no grant, so the two functions below are
-- the only way in. Its only policies are the three restrictive ones every
-- table carries, which keep an OAuth session (the Claude connector) from
-- writing even if a policy were ever added.

create table if not exists public.picture_calls (
  id uuid primary key default gen_random_uuid(),
  opened_at timestamptz not null default now(),
  claimed_at timestamptz
);

alter table public.picture_calls enable row level security;
revoke all on table public.picture_calls from public, anon, authenticated;

drop policy if exists "OAuth sessions cannot insert" on public.picture_calls;
create policy "OAuth sessions cannot insert" on public.picture_calls as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.picture_calls;
create policy "OAuth sessions cannot update" on public.picture_calls as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.picture_calls;
create policy "OAuth sessions cannot delete" on public.picture_calls as restrictive for delete to authenticated using (not (select public.is_oauth_session()));

-- The clearing in open_picture_call reads by age.
create index if not exists picture_calls_opened_at_idx on public.picture_calls (opened_at);

-- Opens a call and gives its id. Calls older than a day are cleared in the
-- same statement, so the table stays small with no job to sweep it; a day is
-- kept so yesterday's calls can still be counted.
create or replace function public.open_picture_call()
returns uuid
language sql
security definer
set search_path = ''
as $$
  with cleared as (
    delete from public.picture_calls where opened_at < now() - interval '1 day'
  )
  insert into public.picture_calls default values returning id;
$$;

revoke all on function public.open_picture_call() from public, anon, authenticated;
grant execute on function public.open_picture_call() to service_role;

-- Claims a call: true only when the id exists, has not been claimed and was
-- opened within the last 120 seconds. The update takes the row's lock, so two
-- claims of one id at the same moment cannot both succeed. The picture
-- service calls this with the project's public anon key, which is why anon
-- may run it: an id is 122 random bits that only the worker and the service
-- ever see, and a wrong guess changes nothing.
create or replace function public.claim_picture_call(p_call uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.picture_calls
       set claimed_at = now()
     where id = p_call
       and claimed_at is null
       and opened_at > now() - interval '120 seconds'
    returning id
  )
  select exists (select 1 from claimed);
$$;

revoke all on function public.claim_picture_call(uuid) from public, authenticated;
grant execute on function public.claim_picture_call(uuid) to anon, service_role;
