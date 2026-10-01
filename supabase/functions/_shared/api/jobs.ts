/**
 * A re-runnable job: an ordered list of steps, each recorded with its
 * outcome. The engine advances one job as far as it can inside a budget,
 * saving after every step, so a crash loses at most the step in flight
 * and the next tick re-runs it. Steps are written to check what exists
 * before creating anything, which is what makes re-running safe.
 */
export type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";
export type JobStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";

export interface Gap {
  step: string;
  code: string;
  message: string;
}

export interface StepRecord {
  name: string;
  status: StepStatus;
  started_at?: string;
  finished_at?: string;
  outcome?: string;
  reason?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface JobRecord {
  id: string;
  status: JobStatus;
  steps: StepRecord[];
  outputs: Record<string, unknown> | null;
  gaps: Gap[];
  client_id: string | null;
  run_ids: string[];
  next_check_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  input: Record<string, unknown>;
  [k: string]: unknown;
}

export type StepResult =
  | {
      status: "done" | "skipped" | "failed";
      outcome?: string;
      reason?: string;
      message?: string;
      data?: Record<string, unknown>;
      gaps?: Gap[];
      patch?: Partial<JobRecord>;
      fatal?: boolean;
    }
  | { status: "waiting"; message?: string; data?: Record<string, unknown>; check_in_s: number };

export interface StepDef<C> {
  name: string;
  run(job: JobRecord, ctx: C): Promise<StepResult>;
  /** Runs even after a fatal failure (a callback that reports the failure); every other pending step is skipped then. */
  always?: boolean;
}

export function initialSteps<C>(steps: StepDef<C>[]): StepRecord[] {
  return steps.map((s) => ({ name: s.name, status: "pending" }));
}

export function nextStep(job: JobRecord): StepRecord | null {
  return job.steps.find((s) => s.status === "pending" || s.status === "running") ?? null;
}

export function finalStatus(job: JobRecord): JobStatus {
  if (job.error) return "failed";
  return job.steps.some((s) => s.status === "failed") ? "partial" : "completed";
}

export async function advanceJob<C>(
  job: JobRecord,
  steps: StepDef<C>[],
  ctx: C,
  opts: { budgetMs: number; now: () => Date; save: (job: JobRecord) => Promise<boolean | void> },
): Promise<{ job: JobRecord; stopped: "waiting" | "budget" | "finished" | "cancelled" }> {
  if (job.status === "cancelled") return { job, stopped: "cancelled" };
  // A save answers false when the row is no longer queued or running (someone cancelled it mid-tick): stop at once.
  const save = async (): Promise<boolean> => (await opts.save(job)) !== false;
  const t0 = opts.now().getTime();
  if (job.status === "queued") {
    job.status = "running";
    job.started_at = opts.now().toISOString();
  }
  for (;;) {
    const rec = nextStep(job);
    if (!rec) {
      job.status = finalStatus(job);
      job.completed_at = opts.now().toISOString();
      job.next_check_at = null;
      await save();
      return { job, stopped: "finished" };
    }
    if (opts.now().getTime() - t0 > opts.budgetMs) {
      job.next_check_at = opts.now().toISOString();
      await save();
      return { job, stopped: "budget" };
    }
    const def = steps.find((s) => s.name === rec.name);
    if (rec.status !== "running") {
      rec.status = "running";
      rec.started_at = opts.now().toISOString();
      if (!(await save())) return { job, stopped: "cancelled" };
    }
    let result: StepResult;
    try {
      result = def ? await def.run(job, ctx) : { status: "failed", reason: "unknown_step", message: `No step named ${rec.name}.` };
    } catch (e) {
      result = { status: "failed", reason: "exception", message: e instanceof Error ? e.message : String(e) };
    }
    if (result.message) rec.message = result.message;
    if (result.data) rec.data = { ...(rec.data ?? {}), ...result.data };
    if (result.status === "waiting") {
      job.next_check_at = new Date(opts.now().getTime() + result.check_in_s * 1000).toISOString();
      if (!(await save())) return { job, stopped: "cancelled" };
      return { job, stopped: "waiting" };
    }
    rec.status = result.status;
    rec.finished_at = opts.now().toISOString();
    if (result.outcome) rec.outcome = result.outcome;
    if (result.reason) rec.reason = result.reason;
    if (result.gaps?.length) {
      // The same gap can be seen by two steps (the readiness check repeats what an earlier step found); it is recorded once.
      const seen = new Set(job.gaps.map((g) => `${g.code}\u0000${g.message}`));
      for (const g of result.gaps) {
        const k = `${g.code}\u0000${g.message}`;
        if (seen.has(k)) continue;
        seen.add(k);
        job.gaps = [...job.gaps, g];
      }
    }
    if (result.patch) Object.assign(job, result.patch);
    if (result.status === "failed" && result.fatal) {
      // Nothing further makes sense, except the steps marked `always` (a callback that
      // reports the failure): the rest is skipped, those run, and the job closes as failed.
      job.error = result.message ?? result.reason ?? "failed";
      for (const s of job.steps) {
        if (s.status !== "pending" || steps.find((d) => d.name === s.name)?.always) continue;
        s.status = "skipped";
        s.reason = "job_failed";
        s.finished_at = opts.now().toISOString();
      }
    }
    if (!(await save())) return { job, stopped: "cancelled" };
  }
}
