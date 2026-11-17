// @vitest-environment node
// The step runner, driven through a tiny example pipeline that lives only in
// this test: it starts an external job, polls it until it ends, then writes
// its result.
import { describe, expect, it } from "vitest";
import type { JobOutcome, ScheduledJob } from "../../../functions/_shared/scheduled-jobs/types";
import { makeRegistry } from "../../../functions/_shared/pipelines/registry";
import {
  MAX_POLL_MINUTES, MAX_RUN_HOURS, MAX_STEP_ATTEMPTS, POLL_MAX_SECONDS, POLL_MIN_SECONDS, runPipelineJob, retryWaitMinutes, smallDetail,
  STATE_MAX_BYTES, type RunnerDeps, type StepOutcome,
} from "../../../functions/_shared/pipelines/runner";
import { SelectionFact, StepRestart, StepStop, type PipelineDefinition, type PipelineRun } from "../../../functions/_shared/pipelines/types";

const T0 = new Date("2026-11-07T07:20:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/** The example: start an external job, look at it until it ends, then write what it found. */
function examplePipeline(external: { status: string; items?: unknown[] }, calls: string[]): PipelineDefinition {
  return {
    name: "example_social", kind: "social", modes: ["shadow", "app"], appCapable: false, secrets: [], first: "start",
    steps: {
      async start(ctx) {
        calls.push("start");
        return { type: "poll", waitSeconds: 60, handle: { job_id: "ext-1" }, state: { started: true } };
      },
      async wait(ctx) {
        calls.push("wait");
        if (external.status !== "SUCCEEDED") return { type: "poll", waitSeconds: 60, handle: { job_id: "ext-1" } };
        await ctx.payloads.put("dataset", external.items ?? []);
        return { type: "next", step: "write", detail: { items: external.items?.length ?? 0 } };
      },
      async write(ctx) {
        calls.push("write");
        const items = (await ctx.payloads.get<unknown[]>("dataset")) ?? [];
        await ctx.output.write("report", { items: items.length, started: ctx.state.started === true });
        return { type: "done" };
      },
    },
  };
}

/** The example's real shape: start polls into wait, so the first step's poll names the step it is called back to. */
function chained(def: PipelineDefinition): PipelineDefinition {
  // start hands over to wait, which does the polling.
  return { ...def, steps: { ...def.steps, start: async (ctx) => { await def.steps.start(ctx); return { type: "next", step: "wait", state: { started: true } }; } } };
}

function harness(def: PipelineDefinition, runOver: Partial<PipelineRun> = {}) {
  const run: PipelineRun = {
    id: "run-1", kind: def.kind, pipeline: def.name, mode: "shadow", app_capable: false, client_id: "client-1",
    real_table: "reports", real_id: "report-1", real_ref: null, input: { range: { start: "2026-10-01", end: "2026-10-31" } },
    status: "running", step: def.first, steps_done: 0, heartbeat_at: T0.toISOString(), started_at: T0.toISOString(),
    finished_at: null, outcome: null, job_id: "job-1", ...runOver,
  };
  const log: Array<{ id: number; step: string; attempt: number; outcome?: StepOutcome; detail?: unknown; finished?: boolean }> = [];
  const payloads = new Map<string, unknown>();
  const written: Array<{ target: string; data: Record<string, unknown> }> = [];
  let clock = T0;
  const deps: RunnerDeps = {
    now: () => clock,
    registry: makeRegistry([def]),
    runs: {
      async get(id) { return id === run.id ? { ...run } : null; },
      async touch(_id, patch) { run.step = patch.step; run.heartbeat_at = patch.at; if (patch.steps_done !== undefined) run.steps_done = patch.steps_done; },
      async finish(_id, status, outcome, when) { run.status = status; run.outcome = outcome; run.finished_at = when; },
    },
    log: {
      async start(row) { log.push({ id: log.length + 1, step: row.step, attempt: row.attempt }); return log.length; },
      async end(id, row) { Object.assign(log[Number(id) - 1], { outcome: row.outcome, detail: row.detail, finished: true }); },
    },
    services: () => ({
      payloads: {
        async put(key, value) { payloads.set(key, value); return { key, bytes: JSON.stringify(value).length }; },
        async get(key) { return (payloads.get(key) ?? null) as never; },
      },
      output: { async write(target, data) { written.push({ target, data }); } },
      db: {},
      env: () => undefined,
    }),
  };
  let job: ScheduledJob = {
    id: "job-1", kind: "report_pipeline", client_id: "client-1", schedule_id: null, occurrence: null, priority: 60, stagger_seconds: 0,
    status: "running", phase: null, report_id: null, attempts: 1, max_attempts: 5, available_at: T0.toISOString(), lease_until: null,
    reason: null, result: null, payload: { run_id: run.id, pipeline: def.name, step: def.first, state: {} },
    created_at: T0.toISOString(), started_at: T0.toISOString(), finished_at: null,
  };
  /** Runs one lease, then applies the outcome to the job as the store's finish does. */
  const lease = async (): Promise<JobOutcome> => {
    const outcome = await runPipelineJob(job, deps);
    const attempts = outcome.resetAttempts ? 0 : outcome.deferred ? Math.max(0, job.attempts - 1) : job.attempts;
    job = { ...job, status: outcome.status, payload: outcome.payload !== undefined ? outcome.payload : job.payload, available_at: outcome.available_at ?? job.available_at, attempts };
    return outcome;
  };
  /** The next lease: attempts counted as scheduled_jobs_lease counts them. */
  const next = async (when: Date) => { clock = when; job = { ...job, status: "running", attempts: job.attempts + 1 }; return lease(); };
  return { run, log, payloads, written, deps, lease, next, get job() { return job; }, set clock(d: Date) { clock = d; } };
}

describe("runPipelineJob: the example pipeline end to end", () => {
  it("starts, polls until the external job ends, moves on and finishes, with a log row per step", async () => {
    const external = { status: "RUNNING", items: [1, 2, 3] as unknown[] };
    const calls: string[] = [];
    const h = harness(chained(examplePipeline(external, calls)));

    const first = await h.lease();
    expect(first).toMatchObject({ status: "queued", resetAttempts: true, available_at: T0.toISOString() });
    expect(h.job.payload).toMatchObject({ step: "wait", state: { started: true }, poll: null });
    expect(h.job.attempts).toBe(0);

    const poll1 = await h.next(at(1));
    expect(poll1).toMatchObject({ status: "queued", deferred: true, available_at: at(2).toISOString() });
    expect(h.job.payload).toMatchObject({ step: "wait", poll: { handle: { job_id: "ext-1" }, polls: 1, since: at(1).toISOString() } });
    expect(h.job.attempts).toBe(0);

    const poll2 = await h.next(at(2));
    expect(poll2.status).toBe("queued");
    expect(h.job.payload).toMatchObject({ poll: { polls: 2, since: at(1).toISOString() } });

    external.status = "SUCCEEDED";
    const moved = await h.next(at(3));
    expect(moved).toMatchObject({ status: "queued", resetAttempts: true });
    expect(h.job.payload).toMatchObject({ step: "write", poll: null, state: { started: true } });
    expect(h.payloads.get("dataset")).toEqual([1, 2, 3]);

    const done = await h.next(at(3));
    expect(done).toMatchObject({ status: "done", result: { run_id: "run-1", last_step: "write" } });
    expect(h.written).toEqual([{ target: "report", data: { items: 3, started: true } }]);
    expect(h.run.status).toBe("done");
    expect(calls).toEqual(["start", "wait", "wait", "wait", "write"]);
    expect(h.log.map((l) => `${l.step}:${l.outcome}`)).toEqual(["start:next", "wait:poll", "wait:poll", "wait:next", "write:done"]);
    expect(h.log.every((l) => l.finished)).toBe(true);
    expect(h.run.steps_done).toBe(2);
  });
});

describe("runPipelineJob: quiet retries", () => {
  const failing = (times: number): PipelineDefinition => {
    let n = 0;
    return {
      name: "flaky", kind: "competitive", modes: ["shadow"], appCapable: false, secrets: [], first: "call",
      steps: { async call() { n += 1; if (n <= times) throw new Error(`provider 503 (${n})`); return { type: "done" }; } },
    };
  };

  it("tries a failing step again after 2, 4, 8 minutes, then finishes when it works", async () => {
    const h = harness(failing(3));
    const r1 = await h.lease();
    expect(r1).toMatchObject({ status: "queued", available_at: at(2).toISOString() });
    expect(r1.deferred).toBeUndefined();
    expect(r1.reason).toContain("provider 503 (1)");
    const r2 = await h.next(at(2));
    expect(r2.available_at).toBe(at(2 + 4).toISOString());
    const r3 = await h.next(at(6));
    expect(r3.available_at).toBe(at(6 + 8).toISOString());
    const r4 = await h.next(at(14));
    expect(r4.status).toBe("done");
    expect(h.log.map((l) => l.outcome)).toEqual(["retry", "retry", "retry", "done"]);
    expect(h.run.heartbeat_at).toBe(at(6).toISOString());
  });

  it("stops the run quietly once a step has failed MAX_STEP_ATTEMPTS times", async () => {
    const h = harness(failing(99));
    let last: JobOutcome = await h.lease();
    for (let i = 1; i < MAX_STEP_ATTEMPTS; i++) last = await h.next(at(i * 60));
    expect(last.status).toBe("failed");
    expect(h.run.status).toBe("stopped");
    expect(h.run.outcome).toContain(`did not finish in ${MAX_STEP_ATTEMPTS} tries`);
    expect(h.log.at(-1)?.outcome).toBe("stopped");
  });

  it("stops a run whose worker kept dying before the step returned", async () => {
    const h = harness(failing(0));
    h.job.attempts = MAX_STEP_ATTEMPTS + 1;
    const r = await runPipelineJob(h.job, h.deps);
    expect(r.status).toBe("failed");
    expect(h.run.status).toBe("stopped");
  });

  it("grows the wait to an hour at most", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 9].map(retryWaitMinutes)).toEqual([2, 4, 8, 16, 32, 60, 60, 60]);
  });
});

describe("runPipelineJob: limits", () => {
  const def = (step: PipelineDefinition["steps"][string], over: Partial<PipelineDefinition> = {}): PipelineDefinition => ({
    name: "limits", kind: "social", modes: ["shadow"], appCapable: false, secrets: [], first: "only", steps: { only: step }, ...over,
  });

  it("gives a step that outruns its time a failed try, and the worker moves on", async () => {
    const h = harness(def(() => new Promise(() => {})));
    h.deps.stepBudgetMs = 20;
    const r = await h.lease();
    expect(r.status).toBe("queued");
    expect(r.reason).toContain("ran past its");
    expect(h.log[0].outcome).toBe("retry");
  });

  it("passes the step an abort signal that fires at the end of its time", async () => {
    let signal: AbortSignal | null = null;
    const h = harness(def(async (ctx) => { signal = ctx.signal; await new Promise((r) => setTimeout(r, 60)); return { type: "done" }; }));
    h.deps.stepBudgetMs = 20;
    await h.lease();
    expect(signal!.aborted).toBe(true);
  });

  it("refuses more than STATE_MAX_BYTES of state; large data belongs in the payload store", async () => {
    const h = harness(def(async () => ({ type: "done", state: { big: "x".repeat(STATE_MAX_BYTES) } })));
    const r = await h.lease();
    expect(r.status).toBe("queued");
    expect(r.reason).toContain("payload store");
    expect(h.run.status).toBe("running");
  });

  it("clamps a poll's wait between POLL_MIN_SECONDS and POLL_MAX_SECONDS", async () => {
    const short = harness(def(async () => ({ type: "poll", waitSeconds: 1, handle: { a: 1 } })));
    expect((await short.lease()).available_at).toBe(new Date(T0.getTime() + POLL_MIN_SECONDS * 1000).toISOString());
    const long = harness(def(async () => ({ type: "poll", waitSeconds: 99_999, handle: { a: 1 } })));
    expect((await long.lease()).available_at).toBe(new Date(T0.getTime() + POLL_MAX_SECONDS * 1000).toISOString());
  });

  it("counts an external job polled past MAX_POLL_MINUTES as a failed try and starts it again", async () => {
    const h = harness(def(async (ctx) => ({ type: "poll", waitSeconds: 60, handle: { started_again: ctx.poll === null } })));
    h.job.payload = { ...h.job.payload, poll: { handle: { started_again: false }, polls: 50, since: at(-MAX_POLL_MINUTES - 1).toISOString() } };
    const r = await h.lease();
    expect(r.status).toBe("queued");
    expect(r.reason).toContain(`did not finish in ${MAX_POLL_MINUTES} minutes`);
    expect((r.payload as { poll: unknown }).poll).toBeNull();
    const again = await h.next(r.available_at ? new Date(r.available_at) : T0);
    expect(again.payload).toMatchObject({ poll: { handle: { started_again: true }, polls: 1 } });
  });

  it("forgets the external job a step gave up on (StepRestart), so the next try starts a new one; any other failure keeps it", async () => {
    const h = harness(def(async (ctx) => {
      if (ctx.poll) throw new StepRestart("the job ended without its result");
      return { type: "poll", waitSeconds: 60, handle: { job: "new" } };
    }));
    h.job.payload = { ...h.job.payload, poll: { handle: { job: "dead" }, polls: 3, since: T0.toISOString() } };
    const r = await h.lease();
    expect(r).toMatchObject({ status: "queued", reason: expect.stringContaining("the job ended without its result") });
    expect((r.payload as { poll: unknown }).poll).toBeNull();
    const again = await h.next(r.available_at ? new Date(r.available_at) : T0);
    expect(again.payload).toMatchObject({ poll: { handle: { job: "new" }, polls: 1 } });
    const plain = harness(def(async () => { throw new Error("provider 503"); }));
    plain.job.payload = { ...plain.job.payload, poll: { handle: { job: "kept" }, polls: 1, since: T0.toISOString() } };
    expect(((await plain.lease()).payload as { poll: unknown }).poll).toMatchObject({ handle: { job: "kept" } });
  });

  it("a wait for an account is a state of the run: no try, no poll limit, no run limit, and the job handle is kept", async () => {
    let waiting = true;
    // The run's horizon is a week away, so the wait may go on past the run's own hours.
    const h = harness(def(async (ctx) => ({ type: "poll", waitSeconds: 600, handle: { apify_run_id: "r1" }, ...(waiting ? { waitingFor: "APIFY_API_TOKEN" } : {}) }), { waitHorizon: () => at(7 * 24 * 60) }));
    h.job.payload = { ...h.job.payload, poll: { handle: { apify_run_id: "r1" }, polls: 3, since: T0.toISOString() } };
    const attemptsBefore = h.job.attempts;
    // 14 hours of waiting, past both MAX_RUN_HOURS and MAX_POLL_MINUTES.
    for (let minutes = 10; minutes <= 14 * 60; minutes += 10) {
      const r = await h.next(at(minutes));
      expect(r.status).toBe("queued");
      expect(r.deferred).toBe(true);
    }
    expect(h.run.status).toBe("running");
    expect(h.job.attempts).toBe(attemptsBefore);
    expect(h.job.payload).toMatchObject({ poll: { handle: { apify_run_id: "r1" } } });
    expect(h.log.every((l) => l.outcome === "poll")).toBe(true);

    // The account answers again: the run goes on from the same handle, and the wait is not counted against its hours.
    waiting = false;
    const after = await h.next(at(14 * 60 + 10));
    expect(after.status).toBe("queued");
    expect(h.run.status).toBe("running");
    expect(h.job.payload).toMatchObject({ poll: { handle: { apify_run_id: "r1" } } });
    // Real run time still counts: another MAX_RUN_HOURS of ordinary polling stops it.
    const late = await h.next(at(14 * 60 + 10 + MAX_RUN_HOURS * 60 + 1));
    expect(late.status).toBe("failed");
    expect(h.run.status).toBe("stopped");
  });

  it("a waiting job with a started run id leased 4 hours later, after a worker outage, keeps its handle, spends no try and stays queued", async () => {
    let waiting = true;
    const h = harness(def(async () => ({ type: "poll", waitSeconds: 600, handle: { apify_run_id: "r1" }, ...(waiting ? { waitingFor: "APIFY_API_TOKEN" } : {}) }), { waitHorizon: () => at(7 * 24 * 60) }));
    h.job.payload = { ...h.job.payload, poll: { handle: { apify_run_id: "r1" }, polls: 2, since: at(10).toISOString() }, paused_at: at(10).toISOString(), paused_for: "APIFY_API_TOKEN" };
    const attemptsBefore = h.job.attempts;
    // No worker ran for 4 hours: the last look is far older than MAX_POLL_MINUTES.
    const outage = await h.next(at(10 + 4 * 60));
    expect(outage.status).toBe("queued");
    expect(outage.deferred).toBe(true);
    expect(h.run.status).toBe("running");
    expect(h.job.attempts).toBe(attemptsBefore);
    expect(h.job.payload).toMatchObject({ poll: { handle: { apify_run_id: "r1" } } });
    expect(h.log.map((l) => l.outcome)).toEqual(["poll"]);
    // The account answers on that same lease's next look: the poll clock starts then, so the job is not judged by the outage.
    waiting = false;
    const answered = await h.next(at(10 + 4 * 60 + 10));
    expect(answered.status).toBe("queued");
    const after = await h.next(at(10 + 4 * 60 + 20));
    expect(after.status).toBe("queued");
    expect(h.run.status).toBe("running");
    expect(h.job.payload).toMatchObject({ poll: { handle: { apify_run_id: "r1" } } });
    expect(h.log.map((l) => l.outcome)).toEqual(["poll", "poll", "poll"]);
  });

  it("stops a run that is still waiting for an account once its horizon has passed, without calling the step, and records why", async () => {
    let called = 0;
    const h = harness(def(async () => { called += 1; return { type: "poll", waitSeconds: 600, handle: { apify_run_id: "r1" }, waitingFor: "APIFY_API_TOKEN" }; }, { waitHorizon: () => at(24 * 60) }));
    for (let minutes = 10; minutes < 24 * 60; minutes += 10) expect((await h.next(at(minutes))).status).toBe("queued");
    const callsBefore = called;
    // Past the horizon the account may answer again, but the run is over: the step is not called.
    const r = await h.next(at(24 * 60 + 5));
    expect(r.status).toBe("failed");
    expect(called).toBe(callsBefore);
    expect(h.run.status).toBe("stopped");
    expect(h.run.outcome).toContain("APIFY_API_TOKEN");
    expect(h.run.outcome).toContain(at(24 * 60).toISOString());
  });

  it("stops a run whose first wait for an account begins after its horizon", async () => {
    const h = harness(def(async () => ({ type: "poll", waitSeconds: 600, handle: {}, waitingFor: "APIFY_API_TOKEN" }), { waitHorizon: () => at(-1) }));
    const r = await h.lease();
    expect(r.status).toBe("failed");
    expect(h.run.status).toBe("stopped");
    expect(h.log.map((l) => l.outcome)).toEqual(["stopped"]);
  });

  it("without a horizon of its own, a pipeline's account wait ends at the run's own hours", async () => {
    const h = harness(def(async () => ({ type: "poll", waitSeconds: 1800, handle: {}, waitingFor: "APIFY_API_TOKEN" })));
    for (let minutes = 30; minutes < MAX_RUN_HOURS * 60; minutes += 30) expect((await h.next(at(minutes))).status).toBe("queued");
    const r = await h.next(at(MAX_RUN_HOURS * 60 + 1));
    expect(r.status).toBe("failed");
    expect(h.run.status).toBe("stopped");
  });

  it("a step that throws StepStop ends the run at once, with no retry", async () => {
    let called = 0;
    const h = harness(def(async () => { called += 1; throw new StepStop("Every watched platform failed."); }));
    const r = await h.lease();
    expect(r.status).toBe("failed");
    expect(called).toBe(1);
    expect(h.run.status).toBe("stopped");
    expect(h.run.outcome).toContain("Every watched platform failed.");
    expect(h.log.map((l) => l.outcome)).toEqual(["stopped"]);
  });

  it("a selection fact ends the run on its first try, with no retry, and keeps the fact as the run's outcome", async () => {
    let called = 0;
    const message = "LANDSCAPE_NOT_FOUND: no RivalIQ landscape tracks the client and the confirmed competitors. Connect tracking for this selection.";
    const h = harness(def(async () => { called += 1; throw new SelectionFact("LANDSCAPE_NOT_FOUND", message); }));
    const r = await h.lease();
    // Not queued for another try: the same fact would be read again.
    expect(r.status).toBe("failed");
    expect(r.available_at).toBeUndefined();
    expect(called).toBe(1);
    expect(r.result).toMatchObject({ run_id: "run-1", fact: "LANDSCAPE_NOT_FOUND" });
    expect(h.run.status).toBe("stopped");
    // The message leads with the code, so the dispatch that owns the report reads the fact back from the run.
    expect(h.run.outcome).toBe(message);
    expect(h.log).toHaveLength(1);
    expect(h.log[0]).toMatchObject({ attempt: 1, outcome: "stopped", detail: { fact: "LANDSCAPE_NOT_FOUND" } });
  });

  it("still tries an ordinary fault again: only a selection fact is exempt", async () => {
    let called = 0;
    const h = harness(def(async () => { called += 1; throw new Error("RivalIQ answered 502"); }));
    const r = await h.lease();
    expect(r.status).toBe("queued");
    expect(h.run.status).toBe("running");
    expect(h.log.map((l) => l.outcome)).toEqual(["retry"]);
    expect(called).toBe(1);
  });

  it("stops a run that has gone on longer than MAX_RUN_HOURS", async () => {
    const h = harness(def(async () => ({ type: "done" })), { started_at: at(-MAX_RUN_HOURS * 60 - 1).toISOString() });
    const r = await h.lease();
    expect(r.status).toBe("failed");
    expect(h.run.outcome).toContain(`${MAX_RUN_HOURS} hours`);
  });

  it("refuses a next step the pipeline does not define", async () => {
    const h = harness(def(async () => ({ type: "next", step: "nowhere" })));
    const r = await h.lease();
    expect(r.status).toBe("queued");
    expect(r.reason).toContain("nowhere");
  });

  it("stops a run whose pipeline is not in this deployment (a rollback)", async () => {
    const h = harness(def(async () => ({ type: "done" })));
    h.job.payload = { ...h.job.payload, pipeline: "gone" };
    const r = await h.lease();
    expect(r.status).toBe("failed");
    expect(h.run.status).toBe("stopped");
    expect(h.run.outcome).toContain("not in this deployment");
  });

  it("does nothing for a run that already finished, or a job with no run", async () => {
    const h = harness(def(async () => ({ type: "done" })), { status: "done" });
    expect((await h.lease()).status).toBe("skipped");
    const bare = harness(def(async () => ({ type: "done" })));
    bare.job.payload = null;
    expect((await runPipelineJob(bare.job, bare.deps)).status).toBe("failed");
  });

  it("keeps running when the step log cannot be written", async () => {
    const h = harness(def(async () => ({ type: "done" })));
    h.deps.log = { start: async () => { throw new Error("log table missing"); }, end: async () => { throw new Error("nope"); } };
    expect((await h.lease()).status).toBe("done");
  });

  it("cuts a long log detail", () => {
    expect(smallDetail({ text: "y".repeat(5000) })).toMatchObject({ truncated: true });
    expect(smallDetail({ ok: 1 })).toEqual({ ok: 1 });
  });
});
