-- Demo clients, and every row a demo created, are visible in the app to admins only.
-- The moburst_user and client roles never see them (Lital, 2026-10-06: demos and their
-- traces confuse users). The API and the project's own functions use the service role,
-- which is not subject to these policies, so demos keep working.
create or replace function public.is_demo_client(_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clients c where c.id = _client_id and c.demo_job_id is not null)
$$;
revoke all on function public.is_demo_client(uuid) from public;
grant execute on function public.is_demo_client(uuid) to authenticated, service_role;

drop policy if exists "Demo clients are for admins only" on public.clients;
create policy "Demo clients are for admins only" on public.clients
  as restrictive for select to authenticated using (public.is_admin() or demo_job_id is null);

-- Every table that hangs off a client. Restrictive policies are ANDed with the existing
-- permissive ones, so nothing else about access changes.
do $$ declare t text; begin
  foreach t in array array[
    'app_events','brand_voice_learnings','client_design_systems','client_users','competitive_alerts',
    'competitive_insight_feedback','competitive_reports','competitor_handles','competitor_sets','competitors',
    'creative_directions','design_learnings','design_states','media_jobs','post_iterations','report_schedules',
    'reports','rivaliq_setup_jobs','rivaliq_snapshots','scheduled_posts','sprout_profiles'] loop
    execute format('drop policy if exists "Demo rows are for admins only" on public.%I', t);
    execute format('create policy "Demo rows are for admins only" on public.%I as restrictive for select to authenticated using (public.is_admin() or not public.is_demo_client(client_id))', t);
  end loop;
end $$;

-- Rows that carry their own demo flag (a demo run on a client that existed before isolation,
-- such as MyRxProfile's 2026-10-01 reports) are hidden as well, whoever the client is.
do $$ declare t text; begin
  foreach t in array array['competitive_reports','competitor_sets','media_jobs','post_iterations','reports'] loop
    execute format('drop policy if exists "Demo rows are for admins only" on public.%I', t);
    execute format('create policy "Demo rows are for admins only" on public.%I as restrictive for select to authenticated using (public.is_admin() or (demo_job_id is null and not public.is_demo_client(client_id)))', t);
  end loop;
end $$;

drop policy if exists "Demo jobs are for admins only" on public.demo_jobs;
create policy "Demo jobs are for admins only" on public.demo_jobs
  as restrictive for select to authenticated using (public.is_admin());
