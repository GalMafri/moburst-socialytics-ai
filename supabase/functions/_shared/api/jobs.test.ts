import { describe, it, expect } from "vitest";
import { advanceJob, finalStatus, initialSteps, nextStep, type JobRecord, type StepDef } from "./jobs";

type Ctx = { log: string[] };
const job = (over: Partial<JobRecord> = {}): JobRecord => ({
  id: "j1", status: "queued", steps: [], outputs: null, gaps: [], client_id: null, run_ids: [], next_check_at: null,
  started_at: null, completed_at: null, error: null, input: {}, ...over,
});
let t = 0;
const now = () => new Date(Date.UTC(2026, 8, 30, 12, 0, t++));

function harness(steps: StepDef<Ctx>[], j = job({ steps: initialSteps(steps) })) {
  const saves: string[] = [];
  const ctx: Ctx = { log: [] };
  const save = async (x: JobRecord) => { saves.push(`${x.status}:${x.steps.map((s) => `${s.name}=${s.status}`).join(",")}`); };
  return { j, ctx, saves, run: (budgetMs = 60_000) => advanceJob(j, steps, ctx, { budgetMs, now, save }) };
}

const step = (name: string, run: StepDef<Ctx>["run"]): StepDef<Ctx> => ({ name, run });

describe("advanceJob", () => {
  it("runs the steps in order, saving after each, and completes", async () => {
    const h = harness([
      step("a", async (_j, c) => { c.log.push("a"); return { status: "done", outcome: "created" }; }),
      step("b", async (_j, c) => { c.log.push("b"); return { status: "skipped", reason: "nothing_to_do" }; }),
      step("c", async (_j, c) => { c.log.push("c"); return { status: "done", patch: { client_id: "cl" } }; }),
    ]);
    const r = await h.run();
    expect(h.ctx.log).toEqual(["a", "b", "c"]);
    expect(r.stopped).toBe("finished");
    expect(r.job.status).toBe("completed");
    expect(r.job.client_id).toBe("cl");
    expect(r.job.completed_at).not.toBeNull();
    expect(r.job.started_at).not.toBeNull();
    expect(r.job.steps.map((s) => s.status)).toEqual(["done", "skipped", "done"]);
    expect(r.job.steps[0].outcome).toBe("created");
    expect(r.job.steps[1].reason).toBe("nothing_to_do");
    expect(h.saves[0]).toBe("running:a=running,b=pending,c=pending");
    expect(h.saves[h.saves.length - 1]).toBe("completed:a=done,b=skipped,c=done");
  });

  it("stops on a waiting step, keeps it running, and re-runs it next time", async () => {
    let checks = 0;
    const h = harness([
      step("a", async () => ({ status: "done" })),
      step("wait", async () => { checks++; return checks < 2 ? { status: "waiting", check_in_s: 120 } : { status: "done" }; }),
      step("z", async () => ({ status: "done" })),
    ]);
    const r1 = await h.run();
    expect(r1.stopped).toBe("waiting");
    expect(r1.job.status).toBe("running");
    expect(r1.job.steps[1].status).toBe("running");
    expect(new Date(r1.job.next_check_at!).getTime() - new Date(r1.job.steps[1].started_at!).getTime()).toBeGreaterThanOrEqual(120_000);
    const r2 = await h.run();
    expect(checks).toBe(2);
    expect(r2.stopped).toBe("finished");
    expect(r2.job.status).toBe("completed");
    expect(r2.job.next_check_at).toBeNull();
  });

  it("continues after a failed step and ends partial", async () => {
    const h = harness([
      step("a", async () => ({ status: "failed", reason: "site_unreadable", message: "The site could not be read." })),
      step("b", async () => ({ status: "done" })),
    ]);
    const r = await h.run();
    expect(r.job.status).toBe("partial");
    expect(r.job.steps[1].status).toBe("done");
  });

  it("stops on a fatal failure, skips the remaining steps and ends failed", async () => {
    const h = harness([
      step("a", async () => ({ status: "failed", reason: "no_owner", message: "No owner.", fatal: true })),
      step("b", async () => ({ status: "done" })),
    ]);
    const r = await h.run();
    expect(r.job.status).toBe("failed");
    expect(r.job.error).toBe("No owner.");
    expect(r.job.steps[1]).toMatchObject({ status: "skipped", reason: "job_failed" });
  });

  it("turns a thrown error into a failed step", async () => {
    const h = harness([step("a", async () => { throw new Error("boom"); }), step("b", async () => ({ status: "done" }))]);
    const r = await h.run();
    expect(r.job.steps[0]).toMatchObject({ status: "failed", reason: "exception", message: "boom" });
    expect(r.job.status).toBe("partial");
  });

  it("respects the budget", async () => {
    const h = harness([step("a", async () => ({ status: "done" })), step("b", async () => ({ status: "done" }))]);
    const r = await h.run(0);
    expect(r.stopped).toBe("budget");
    expect(r.job.steps[1].status).toBe("pending");
  });

  it("does nothing for a cancelled job", async () => {
    const h = harness([step("a", async (_j, c) => { c.log.push("a"); return { status: "done" }; })]);
    h.j.status = "cancelled";
    const r = await h.run();
    expect(r.stopped).toBe("cancelled");
    expect(h.ctx.log).toEqual([]);
  });

  it("accumulates gaps", async () => {
    const h = harness([
      step("a", async () => ({ status: "done", gaps: [{ step: "a", code: "meta_missing", message: "No Meta page could be placed." }] })),
      step("b", async () => ({ status: "done", gaps: [{ step: "b", code: "brief_missing", message: "No brief." }] })),
    ]);
    const r = await h.run();
    expect(r.job.gaps.map((g) => g.code)).toEqual(["meta_missing", "brief_missing"]);
  });
});

describe("helpers", () => {
  it("initialSteps and nextStep", () => {
    const steps = initialSteps([step("a", async () => ({ status: "done" })), step("b", async () => ({ status: "done" }))]);
    expect(steps).toEqual([{ name: "a", status: "pending" }, { name: "b", status: "pending" }]);
    expect(nextStep(job({ steps }))?.name).toBe("a");
    steps[0].status = "done";
    expect(nextStep(job({ steps }))?.name).toBe("b");
  });
  it("finalStatus is completed, partial or failed", () => {
    expect(finalStatus(job({ steps: [{ name: "a", status: "done" }, { name: "b", status: "skipped" }] }))).toBe("completed");
    expect(finalStatus(job({ steps: [{ name: "a", status: "failed" }, { name: "b", status: "done" }] }))).toBe("partial");
    expect(finalStatus(job({ steps: [{ name: "a", status: "failed" }], error: "x" }))).toBe("failed");
  });
});

describe("cancellation during a tick", () => {
  it("stops when the store reports the job is no longer running and never runs the next step", async () => {
    const ran: string[] = [];
    const steps: StepDef<Ctx>[] = [step("a", async () => { ran.push("a"); return { status: "done" }; }), step("b", async () => { ran.push("b"); return { status: "done" }; })];
    const j = job({ steps: initialSteps(steps) });
    let saves = 0;
    const r = await advanceJob(j, steps, { log: [] }, { budgetMs: 60_000, now, save: async () => { saves++; return saves < 3; } });
    expect(r.stopped).toBe("cancelled");
    expect(ran).toEqual(["a"]);
  });
});

describe("gap accumulation", () => {
  it("records the same gap once even when two steps report it", async () => {
    const g = { step: "readiness", code: "industry_missing", message: "No industry set for X." };
    const h = harness([
      step("a", async () => ({ status: "done", gaps: [{ step: "industry", code: "industry_missing", message: "No industry set for X." }] })),
      step("b", async () => ({ status: "done", gaps: [g, g] })),
    ]);
    const r = await h.run();
    expect(r.job.gaps).toHaveLength(1);
  });
});

describe("a fatal failure", () => {
  it("skips every other step but still runs the ones marked always, and closes the job as failed", async () => {
    const ran: string[] = [];
    const steps: StepDef<unknown>[] = [
      { name: "first", run: async () => { ran.push("first"); return { status: "failed", fatal: true, reason: "out_of_scope", message: "This key may not work on this client." }; } },
      { name: "middle", run: async () => { ran.push("middle"); return { status: "done" }; } },
      { name: "callback", always: true, run: async (job) => { ran.push(`callback:${finalStatus({ ...job, steps: job.steps.filter((s) => s.name !== "callback") })}`); return { status: "done", outcome: "delivered" }; } },
    ];
    const job: JobRecord = { id: "j", status: "queued", steps: initialSteps(steps), outputs: null, gaps: [], client_id: null, run_ids: [], next_check_at: null, started_at: null, completed_at: null, error: null, input: {} };
    const r = await advanceJob(job, steps, {}, { budgetMs: 10_000, now: () => new Date("2026-10-01T12:00:00.000Z"), save: async () => {} });
    expect(r.stopped).toBe("finished");
    expect(ran).toEqual(["first", "callback:failed"]);
    expect(job.status).toBe("failed");
    expect(job.error).toBe("This key may not work on this client.");
    expect(job.steps.map((s) => `${s.name}:${s.status}:${s.reason ?? s.outcome}`)).toEqual(["first:failed:out_of_scope", "middle:skipped:job_failed", "callback:done:delivered"]);
    expect(job.completed_at).toBe("2026-10-01T12:00:00.000Z");
  });
});
