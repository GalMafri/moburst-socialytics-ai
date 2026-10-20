// Running an in-app pipeline inside the request that needs its answer.
//
// The competitor feed refresh needs the LinkedIn source's answer before it
// can save the feed, the way it waits today for the n8n workflow's answer
// (up to 100 s). With the switch on app, the refresh runs the LinkedIn
// source pipeline here, step after step, inside that same time. The run is
// recorded like any other (report_pipeline_runs, mode app, with its step
// log), so a run that stops counts toward the rule that sends the window to
// n8n after APP_STOPS_BEFORE_N8N stops.
//
// Each call of a step gets the time left, at most a queued step's
// STEP_BUDGET_MS, and an abort signal at that time. A step that asks to be
// called back is called again after a pause of at most INLINE_POLL_PAUSE_MS:
// its own look at the external job already waits on the provider's side
// (Apify holds the answer until the run ends), so this is a short breath
// between looks, not a timer standing in for the provider. A step that
// throws, or time running out, stops the run; the caller's own quiet retry
// decides what happens next.

import { smallDetail, STEP_BUDGET_MS, type RunStore, type StepLog, type StepOutcome, type StepServices } from "./runner.ts";
import type { OutputWriter, PipelineDefinition, PipelineRun, PollState, RealTable, StepContext, StepResult } from "./types.ts";

export const INLINE_POLL_PAUSE_MS = 2000;

export interface InlineStart {
  clientId: string;
  realTable: RealTable | null;
  realId: string | null;
  realRef: Record<string, unknown> | null;
  input: Record<string, unknown>;
  dedupe: string;
}

export interface InlineDeps {
  now(): Date;
  /** Makes the run's row (mode app, running) and returns it. */
  createRun(row: Record<string, unknown>): Promise<PipelineRun>;
  runs: RunStore;
  log: StepLog;
  services(run: PipelineRun, def: PipelineDefinition): StepServices;
  sleep?(ms: number): Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class InlineRunStopped extends Error {
  runId: string;
  constructor(runId: string, why: string) {
    super(why);
    this.name = "InlineRunStopped";
    this.runId = runId;
  }
}

/** Runs the pipeline to its end within budgetMs; the "report" it wrote is its answer. */
export async function runPipelineInline(def: PipelineDefinition, a: InlineStart, deps: InlineDeps, budgetMs: number): Promise<{ run: PipelineRun; output: Record<string, unknown> | null; calls: number }> {
  if (!def.modes.includes("app")) throw new Error(`Pipeline ${def.name} does not run in app mode.`);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const run = await deps.createRun({
    kind: def.kind, pipeline: def.name, mode: "app", app_capable: def.appCapable, client_id: a.clientId,
    real_table: a.realTable, real_id: a.realId, real_ref: a.realRef, input: a.input, dedupe_key: a.dedupe,
    status: "running", step: def.first,
  });
  const deadline = deps.now().getTime() + budgetMs;
  const services = deps.services(run, def);
  let output: Record<string, unknown> | null = null;
  const capture: OutputWriter = {
    async write(target, data) {
      await services.output.write(target, data);
      if (target === "report") output = data;
    },
  };

  let step = def.first;
  let state: Record<string, unknown> = {};
  let poll = null as PollState | null;
  let calls = 0;
  let logId: string | number | null = null;
  const logEnd = async (outcome: StepOutcome, detail: Record<string, unknown> | null | undefined) => {
    if (logId == null) return;
    try {
      await deps.log.end(logId, { finished_at: deps.now().toISOString(), outcome, detail: smallDetail(detail ?? null) });
    } catch (e) {
      console.warn(`[pipeline] ${run.id} log end:`, message(e));
    }
    logId = null;
  };

  try {
    for (;;) {
      const now = deps.now();
      const left = deadline - now.getTime();
      if (left <= 0) throw new Error(`it did not finish in ${Math.round(budgetMs / 1000)} s`);
      const fn = def.steps[step];
      if (!fn) throw new Error(`pipeline ${def.name} has no step ${step}`);
      calls += 1;
      const at = now.toISOString();
      try {
        // No queued job runs an inline step.
        logId = await deps.log.start({ run_id: run.id, job_id: null, step, attempt: 1, started_at: at });
      } catch (e) {
        console.warn(`[pipeline] ${run.id} log start:`, message(e));
        logId = null;
      }
      const budget = Math.min(STEP_BUDGET_MS, left);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeUp = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(new Error(`step ${step} ran out of time`));
          reject(new Error(`step ${step} ran out of time`));
        }, budget);
      });
      const ctx: StepContext = {
        run, step, attempt: 1, state, poll, now: deps.now, signal: controller.signal, deadline: new Date(now.getTime() + budget),
        payloads: services.payloads, output: capture, db: services.db, env: services.env,
      };
      let result: StepResult;
      try {
        const work = fn(ctx);
        work.catch(() => {});
        result = await Promise.race([work, timeUp]);
      } finally {
        clearTimeout(timer);
      }
      state = result.state ?? state;
      if (result.type === "done") {
        await logEnd("done", result.detail);
        await deps.runs.finish(run.id, "done", null, deps.now().toISOString());
        return { run, output, calls };
      }
      if (result.type === "next") {
        if (!def.steps[result.step]) throw new Error(`step ${step} named ${result.step} as next, which the pipeline does not define`);
        await logEnd("next", { ...(result.detail ?? {}), next: result.step });
        await deps.runs.touch(run.id, { step: result.step, steps_done: calls, at: deps.now().toISOString() });
        step = result.step;
        poll = null;
        continue;
      }
      const prev = poll as PollState | null;
      poll = prev && JSON.stringify(prev.handle) === JSON.stringify(result.handle)
        ? { handle: result.handle, polls: prev.polls + 1, since: prev.since }
        : { handle: result.handle, polls: 1, since: at };
      await logEnd("poll", { ...(result.detail ?? {}), polls: poll.polls });
      await deps.runs.touch(run.id, { step, at: deps.now().toISOString() });
      const pause = Math.min(Math.max(0, Number(result.waitSeconds) || 0) * 1000, INLINE_POLL_PAUSE_MS, Math.max(0, deadline - deps.now().getTime()));
      if (pause > 0) await sleep(pause);
    }
  } catch (e) {
    const why = message(e).slice(0, 500);
    await logEnd("stopped", { error: why });
    try {
      await deps.runs.finish(run.id, "stopped", why, deps.now().toISOString());
    } catch (finishError) {
      console.warn(`[pipeline] ${run.id} finish:`, message(finishError));
    }
    throw new InlineRunStopped(run.id, `The in-app ${def.kind} run stopped: ${why}`);
  }
}
