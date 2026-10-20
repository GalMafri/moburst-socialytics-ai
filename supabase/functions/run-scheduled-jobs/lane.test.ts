// @vitest-environment node
// The report pipeline lane: pipeline steps run alongside the main loop, up to
// PIPELINE_CONCURRENCY at once, never behind a long main job and never
// changing what the main loop does.
import { describe, expect, it } from "vitest";
import { PIPELINE_CONCURRENCY, START_WINDOW_MS, workerTick, type PipelineLane, type WorkerDeps } from "./worker";
import type { JobOutcome, ScheduledJob } from "./types";

const T0 = new Date("2026-11-07T07:16:00Z");
const job = (id: string, kind: ScheduledJob["kind"] = "report_pipeline", over: Partial<ScheduledJob> = {}): ScheduledJob => ({
  id, kind, client_id: "client-1", schedule_id: null, occurrence: null, priority: 60, stagger_seconds: 0,
  status: "running", phase: null, report_id: null, attempts: 1, max_attempts: 5, available_at: T0.toISOString(), lease_until: null,
  reason: null, result: null, created_at: T0.toISOString(), started_at: null, finished_at: null, ...over,
});

/** A promise the test resolves when it chooses. */
function gate<T = void>() {
  let open!: (v: T) => void;
  const p = new Promise<T>((r) => { open = r; });
  return { p, open };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

function mainDeps(queue: ScheduledJob[], run: (j: ScheduledJob) => Promise<JobOutcome>, clock: { now: Date }, finished: string[]): WorkerDeps {
  return {
    now: () => clock.now,
    lease: async () => queue.shift() ?? null,
    run,
    finish: async (j) => { finished.push(j.id); },
    closeAbandoned: async () => [],
    releaseReady: async () => 0,
  };
}

describe("workerTick with the pipeline lane", () => {
  it("gives the main loop exactly the results it had before when no pipeline step is due", async () => {
    const clock = { now: T0 };
    const run = async (j: ScheduledJob): Promise<JobOutcome> => ({ status: "done", reason: `ran ${j.id}` });
    const without = await workerTick(mainDeps([job("a", "feed_refresh"), job("b", "dispatch")], run, clock, []));
    const leased: number[] = [];
    const lane: PipelineLane = { lease: async () => { leased.push(1); return []; }, run: async () => ({ status: "done" }), finish: async () => {} };
    const withLane = await workerTick({ ...mainDeps([job("a", "feed_refresh"), job("b", "dispatch")], run, clock, []), pipelines: lane });
    expect(withLane).toEqual(without);
    expect(leased).toHaveLength(1);
  });

  it("runs up to PIPELINE_CONCURRENCY steps at once, and leases the next as soon as one finishes", async () => {
    const clock = { now: T0 };
    const waiting = Array.from({ length: 6 }, (_, i) => job(`p${i}`));
    const gates = new Map(waiting.map((j) => [j.id, gate<JobOutcome>()]));
    let running = 0, most = 0;
    const leases: number[] = [];
    const finished: string[] = [];
    const lane: PipelineLane = {
      // As scheduled_jobs_lease_pipelines does: no more than the free room.
      lease: async () => { const room = PIPELINE_CONCURRENCY - running; leases.push(room); return waiting.splice(0, Math.max(0, room)); },
      run: async (j) => { running += 1; most = Math.max(most, running); const r = await gates.get(j.id)!.p; running -= 1; return r; },
      finish: async (j) => { finished.push(j.id); },
    };
    const done = workerTick({ ...mainDeps([], async () => ({ status: "done" }), clock, []), pipelines: lane });
    await tick();
    expect(running).toBe(PIPELINE_CONCURRENCY);
    gates.get("p0")!.open({ status: "queued", resetAttempts: true });
    await tick(); await tick();
    expect(finished).toEqual(["p0"]);
    expect(running).toBe(PIPELINE_CONCURRENCY);
    for (const g of gates.values()) g.open({ status: "done" });
    const result = await done;
    expect(most).toBe(PIPELINE_CONCURRENCY);
    expect(finished.sort()).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
    expect(result.results.filter((r) => r.kind === "report_pipeline")).toHaveLength(6);
  });

  it("never waits behind a long main job, such as a week plan", async () => {
    const clock = { now: T0 };
    const weekPlan = gate<JobOutcome>();
    const order: string[] = [];
    const lane: PipelineLane = {
      lease: (() => { let n = 0; return async () => (n++ === 0 ? [job("p1"), job("p2")] : []); })(),
      run: async (j) => ({ status: "done", reason: j.id }),
      finish: async (j) => { order.push(j.id); },
    };
    const done = workerTick({
      ...mainDeps([job("plan", "week_plan")], () => weekPlan.p, clock, order),
      pipelines: lane,
    });
    await tick(); await tick();
    expect(order).toEqual(["p1", "p2"]);
    weekPlan.open({ status: "done" });
    const result = await done;
    expect(order).toEqual(["p1", "p2", "plan"]);
    expect(result.results.map((r) => r.id)).toEqual(["plan", "p1", "p2"]);
  });

  it("starts no step once the start window has passed", async () => {
    const clock = { now: T0 };
    const ran: string[] = [];
    let leases = 0;
    const lane: PipelineLane = {
      lease: async () => { leases += 1; clock.now = new Date(T0.getTime() + START_WINDOW_MS + 1); return [job("p1")]; },
      run: async (j) => { ran.push(j.id); return { status: "done" }; },
      finish: async () => {},
    };
    await workerTick({ ...mainDeps([], async () => ({ status: "done" }), clock, []), pipelines: lane });
    expect(leases).toBe(1);
    expect(ran).toEqual(["p1"]);
  });

  it("leaves the main loop untouched when the lane cannot lease (its database function is not there yet)", async () => {
    const clock = { now: T0 };
    const lane: PipelineLane = { lease: async () => { throw new Error("function scheduled_jobs_lease_pipelines does not exist"); }, run: async () => ({ status: "done" }), finish: async () => {} };
    const result = await workerTick({ ...mainDeps([job("a", "feed_refresh")], async () => ({ status: "done" }), clock, []), pipelines: lane });
    expect(result.results).toEqual([{ id: "a", kind: "feed_refresh", status: "done", reason: null }]);
  });

  it("retries a step whose runner threw, and survives a finish that failed", async () => {
    const clock = { now: T0 };
    const outcomes: JobOutcome[] = [];
    const lane: PipelineLane = {
      lease: (() => { let n = 0; return async () => (n++ === 0 ? [job("p1"), job("p2", "report_pipeline", { attempts: 5 })] : []); })(),
      run: async () => { throw new Error("boom"); },
      finish: async (j, o) => { outcomes.push(o); if (j.id === "p2") throw new Error("database away"); },
    };
    const result = await workerTick({ ...mainDeps([], async () => ({ status: "done" }), clock, []), pipelines: lane });
    expect(outcomes[0]).toMatchObject({ status: "queued", reason: "boom" });
    expect(outcomes[1]).toMatchObject({ status: "failed", reason: "boom" });
    expect(result.results.map((r) => r.status)).toEqual(["queued", "failed"]);
  });
});
