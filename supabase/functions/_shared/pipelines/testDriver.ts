// For tests only: an in-memory database with the pipeline start function, and
// a driver that runs a pipeline's queued steps one after another through the
// real step runner and the real stores, moving a fake clock to each step's
// time. Nothing here is imported by a deployed function.

import { fakeDb, type FakeDb } from "../lifecycle/fakeDb.ts";
import type { Registry } from "./registry.ts";
import { runPipelineJob } from "./runner.ts";
import { makeRunStore, makeStepLog, makeStepServices } from "./store.ts";
import type { JobOutcome, ScheduledJob } from "../../run-scheduled-jobs/types.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** A fake database whose report_pipeline_start makes the run and its first job, as the SQL function does. */
export function pipelineDb(tables: Record<string, Row[]>, clock: () => Date = () => new Date()): FakeDb {
  return fakeDb(tables, {
    report_pipeline_start(args, db) {
      const runs = (db.tables.report_pipeline_runs ??= []);
      const existing = runs.find((r) => r.dedupe_key === args.p_dedupe);
      if (existing) return { run_id: existing.id, started: false };
      const at = clock().toISOString();
      const run = {
        id: `run-${runs.length + 1}`, kind: args.p_kind, pipeline: args.p_pipeline, mode: args.p_mode, app_capable: !!args.p_app_capable,
        client_id: args.p_client, real_table: args.p_real_table, real_id: args.p_real_id, real_ref: args.p_real_ref, input: args.p_input ?? {},
        dedupe_key: args.p_dedupe, status: "running", step: args.p_first_step, steps_done: 0, heartbeat_at: at, started_at: at, finished_at: null, outcome: null, job_id: null as string | null,
      };
      runs.push(run);
      const jobs = (db.tables.scheduled_jobs ??= []);
      const job = {
        id: `job-${jobs.length + 1}`, kind: "report_pipeline", client_id: args.p_client, schedule_id: null, occurrence: null, priority: args.p_mode === "app" ? 25 : 60,
        stagger_seconds: 0, status: "queued", phase: null, report_id: null, attempts: 0, max_attempts: 5, available_at: at, lease_until: null, reason: null, result: null,
        payload: { run_id: run.id, pipeline: args.p_pipeline, step: args.p_first_step, state: {} }, created_at: at, started_at: null, finished_at: null,
      };
      jobs.push(job);
      run.job_id = job.id;
      return { run_id: run.id, started: true };
    },
  });
}

export interface DriveResult {
  outcome: JobOutcome;
  calls: Array<{ step: string; attempt: number; outcome: JobOutcome }>;
}

/** Runs the run's job until it is no longer queued, as the pipeline lane would, moving the clock to each available_at. */
export async function drivePipeline(db: FakeDb, registry: Registry, runId: string, o: { clock: { now(): Date; set(d: Date): void }; env: (name: string) => string | undefined; maxCalls?: number }): Promise<DriveResult> {
  const job = (db.tables.scheduled_jobs ?? []).find((j) => j.payload?.run_id === runId) as ScheduledJob & Row;
  if (!job) throw new Error(`No job for ${runId}`);
  const deps = { now: () => o.clock.now(), registry, runs: makeRunStore(db), log: makeStepLog(db), services: makeStepServices(db, o.env) };
  const calls: DriveResult["calls"] = [];
  for (let i = 0; i < (o.maxCalls ?? 400); i++) {
    job.attempts += 1;
    const step = String(job.payload?.step);
    const outcome = await runPipelineJob(job, deps);
    calls.push({ step, attempt: job.attempts, outcome });
    if (outcome.status !== "queued") {
      job.status = outcome.status;
      return { outcome, calls };
    }
    if (outcome.payload) job.payload = outcome.payload;
    if (outcome.resetAttempts || outcome.deferred) job.attempts = outcome.resetAttempts ? 0 : job.attempts - 1;
    const at = Date.parse(outcome.available_at ?? "");
    if (Number.isFinite(at) && at > o.clock.now().getTime()) o.clock.set(new Date(at));
  }
  throw new Error("The pipeline did not finish within the calls allowed.");
}

/** A clock a test moves. */
export function testClock(start: string) {
  let t = Date.parse(start);
  return { now: () => new Date(t), set: (d: Date) => { t = d.getTime(); }, advance: (ms: number) => { t += ms; } };
}
