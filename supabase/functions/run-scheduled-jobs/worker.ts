// The scheduled-jobs worker loop and the daily repair sweep.
//
// pg_cron calls the worker every minute. Each call sweeps abandoned runs,
// then leases and runs one job at a time. It starts a new job only inside
// the first START_WINDOW_MS, so even a slow job (a feed refresh can take a
// minute or more) never runs into the edge runtime's wall clock. A worker
// that dies anyway leaves the job's lease to expire, and the next call
// picks it up with the attempt counted.
//
// Report pipeline steps (report_pipeline jobs) run in a lane of their own,
// alongside that loop: up to PIPELINE_CONCURRENCY at once across every
// worker, so the reports that start together on the 7th never queue behind
// each other or behind the calendar, and the main loop is unchanged. The
// main lease never hands out a pipeline job (scheduled_jobs_lease).

import type { JobOutcome, ScheduledJob } from "./types.ts";

export const LEASE_SECONDS = 300;
export const START_WINDOW_MS = 20_000;
export const RETRY_MINUTES = 10;
/** Report pipeline steps running at once, across every worker. */
export const PIPELINE_CONCURRENCY = 4;

/** The report pipeline lane. */
export interface PipelineLane {
  /** Pipeline jobs that are due, as many as the lane has room for across every worker. */
  lease(): Promise<ScheduledJob[]>;
  run(job: ScheduledJob): Promise<JobOutcome>;
  finish(job: ScheduledJob, outcome: JobOutcome): Promise<void>;
}

export interface WorkerDeps {
  now(): Date;
  lease(): Promise<ScheduledJob | null>;
  run(job: ScheduledJob): Promise<JobOutcome>;
  finish(job: ScheduledJob, outcome: JobOutcome): Promise<void>;
  closeAbandoned(): Promise<Array<{ table: string; id: string }>>;
  /** release_ready_dispatches: held social jobs whose competitive report finished. */
  releaseReady(): Promise<number>;
  /** The report pipeline lane; without it the tick runs the main loop alone. */
  pipelines?: PipelineLane;
}

export interface TickResult {
  abandoned: number;
  released: number;
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
  let released = 0;
  try {
    released = await d.releaseReady();
  } catch (e) {
    console.warn("[scheduled-jobs] release sweep failed:", e instanceof Error ? e.message : String(e));
  }
  // The pipeline lane runs alongside the loop below; it never throws.
  const laneResults: TickResult["results"] = [];
  const lane = d.pipelines ? pipelineLane(d.pipelines, d.now, t0, laneResults) : null;
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
      // Out of attempts: a dispatch is blocked rather than failed. Its schedule
      // has not moved on, and a failed job for the same occurrence would never be
      // queued again; blocked is rechecked and alerted every day.
      outcome = job.attempts < job.max_attempts
        ? { status: "queued", reason, available_at: new Date(d.now().getTime() + RETRY_MINUTES * 60000).toISOString() }
        : { status: job.kind === "dispatch" ? "blocked" : "failed", reason };
    }
    await d.finish(job, outcome);
    results.push({ id: job.id, kind: job.kind, status: outcome.status, reason: outcome.reason ?? null });
  }
  if (lane) {
    await lane;
    results.push(...laneResults);
  }
  return { abandoned, released, results };
}

/**
 * Leases pipeline jobs while the lane has room and the start window is open,
 * and runs each as soon as it is leased; a step that finishes early frees its
 * room for the next. Never throws: a lane that cannot lease (its database
 * function not there yet) leaves the main loop untouched.
 */
async function pipelineLane(lane: PipelineLane, now: () => Date, t0: number, out: TickResult["results"]): Promise<void> {
  const inFlight = new Set<Promise<void>>();
  const runOne = async (job: ScheduledJob) => {
    let outcome: JobOutcome;
    try {
      outcome = await lane.run(job);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[scheduled-jobs] ${job.kind} ${job.id} threw:`, reason);
      outcome = job.attempts < job.max_attempts
        ? { status: "queued", reason, available_at: new Date(now().getTime() + RETRY_MINUTES * 60000).toISOString() }
        : { status: "failed", reason };
    }
    try {
      await lane.finish(job, outcome);
    } catch (e) {
      // The lease runs out and the step is run again.
      console.warn(`[scheduled-jobs] ${job.kind} ${job.id} finish:`, e instanceof Error ? e.message : String(e));
    }
    out.push({ id: job.id, kind: job.kind, status: outcome.status, reason: outcome.reason ?? null });
  };
  try {
    for (;;) {
      if (now().getTime() - t0 >= START_WINDOW_MS) break;
      if (inFlight.size < PIPELINE_CONCURRENCY) {
        const jobs = await lane.lease();
        for (const job of jobs) {
          const p: Promise<void> = runOne(job).finally(() => { inFlight.delete(p); });
          inFlight.add(p);
        }
        if (!jobs.length && !inFlight.size) break;
      }
      if (inFlight.size) await Promise.race(inFlight);
    }
  } catch (e) {
    console.warn("[scheduled-jobs] pipeline lane:", e instanceof Error ? e.message : String(e));
  }
  await Promise.all(inFlight);
}

/** Grace before a dead lease or an undrained queue counts as a problem. */
const LEASE_GRACE_MS = 5 * 60000;
const DRAIN_GRACE_MS = 30 * 60000;
const DAY_MS = 86_400_000;

/** A due schedule occurrence with no job (scheduled_report_gaps). */
export interface ScheduleGap {
  schedule_id: string;
  client_id: string;
  client_name: string | null;
  report_kind: string;
  next_run_at: string;
}

export interface JobsSummary {
  counts: Record<string, number>;
  failed: ScheduledJob[];
  blocked: ScheduledJob[];
  stuck: ScheduledJob[];
  overdue: ScheduledJob[];
  unscheduled: ScheduleGap[];
}

/**
 * What the daily sweep looks at: a job that failed in the last day, a job
 * blocked on something outside it, a lease that ran out without the job
 * finishing, due work nobody picked up (the worker is not running), and a
 * due schedule with no job at all (the daily enqueue did not run). Nothing
 * here alerts anyone; repairsFor says what the sweep puts right.
 */
export function summarize(rows: ScheduledJob[], now: Date, gaps: ScheduleGap[] = []): JobsSummary {
  const t = now.getTime();
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const failed = rows.filter((r) => r.status === "failed" && r.finished_at && t - new Date(r.finished_at).getTime() < DAY_MS);
  const blocked = rows.filter((r) => r.status === "blocked");
  const stuck = rows.filter((r) => r.status === "running" && r.lease_until && new Date(r.lease_until).getTime() < t - LEASE_GRACE_MS);
  const overdue = rows.filter((r) => r.status === "queued" && t - new Date(r.available_at).getTime() > DRAIN_GRACE_MS);
  return { counts, failed, blocked, stuck, overdue, unscheduled: gaps };
}

export interface Repairs {
  /** Running jobs whose worker stopped long ago: back in the queue now. */
  requeue: string[];
  /** Due schedules with no job: the daily enqueue runs again (it only adds what is missing). */
  enqueue: boolean;
  /** Due work nobody picked up: the worker runs now. */
  work: boolean;
}

/**
 * What the daily sweep puts right on its own. Failed and blocked jobs are
 * left to their own retries (the next daily enqueue releases blocked
 * dispatches and adds the day's feed refreshes again); they stay in the
 * sweep's answer for developers to read.
 */
export function repairsFor(s: JobsSummary): Repairs {
  return { requeue: s.stuck.map((j) => j.id), enqueue: s.unscheduled.length > 0, work: s.stuck.length > 0 || s.overdue.length > 0 };
}
