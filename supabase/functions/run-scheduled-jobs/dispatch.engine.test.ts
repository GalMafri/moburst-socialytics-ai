// @vitest-environment node
// The dispatch under the engine switch. With the switch on n8n (set by hand),
// every scenario makes the same requests, writes, job saves and outcomes as a
// dispatch with no switch at all. Then shadow (n8n for real, plus an in-app
// run queued once n8n has the request) and app (no n8n request; the job
// watches the in-app run's heartbeat instead of the 90-minute clock). Nothing
// else ever goes to n8n: an unreadable switch, a missing pipeline, stopped
// app runs and a repeated request all run again in the app.
import { describe, expect, it } from "vitest";
import { RETRY_FIRST_MINUTES, runDispatch, type DispatchDeps, type DispatchStore, type ScheduleRow } from "./dispatch";
import type { JobOutcome, ScheduledJob } from "../_shared/scheduled-jobs/types";
import type { LandscapeCheck } from "../_shared/competitive/landscapeCheck";
import type { ReportPipelineStart } from "../_shared/pipelines/shadow";
import type { AppRunView } from "../_shared/pipelines/store";
import type { Engine, PipelineDefinition } from "../_shared/pipelines/types";
import { REGISTRY } from "../_shared/pipelines/registry";

const NOW = new Date("2026-11-07T07:20:00Z");
const DUE = "2026-11-07T07:15:00.000Z";
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

type Row = { id: string; client_id: string; status: string; date_range_start: string | null; date_range_end: string | null; set_id?: string; created_at?: string; error?: string };

function world(kinds: Array<"competitive" | "social"> = ["social"]) {
  const schedules: Array<ScheduleRow & { last_result?: string | null }> = kinds.map((kind) => ({
    id: `sched-${kind}`, client_id: "client-1", report_kind: kind, is_active: true, next_run_at: DUE,
    run_day_of_month: 7, frequency: "monthly", range_mode: "previous_month", created_by: "user-1", pending_competitive_report_id: null,
  }));
  const tables = {
    schedules,
    competitive: [{ id: "old-complete", client_id: "client-1", status: "complete", date_range_start: "2026-09-01", date_range_end: "2026-09-30", set_id: "set-1" }] as Row[],
    reports: [] as Row[],
    clock: NOW,
  };
  const writes: string[] = [];
  const made = { social: 0, competitive: 0 };
  const rows = (t: string) => (t === "reports" ? tables.reports : tables.competitive);
  const store: DispatchStore = {
    async schedule(id) { const s = tables.schedules.find((x) => x.id === id); return s ? { ...s } : null; },
    async client(id) { return id === "client-1" ? { id, name: "Fixture", archived_at: null } : null; },
    async competitorSet() { return { id: "set-1", rivaliq_landscape_id: "ls-1" }; },
    async competitiveReport(id, clientId) { return tables.competitive.find((r) => r.id === id && r.client_id === clientId) ?? null; },
    async reportRun(table, id) { const r = rows(table).find((x) => x.id === id); return r ? { status: r.status, created_at: r.created_at ?? null, error: r.error ?? null, held: false } : null; },
    async pairedCompetitivePending() { return false; },
    async releaseHeldSocial(clientId) { writes.push(`release social ${clientId}`); },
    async webhooks() { return { social: "https://n8n.fixture/social", competitive: "https://n8n.fixture/competitive" }; },
    async insertCompetitiveReport(row) { const id = `comp-${++made.competitive}`; tables.competitive.push({ id, client_id: row.client_id, status: "running", date_range_start: row.date_range_start, date_range_end: row.date_range_end, set_id: row.set_id, created_at: row.created_at }); writes.push(`insert competitive ${id}`); return id; },
    async insertSocialReport(row) { const id = `social-${++made.social}`; tables.reports.push({ id, client_id: row.client_id, status: "running", date_range_start: row.date_range_start, date_range_end: row.date_range_end, created_at: tables.clock.toISOString() }); writes.push(`insert social ${id}`); return id; },
    async holdSocial(_c, reportId) { writes.push(`hold ${reportId}`); },
    async setAnalyzing(setId) { writes.push(`analyzing ${setId}`); },
    async dropReport(table, id) { const list = rows(table); const i = list.findIndex((x) => x.id === id && x.status !== "complete" && x.status !== "completed"); if (i >= 0) list.splice(i, 1); writes.push(`drop ${table} ${id}`); },
    async releaseSet(setId) { writes.push(`release set ${setId}`); },
    async advance(schedule, nextRunAt, result) { Object.assign(tables.schedules.find((x) => x.id === schedule.id)!, { next_run_at: nextRunAt, last_result: result }); writes.push(`advance ${schedule.id}`); },
    async close(schedule, nextRunAt) { Object.assign(tables.schedules.find((x) => x.id === schedule.id)!, { next_run_at: nextRunAt }); writes.push(`close ${schedule.id}`); },
    async note(scheduleId, result) { writes.push(`note ${scheduleId} ${result ?? "-"}`); },
  };
  return { tables, store, writes };
}

const job = (kind: "competitive" | "social", over: Partial<ScheduledJob> = {}): ScheduledJob => ({
  id: `job-${kind}`, kind: "dispatch", client_id: "client-1", schedule_id: `sched-${kind}`, occurrence: DUE,
  priority: kind === "competitive" ? 20 : 30, stagger_seconds: 0, status: "running", phase: null, report_id: null,
  attempts: 1, max_attempts: 3, available_at: DUE, lease_until: null, reason: null, result: null,
  created_at: DUE, started_at: DUE, finished_at: null, ...over,
});

const TRACKED: LandscapeCheck = {
  ok: true, linked: true,
  summary: { id: "ls-1", name: "Fixture", focus_company: "Fixture", is_match: true, client_company_id: "1", match_reason: "focus company", companies: [] },
  landscape: { id: "ls-1", name: "Fixture", focusCompanyId: 1, companies: [] },
};

type Switch = "none" | "n8n" | "unreadable" | "shadow" | "app" | "app-no-watch" | "app-no-pipeline";
const placeholder = (kind: "social" | "competitive") => REGISTRY.get(`placeholder_${kind}`)!;
const appPipeline = (kind: "social" | "competitive"): PipelineDefinition => ({ ...placeholder(kind), name: `real_${kind}`, modes: ["shadow", "app"], appCapable: true });

function harness(w: ReturnType<typeof world>, sw: Switch, opts: { transport?: "accept" | "reject" | "throw"; startFails?: boolean; appRun?: () => AppRunView | null } = {}) {
  const posts: string[] = [];
  const saved: Array<Record<string, unknown>> = [];
  const starts: ReportPipelineStart[] = [];
  const order: string[] = [];
  let transport = opts.transport ?? "accept";
  const engineDeps = (): Partial<DispatchDeps> => {
    if (sw === "none") return {};
    const resolve = async (kind: "social" | "competitive"): Promise<{ engine: Engine; pipeline?: PipelineDefinition; refused?: string }> => {
      if (sw === "unreadable") throw new Error("report_engines does not exist");
      if (sw === "n8n") return { engine: "n8n" };
      if (sw === "shadow") return { engine: "shadow", pipeline: placeholder(kind) };
      if (sw === "app-no-pipeline") return { engine: "app", refused: `No app-capable ${kind} pipeline with its secrets set is in this deployment.` };
      return { engine: "app", pipeline: appPipeline(kind) };
    };
    return {
      engine: resolve,
      async startPipeline(a) { order.push(`start ${a.mode}`); starts.push(a); if (opts.startFails) throw new Error("report_pipeline_start failed"); return { run_id: `run-${starts.length}` }; },
      ...(sw === "app-no-watch" ? {} : { async pipelineRun() { return opts.appRun ? opts.appRun() : null; } }),
    };
  };
  const deps = (j: ScheduledJob): DispatchDeps => ({
    store: w.store,
    now: () => w.tables.clock,
    async post(url) {
      posts.push(url); order.push("post");
      if (transport === "throw") throw new Error("Fixture network failure");
      return transport === "reject" ? { ok: false, status: 503 } : { ok: true, status: 200 };
    },
    async buildSocialPayload(a) { return { report_id: a.reportId, date_range_start: a.range.start, date_range_end: a.range.end }; },
    async buildCompetitivePayload(a) { return { report_id: a.reportId, set_id: a.set.id, attempt_started_at: a.attemptStartedAt }; },
    async checkLandscape() { return TRACKED; },
    async saveJob(patch) { saved.push(JSON.parse(JSON.stringify(patch))); order.push(`save ${patch.phase ?? "-"}`); Object.assign(j, patch); },
    ...engineDeps(),
  });
  const run = async (j: ScheduledJob): Promise<JobOutcome> => {
    const outcome = await runDispatch(j, deps(j));
    if (outcome.result !== undefined) j.result = outcome.result ?? null;
    j.status = outcome.status;
    return outcome;
  };
  return { posts, saved, starts, order, run, setTransport: (t: "accept" | "reject" | "throw") => { transport = t; } };
}

/** A scenario: leases of one job with things happening between them. Returns everything observable. */
type Scenario = (w: ReturnType<typeof world>, h: ReturnType<typeof harness>) => Promise<unknown[]>;
const SCENARIOS: Record<string, { kinds: Array<"competitive" | "social">; play: Scenario }> = {
  "a social report that runs and completes": {
    kinds: ["social"],
    async play(w, h) {
      const j = job("social");
      const out = [await h.run(j)];
      w.tables.reports[0].status = "completed";
      out.push(await h.run({ ...j, status: "running" }));
      return out;
    },
  },
  "a competitive analysis that runs and completes": {
    kinds: ["competitive"],
    async play(w, h) {
      const j = job("competitive");
      const out = [await h.run(j)];
      w.tables.competitive.find((r) => r.id === "comp-1")!.status = "complete";
      out.push(await h.run({ ...j, status: "running" }));
      return out;
    },
  },
  "a refused request": {
    kinds: ["social"],
    async play(_w, h) { h.setTransport("reject"); return [await h.run(job("social"))]; },
  },
  "an unanswered request, sent again for the same report": {
    kinds: ["social"],
    async play(w, h) {
      h.setTransport("throw");
      const j = job("social");
      const out = [await h.run(j)];
      h.setTransport("accept");
      w.tables.clock = minutes(10);
      out.push(await h.run({ ...j, status: "running", attempts: 2 }));
      return out;
    },
  },
  "a report n8n stopped answering for 90 minutes": {
    kinds: ["social"],
    async play(w, h) {
      const j = job("social");
      const out = [await h.run(j)];
      w.tables.clock = minutes(95);
      out.push(await h.run({ ...j, status: "running" }));
      return out;
    },
  },
  "a manual competitive run": {
    kinds: [],
    async play(_w, h) {
      const j = job("competitive", { schedule_id: null, occurrence: null, payload: { run: "manual", kind: "competitive", range: { start: "2026-10-01", end: "2026-10-31" }, requested_by: "user-1", requested_at: DUE } });
      return [await h.run(j)];
    },
  },
};

async function observe(name: string, sw: Switch) {
  const s = SCENARIOS[name];
  const w = world(s.kinds);
  const h = harness(w, sw);
  const outcomes = await s.play(w, h);
  return { trace: { outcomes, posts: h.posts, saved: h.saved, writes: w.writes, reports: w.tables.reports, competitive: w.tables.competitive, schedules: w.tables.schedules }, starts: h.starts };
}

describe("with every switch on n8n, nothing changes", () => {
  for (const name of Object.keys(SCENARIOS)) {
    it(`${name}: the same requests, writes, saves and outcomes as with no switch`, async () => {
      const before = await observe(name, "none");
      const after = await observe(name, "n8n");
      expect(after.trace).toEqual(before.trace);
      expect(after.starts).toEqual([]);
    });
  }

  it("an n8n run never carries an engine in its memory", async () => {
    const { trace } = await observe("a social report that runs and completes", "n8n");
    expect(JSON.stringify(trace.saved)).not.toContain("engine");
    expect(JSON.stringify(trace.outcomes)).not.toContain("engine");
  });
});

describe("shadow: n8n runs for real, and an in-app run is queued next to it", () => {
  it("sends n8n exactly what it sends today, then queues the shadow with the same request", async () => {
    const name = "a social report that runs and completes";
    const n8n = await observe(name, "none");
    const shadow = await observe(name, "shadow");
    expect(shadow.trace).toEqual(n8n.trace);
    expect(shadow.starts).toEqual([{
      mode: "shadow", kind: "social", pipeline: placeholder("social"), clientId: "client-1", reportId: "social-1",
      range: { start: "2026-10-01", end: "2026-10-31" }, setId: null,
      request: { report_id: "social-1", date_range_start: "2026-10-01", date_range_end: "2026-10-31" },
    }]);
  });

  it("queues the shadow only once n8n has the request", async () => {
    const w = world(["social"]);
    const h = harness(w, "shadow");
    await h.run(job("social"));
    expect(h.order).toEqual(["save prepared", "save posting", "post", "save sent", "start shadow"]);
  });

  it("gives a competitive shadow its set", async () => {
    const { starts } = await observe("a competitive analysis that runs and completes", "shadow");
    expect(starts).toEqual([expect.objectContaining({ mode: "shadow", kind: "competitive", reportId: "comp-1", setId: "set-1" })]);
  });

  it("queues no shadow when n8n refused the request", async () => {
    const { starts } = await observe("a refused request", "shadow");
    expect(starts).toEqual([]);
  });

  it("changes nothing when the shadow cannot be queued", async () => {
    const w = world(["social"]);
    const h = harness(w, "shadow", { startFails: true });
    const outcome = await h.run(job("social"));
    expect(outcome).toMatchObject({ status: "waiting", reason: "The report is running." });
    expect(h.posts).toEqual(["https://n8n.fixture/social"]);
    const base = await observe("a social report that runs and completes", "none");
    expect(outcome).toEqual(base.trace.outcomes[0]);
  });
});

describe("app: the in-app pipeline makes the report", () => {
  it("sends nothing to n8n, queues the app run for the report, and watches it", async () => {
    const w = world(["social"]);
    const h = harness(w, "app", { appRun: () => ({ status: "running", heartbeat_at: w.tables.clock.toISOString(), outcome: null }) });
    const j = job("social");
    const first = await h.run(j);
    expect(h.posts).toEqual([]);
    expect(h.starts).toEqual([expect.objectContaining({ mode: "app", kind: "social", reportId: "social-1", pipeline: expect.objectContaining({ name: "real_social" }) })]);
    expect(first).toMatchObject({ status: "waiting", result: { engine: "app", pipeline_run_id: "run-1" } });
    expect(j.phase).toBe("sent");
    expect(w.tables.reports[0].status).toBe("running");
  });

  it("keeps waiting past 90 minutes while the run is taken step by step", async () => {
    const w = world(["social"]);
    const h = harness(w, "app", { appRun: () => ({ status: "running", heartbeat_at: minutes(170).toISOString(), outcome: null }) });
    const j = job("social");
    await h.run(j);
    w.tables.clock = minutes(180);
    const later = await h.run({ ...j, status: "running" });
    expect(later).toMatchObject({ status: "waiting", reason: "The report is running." });
    expect(w.writes).not.toContain("drop reports social-1");
  });

  it("runs the report again when the run stopped, or nothing touched it for 90 minutes", async () => {
    for (const view of [
      { status: "stopped" as const, heartbeat_at: minutes(30).toISOString(), outcome: "Step fetch did not finish in 5 tries" },
      { status: "running" as const, heartbeat_at: minutes(1).toISOString(), outcome: null },
    ]) {
      const w = world(["social"]);
      const h = harness(w, "app", { appRun: () => view });
      const j = job("social");
      await h.run(j);
      w.tables.clock = minutes(120);
      const again = await h.run({ ...j, status: "running" });
      expect(again.status).toBe("queued");
      expect(again.reason).toContain(view.status === "stopped" ? "the in-app pipeline stopped (Step fetch" : "stopped answering");
      expect(w.writes).toContain("drop reports social-1");
      expect((again.result as Record<string, unknown>).engine).toBeUndefined();
    }
  });

  it("finishes when the run completed the report", async () => {
    const w = world(["social"]);
    const h = harness(w, "app", { appRun: () => ({ status: "done", heartbeat_at: NOW.toISOString(), outcome: null }) });
    const j = job("social");
    await h.run(j);
    w.tables.reports[0].status = "completed";
    expect((await h.run({ ...j, status: "running" })).status).toBe("done");
    expect(w.writes).toContain("advance sched-social");
  });

  it("runs the report again, with nothing sent anywhere, when the app run cannot be queued", async () => {
    const w = world(["social"]);
    const h = harness(w, "app", { startFails: true });
    const outcome = await h.run(job("social"));
    expect(outcome.status).toBe("queued");
    expect(outcome.reason).toContain("could not be queued");
    expect(h.posts).toEqual([]);
    expect(w.writes).toContain("drop reports social-1");
  });

  it("watches the report itself when the app run cannot be watched, and still sends nothing to n8n", async () => {
    const { starts, trace } = await observe("a social report that runs and completes", "app-no-watch");
    expect(starts).toEqual([expect.objectContaining({ mode: "app", kind: "social", reportId: "social-1" })]);
    expect(trace.posts).toEqual([]);
    expect(trace.outcomes.map((o) => (o as JobOutcome).status)).toEqual(["waiting", "done"]);
  });
});

describe("no automatic hand-off to n8n", () => {
  it("runs again in the app, with the same waits, however many in-app runs of one report have stopped", async () => {
    const w = world(["social"]);
    const h = harness(w, "app", { appRun: () => ({ status: "stopped", heartbeat_at: w.tables.clock.toISOString(), outcome: "Step fetch did not finish in 5 tries" }) });
    const j = job("social");
    const waits: number[] = [];
    for (let i = 1; i <= 4; i++) {
      await h.run(j);
      expect(h.starts).toHaveLength(i);
      w.tables.clock = minutes(i * 600);
      const again = await h.run({ ...j, status: "running" });
      expect(again.status).toBe("queued");
      waits.push((Date.parse(again.available_at!) - w.tables.clock.getTime()) / 60_000);
      Object.assign(j, { status: "running", phase: null, report_id: null, result: again.result });
    }
    expect(waits).toEqual([30, 60, 120, 240]);
    expect(h.posts).toEqual([]);
    const runs = (j.result as { runs: Array<{ engine?: string; outcome?: string }> }).runs;
    expect(runs.map((r) => [r.engine ?? "n8n", r.outcome ?? "open"])).toEqual([["app", "stopped"], ["app", "stopped"], ["app", "stopped"], ["app", "stopped"]]);
  });

  it("a missing pipeline (or its secret) waits and runs again later like a stopped run, sending nothing anywhere", async () => {
    for (const kind of ["social", "competitive"] as const) {
      const w = world([kind]);
      const h = harness(w, "app-no-pipeline");
      const j = job(kind);
      const first = await h.run(j);
      expect(first.status).toBe("queued");
      expect(first.available_at).toBe(minutes(RETRY_FIRST_MINUTES).toISOString());
      expect(first.reason).toContain(`No app-capable ${kind} pipeline`);
      expect(first.reason).not.toContain("n8n");
      expect(h.posts).toEqual([]);
      expect(h.starts).toEqual([]);
      const id = kind === "social" ? "social-1" : "comp-1";
      expect(w.writes).toContain(`drop ${kind === "social" ? "reports" : "competitive_reports"} ${id}`);
      if (kind === "competitive") expect(w.writes).toEqual(expect.arrayContaining(["release set set-1", "release social client-1"]));
      // The next wait doubles, as after a stopped run.
      w.tables.clock = minutes(40);
      Object.assign(j, { status: "running", phase: null, report_id: null, result: first.result });
      const second = await h.run(j);
      expect(second.available_at).toBe(minutes(40 + 2 * RETRY_FIRST_MINUTES).toISOString());
      expect(h.posts).toEqual([]);
    }
  });

  it("a missing pipeline closes the occurrence quietly when no run fits before the schedule's next run", async () => {
    const w = world(["social"]);
    const h = harness(w, "app-no-pipeline");
    // Two hours before the next monthly run: inside the last three hours, so no run fits.
    w.tables.clock = new Date("2026-12-07T05:15:00Z");
    const outcome = await h.run(job("social"));
    expect(outcome.status).toBe("skipped");
    expect(w.writes).toContain("close sched-social");
    expect(h.posts).toEqual([]);
  });

  it("an unreadable switch reads as app: nothing goes to n8n, and with no pipeline known the occurrence runs again later", async () => {
    const w = world(["social"]);
    const h = harness(w, "unreadable");
    const outcome = await h.run(job("social"));
    expect(outcome.status).toBe("queued");
    expect(outcome.available_at).toBe(minutes(RETRY_FIRST_MINUTES).toISOString());
    expect(outcome.reason).toContain("report_engines does not exist");
    expect(h.posts).toEqual([]);
    expect(w.writes).toContain("drop reports social-1");
  });

  it("a repeated request in the posting phase with an app route starts the app run for the same report", async () => {
    const w = world(["social"]);
    const h = harness(w, "app", { appRun: () => ({ status: "running", heartbeat_at: w.tables.clock.toISOString(), outcome: null }) });
    w.tables.reports.push({ id: "social-9", client_id: "client-1", status: "running", date_range_start: "2026-10-01", date_range_end: "2026-10-31", created_at: NOW.toISOString() });
    const j = job("social", { phase: "posting", report_id: "social-9", result: { range: { start: "2026-10-01", end: "2026-10-31" }, runs: [{ report_id: "social-9", started_at: NOW.toISOString() }] } });
    const outcome = await h.run(j);
    expect(h.posts).toEqual([]);
    expect(h.starts).toEqual([expect.objectContaining({ mode: "app", kind: "social", reportId: "social-9" })]);
    expect(outcome).toMatchObject({ status: "waiting", result: { engine: "app", pipeline_run_id: "run-1" } });
    expect(w.tables.reports.map((r) => r.id)).toEqual(["social-9"]);
  });

  it("a missing webhook URL does not stop an app route", async () => {
    for (const kind of ["social", "competitive"] as const) {
      const w = world([kind]);
      w.store.webhooks = async () => ({ social: null, competitive: null });
      const h = harness(w, "app", { appRun: () => ({ status: "running", heartbeat_at: w.tables.clock.toISOString(), outcome: null }) });
      const outcome = await h.run(job(kind));
      expect(outcome).toMatchObject({ status: "waiting", reason: "The report is running." });
      expect(h.starts).toEqual([expect.objectContaining({ mode: "app", kind })]);
      expect(h.posts).toEqual([]);
    }
  });

  it("a missing webhook URL on an n8n route set by hand still blocks without a report, as before", async () => {
    for (const kind of ["social", "competitive"] as const) {
      const w = world([kind]);
      w.store.webhooks = async () => ({ social: null, competitive: null });
      const outcome = await harness(w, "n8n").run(job(kind));
      expect(outcome.status).toBe("blocked");
      expect(outcome.reason).toMatch(/not configured/);
      expect(w.tables.reports).toHaveLength(0);
      expect(w.tables.competitive.map((r) => r.id)).toEqual(["old-complete"]);
    }
  });
});
