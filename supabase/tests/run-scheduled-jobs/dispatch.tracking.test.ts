// @vitest-environment node
// One rule: a competitive analysis runs only when the confirmed set is
// tracked. Until then the dispatch waits for tracking, makes nothing, and
// starts the analysis on its own once tracking is there.
//
// Before this rule the check before a run and the pipeline's landscape step
// disagreed, so a run for a selection nothing tracked passed the check,
// stopped in the pipeline, and was made again every day. These tests hold the
// three ways out of that: a run that stops on the fact waits instead of being
// made again; a job already going round settles into the wait on its next
// lease; and a request for an untracked selection waits from its first lease.
import { describe, expect, it } from "vitest";
import {
  endedForTracking, MANUAL_RUN_DAYS, NEEDS_TRACKING, RETRY_FIRST_MINUTES, runDispatch,
  type DispatchDeps, type DispatchMemory, type DispatchRun, type DispatchStore, type ScheduleRow,
} from "../../functions/run-scheduled-jobs/dispatch";
import type { JobOutcome, ScheduledJob } from "../../functions/_shared/scheduled-jobs/types";
import { CLIENT_NOT_TRACKED, LANDSCAPE_MISSING, RIVALIQ_UNAVAILABLE, SELECTION_NOT_COVERED, resolveSelectionLandscape, trackingCheckRecord, type LandscapeCheck } from "../../functions/_shared/competitive/landscapeCheck";
import { recordedTracking } from "../../functions/_shared/competitive/selectionTracking";
import type { AppRunView } from "../../functions/_shared/pipelines/store";
import type { PipelineDefinition } from "../../functions/_shared/pipelines/types";
import { REGISTRY } from "../../functions/_shared/pipelines/registry";

const NOW = new Date("2026-11-17T07:20:00Z");
const DUE = "2026-11-17T07:15:00.000Z";
const HOUR = 60;
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

// Invented brands. The account holds an old landscape that tracks the client
// with last year's competitors, which is what the check used to accept.
const CLIENT = { name: "Northwind Bikes", website_url: "https://northwindbikes.example" };
const SELECTION = [
  { name: "Tailspin Cycles", website_url: "https://tailspincycles.example" },
  { name: "Fabrikam Wheels", website_url: "https://fabrikamwheels.example" },
  { name: "Contoso Rides", website_url: "https://contosorides.example" },
];
const company = (id: number, c: { name: string; website_url: string }) => ({ id, name: c.name, url: c.website_url });
const OLD_LANDSCAPE = { id: 501, name: "TIER 1", focusCompanyId: 1, companies: [company(1, CLIENT), { id: 9, name: "Adventure Works", url: "https://adventureworks.example" }] };
const OWN_LANDSCAPE = { id: 777, name: "Socialytics - Northwind Bikes - set-1", focusCompanyId: 1, companies: [company(1, CLIENT), ...SELECTION.map((c, i) => company(i + 2, c))] };

const NOT_FOUND = "LANDSCAPE_NOT_FOUND: no RivalIQ landscape tracks the client and the confirmed competitors. Connect tracking for this selection.";

type Row = { id: string; client_id: string; status: string; set_id?: string; created_at?: string; error?: string };

function world(opts: { manual?: boolean; linked?: string } = {}) {
  const schedules: Array<ScheduleRow & { last_result?: string | null }> = opts.manual ? [] : [{
    id: "sched-competitive", client_id: "client-1", report_kind: "competitive", is_active: true, next_run_at: DUE,
    run_day_of_month: 17, frequency: "monthly", range_mode: "previous_month", created_by: "user-1", pending_competitive_report_id: null,
  }];
  /** The client's confirmed set, as the dispatch reads it: with no link unless the scenario gives it one. */
  const set = { id: "set-1", rivaliq_landscape_id: opts.linked ?? null, tracking_check: null as unknown };
  const tables = { schedules, competitive: [] as Row[], clock: NOW, landscapes: [OLD_LANDSCAPE] as unknown, set };
  const writes: string[] = [];
  let made = 0;
  const store: DispatchStore = {
    async schedule(id) { const s = schedules.find((x) => x.id === id); return s ? { ...s } : null; },
    async client(id) { return id === "client-1" ? { id, archived_at: null, ...CLIENT } : null; },
    async competitorSet() { return { ...set }; },
    async competitiveReport() { return null; },
    async recordRedo(id) { writes.push(`redo ${id}`); },
    async reportRun(_table, id) { const r = tables.competitive.find((x) => x.id === id); return r ? { status: r.status, created_at: r.created_at ?? null, error: r.error ?? null, held: false } : null; },
    async pairedCompetitivePending() { return false; },
    async releaseHeldSocial(clientId) { writes.push(`release social ${clientId}`); },
    async webhooks() { return { social: "https://n8n.fixture/social", competitive: "https://n8n.fixture/competitive" }; },
    async insertCompetitiveReport(row) { const id = `comp-${++made}`; tables.competitive.push({ id, client_id: row.client_id, status: "running", set_id: row.set_id, created_at: row.created_at }); writes.push(`insert ${id}`); return id; },
    async insertSocialReport() { throw new Error("no social report is made here"); },
    async holdSocial(_c, reportId) { writes.push(`hold ${reportId}`); },
    async setAnalyzing(setId) { writes.push(`analyzing ${setId}`); },
    async dropReport(_table, id) { const i = tables.competitive.findIndex((x) => x.id === id && x.status !== "complete"); if (i >= 0) tables.competitive.splice(i, 1); writes.push(`drop ${id}`); },
    async releaseSet(setId) { writes.push(`release set ${setId}`); },
    async advance(schedule) { writes.push(`advance ${schedule.id}`); },
    async close(schedule) { writes.push(`close ${schedule.id}`); },
    async note(scheduleId, result) { const s = schedules.find((x) => x.id === scheduleId); if (s) s.last_result = result; writes.push(`note ${result ?? "-"}`); },
  };
  return { tables, store, writes };
}

const scheduledJob = (over: Partial<ScheduledJob> = {}): ScheduledJob => ({
  id: "job-competitive", kind: "dispatch", client_id: "client-1", schedule_id: "sched-competitive", occurrence: DUE,
  priority: 20, stagger_seconds: 0, status: "running", phase: null, report_id: null,
  attempts: 1, max_attempts: 3, available_at: DUE, lease_until: null, reason: null, result: null,
  created_at: DUE, started_at: DUE, finished_at: null, ...over,
});
const manualJob = (requestedAt: string, over: Partial<ScheduledJob> = {}): ScheduledJob => scheduledJob({
  id: "job-manual", schedule_id: null, occurrence: null, priority: 15, created_at: requestedAt,
  payload: { run: "manual", kind: "competitive", range: { start: "2026-10-12", end: "2026-11-10" }, requested_by: "user-1", requested_at: requestedAt },
  result: { range: { start: "2026-10-12", end: "2026-11-10" } }, ...over,
});

const appPipeline = (): PipelineDefinition => ({ ...REGISTRY.get("placeholder_competitive")!, name: "real_competitive", modes: ["shadow", "app"], appCapable: true });

function harness(w: ReturnType<typeof world>, opts: { engine?: "app" | "n8n"; appRun?: () => AppRunView | null; alert?: (text: string) => Promise<boolean> } = {}) {
  const starts: string[] = [];
  const posts: string[] = [];
  const checks: LandscapeCheck[] = [];
  const deps = (j: ScheduledJob): DispatchDeps => ({
    store: w.store,
    now: () => w.tables.clock,
    async post(url) { posts.push(url); return { ok: true, status: 200 }; },
    async buildSocialPayload() { return {}; },
    async buildCompetitivePayload(a) { return { report_id: a.reportId, set_id: a.set.id }; },
    // The real decision, on what the account holds now: the same one the pipeline's landscape step makes.
    // Recorded on the set as the worker records it (recordTrackingCheck): the one record every screen reads.
    async checkLandscape(_client, set) {
      const c = resolveSelectionLandscape(w.tables.landscapes as never, CLIENT, SELECTION, set.rivaliq_landscape_id);
      checks.push(c);
      const record = trackingCheckRecord(c, set.rivaliq_landscape_id, w.tables.clock);
      if (record) w.tables.set.tracking_check = record;
      return c;
    },
    async saveJob(patch) { Object.assign(j, JSON.parse(JSON.stringify(patch))); },
    async engine() { return opts.engine === "n8n" ? { engine: "n8n" as const } : { engine: "app" as const, pipeline: appPipeline() }; },
    async startPipeline(a) { starts.push(a.reportId); return { run_id: `run-${starts.length}` }; },
    async pipelineRun() { return opts.appRun ? opts.appRun() : null; },
    ...(opts.alert ? { alert: opts.alert } : {}),
  });
  /** One lease, written back the way the worker's finish() does. */
  const run = async (j: ScheduledJob): Promise<JobOutcome> => {
    const outcome = await runDispatch(j, deps(j));
    if (outcome.result !== undefined) j.result = outcome.result ?? null;
    j.status = outcome.status;
    if (outcome.available_at) j.available_at = outcome.available_at;
    return outcome;
  };
  return { starts, posts, checks, run };
}

const runsOf = (j: ScheduledJob) => ((j.result as DispatchMemory | null)?.runs ?? []) as DispatchRun[];

describe("a run that stops because the selection is not tracked waits for tracking", () => {
  for (const [what, outcome] of [
    ["the pipeline's landscape step stopped it at once", NOT_FOUND],
    // A run started under the earlier code, which tried the step five times first.
    ["the earlier code stopped it after its retries", `Step landscape did not finish in 5 tries: ${NOT_FOUND}`],
    ["the linked landscape no longer holds the selection", "TRACKING_SELECTION_MISMATCH: the selected landscape must track every confirmed competitor with the reviewed website exactly once."],
    ["the landscape no longer tracks the client as one company", "CLIENT_IDENTITY_UNVERIFIED: the selected landscape does not uniquely track the client website."],
  ] as const) {
    // With no landscape for the selection, setup is under way; with one that does not hold it, the selection is not covered.
    const code = outcome.includes("LANDSCAPE_NOT_FOUND") ? CLIENT_NOT_TRACKED : SELECTION_NOT_COVERED;
    it(`${what}: no retry is queued, the row is taken away, and the schedule says so`, async () => {
      const w = world();
      const alerts: string[] = [];
      w.tables.landscapes = [OWN_LANDSCAPE];
      const h = harness(w, { appRun: () => ({ status: "stopped", heartbeat_at: w.tables.clock.toISOString(), outcome }), alert: async (t) => { alerts.push(t); return true; } });
      const j = scheduledJob();
      expect(await h.run(j)).toMatchObject({ status: "waiting", reason: "The report is running." });
      expect(j).toMatchObject({ phase: "sent", report_id: "comp-1" });

      // The tracking went away while the run was going, a day and more later: past the alert's time too.
      w.tables.landscapes = [OLD_LANDSCAPE];
      w.tables.clock = minutes(26 * HOUR);
      const waiting = await h.run(j);

      expect(waiting.status).toBe("waiting");
      expect(waiting.reason).toMatch(new RegExp(`^${NEEDS_TRACKING}: `));
      // Nothing is queued: no time to run again, no attempt counted.
      expect(waiting.available_at).toBeUndefined();
      expect(waiting.deferred).toBeUndefined();
      expect(j).toMatchObject({ phase: null, report_id: null });
      expect(waiting.result).toMatchObject({ code, set_id: "set-1" });
      // A schedule's analysis covers its period as of the day it runs, so the period of the run that stopped is not kept.
      expect((waiting.result as DispatchMemory).range).toBeUndefined();
      // The run that did not finish is never shown, and never holds the social report.
      expect(w.tables.competitive).toEqual([]);
      expect(w.writes).toEqual(expect.arrayContaining(["drop comp-1", "release set set-1", "release social client-1"]));
      expect(w.tables.schedules[0].last_result).toMatch(new RegExp(`^${NEEDS_TRACKING}: `));
      const [run] = runsOf(j);
      expect(run).toMatchObject({ report_id: "comp-1", outcome: "stopped", end: "needs_tracking" });
      expect(endedForTracking(run)).toBe(true);
      // Waiting for tracking is not a report that is late: nobody is alerted, and no alert stays due.
      expect(alerts).toEqual([]);
      expect(waiting.result).not.toHaveProperty("alert_due_at");
      expect((waiting.result as DispatchMemory).tracking_wait_at).toBe(minutes(26 * HOUR).toISOString());
      expect(h.starts).toEqual(["comp-1"]);
    });
  }

  it("the n8n route waits the same way when the workflow stopped on the fact", async () => {
    const w = world();
    w.tables.landscapes = [OWN_LANDSCAPE];
    const h = harness(w, { engine: "n8n" });
    const j = scheduledJob();
    await h.run(j);
    expect(h.posts).toEqual(["https://n8n.fixture/competitive"]);
    Object.assign(w.tables.competitive[0], { status: "failed", error: NOT_FOUND });
    w.tables.clock = minutes(20);
    const waiting = await h.run(j);
    expect(waiting).toMatchObject({ status: "waiting", result: { code: CLIENT_NOT_TRACKED } });
    expect(waiting.reason).toMatch(new RegExp(`^${NEEDS_TRACKING}: `));
    expect(h.posts).toHaveLength(1);
  });

  it("a run that stopped on a check of the companies answer, or on an empty answer, is a fault made again as before, never a wait", async () => {
    for (const outcome of [
      "Step aggregate did not finish in 5 tries: CLIENT_IDENTITY_UNVERIFIED: the RivalIQ landscape must track exactly one company matching Northwind Bikes. A focus company is not automatically the client.",
      "Step landscape did not finish in 5 tries: NO_LANDSCAPES on this RivalIQ account",
    ]) {
      const w = world();
      w.tables.landscapes = [OWN_LANDSCAPE];
      const h = harness(w, { appRun: () => ({ status: "stopped", heartbeat_at: w.tables.clock.toISOString(), outcome }) });
      const j = scheduledJob();
      await h.run(j);
      w.tables.clock = minutes(40);
      expect(await h.run(j), outcome).toMatchObject({ status: "queued", deferred: true, available_at: minutes(40 + RETRY_FIRST_MINUTES).toISOString() });
      expect(endedForTracking(runsOf(j)[0])).toBe(false);
    }
  });

  it("a run that stopped for any other reason is still made again, as before", async () => {
    const w = world();
    w.tables.landscapes = [OWN_LANDSCAPE];
    const h = harness(w, { appRun: () => ({ status: "stopped", heartbeat_at: w.tables.clock.toISOString(), outcome: "Step posts did not finish in 5 tries: RivalIQ answered 502" }) });
    const j = scheduledJob();
    await h.run(j);
    w.tables.clock = minutes(40);
    const again = await h.run(j);
    expect(again).toMatchObject({ status: "queued", deferred: true, available_at: minutes(40 + RETRY_FIRST_MINUTES).toISOString() });
    expect(runsOf(j)[0]).toMatchObject({ outcome: "stopped", end: "app_stopped" });
    expect(endedForTracking(runsOf(j)[0])).toBe(false);
  });
});

describe("a job that was making the report again each day settles into the wait on its own", () => {
  // As the earlier code left it: a manual run asked for six days ago, eleven
  // runs that each stopped in the pipeline's landscape step, queued for its
  // next daily run with nothing prepared.
  const REQUESTED = minutes(-6 * 24 * HOUR).toISOString();
  const looping = (): ScheduledJob => {
    const runs: DispatchRun[] = Array.from({ length: 11 }, (_, i) => ({
      report_id: `old-${i + 1}`, started_at: minutes(-(11 - i) * 12 * HOUR).toISOString(), ended_at: minutes(-(11 - i) * 12 * HOUR + 34).toISOString(),
      outcome: "stopped", engine: "app", end: "app_stopped",
      note: `the in-app pipeline stopped (Step landscape did not finish in 5 tries: ${NOT_FOUND})`,
    }));
    return manualJob(REQUESTED, {
      status: "running", phase: null, report_id: null,
      result: { range: { start: "2026-10-12", end: "2026-11-10" }, runs, alerted_at: minutes(-5 * 24 * HOUR).toISOString() },
    });
  };

  it("its next lease checks tracking with the shared decision and waits: no report, no pipeline run, no time to run again", async () => {
    const w = world({ manual: true });
    const h = harness(w);
    const j = looping();
    const settled = await h.run(j);
    expect(settled.status).toBe("waiting");
    expect(settled.reason).toMatch(new RegExp(`^${NEEDS_TRACKING}: `));
    expect(settled.available_at).toBeUndefined();
    expect(settled.result).toMatchObject({ code: CLIENT_NOT_TRACKED, set_id: "set-1" });
    // A run a person asked for keeps the period they chose, however long it waits.
    expect((settled.result as DispatchMemory).range).toEqual({ start: "2026-10-12", end: "2026-11-10" });
    // The old landscape tracks the client alone: the check no longer takes it for tracking.
    expect(h.checks).toHaveLength(1);
    expect(h.checks[0]).toMatchObject({ ok: false, code: CLIENT_NOT_TRACKED });
    expect(h.starts).toEqual([]);
    expect(w.writes.filter((x) => x.startsWith("insert"))).toEqual([]);
    expect(j).toMatchObject({ phase: null, report_id: null });
    // What it did before is kept for the logs.
    expect(runsOf(j)).toHaveLength(11);
    expect(runsOf(j).every(endedForTracking)).toBe(true);
  });

  it("the daily look keeps it waiting and spends nothing, then starts the analysis once tracking is there", async () => {
    const w = world({ manual: true });
    const h = harness(w, { appRun: () => ({ status: "stopped", heartbeat_at: w.tables.clock.toISOString(), outcome: "Step posts did not finish in 5 tries: RivalIQ answered 502" }) });
    // Asked for at the time of the first lease here, so the window is still open at each look below.
    const j = manualJob(NOW.toISOString(), { result: looping().result });
    for (const day of [0, 1, 2]) {
      w.tables.clock = minutes(day * 24 * HOUR);
      expect((await h.run(j)).status).toBe("waiting");
    }
    expect(h.starts).toEqual([]);
    expect(w.tables.competitive).toEqual([]);

    // Tracking arrives: the selection's own landscape now holds the client and all three competitors.
    w.tables.landscapes = [OLD_LANDSCAPE, OWN_LANDSCAPE];
    w.tables.clock = minutes(3 * 24 * HOUR);
    const started = await h.run(j);
    expect(started).toMatchObject({ status: "waiting", reason: "The report is running." });
    expect(j).toMatchObject({ phase: "sent", report_id: "comp-1" });
    expect(h.starts).toEqual(["comp-1"]);

    // A fault in that run is tried again after the first wait: the runs that waited for tracking do not lengthen it.
    w.tables.clock = minutes(3 * 24 * HOUR + 40);
    const again = await h.run(j);
    expect(again).toMatchObject({ status: "queued", deferred: true, available_at: minutes(3 * 24 * HOUR + 40 + RETRY_FIRST_MINUTES).toISOString() });
  });

  it("ends quietly when its window closes with tracking still not there", async () => {
    const w = world({ manual: true });
    const h = harness(w);
    const j = looping();
    expect((await h.run(j)).status).toBe("waiting");
    w.tables.clock = new Date(Date.parse(REQUESTED) + MANUAL_RUN_DAYS * 24 * HOUR * 60_000 + 60_000);
    const closed = await h.run(j);
    expect(closed.status).toBe("skipped");
    expect(w.tables.competitive).toEqual([]);
    expect(h.starts).toEqual([]);
  });
});

describe("a run asked for while the selection is not tracked is a waiting run, never a loop", () => {
  for (const kind of ["manual", "scheduled"] as const) {
    it(`${kind}: every lease waits, and nothing is made or sent`, async () => {
      const w = world({ manual: kind === "manual" });
      const h = harness(w);
      const j = kind === "manual" ? manualJob(NOW.toISOString()) : scheduledJob();
      for (const day of [0, 1, 2, 3, 4]) {
        w.tables.clock = minutes(day * 24 * HOUR);
        const out = await h.run(j);
        expect(out.status).toBe("waiting");
        expect(out.reason).toMatch(new RegExp(`^${NEEDS_TRACKING}: `));
        expect(out.available_at).toBeUndefined();
      }
      expect(h.checks).toHaveLength(5);
      expect(h.starts).toEqual([]);
      expect(h.posts).toEqual([]);
      expect(w.tables.competitive).toEqual([]);
      expect(runsOf(j)).toEqual([]);
      if (kind === "scheduled") expect(w.tables.schedules[0].last_result).toMatch(new RegExp(`^${NEEDS_TRACKING}: `));
    });
  }
});

describe("a linked set never loses its link to a check", () => {
  // The set is linked to the old landscape, which holds the client and other
  // competitors: tracking that works (the feed reads it), but not for this
  // selection.
  it("a linked landscape missing a confirmed competitor: the analysis waits, the link is kept, and nothing is reset, made or sent", async () => {
    const partly = { ...OWN_LANDSCAPE, id: 501, companies: OWN_LANDSCAPE.companies.slice(0, 3) };
    for (const kind of ["manual", "scheduled"] as const) {
      const w = world({ manual: kind === "manual", linked: "501" });
      w.tables.landscapes = [partly];
      const h = harness(w);
      const j = kind === "manual" ? manualJob(NOW.toISOString()) : scheduledJob();
      for (const day of [0, 1, 2]) {
        w.tables.clock = minutes(day * 24 * HOUR);
        const out = await h.run(j);
        // Waiting, not blocked: nothing is broken, and nothing sets tracking up again.
        expect(out.status).toBe("waiting");
        expect(out.reason).toBe(`${NEEDS_TRACKING}: The RivalIQ landscape linked to Northwind Bikes's competitor set (501) does not hold the confirmed selection: it does not track Contoso Rides exactly once. The analysis waits until it does, and the link is kept as it is.`);
        expect(out.result).toMatchObject({ code: SELECTION_NOT_COVERED, set_id: "set-1" });
        expect(out.available_at).toBeUndefined();
      }
      // The record the lifecycle reads names no landscape as gone, so its one reset never fires (steps.test.ts).
      expect(w.tables.set.tracking_check).toMatchObject({ code: SELECTION_NOT_COVERED, landscape_id: "501", uncovered: { client: false, competitors: ["Contoso Rides"] } });
      expect(w.tables.set.tracking_check).not.toHaveProperty("gone");
      expect(recordedTracking(w.tables.set)).toEqual({ state: "not_covered", uncovered: { client: false, competitors: ["Contoso Rides"] } });
      expect(w.tables.set.rivaliq_landscape_id).toBe("501");
      expect(h.starts).toEqual([]);
      expect(h.posts).toEqual([]);
      expect(w.writes.filter((x) => !x.startsWith("note") && !x.startsWith("release social"))).toEqual([]);

      // Once the linked landscape holds the whole selection, the next daily look starts the analysis.
      w.tables.landscapes = [{ ...OWN_LANDSCAPE, id: 501 }];
      w.tables.clock = minutes(3 * 24 * HOUR);
      expect(await h.run(j)).toMatchObject({ status: "waiting", reason: "The report is running." });
      expect(recordedTracking(w.tables.set)).toEqual({ state: "tracked" });
      expect(h.starts).toEqual(["comp-1"]);
    }
  });

  it("a linked landscape that does not hold the client as one company waits the same way", async () => {
    const w = world({ linked: "501" });
    w.tables.landscapes = [{ ...OWN_LANDSCAPE, id: 501, companies: OWN_LANDSCAPE.companies.slice(1) }];
    const h = harness(w);
    const out = await h.run(scheduledJob());
    expect(out).toMatchObject({ status: "waiting", result: { code: SELECTION_NOT_COVERED } });
    expect(w.tables.set.tracking_check).toMatchObject({ code: SELECTION_NOT_COVERED, uncovered: { client: true } });
    expect(w.tables.set.tracking_check).not.toHaveProperty("gone");
  });

  it("a linked landscape that is not in a complete list is gone, as before: blocked, and recorded so the lifecycle starts tracking again", async () => {
    const w = world({ linked: "999" });
    w.tables.landscapes = [OLD_LANDSCAPE, OWN_LANDSCAPE];
    const h = harness(w);
    const out = await h.run(scheduledJob());
    expect(out.status).toBe("blocked");
    expect(out.reason).toMatch(new RegExp(`^${NEEDS_TRACKING}: The RivalIQ landscape linked to Northwind Bikes's competitor set \\(999\\) no longer exists\\.`));
    expect(out.result).toMatchObject({ code: LANDSCAPE_MISSING, set_id: "set-1" });
    expect(w.tables.set.tracking_check).toMatchObject({ code: LANDSCAPE_MISSING, landscape_id: "999", gone: true });
    expect(recordedTracking(w.tables.set)).toEqual({ state: "gone" });
    expect(h.starts).toEqual([]);
  });

  it("an answer that cannot be read concludes nothing: no wait for tracking, nothing recorded, the link and the record as they were", async () => {
    for (const landscapes of [[], null, { landscapes: [] }, [OLD_LANDSCAPE, { name: "no id" }], [{ id: 501, name: "TIER 1" }]]) {
      const w = world({ linked: "501" });
      const before = { code: "ok", landscape_id: "501", message: null, checked_at: "2026-11-10T07:00:00.000Z" };
      w.tables.set.tracking_check = before;
      w.tables.landscapes = landscapes;
      const h = harness(w);
      // Asked again shortly, as for a provider that could not be reached; a person looks once the attempts are used up.
      const first = await h.run(scheduledJob());
      expect(first, JSON.stringify(landscapes)).toMatchObject({ status: "queued" });
      expect(first.reason).not.toMatch(new RegExp(NEEDS_TRACKING));
      const last = await h.run(scheduledJob({ attempts: 3 }));
      expect(last).toMatchObject({ status: "blocked", result: { code: RIVALIQ_UNAVAILABLE } });
      expect(h.checks.every((c) => !c.ok && c.code === RIVALIQ_UNAVAILABLE)).toBe(true);
      expect(w.tables.set.tracking_check).toEqual(before);
      expect(recordedTracking(w.tables.set)).toEqual({ state: "tracked" });
      expect(h.starts).toEqual([]);
    }
  });
});

describe("waiting for tracking is never late", () => {
  const slack = () => { const sent: string[] = []; return { sent, alert: async (t: string) => { sent.push(t); return true; } }; };

  it("the day is counted from the first run made after the wait, not from a run that ended in it", async () => {
    const w = world();
    const s = slack();
    let app: AppRunView | null = null;
    w.tables.landscapes = [OWN_LANDSCAPE];
    const h = harness(w, { appRun: () => app, alert: s.alert });
    const j = scheduledJob();
    await h.run(j);
    expect((j.result as DispatchMemory).alert_due_at).toBe(minutes(24 * HOUR).toISOString());

    // The run stops on the fact two days in, long past the first run's day: a wait, not a late report.
    w.tables.landscapes = [OLD_LANDSCAPE];
    w.tables.clock = minutes(48 * HOUR);
    app = { status: "stopped", heartbeat_at: w.tables.clock.toISOString(), outcome: NOT_FOUND };
    expect((await h.run(j)).status).toBe("waiting");
    for (const day of [3, 4, 5]) {
      w.tables.clock = minutes(day * 24 * HOUR);
      expect((await h.run(j)).status).toBe("waiting");
    }
    expect(s.sent).toEqual([]);
    expect(j.result).not.toHaveProperty("alert_due_at");

    // Tracking arrives on day 6 and the analysis starts: its day begins now.
    w.tables.landscapes = [OWN_LANDSCAPE];
    w.tables.clock = minutes(6 * 24 * HOUR);
    app = null;
    expect(await h.run(j)).toMatchObject({ status: "waiting", reason: "The report is running." });
    expect((j.result as DispatchMemory).alert_due_at).toBe(minutes(7 * 24 * HOUR).toISOString());
    // Still going two hours later: not late, though the first run of all was six days ago.
    w.tables.clock = minutes(6 * 24 * HOUR + 2 * HOUR);
    app = { status: "running", heartbeat_at: w.tables.clock.toISOString(), outcome: null };
    expect(await h.run(j)).toMatchObject({ status: "waiting", reason: "The report is running." });
    expect(s.sent).toEqual([]);
    // Still going a day after it started: now it is late, once.
    w.tables.clock = minutes(7 * 24 * HOUR + 5);
    app = { status: "running", heartbeat_at: w.tables.clock.toISOString(), outcome: null };
    await h.run(j);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toContain("it is still running");
  });

  it("the job that was making the report again each day, never alerted: its eleven runs do not make it late now or after tracking arrives", async () => {
    const w = world({ manual: true });
    const s = slack();
    let app: AppRunView | null = null;
    const h = harness(w, { appRun: () => app, alert: s.alert });
    const runs: DispatchRun[] = Array.from({ length: 11 }, (_, i) => ({
      report_id: `old-${i + 1}`, started_at: minutes(-(11 - i) * 12 * HOUR).toISOString(), ended_at: minutes(-(11 - i) * 12 * HOUR + 34).toISOString(),
      outcome: "stopped", engine: "app", end: "app_stopped", note: `the in-app pipeline stopped (Step landscape did not finish in 5 tries: ${NOT_FOUND})`,
    }));
    // Queued early for an alert that was due, with its next run two hours on: that lease only looks at the alert.
    const retryAt = minutes(2 * HOUR).toISOString();
    const j = manualJob(NOW.toISOString(), { result: { range: { start: "2026-10-12", end: "2026-11-10" }, runs, alert_due_at: minutes(-HOUR).toISOString(), retry_at: retryAt } });
    expect(await h.run(j)).toMatchObject({ status: "queued", deferred: true, available_at: retryAt });
    expect(s.sent).toEqual([]);
    // Its next run's time: the check, and the wait.
    w.tables.clock = minutes(2 * HOUR);
    expect((await h.run(j)).status).toBe("waiting");
    expect(j.result).not.toHaveProperty("alert_due_at");
    expect(j.result).not.toHaveProperty("retry_at");
    // Tracking arrives; a run that is still going an hour in is not late.
    w.tables.landscapes = [OWN_LANDSCAPE];
    w.tables.clock = minutes(26 * HOUR);
    expect(await h.run(j)).toMatchObject({ status: "waiting", reason: "The report is running." });
    w.tables.clock = minutes(27 * HOUR);
    app = { status: "running", heartbeat_at: w.tables.clock.toISOString(), outcome: null };
    await h.run(j);
    expect(s.sent).toEqual([]);
  });
});
