// The step runner: runs one step of an in-app pipeline per lease of a
// report_pipeline job on the scheduled-jobs queue.
//
// An edge function is cut off at about 150 s and the worker starts work only
// in the first 20 s of a tick, so a step gets STEP_BUDGET_MS and an abort
// signal at that time. Long work is cut into steps; a step either finishes
// the run, names the next step, or starts an external job (an Apify run, a
// Claude message batch, a Gamma generation) and asks to be called back after
// a wait to look at it. A long Claude analysis is its own step: inline when
// its answer fits the step's time (claude.ts), else as a message batch that
// the step polls.
//
// Nothing here fails in front of anyone. A step that throws is tried again
// quietly after a growing wait; a step that keeps failing, an external job
// that never ends, or a run that takes too long stops the run quietly, and
// for a real report the dispatch that owns it makes the report again.
//
// Each step writes a log row (step, started, finished, outcome, a small
// detail): the run history n8n's executions list gave.

import type { JobOutcome, ScheduledJob } from "../../run-scheduled-jobs/types.ts";
import type { Registry } from "./registry.ts";
import type { OutputWriter, PayloadStore, PipelineDefinition, PipelineJobPayload, PipelineRun, PollState, StepContext, StepResult } from "./types.ts";

/** One step's time, inside the 120 s every step must stay under. */
export const STEP_BUDGET_MS = 110_000;
/** The state carried from step to step; anything larger goes to the payload store. */
export const STATE_MAX_BYTES = 32_768;
/** Tries of one step before the run stops. */
export const MAX_STEP_ATTEMPTS = 5;
/** How long one external job may be polled before the step starts it again. */
export const MAX_POLL_MINUTES = 180;
/** How long a whole run may take. */
export const MAX_RUN_HOURS = 12;
/** The shortest and longest wait a step may ask for before it looks again. */
export const POLL_MIN_SECONDS = 15;
export const POLL_MAX_SECONDS = 30 * 60;
/** The wait before the second try of a step; each later wait doubles, up to RETRY_MAX_MINUTES. */
export const RETRY_FIRST_MINUTES = 2;
export const RETRY_MAX_MINUTES = 60;
/** The longest detail a log row keeps. */
export const DETAIL_MAX_CHARS = 2000;

export type StepOutcome = "next" | "poll" | "done" | "retry" | "stopped";

export interface RunStore {
  get(runId: string): Promise<PipelineRun | null>;
  /** The runner ran a step of the run: where it stands now, and when it was last seen. */
  touch(runId: string, patch: { step: string; steps_done?: number; at: string }): Promise<void>;
  finish(runId: string, status: "done" | "stopped", outcome: string | null, at: string): Promise<void>;
}

export interface StepLog {
  start(row: { run_id: string; job_id: string; step: string; attempt: number; started_at: string }): Promise<string | number | null>;
  end(id: string | number, row: { finished_at: string; outcome: StepOutcome; detail: Record<string, unknown> | null }): Promise<void>;
}

/** What a step of a run is given besides its state: shadow storage or the real writers, and a read-only database. */
export interface StepServices {
  payloads: PayloadStore;
  output: OutputWriter;
  // deno-lint-ignore no-explicit-any
  db: any;
  env(name: string): string | undefined;
}

export interface RunnerDeps {
  now(): Date;
  registry: Registry;
  runs: RunStore;
  log: StepLog;
  services(run: PipelineRun, def: PipelineDefinition): StepServices;
  /** Tests shorten it. */
  stepBudgetMs?: number;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const MINUTE = 60_000;

/** The wait after the given number of failed tries: 2 minutes, doubling, at most an hour. */
export function retryWaitMinutes(attempt: number): number {
  return Math.min(RETRY_MAX_MINUTES, RETRY_FIRST_MINUTES * 2 ** Math.max(0, attempt - 1));
}

/** A log detail, cut to DETAIL_MAX_CHARS. */
export function smallDetail(detail: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!detail) return null;
  const text = JSON.stringify(detail);
  return text.length <= DETAIL_MAX_CHARS ? detail : { truncated: true, text: text.slice(0, DETAIL_MAX_CHARS) };
}

/** The job's payload, or null when it is not a pipeline job's. */
export function pipelinePayload(job: Pick<ScheduledJob, "payload">): PipelineJobPayload | null {
  const p = (job.payload ?? null) as Partial<PipelineJobPayload> | null;
  if (!p || typeof p.run_id !== "string" || typeof p.pipeline !== "string" || typeof p.step !== "string") return null;
  return {
    run_id: p.run_id, pipeline: p.pipeline, step: p.step,
    state: p.state && typeof p.state === "object" ? p.state as Record<string, unknown> : {},
    poll: p.poll && typeof p.poll === "object" ? p.poll as PollState : null,
  };
}

const sameHandle = (a: Record<string, unknown> | undefined, b: Record<string, unknown>) => JSON.stringify(a ?? null) === JSON.stringify(b);

export async function runPipelineJob(job: ScheduledJob, d: RunnerDeps): Promise<JobOutcome> {
  const p = pipelinePayload(job);
  if (!p) return { status: "failed", reason: "The pipeline job names no run, pipeline or step." };
  const run = await d.runs.get(p.run_id);
  if (!run) return { status: "skipped", reason: "The pipeline run was removed." };
  if (run.status !== "running") return { status: "skipped", reason: `The pipeline run is already ${run.status}.` };

  const now = d.now();
  const at = now.toISOString();
  const def = d.registry.get(p.pipeline);
  const stop = async (why: string): Promise<JobOutcome> => {
    await d.runs.finish(run.id, "stopped", why.slice(0, 500), at);
    return { status: "failed", reason: why, result: { run_id: run.id, step: p.step, stopped: why.slice(0, 500) } };
  };
  if (!def) return stop(`Pipeline ${p.pipeline} is not in this deployment.`);
  const step = def.steps[p.step];
  if (!step) return stop(`Pipeline ${def.name} has no step ${p.step}.`);
  const maxHours = def.maxRunHours ?? MAX_RUN_HOURS;
  if (now.getTime() - Date.parse(run.started_at) > maxHours * 60 * MINUTE) return stop(`The run took longer than ${maxHours} hours.`);
  const maxAttempts = def.maxStepAttempts ?? MAX_STEP_ATTEMPTS;
  if (job.attempts > maxAttempts) return stop(`Step ${p.step} did not finish in ${maxAttempts} tries.`);

  // A log row that never gets its end is a step the worker was cut off in.
  let logId: string | number | null = null;
  try {
    logId = await d.log.start({ run_id: run.id, job_id: job.id, step: p.step, attempt: job.attempts, started_at: at });
  } catch (e) {
    console.warn(`[pipeline] ${run.id} log start:`, message(e));
  }
  const logEnd = async (outcome: StepOutcome, detail: Record<string, unknown> | null) => {
    if (logId == null) return;
    try {
      await d.log.end(logId, { finished_at: d.now().toISOString(), outcome, detail: smallDetail(detail) });
    } catch (e) {
      console.warn(`[pipeline] ${run.id} log end:`, message(e));
    }
  };

  /** A failed try: again after a growing wait, or the run stops once the tries are used up. */
  const failedTry = async (why: string, payload: PipelineJobPayload): Promise<JobOutcome> => {
    if (job.attempts >= maxAttempts) {
      await logEnd("stopped", { error: why.slice(0, 500) });
      return stop(`Step ${p.step} did not finish in ${maxAttempts} tries: ${why}`.slice(0, 500));
    }
    const wait = retryWaitMinutes(job.attempts);
    await logEnd("retry", { error: why.slice(0, 500), wait_minutes: wait });
    await d.runs.touch(run.id, { step: p.step, at });
    return {
      status: "queued", reason: `Step ${p.step} is tried again in ${wait} minutes: ${why}`.slice(0, 500),
      available_at: new Date(now.getTime() + wait * MINUTE).toISOString(), payload: { ...payload },
    };
  };

  // An external job that has run too long counts as a failed try, and the
  // step starts it again on the next one.
  const maxPoll = def.maxPollMinutes ?? MAX_POLL_MINUTES;
  if (p.poll && now.getTime() - Date.parse(p.poll.since) > maxPoll * MINUTE) {
    return failedTry(`the external job did not finish in ${maxPoll} minutes`, { ...p, poll: null });
  }

  const budget = d.stepBudgetMs ?? STEP_BUDGET_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`step ${p.step} ran past its ${Math.round(budget / 1000)} s`));
      reject(new Error(`the step ran past its ${Math.round(budget / 1000)} s`));
    }, budget);
  });
  const services = d.services(run, def);
  const ctx: StepContext = {
    run, step: p.step, attempt: job.attempts, state: p.state, poll: p.poll ?? null,
    now: d.now, signal: controller.signal, deadline: new Date(now.getTime() + budget),
    payloads: services.payloads, output: services.output, db: services.db, env: services.env,
  };

  let result: StepResult;
  try {
    const work = step(ctx);
    // A step still going when its time is up must not end the worker when it fails later.
    work.catch(() => {});
    result = await Promise.race([work, timeUp]);
  } catch (e) {
    return failedTry(message(e), p);
  } finally {
    clearTimeout(timer);
  }

  const state = result.state ?? p.state;
  const stateBytes = JSON.stringify(state ?? {}).length;
  if (stateBytes > STATE_MAX_BYTES) {
    return failedTry(`the step kept ${stateBytes} bytes of state; more than ${STATE_MAX_BYTES} goes to the payload store`, p);
  }

  if (result.type === "done") {
    await logEnd("done", result.detail ?? null);
    await d.runs.finish(run.id, "done", null, at);
    return { status: "done", result: { run_id: run.id, steps_done: run.steps_done + 1, last_step: p.step } };
  }

  if (result.type === "next") {
    if (!def.steps[result.step]) return failedTry(`the step named ${result.step} as next, which the pipeline does not define`, p);
    await logEnd("next", { ...(result.detail ?? {}), next: result.step });
    await d.runs.touch(run.id, { step: result.step, steps_done: run.steps_done + 1, at });
    return {
      status: "queued", reason: `Step ${p.step} done; ${result.step} is next.`, available_at: at, resetAttempts: true,
      payload: { run_id: run.id, pipeline: def.name, step: result.step, state, poll: null },
    };
  }

  // poll
  const wait = Math.min(POLL_MAX_SECONDS, Math.max(POLL_MIN_SECONDS, Math.round(Number(result.waitSeconds) || 0)));
  const poll: PollState = p.poll && sameHandle(p.poll.handle, result.handle)
    ? { handle: result.handle, polls: p.poll.polls + 1, since: p.poll.since }
    : { handle: result.handle, polls: 1, since: at };
  await logEnd("poll", { ...(result.detail ?? {}), wait_seconds: wait, polls: poll.polls });
  await d.runs.touch(run.id, { step: p.step, at });
  // Looking at an external job is not a failed try.
  return {
    status: "queued", reason: `Step ${p.step} looks again in ${wait} s.`, available_at: new Date(now.getTime() + wait * 1000).toISOString(), deferred: true,
    payload: { run_id: run.id, pipeline: def.name, step: p.step, state, poll },
  };
}
