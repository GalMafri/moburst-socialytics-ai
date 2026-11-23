create table if not exists public.api_action_runs (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  action text not null,
  idempotency_key text not null,
  request_hash text not null,
  client_id uuid,
  status text not null default 'running' check (status in ('running', 'done')),
  response_status integer,
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (owner, action, idempotency_key)
);
create index if not exists api_action_runs_created on public.api_action_runs (created_at);
alter table public.api_action_runs enable row level security;
revoke all on table public.api_action_runs from public, anon, authenticated;

drop policy if exists "OAuth sessions cannot insert" on public.api_action_runs;
create policy "OAuth sessions cannot insert" on public.api_action_runs as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.api_action_runs;
create policy "OAuth sessions cannot update" on public.api_action_runs as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.api_action_runs;
create policy "OAuth sessions cannot delete" on public.api_action_runs as restrictive for delete to authenticated using (not (select public.is_oauth_session()));

create or replace function public.api_action_claim(p_owner text, p_action text, p_key text, p_hash text, p_client uuid)
returns table (claimed boolean, status text, request_hash text, response_status integer, response jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.api_action_runs r
   where r.owner = p_owner and r.action = p_action and r.idempotency_key = p_key
     and (r.created_at < now() - interval '24 hours' or (r.status = 'running' and r.created_at < now() - interval '15 minutes'));
  delete from public.api_action_runs r where r.created_at < now() - interval '7 days';
  insert into public.api_action_runs (owner, action, idempotency_key, request_hash, client_id)
    values (p_owner, p_action, p_key, p_hash, p_client)
    on conflict (owner, action, idempotency_key) do nothing;
  if found then
    return query select true, 'running'::text, p_hash, null::integer, null::jsonb;
    return;
  end if;
  return query select false, r.status, r.request_hash, r.response_status, r.response
    from public.api_action_runs r
   where r.owner = p_owner and r.action = p_action and r.idempotency_key = p_key;
end $$;
revoke all on function public.api_action_claim(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.api_action_claim(text, text, text, text, uuid) to service_role;