/**
 * The worker that advances demo jobs, and the discard of what a job made.
 * A tick leases the due jobs, advances each as far as the budget allows,
 * and releases every lease in a finally, so a thrown step never keeps a
 * job locked. The api-demo-worker cron calls the route every minute and
 * POST /v1/demo-jobs kicks it right away.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { advanceJob, type JobRecord, type JobStatus, type StepDef } from "../_shared/api/jobs.ts";
import type { CallResult } from "../_shared/invoke.ts";
import type { Route } from "../_shared/api/router.ts";
import type { DiscardResult } from "./routes-demo.ts";

export interface WorkerDeps<C> {
  lease(): Promise<JobRecord[]>;
  save(job: JobRecord): Promise<void>;
  release(id: string): Promise<void>;
  ctx: C;
  steps: StepDef<C>[];
  budgetMs: number;
  now(): Date;
}

export interface TickResult {
  leased: number;
  results: Array<{ id: string; stopped?: string; status: JobStatus; error?: string }>;
}

export async function workerTick<C>(deps: WorkerDeps<C>): Promise<TickResult> {
  const jobs = await deps.lease();
  const results: TickResult["results"] = [];
  const t0 = deps.now().getTime();
  for (const job of jobs) {
    const remaining = deps.budgetMs - (deps.now().getTime() - t0);
    try {
      const r = await advanceJob(job, deps.steps, deps.ctx, { budgetMs: Math.max(0, remaining), now: deps.now, save: deps.save });
      results.push({ id: job.id, stopped: r.stopped, status: r.job.status });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`demo job ${job.id} tick failed:`, message);
      results.push({ id: job.id, status: job.status, error: message });
    } finally {
      try {
        await deps.release(job.id);
      } catch (e) {
        console.error(`demo job ${job.id} release failed:`, e instanceof Error ? e.message : String(e));
      }
    }
  }
  return { leased: jobs.length, results };
}

const LEASE_SECONDS = 180;
const TICK_BUDGET_MS = 110_000;
const JOBS_PER_TICK = 3;

export function workerRoute<C>(deps: { jobs: { lease(limit: number, seconds: number): Promise<JobRecord[]>; save(job: JobRecord): Promise<void>; release(id: string): Promise<void> }; ctx: C; steps: StepDef<C>[] }): Route {
  return {
    method: "POST", path: "/internal/worker", auth: "internal", doc: { summary: "Advance due demo jobs", tag: "Internal", response: "Empty" },
    handler: async () => {
      const r = await workerTick({ lease: () => deps.jobs.lease(JOBS_PER_TICK, LEASE_SECONDS), save: (j) => deps.jobs.save(j), release: (id) => deps.jobs.release(id), ctx: deps.ctx, steps: deps.steps, budgetMs: TICK_BUDGET_MS, now: () => new Date() });
      return { status: 200, body: { data: r } };
    },
  };
}

/**
 * Remove what a job created. A client the job created goes through
 * delete-client (files, rows, everything; the server path counts as admin);
 * a client that existed before keeps its place and only the rows flagged
 * with the job go, children before parents.
 */
export async function discardJob(job: JobRecord, deps: { db: SupabaseClient; call(name: string, body: unknown): Promise<CallResult> }): Promise<DiscardResult> {
  const removed = { client: false, competitor_sets: 0, reports: 0, competitive_reports: 0, posts: 0, media_jobs: 0 };
  if (job.client_id) {
    const { data: client } = await deps.db.from("clients").select("id, name, demo_job_id").eq("id", job.client_id).maybeSingle();
    const c = client as { id: string; name: string; demo_job_id: string | null } | null;
    if (c && c.demo_job_id === job.id) {
      const r = await deps.call("delete-client", { client_id: c.id });
      if (!r.ok) throw new Error(`delete-client answered ${r.status}: ${r.text.slice(0, 200)}`);
      removed.client = true;
      return { removed };
    }
  }
  const count = async (table: string) => {
    const { data, error } = await deps.db.from(table).delete().eq("demo_job_id", job.id).select("id");
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []).length;
  };
  removed.media_jobs = await count("media_jobs");
  removed.posts = await count("post_iterations");
  removed.competitive_reports = await count("competitive_reports");
  removed.reports = await count("reports");
  removed.competitor_sets = await count("competitor_sets");
  return { removed };
}
