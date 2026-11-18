-- "Sync from Sprout": a staff member starts the Sprout onboarding run now,
-- on top of the weekly one (the owner, 18 Nov 2026: "the sync sprout now
-- button that helps us sync all clients from sprout whenever a staff member
-- wants to on top of the weekly sync").
--
-- The run is the weekly one, unchanged (run-scheduled-jobs/sproutOnboarding.ts):
-- this only queues a sprout_onboarding job for now, through the same queue.
-- enqueue_sprout_onboarding_job (20261108130000_sprout_auto_onboarding.sql)
-- queues on its own days only and is left as it is, as is its cron line.
--
--   enqueue_sprout_onboarding_now(): one job with a key of its own
--   (sprout_onboarding:now:<the moment, UTC>:<random>, so two runs started in
--   the same second never share one), unless a run is queued or
--   running (the weekly one, one a person started, or the rest of either),
--   in which case nothing is queued and that run is named. Two people
--   pressing together are answered one after the other, so they queue one
--   run. No limit beyond one run at a time.
--
-- The weekly rule after a run started here: a finished run counts as a
-- finished run, so "no run finished in 8 days" is measured from it, and the
-- Monday run still happens (a run on Friday is followed by Monday's). The
-- one Monday run that is not queued is the one whose morning finds a run
-- still queued or running, which is that same work under way.
--
-- A person is waiting, so the job goes ahead of automatic work the way a
-- week planned from its button does (priority 15). Service role only: the
-- staff check is the calling function's (sprout-profiles). Safe to run twice.

create or replace function public.enqueue_sprout_onboarding_now()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_open uuid;
  v_id uuid;
  v_key text := 'sprout_onboarding:now:' || to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                || ':' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
begin
  perform pg_advisory_xact_lock(hashtext('enqueue_sprout_onboarding_now'));
  select id into v_open from public.scheduled_jobs
   where kind = 'sprout_onboarding' and status in ('queued', 'running')
   order by created_at, id
   limit 1;
  if v_open is not null then
    return jsonb_build_object('queued', false, 'job_id', v_open, 'dedupe_key', null);
  end if;
  insert into public.scheduled_jobs (kind, client_id, dedupe_key, priority, available_at)
  values ('sprout_onboarding', null, v_key, 15, now())
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return jsonb_build_object('queued', v_id is not null, 'job_id', v_id, 'dedupe_key', case when v_id is not null then v_key end);
end $$;

revoke all on function public.enqueue_sprout_onboarding_now() from public, anon, authenticated;
grant execute on function public.enqueue_sprout_onboarding_now() to service_role;
