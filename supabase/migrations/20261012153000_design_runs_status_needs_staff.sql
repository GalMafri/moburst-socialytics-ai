-- design_runs_status gains needs_staff: runs that ended in the last two hours with nothing offered. The client sees "Finishing up";
-- the hourly n8n check mails the team.
create or replace function public.design_runs_status()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'queued', (select count(*) from public.design_runs where status = 'queued'),
    'running', (select count(*) from public.design_runs where status = 'running'),
    'stuck', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'client_id', client_id, 'post_key', post_key)), '[]'::jsonb)
                from public.design_runs where status = 'running' and lease_until < now()),
    'failed_today', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'client_id', client_id, 'failure', failure)), '[]'::jsonb)
                from public.design_runs where status = 'failed' and finished_at > now() - interval '1 day'),
    'needs_staff', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'client', c.name, 'platform', r.platform, 'format', r.format,
                                                                  'finished_at', r.finished_at, 'failure', left(coalesce(r.failure, ''), 400))), '[]'::jsonb)
                from public.design_runs r join public.clients c on c.id = r.client_id
               where r.status in ('dropped', 'failed') and r.finished_at > now() - interval '2 hours'
                 and not exists (select 1 from public.design_options o where o.run_id = r.id and o.status = 'offered')))
$$;
revoke all on function public.design_runs_status() from public, anon, authenticated;
