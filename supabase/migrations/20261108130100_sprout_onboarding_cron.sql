-- Sprout auto-onboarding: its clock (spec section 6:
-- docs/superpowers/specs/2026-11-02-sprout-auto-onboarding-design.md).
-- Applied only after Lital reviews a dry run on the live list (section 9:
-- run-scheduled-jobs {"mode":"sprout_onboarding_dry_run"}), as Trends was on
-- 2 Nov, since from then on new Sprout brands become clients (and are paid
-- for).
--
-- Daily at 06:00 UTC, 08:00 Israel time (09:00 in summer time), before the
-- Monday plans are queued at 07:15 UTC. enqueue_sprout_onboarding_job
-- (20261108130000_sprout_auto_onboarding.sql) queues a run on Monday, or on
-- any day when no run finished in 8 days; the per-minute worker runs it.
-- Scheduling the same name again replaces the line, so this applies twice.

select cron.schedule('sprout-onboarding-enqueue', '0 6 * * *', $cron$ select public.enqueue_sprout_onboarding_job(); $cron$);
