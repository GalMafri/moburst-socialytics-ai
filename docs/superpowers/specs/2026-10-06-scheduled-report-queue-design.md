# Scheduled reports run as a queue

Status: approved direction (Lital, 2026-10-06). Replaces the single-request
scheduler in `trigger-scheduled-reports`.

## Why

The monthly reports and the weekly competitor feeds were run by one HTTP
request. n8n's "Socialytics - Daily Scheduler" posted to
`trigger-scheduled-reports` at 07:15 UTC with a 120 s timeout, and that one
request closed abandoned runs, refreshed every stale competitor feed one after
another, then dispatched every due schedule.

On 2026-10-06 four feeds refreshed between 07:15:05 and 07:17:01 UTC (45 to 60 s
each: RivalIQ, the LinkedIn source workflow, Claude), n8n hung up at 07:17:00
and the request stopped. Five clients' feeds were still stale. On 2026-10-07,
twelve monthly schedules fall due (Bader Law, LegaBot, Moburst, MyRxProfile,
NewDay USA, Subliy; competitive and social each). The same request would have
spent minutes on feeds and been cut off before it dispatched any report.

What allowed it:

1. One request did a batch whose size grows with the client list, under two
   timeouts (n8n's and the edge runtime's wall clock). A request cut off
   mid-loop also left claimed schedules that needed manual review.
2. Functions called functions over HTTP: the scheduler called
   `refresh-competitor-feed`, and `update-competitive-report` called the
   scheduler to release a held social report.
3. Staleness was "older than six days", so feeds refreshed together all fell
   due on the same morning.
4. n8n was only a clock, adding a network hop with its own timeout.
5. Only the first error surfaced; nothing recorded which unit of work failed.

## Design

### Units of work: `scheduled_jobs`

One row per unit of work: one feed refresh for one client on one day, or one
dispatch of one schedule occurrence.

| column | meaning |
|---|---|
| `kind` | `feed_refresh` or `dispatch` |
| `client_id`, `schedule_id`, `occurrence` | what it is for; `occurrence` is the schedule's `next_run_at` it serves |
| `dedupe_key` (unique) | `dispatch:<schedule>:<occurrence>` or `feed:<client>:<date>`; enqueueing twice is a no-op |
| `priority` | feeds 10, competitive 20, social 30 (same order the old request used) |
| `stagger_seconds` | sent to n8n as before: competitive n*150, social n*180 |
| `status` | `queued`, `running`, `waiting`, `blocked`, `done`, `skipped`, `failed` |
| `phase`, `report_id` | dispatch progress: `prepared` (report row created) then `posting` (request sent) |
| `attempts`, `max_attempts`, `available_at`, `lease_until` | leasing and retry |
| `reason`, `result` | why it is not done, and what it did |

`waiting` means a dependency is in progress (competitive report running, set
not confirmed yet). `blocked` means a dependency failed and needs a person
(retry the competitive report). Both are rechecked every day and released the
moment their competitive report completes.

RLS is on with no policies: only the service role touches the table.

### Clock: pg_cron in the project

- `scheduled-reports-enqueue`, `15 7 * * *`: `select public.enqueue_scheduled_report_jobs()`.
  Pure SQL, no HTTP.
- `scheduled-jobs-worker`, every minute: `net.http_post` to `run-scheduled-jobs`
  with the Vault secret, the same pattern as `api-demo-worker`.

n8n "Socialytics - Daily Scheduler" stops being the clock. It becomes the
daily check that alerts by email (see Alerting).

### Enqueue (SQL, idempotent)

`enqueue_scheduled_report_jobs(p_now, p_dry_run)`:

1. Release every `waiting` / `blocked` dispatch job (the old daily recheck).
2. One `dispatch` job per active schedule with `next_run_at <= p_now` whose
   client is not archived.
3. One `feed_refresh` job per non-archived client with a competitor set in
   `confirmed`, `analyzing`, `complete` or `failed`, when its latest feed is
   missing, older than seven days, or older than a day and today is the
   client's refresh weekday (a stable hash of the client id). Feeds spread
   across the week instead of falling due together.
4. Returns what it enqueued. `p_dry_run` returns the same list without writing.

### Worker: `run-scheduled-jobs`

Each invocation:

1. Closes abandoned runs (moved unchanged from the old scheduler; it now runs
   every minute, so a dead run is closed within a minute of the 90-minute mark).
2. Leases one job (`scheduled_jobs_lease`, 300 s lease, `for update skip
   locked`), runs it, records the outcome, and leases another only while less
   than 20 s have passed. Every job is bounded, so no invocation approaches
   the wall clock, and overlapping invocations never share a job.

Two invocations can overlap when a job outlasts the minute. They never share a
job (lease plus `skip locked`), and every RivalIQ call already goes through the
database coordinator (`claim_rivaliq_request`: one call at a time, hourly
budget), so overlap needs no extra lock.

`feed_refresh` runs the feed refresh in-process
(`_shared/competitive/refreshFeed.ts`, extracted from `refresh-competitor-feed`,
which keeps serving the feed page). `RIVALIQ_CLIENT_NOT_TRACKED` ends as
`skipped` with that code. Other errors retry after 10 minutes, up to three
attempts, then `failed`.

`dispatch` keeps the old per-schedule rules exactly (competitive needs a set
in the accepted statuses; social waits for a due paired competitive analysis
and for its pending competitive report; the range comes from the completed
competitive report; archived clients never dispatch), with explicit phases:

- `prepared`: the report row exists and its id is on the job. A job resumed
  in this phase reuses that report.
- `posting`: written immediately before the webhook call. A job found in this
  phase after an interruption never posts again: its report is closed as
  "Dispatch could not be confirmed" (the Retry control's existing path), the
  schedule advances with that error, and the job is `failed`. At most one
  n8n run per occurrence, which is what the old claim protected.
- Webhook refused or payload error: report failed, schedule advanced with the
  error, job `failed` (unchanged behaviour).
- Success: schedule advanced (`last_run_at`, `next_run_at`, `last_result`,
  pending cleared), job `done`.

`report_schedules.last_result` is written as before, so the client setup page
reads the same thing.

### Releasing held social reports

`update-competitive-report`, on a completed report, calls the SQL function
`requeue_dispatch_after_competitive(report_id)` through the database client.
No HTTP call to another function.

### Alerting

`run-scheduled-jobs` with `{"mode":"status"}` returns today's jobs. It
answers 500 when any job is `failed` or `blocked`, or `running` past its
lease, and lists them. The n8n workflow runs that check at 08:30 UTC; its
existing error workflow emails the failure, as alerts reach Lital today.

### What is removed

- The dispatch loop and the HTTP feed calls in `trigger-scheduled-reports`.
  The function stays as a manual "enqueue now" endpoint (secret-protected,
  `?dry_run=1` supported) that calls the same SQL function.
- `claim_report_schedule` and its QA-SQL check: the unique `dedupe_key` plus
  the lease replace the claim. `dispatch_claimed_at` stays as a column (read by
  nothing) to avoid a destructive schema change.
- The QA-10 block in `scripts/qa-backend.cjs`, which loads the old module.
  Its behaviours move to Vitest tests on the new worker.

## Proof before go-live

- Vitest: dispatch rules ported from QA-10 (hold social until a fresh
  competitive completes, in both orders; missing set holds both; failed
  dependency is visible; webhook throw / refuse / accept; interrupted posting
  never re-posts; resumed prepared reuses the report), feed outcomes, lease loop.
- PGlite: migration applies twice; enqueue is idempotent; dry run writes
  nothing; lease hands a job to one caller; requeue releases only the matching
  social job; roles other than service_role are denied.
- Production, before 2026-10-07 07:15 UTC: dry-run enqueue against live data
  (expect the five stale feeds and the twelve due dispatches); dispatch
  dry-run for every due schedule (payload builds against real data, no
  writes, no webhook); a live run of the five stale feed jobs, which are due
  anyway and touch nothing client-facing.
