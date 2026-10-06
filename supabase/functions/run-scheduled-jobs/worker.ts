// The scheduled-jobs worker loop and the daily status summary.
//
// pg_cron calls the worker every minute. Each call sweeps abandoned runs,
// then leases and runs one job at a time. It starts a new job only inside
// the first START_WINDOW_MS, so even a slow job (a feed refresh can take a
// minute or more) never runs into the edge runtime's wall clock. A worker
// that dies anyway leaves the job's lease to expire, and the next call
// picks it up with the attempt counted.

import type { JobOutcome, ScheduledJob } from "./types.ts";

export const LEASE_SECONDS = 300;
export const START_WINDOW_MS = 20_000;
export const RETRY_MINUTES = 10;

export interface WorkerDeps {
  now(): Date;
  lease(): Promise<ScheduledJob | null>;
  run(job: ScheduledJob): Promise<JobOutcome>;
  finish(job: ScheduledJob, outcome: JobOutcome): Promise<void>;
  closeAbandoned(): Promise<Array<{ table: string; id: string }>>;
}

export interface TickResult {
  abandoned: number;
  results: Array<{ id: string; kind: string; status: string; reason: string | null }>;
}

export async function workerTick(d: WorkerDeps): Promise<TickResult> {
  const t0 = d.now().getTime();
  let abandoned = 0;
  try {
    abandoned = (await d.closeAbandoned()).length;
  } catch (e) {
    console.warn("[scheduled-jobs] abandoned-run sweep failed:", e instanceof Error ? e.message : String(e));
  }
  const results: TickResult["results"] = [];
  for (;;) {
    if (results.length > 0 && d.now().getTime() - t0 >= START_WINDOW_MS) break;
    const job = await d.lease();
    if (!job) break;
    let outcome: JobOutcome;
    try {
      outcome = await d.run(job);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[scheduled-jobs] ${job.kind} ${job.id} threw:`, reason);
      outcome = job.attempts >= job.max_attempts
        ? { status: "failed", reason }
        : { status: "queued", reason, available_at: new Date(d.now().getTime() + RETRY_MINUTES * 60000).toISOString() };
    }
    await d.finish(job, outcome);
    results.push({ id: job.id, kind: job.kind, status: outcome.status, reason: outcome.reason ?? null });
  }
  return { abandoned, results };
}

/** Grace before a dead lease or an undrained queue counts as a problem. */
const LEASE_GRACE_MS = 5 * 60000;
const DRAIN_GRACE_MS = 30 * 60000;
const DAY_MS = 86_400_000;

export interface JobsSummary {
  ok: boolean;
  counts: Record<string, number>;
  failed: ScheduledJob[];
  blocked: ScheduledJob[];
  stuck: ScheduledJob[];
  overdue: ScheduledJob[];
}

/**
 * What the daily check alerts on: a job that failed in the last day, a job
 * blocked on something a person has to fix, a lease that ran out without the
 * job finishing, and due work nobody picked up (the worker is not running).
 */
export function summarize(rows: ScheduledJob[], now: Date): JobsSummary {
  const t = now.getTime();
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const failed = rows.filter((r) => r.status === "failed" && r.finished_at && t - new Date(r.finished_at).getTime() < DAY_MS);
  const blocked = rows.filter((r) => r.status === "blocked");
  const stuck = rows.filter((r) => r.status === "running" && r.lease_until && new Date(r.lease_until).getTime() < t - LEASE_GRACE_MS);
  const overdue = rows.filter((r) => r.status === "queued" && t - new Date(r.available_at).getTime() > DRAIN_GRACE_MS);
  return { ok: !failed.length && !blocked.length && !stuck.length && !overdue.length, counts, failed, blocked, stuck, overdue };
}
