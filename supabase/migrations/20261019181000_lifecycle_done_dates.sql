-- A design style reused from storage is dated by when it was learned, so its
-- 90-day refresh counts from then (_shared/lifecycle/policy.ts rowAfter,
-- doneAt). Rows written before that rule get the same date, for every client.
update public.client_lifecycle_steps
   set done_at = (result->>'synthesized_at')::timestamptz, updated_at = now()
 where step = 'design_refs' and status = 'done'
   and result ? 'synthesized_at' and (result->>'synthesized_at') is not null
   and (result->>'synthesized_at')::timestamptz < done_at;
