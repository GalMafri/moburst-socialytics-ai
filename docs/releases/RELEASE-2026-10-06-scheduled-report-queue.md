# Release 2026-10-06: scheduled reports and competitor feeds run as a queue

Commits `5f20d04` to `bc0d874` on main. Edge functions deployed by the Lovable agent: `run-scheduled-jobs` (new, JWT verification off), `trigger-scheduled-reports`, `refresh-competitor-feed` and `update-competitive-report` from `8278fa0`, then `run-scheduled-jobs` again from `bc0d874`. Database changes applied live through `query_database` between 14:50 and 14:57 Israel time: `20261006150000_scheduled_report_queue.sql`, `20261006150100_scheduled_report_queue_cron.sql`, `20261006150200_drop_schedule_claim.sql`. No frontend change. Design: `docs/superpowers/specs/2026-10-06-scheduled-report-queue-design.md`.

## Why

n8n's "Socialytics - Daily Scheduler" posted to `trigger-scheduled-reports` at 07:15 UTC with a 120 s timeout, and that one request closed abandoned runs, refreshed every stale competitor feed one after another (45 to 60 s each), then dispatched every due schedule. On 2026-10-06 four feeds refreshed between 10:15:05 and 10:17:01 Israel time, n8n hung up at 10:17:00 and the request stopped (n8n execution 516962, "The connection was aborted"). On 2026-10-07 twelve monthly schedules fall due (competitive and social for Bader Law, LegaBot, Moburst, MyRxProfile, NewDay USA and Subliy); the same request would have spent minutes on the five feeds still stale and been cut off before any dispatch. Lital rejected "respond fast, work in the background" as a stopgap and asked for the structural fix.

## What changed

- **`scheduled_jobs`**: one row per feed refresh (per client per day) or dispatch (per schedule occurrence), unique dedupe key, lease with `skip locked`, recorded dispatch phases (`prepared`, `posting`). A job interrupted while posting never posts again; its report is closed as unconfirmed for the Retry control. RLS on, service role only.
- **Clock in the database**: `scheduled-reports-enqueue` (07:15 UTC) runs `enqueue_scheduled_report_jobs()` in SQL; `scheduled-jobs-worker` (every minute) calls `run-scheduled-jobs`, which sweeps abandoned runs, releases held social jobs whose competitive report finished, and runs jobs one at a time, starting new ones only in its first 20 s.
- **Feed refresh in-process**: the body of `refresh-competitor-feed` moved verbatim to `_shared/competitive/refreshFeed.ts`; the endpoint is auth plus a call, and the worker runs the same code. Feeds refresh on a stable per-client weekday, or after six days, so they no longer all fall due on one morning.
- **No function calls a function for scheduling**: `update-competitive-report` no longer calls the scheduler; the worker's sweep releases the held social report within a minute.
- **`trigger-scheduled-reports`** is now the manual enqueue endpoint (`?dry_run=1` previews).
- **Alerting**: the n8n workflow (same id `m6hj4kWuT1tPSeJg`) is now "Socialytics - Scheduled Jobs Check" at 08:30 UTC. It reads `run-scheduled-jobs {"mode":"status"}` and throws, so the error workflow emails, when a job failed, is blocked, stuck or not picked up, or an active schedule is an hour past due with no job.
- **Removed**: the dispatch loop and HTTP feed calls in the old scheduler, `claim_report_schedule`, and the QA-10/QA-11/QA-04 scheduler checks in `scripts/qa-backend.cjs` (their behaviours are Vitest tests now).

## Evidence

| Check | Result |
|---|---|
| Unit and component tests | 887 passed (`npx vitest run`; 846 before, 41 new: dispatch rules ported from QA-10/11/04, interruption and resume, feed outcomes, worker loop, status summary, schedule arithmetic); `npx tsc -b` clean; `deno check` on the four functions shows only the pre-existing `reportMetrics.ts` error that main has too |
| SQL against Postgres | `scripts/qa-sql-queue.mjs` (PGlite, `QA_SQL_MODULE` pointing at a PGlite build): migration applies twice, only `service_role` reaches it, dry run writes nothing, enqueue idempotent and ordered with the old stagger, lease exclusive and counts attempts, the sweep releases only finished competitive dependencies, overdue schedules with no job are reported |
| Backend QA script | 101 checks, 54 pass; the 47 failures are the same pre-existing "Unmocked dependency" harness failures as before this release; the feed identity checks (QA-FEED) pass against the moved module |
| Independent review | one reviewer pass before deploy; its three defects (exhausted dispatch left `failed` and never retried, resumed competitive skipping the pin, a release race) were fixed in `254db98` |
| Live auth | status 200 with the Vault secret, 401 with a wrong one, no gateway JWT rejection |
| Live dry run for 2026-10-07 07:15 UTC | all 6 competitive payloads build and would post (2026-09-01 to 2026-09-30, stagger 0 to 750 s); all 6 social payloads build and wait for their competitive analysis, as the rules require |
| Live jobs, 14:55 to 14:56 Israel time | 5 feed jobs: Moburst refreshed in 35 s (13 posts, 4 alerts, snapshot saved); Subliy, Glossier, Brooklinen and Calm skipped as RivalIQ not tracking the client (configuration, not failure) |
| Live alert workflow | manual run 518052: status read with the stored credential, ok, no alert |

## Leftovers

- Subliy's competitive report is due 2026-10-07 and RivalIQ does not track Subliy; its competitive run will likely fail and hold its social report as blocked, which the 08:30 UTC check will report.
- `n8n/managed-webhook-auth-patch.json` still describes the old 07:15 call to `trigger-scheduled-reports`; harmless (that endpoint only enqueues now) and superseded by the live workflow.
