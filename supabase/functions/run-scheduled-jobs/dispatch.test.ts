// @vitest-environment node
// Node, like the Deno runtime, has AbortSignal.timeout; jsdom does not.
import { describe, it, expect } from "vitest";
import { HELD_REDO_MINUTES, LAST_RUN_LEAD_MINUTES, makePoster, MANUAL_RUN_DAYS, manualRun, NEEDS_TRACKING, nextRunOfOccurrence, retryWaitMinutes, runDispatch, type DispatchDeps, type DispatchStore, type ScheduleRow } from "./dispatch";
import { HELD_REDOS } from "../_shared/competitive/reportEvidence";
import { RETRY_MINUTES } from "./worker";
import type { JobOutcome, ScheduledJob } from "./types";
import type { LandscapeCheck } from "../_shared/competitive/landscapeCheck";

// The behaviours QA-10, QA-11 and QA-04 in scripts/qa-backend.cjs checked
// against the old single-request scheduler, now checked against the queue's
// dispatch step, and the rule of 19 Oct: a report that does not finish runs
// again on its own and never shows as a run that did not finish.

const NOW = new Date("2026-10-07T07:20:00Z");
const DUE = "2026-10-07T07:00:00.000Z";
/** The schedule's next run after DUE: the occurrence's last moment. */
const NEXT = "2026-11-07T07:15:00.000Z";
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60000);

type Row = { id: string; client_id: string; status: string; date_range_start: string | null; date_range_end: string | null; set_id?: string; created_at?: string; error?: string; held?: boolean; created_by?: string | null };

function world(opts: { kinds?: Array<"competitive" | "social">; set?: boolean } = {}) {
  const kinds = opts.kinds ?? ["competitive", "social"];
  const schedules: Array<ScheduleRow & { last_result?: string | null; last_run_at?: string | null }> = kinds.map((kind) => ({
    id: `sched-${kind}`, client_id: "client-1", report_kind: kind, is_active: true, next_run_at: DUE,
    run_day_of_month: 7, frequency: "monthly", range_mode: "previous_month", created_by: "user-1", pending_competitive_report_id: null,
  }));
  const tables = {
    schedules,
    clients: [{ id: "client-1", name: "Fixture", archived_at: null as string | null }],
    sets: opts.set === false ? [] : [{ id: "set-1", client_id: "client-1", status: "complete" }],
    competitive: [{ id: "old-complete", client_id: "client-1", status: "complete", date_range_start: "2026-08-01", date_range_end: "2026-08-31", set_id: "set-1" }] as Row[],
    reports: [] as Row[],
    setStatus: {} as Record<string, string>,
    notes: [] as Array<{ id: string; result: string | null }>,
    /** Status of each schedule's dispatch job for its current occurrence. Both are enqueued together. */
    jobStatus: Object.fromEntries(kinds.map((kind) => [`sched-${kind}`, "queued"])) as Record<string, string>,
    /** Schedules whose job has made a run already (queued between runs). */
    retrying: new Set<string>(),
    /** Social jobs put back in the queue by releaseHeldSocial. */
    released: [] as string[],
    webhooks: { social: "https://n8n.fixture/social", competitive: "https://n8n.fixture/competitive" } as { social: string | null; competitive: string | null },
    clock: NOW,
  };
  const writes: string[] = [];
  /** Ids are never reused, as in the database, even after a row is taken away. */
  const made = { social: 0, competitive: 1 };
  const rows = (table: string) => (table === "reports" ? tables.reports : tables.competitive);
  const store: DispatchStore = {
    async schedule(id) { const s = tables.schedules.find((x) => x.id === id); return s ? { ...s } : null; },
    async client(id) { return tables.clients.find((c) => c.id === id) ?? null; },
    async competitorSet(clientId) { return tables.sets.find((s) => s.client_id === clientId) ?? null; },
    async competitiveReport(id, clientId) { return tables.competitive.find((r) => r.id === id && r.client_id === clientId) ?? null; },
    async reportRun(table, id) {
      const r = rows(table).find((x) => x.id === id);
      return r ? { status: r.status, created_at: r.created_at ?? null, error: r.error ?? null, held: !!r.held } : null;
    },
    async pairedCompetitivePending(clientId, now) {
      return tables.schedules.some((s) => s.client_id === clientId && s.report_kind === "competitive" && s.is_active && new Date(s.next_run_at) <= now
        && (tables.jobStatus[s.id] === undefined || tables.jobStatus[s.id] === "running" || (tables.jobStatus[s.id] === "queued" && !tables.retrying.has(s.id))));
    },
    async releaseHeldSocial(clientId) {
      for (const s of tables.schedules) {
        if (s.client_id === clientId && s.report_kind === "social" && s.is_active && !s.pending_competitive_report_id && tables.jobStatus[s.id] === "waiting") {
          tables.jobStatus[s.id] = "queued";
          tables.released.push(s.id);
        }
      }
      writes.push(`release social ${clientId}`);
    },
    async webhooks() { return tables.webhooks; },
    async insertCompetitiveReport(row) {
      const id = `comp-${made.competitive++}`;
      tables.competitive.push({ id, client_id: row.client_id, status: "running", date_range_start: row.date_range_start, date_range_end: row.date_range_end, set_id: row.set_id, created_at: row.created_at, created_by: row.created_by });
      writes.push(`insert competitive ${id}`);
      return id;
    },
    async insertSocialReport(row) {
      const id = `social-${made.social++}`;
      tables.reports.push({ id, client_id: row.client_id, status: "running", date_range_start: row.date_range_start, date_range_end: row.date_range_end, created_at: tables.clock.toISOString(), created_by: row.created_by });
      writes.push(`insert social ${id}`);
      return id;
    },
    async holdSocial(clientId, reportId, now) {
      for (const s of tables.schedules) {
        if (s.client_id === clientId && s.report_kind === "social" && s.is_active && new Date(s.next_run_at) <= now && !s.pending_competitive_report_id) {
          s.pending_competitive_report_id = reportId;
        }
      }
      writes.push(`hold ${reportId}`);
    },
    async setAnalyzing(setId) { tables.setStatus[setId] = "analyzing"; writes.push(`analyzing ${setId}`); },
    async dropReport(table, id) {
      if (table === "competitive_reports") for (const s of tables.schedules) if (s.pending_competitive_report_id === id) s.pending_competitive_report_id = null;
      const list = rows(table);
      const i = list.findIndex((x) => x.id === id && x.status !== "complete" && x.status !== "completed");
      if (i >= 0) list.splice(i, 1);
      writes.push(`drop ${table} ${id}`);
    },
    async releaseSet(setId) {
      if (["analyzing", "failed"].includes(tables.setStatus[setId])) tables.setStatus[setId] = tables.competitive.some((r) => r.set_id === setId && r.status === "complete") ? "complete" : "confirmed";
      writes.push(`release set ${setId}`);
    },
    async advance(schedule, nextRunAt, result) {
      const s = tables.schedules.find((x) => x.id === schedule.id)!;
      Object.assign(s, { next_run_at: nextRunAt, pending_competitive_report_id: null, last_result: result, last_run_at: tables.clock.toISOString() });
      tables.notes.push({ id: s.id, result });
      writes.push(`advance ${s.id}`);
    },
    async close(schedule, nextRunAt) {
      const s = tables.schedules.find((x) => x.id === schedule.id)!;
      Object.assign(s, { next_run_at: nextRunAt, pending_competitive_report_id: null, last_result: null });
      writes.push(`close ${s.id}`);
    },
    async note(scheduleId, result) {
      const s = tables.schedules.find((x) => x.id === scheduleId);
      if (s) s.last_result = result;
      tables.notes.push({ id: scheduleId, result });
      writes.push(`note ${scheduleId}`);
    },
  };
  return { tables, store, writes };
}

function jobFor(kind: "competitive" | "social", over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: `job-${kind}`, kind: "dispatch", client_id: "client-1", schedule_id: `sched-${kind}`, occurrence: DUE,
    priority: kind === "competitive" ? 20 : 30, stagger_seconds: 0, status: "running", phase: null, report_id: null,
    attempts: 1, max_attempts: 3, available_at: DUE, lease_until: null, reason: null, result: null,
    created_at: DUE, started_at: DUE, finished_at: null, ...over,
  };
}

const TRACKED: LandscapeCheck = {
  ok: true, linked: true,
  summary: { id: "ls-1", name: "Socialytics - Fixture - set-1", focus_company: "Fixture", is_match: true, client_company_id: "1", match_reason: "focus company", companies: [] },
  landscape: { id: "ls-1", name: "Socialytics - Fixture - set-1", focusCompanyId: 1, companies: [] },
};
const NOT_TRACKED: LandscapeCheck = { ok: false, code: "RIVALIQ_CLIENT_NOT_TRACKED", landscapeId: null, message: "No RivalIQ landscape tracks Fixture." };
const MISSING: LandscapeCheck = { ok: false, code: "RIVALIQ_LANDSCAPE_MISSING", landscapeId: "ls-gone", message: "The RivalIQ landscape linked to Fixture's competitor set (ls-gone) no longer exists." };
const BUSY: LandscapeCheck = { ok: false, code: "RIVALIQ_BUSY", status: 429, message: "RivalIQ cannot accept a new request yet." };

type Transport = "accept" | "reject" | "throw";

function harness(w: ReturnType<typeof world>, transport: Transport = "accept", opts: { onCompetitivePost?: () => void; dryRun?: boolean; tracking?: LandscapeCheck } = {}) {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const saved: Array<Record<string, unknown>> = [];
  const checks: string[] = [];
  let mode: Transport = transport;
  const deps = (job: ScheduledJob): DispatchDeps => ({
    store: w.store,
    now: () => w.tables.clock,
    dryRun: opts.dryRun,
    async post(url, body) {
      posts.push({ url, body: body as Record<string, unknown> });
      if (mode === "throw") throw new Error("Fixture network failure");
      if (url.endsWith("/competitive")) opts.onCompetitivePost?.();
      return mode === "reject" ? { ok: false, status: 503 } : { ok: true, status: 200 };
    },
    async buildSocialPayload(a) {
      const comp = a.competitiveReportId ? w.tables.competitive.find((r) => r.id === a.competitiveReportId) : w.tables.competitive.filter((r) => r.status === "complete").at(-1);
      return { report_id: a.reportId, client_id: a.client.id, date_range_start: a.range.start, date_range_end: a.range.end, competitive_report_id: comp?.id ?? null, stagger_seconds: a.staggerSeconds };
    },
    async buildCompetitivePayload(a) {
      return { report_id: a.reportId, set_id: a.set.id, attempt_started_at: a.attemptStartedAt, date_range_start: a.range.start, date_range_end: a.range.end, stagger_seconds: a.staggerSeconds };
    },
    async checkLandscape(client, set) { checks.push(`${client.id}:${set.id}`); return opts.tracking ?? TRACKED; },
    async saveJob(patch) { saved.push(patch); Object.assign(job, patch); },
  });
  /** One lease of the job, written back the way the worker's finish() does. */
  const run = async (job: ScheduledJob): Promise<JobOutcome> => {
    if (job.schedule_id) w.tables.jobStatus[job.schedule_id] = "running";
    const outcome = await runDispatch(job, deps(job));
    if (job.schedule_id && !opts.dryRun) {
      w.tables.jobStatus[job.schedule_id] = outcome.status;
      if (outcome.status === "queued" && Array.isArray((outcome.result as { runs?: unknown[] } | undefined)?.runs) && (outcome.result as { runs: unknown[] }).runs.length) w.tables.retrying.add(job.schedule_id);
    }
    if (outcome.result !== undefined) job.result = outcome.result ?? null;
    job.status = outcome.status;
    return outcome;
  };
  return { posts, saved, checks, run, setTransport: (t: Transport) => { mode = t; } };
}

describe("runDispatch", () => {
  for (const order of [["competitive", "social"], ["social", "competitive"]] as const) {
    it(`holds social until a fresh competitive report completes (${order.join(" then ")})`, async () => {
      const w = world();
      const h = harness(w);
      const jobs = { competitive: jobFor("competitive"), social: jobFor("social") };
      const outcomes = [];
      for (const kind of order) outcomes.push([kind, await h.run(jobs[kind])] as const);
      // Only the competitive request went out; the social report is held.
      expect(h.posts.map((p) => p.url)).toEqual(["https://n8n.fixture/competitive"]);
      const comp = w.tables.competitive.at(-1)!;
      expect(comp.status).toBe("running");
      expect(jobs.competitive.phase).toBe("sent");
      const social = w.tables.schedules.find((s) => s.report_kind === "social")!;
      expect(social.next_run_at).toBe(DUE);
      // Either way the social schedule ends up pinned to the fresh competitive report.
      expect(outcomes.find(([k]) => k === "social")![1].status).toBe("waiting");
      expect(social.pending_competitive_report_id).toBe(comp.id);
      // The competitive report completes; the social job runs again and posts against it.
      comp.status = "complete";
      comp.date_range_start = "2026-09-01"; comp.date_range_end = "2026-09-30";
      expect((await h.run(jobs.competitive)).status).toBe("done");
      const sent = await h.run(jobs.social);
      expect(sent.status).toBe("waiting");
      const post = h.posts.find((p) => p.url.endsWith("/social"))!;
      expect(post.body.competitive_report_id).toBe(comp.id);
      // The schedule moves on only once the social report itself exists.
      expect(w.tables.schedules.find((s) => s.report_kind === "social")!.next_run_at).toBe(DUE);
      w.tables.reports.at(-1)!.status = "completed";
      expect((await h.run(jobs.social)).status).toBe("done");
      expect(w.tables.schedules.find((s) => s.report_kind === "social")!.next_run_at).toBe(NEXT);
      expect(w.tables.schedules.find((s) => s.report_kind === "competitive")!.next_run_at).toBe(NEXT);
    });
  }

  it("runs a social-only schedule against the latest complete competitive report", async () => {
    const w = world({ kinds: ["social"] });
    const h = harness(w);
    const r = await h.run(jobFor("social"));
    expect(r.status).toBe("waiting");
    expect(r.reason).toBe("The report is running.");
    expect(h.posts[0].body.competitive_report_id).toBe("old-complete");
    expect(h.posts[0].body.date_range_start).toBe("2026-09-01");
    expect(w.tables.schedules[0].last_result).toBe("The report is running.");
  });

  it("uses a competitive report that completed before the social job ran", async () => {
    const w = world();
    const h = harness(w, "accept", { onCompetitivePost: () => { const c = w.tables.competitive.at(-1)!; c.status = "complete"; } });
    await h.run(jobFor("competitive"));
    const social = await h.run(jobFor("social"));
    expect(social.status).toBe("waiting");
    expect(h.posts.map((p) => p.url)).toEqual(["https://n8n.fixture/competitive", "https://n8n.fixture/social"]);
    expect(h.posts[1].body.competitive_report_id).toBe(w.tables.competitive.at(-1)!.id);
  });

  it("never holds the social report for a client with no competitor set", async () => {
    const w = world({ set: false });
    const h = harness(w);
    const comp = await h.run(jobFor("competitive"));
    const social = await h.run(jobFor("social"));
    expect(comp.status).toBe("waiting");
    expect(h.checks).toHaveLength(0);
    expect(w.tables.competitive.map((r) => r.id)).toEqual(["old-complete"]);
    // The competitive schedule stays due for its daily recheck; the social report goes out.
    expect(social.status).toBe("waiting");
    expect(h.posts.map((p) => p.url)).toEqual(["https://n8n.fixture/social"]);
    expect(w.tables.schedules.find((s) => s.report_kind === "competitive")!.next_run_at).toBe(DUE);
    expect(w.tables.notes.map((n) => n.result)).toContain("Waiting for a confirmed competitor set. The paired social report goes ahead without it.");
  });

  it("goes ahead with the social report when its competitive report did not finish", async () => {
    const w = world();
    const h = harness(w);
    await h.run(jobFor("competitive"));
    const stopped = w.tables.competitive.at(-1)!;
    stopped.status = "failed";
    const social = jobFor("social");
    expect((await h.run(social)).status).toBe("waiting");
    expect(social.result?.competitive_report_skipped).toBe(stopped.id);
    expect(w.tables.reports).toHaveLength(1);
    // Built on the latest complete analysis, never on the one that stopped.
    const post = h.posts.find((p) => p.url.endsWith("/social"))!;
    expect(post.body.competitive_report_id).toBe("old-complete");
    w.tables.reports[0].status = "completed";
    expect((await h.run(social)).status).toBe("done");
    const schedule = w.tables.schedules.find((s) => s.report_kind === "social")!;
    expect(schedule.next_run_at).toBe(NEXT);
    expect(schedule.pending_competitive_report_id).toBeNull();
  });

  it("goes ahead with the social report when its pinned competitive report is gone", async () => {
    const w = world({ kinds: ["social"] });
    w.tables.schedules[0].pending_competitive_report_id = "deleted-report";
    const h = harness(w);
    expect((await h.run(jobFor("social"))).status).toBe("waiting");
    expect(h.posts[0].body.competitive_report_id).toBe("old-complete");
  });

  it("waits, without blocking, while the pinned competitive report is still running", async () => {
    const w = world();
    const h = harness(w);
    await h.run(jobFor("competitive"));
    const social = await h.run(jobFor("social"));
    expect(social.status).toBe("waiting");
    expect(social.reason).toMatch(/to finish/);
  });

  for (const [label, tracking, status] of [["not set up", NOT_TRACKED, "waiting"], ["linked landscape missing", MISSING, "blocked"]] as const) {
    it(`records needs tracking and creates no competitive report when RivalIQ tracking is ${label}`, async () => {
      const w = world();
      const h = harness(w, "accept", { tracking });
      const comp = await h.run(jobFor("competitive"));
      expect(comp.status).toBe(status);
      expect(comp.result?.code).toBe(tracking.ok ? undefined : tracking.code);
      expect(comp.reason).toMatch(new RegExp(`^${NEEDS_TRACKING}: `));
      expect(w.tables.notes.find((n) => n.id === "sched-competitive")!.result).toMatch(new RegExp(`^${NEEDS_TRACKING}: `));
      expect(w.tables.competitive.map((r) => r.id)).toEqual(["old-complete"]);
      expect(w.writes.filter((x) => /insert competitive|hold |analyzing /.test(x))).toEqual([]);
      expect(h.posts).toHaveLength(0);
      // The competitive schedule is not advanced, so it is checked again; the social report is not held.
      expect(w.tables.schedules.find((s) => s.report_kind === "competitive")!.next_run_at).toBe(DUE);
      expect((await h.run(jobFor("social"))).status).toBe("waiting");
      expect(h.posts.map((p) => p.url)).toEqual(["https://n8n.fixture/social"]);
    });
  }

  it("releases a social report that started waiting before the competitive check said no", async () => {
    const w = world();
    const h = harness(w, "accept", { tracking: NOT_TRACKED });
    const first = await h.run(jobFor("social"));
    expect(first.status).toBe("waiting");
    await h.run(jobFor("competitive"));
    expect(w.tables.released).toEqual(["sched-social"]);
    await h.run(jobFor("social"));
    expect(h.posts.map((p) => p.url)).toEqual(["https://n8n.fixture/social"]);
  });

  it("retries a RivalIQ check that could not be made, then blocks and lets the social report go", async () => {
    const w = world();
    const h = harness(w, "accept", { tracking: BUSY });
    const first = await h.run(jobFor("competitive", { attempts: 1 }));
    expect(first.status).toBe("queued");
    expect(first.available_at).toBe(new Date(NOW.getTime() + RETRY_MINUTES * 60000).toISOString());
    // A queued competitive job may still start, so the social report waits for it.
    expect((await h.run(jobFor("social"))).status).toBe("waiting");
    const last = await h.run(jobFor("competitive", { attempts: 3 }));
    expect(last.status).toBe("blocked");
    expect(w.tables.competitive.map((r) => r.id)).toEqual(["old-complete"]);
    expect(w.tables.released).toEqual(["sched-social"]);
    await h.run(jobFor("social"));
    expect(h.posts.map((p) => p.url)).toEqual(["https://n8n.fixture/social"]);
  });

  it("does not repeat the tracking check when it resumes a prepared competitive report", async () => {
    const w = world({ kinds: ["competitive"] });
    w.tables.competitive.push({ id: "comp-1", client_id: "client-1", status: "running", date_range_start: "2026-09-01", date_range_end: "2026-09-30", set_id: "set-1", created_at: "2026-10-07T07:16:00.000Z" });
    const h = harness(w, "accept", { tracking: NOT_TRACKED });
    const r = await h.run(jobFor("competitive", { phase: "prepared", report_id: "comp-1", attempts: 2, result: { set_id: "set-1", attempt_started_at: "2026-10-07T07:16:00.000Z", range: { start: "2026-09-01", end: "2026-09-30" } } }));
    expect(r.status).toBe("waiting");
    expect(h.checks).toHaveLength(0);
  });

  it("keeps the competitive report period when the social report is released later", async () => {
    const w = world();
    const h = harness(w);
    await h.run(jobFor("competitive"));
    const comp = w.tables.competitive.at(-1)!;
    Object.assign(comp, { status: "complete", date_range_start: "2026-07-01", date_range_end: "2026-07-31" });
    await h.run(jobFor("social"));
    const post = h.posts.find((p) => p.url.endsWith("/social"))!;
    expect([post.body.date_range_start, post.body.date_range_end]).toEqual(["2026-07-01", "2026-07-31"]);
  });

  it("records each phase before the step that needs it", async () => {
    const w = world({ kinds: ["competitive"] });
    const h = harness(w);
    const job = jobFor("competitive", { stagger_seconds: 150 });
    const r = await h.run(job);
    expect(r.status).toBe("waiting");
    expect(h.saved.map((s) => s.phase)).toEqual(["prepared", "posting", "sent"]);
    expect(h.saved[0].report_id).toBe(w.tables.competitive.at(-1)!.id);
    expect(h.posts[0].body.stagger_seconds).toBe(150);
    expect(h.posts[0].body.attempt_started_at).toBe(w.tables.competitive.at(-1)!.created_at);
    expect(job.report_id).toBe(w.tables.competitive.at(-1)!.id);
  });

  it("reuses the report a job prepared before it was interrupted", async () => {
    const w = world({ kinds: ["social"] });
    w.tables.reports.push({ id: "social-0", client_id: "client-1", status: "running", date_range_start: "2026-09-01", date_range_end: "2026-09-30", created_at: DUE });
    const h = harness(w);
    const r = await h.run(jobFor("social", { phase: "prepared", report_id: "social-0", attempts: 2, result: { range: { start: "2026-09-01", end: "2026-09-30" } } }));
    expect(r.status).toBe("waiting");
    expect(w.tables.reports).toHaveLength(1);
    expect(h.posts[0].body.report_id).toBe("social-0");
  });

  it("starts over with a new report when the prepared one was closed meanwhile, and takes the closed one away", async () => {
    const w = world({ kinds: ["social"] });
    w.tables.reports.push({ id: "social-closed", client_id: "client-1", status: "failed", date_range_start: "2026-09-01", date_range_end: "2026-09-30", created_at: DUE });
    const h = harness(w);
    const r = await h.run(jobFor("social", { phase: "prepared", report_id: "social-closed", attempts: 2 }));
    expect(r.status).toBe("waiting");
    expect(w.tables.reports.map((x) => x.id)).toEqual(["social-0"]);
    expect(h.posts[0].body.report_id).toBe("social-0");
  });

  it("pins the social report again when a prepared competitive dispatch resumes", async () => {
    const w = world();
    w.tables.competitive.push({ id: "comp-1", client_id: "client-1", status: "running", date_range_start: "2026-09-01", date_range_end: "2026-09-30", set_id: "set-1", created_at: "2026-10-07T07:16:00.000Z" });
    const h = harness(w);
    const r = await h.run(jobFor("competitive", { phase: "prepared", report_id: "comp-1", attempts: 2, result: { set_id: "set-1", attempt_started_at: "2026-10-07T07:16:00.000Z", range: { start: "2026-09-01", end: "2026-09-30" } } }));
    expect(r.status).toBe("waiting");
    expect(w.tables.competitive).toHaveLength(2);
    expect(w.tables.schedules.find((s) => s.report_kind === "social")!.pending_competitive_report_id).toBe("comp-1");
    expect(h.posts[0].body.attempt_started_at).toBe("2026-10-07T07:16:00.000Z");
  });

  it("blocks without creating a report when it keeps stopping before the request", async () => {
    const w = world({ kinds: ["social"] });
    const h = harness(w);
    const r = await h.run(jobFor("social", { attempts: 4 }));
    expect(r.status).toBe("blocked");
    expect(w.tables.reports).toHaveLength(0);
    expect(h.posts).toHaveLength(0);
  });

  it("skips a schedule that was turned off, archived or moved on", async () => {
    const off = world({ kinds: ["social"] });
    off.tables.schedules[0].is_active = false;
    expect((await harness(off).run(jobFor("social"))).status).toBe("skipped");
    const archived = world({ kinds: ["social"] });
    archived.tables.clients[0].archived_at = "2026-10-01";
    expect((await harness(archived).run(jobFor("social"))).status).toBe("skipped");
    const moved = world({ kinds: ["social"] });
    moved.tables.schedules[0].next_run_at = NEXT;
    const r = await harness(moved).run(jobFor("social"));
    expect(r.status).toBe("skipped");
    expect(moved.tables.reports).toHaveLength(0);
  });

  it("blocks, without a report, when a webhook URL is missing", async () => {
    const w = world({ kinds: ["social"] });
    w.tables.webhooks.social = null;
    const r = await harness(w).run(jobFor("social"));
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/not configured/);
    expect(w.tables.reports).toHaveLength(0);
  });

  it("dry run builds every payload and writes nothing", async () => {
    const w = world();
    const h = harness(w, "accept", { dryRun: true });
    const comp = await h.run(jobFor("competitive"));
    const social = await h.run(jobFor("social"));
    expect(w.writes).toEqual([]);
    expect(h.posts).toHaveLength(0);
    expect(h.saved).toHaveLength(0);
    expect(comp.result?.payload_keys).toContain("set_id");
    // The social report would wait for the competitive analysis, and its payload still builds.
    expect(social.status).toBe("waiting");
    expect(social.result?.payload_keys).toContain("competitive_report_id");
  });
});

describe("a report that does not finish", () => {
  it("waits 30 minutes after the first run, doubling each time, at most a day", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 12].map(retryWaitMinutes)).toEqual([30, 60, 120, 240, 480, 960, 1440, 1440]);
    expect(nextRunOfOccurrence(1, NOW, NEXT)!.toISOString()).toBe(at(30).toISOString());
    // The last run starts in time to finish before the schedule's next run.
    const late = new Date(Date.parse(NEXT) - 5 * 3_600_000);
    expect(nextRunOfOccurrence(9, late, NEXT)!.toISOString()).toBe(new Date(Date.parse(NEXT) - LAST_RUN_LEAD_MINUTES * 60000).toISOString());
    expect(nextRunOfOccurrence(9, new Date(Date.parse(NEXT) - 2 * 3_600_000), NEXT)).toBeNull();
  });

  it("is taken away and runs again when the workflow reports it did not finish", async () => {
    const w = world({ kinds: ["social"] });
    const h = harness(w);
    const job = jobFor("social");
    expect((await h.run(job)).status).toBe("waiting");
    const first = w.tables.reports[0];
    first.status = "failed";
    first.error = "Sprout answered 502";
    const again = await h.run(job);
    // Nothing shows a run that did not finish, and the schedule keeps waiting on this occurrence.
    expect(w.tables.reports).toHaveLength(0);
    expect(again).toMatchObject({ status: "queued", deferred: true, available_at: at(30).toISOString() });
    expect(job.phase).toBeNull();
    expect(job.report_id).toBeNull();
    expect(w.tables.schedules[0]).toMatchObject({ next_run_at: DUE, last_result: null });
    expect(JSON.stringify(job.result)).toMatch(/Sprout answered 502/);
    // The next run makes a new report, for the same period; once it exists the schedule moves on.
    w.tables.clock = at(31);
    expect((await h.run(job)).status).toBe("waiting");
    expect(w.tables.reports.map((r) => r.id)).toEqual(["social-1"]);
    expect(h.posts.map((p) => p.body.date_range_start)).toEqual(["2026-09-01", "2026-09-01"]);
    w.tables.reports[0].status = "completed";
    expect((await h.run(job)).status).toBe("done");
    expect(w.tables.schedules[0]).toMatchObject({ next_run_at: NEXT, last_result: "The report ran." });
    expect((job.result as { runs: Array<{ outcome: string }> }).runs.map((r) => r.outcome)).toEqual(["stopped", "ran"]);
  });

  it("is taken away and runs again when the workflow stops answering for 90 minutes", async () => {
    const w = world({ kinds: ["social"] });
    const h = harness(w);
    const job = jobFor("social");
    await h.run(job);
    w.tables.clock = at(60);
    expect((await h.run(job)).status).toBe("waiting");
    expect(w.tables.reports).toHaveLength(1);
    w.tables.clock = at(91);
    const again = await h.run(job);
    expect(again.status).toBe("queued");
    expect(w.tables.reports).toHaveLength(0);
  });

  it("runs again later when the workflow refuses the request", async () => {
    const w = world({ kinds: ["social"] });
    const h = harness(w, "reject");
    const r = await h.run(jobFor("social"));
    expect(r).toMatchObject({ status: "queued", available_at: at(30).toISOString() });
    expect(w.tables.reports).toHaveLength(0);
    expect(w.tables.schedules[0].next_run_at).toBe(DUE);
    expect(w.tables.notes.some((n) => /error|fail/i.test(n.result ?? ""))).toBe(false);
  });

  it("sends an unanswered request again for the same report, never making a second one", async () => {
    const w = world({ kinds: ["social"] });
    const h = harness(w, "throw");
    const job = jobFor("social");
    const r = await h.run(job);
    expect(r).toMatchObject({ status: "queued", available_at: at(RETRY_MINUTES).toISOString(), deferred: true });
    expect(job.phase).toBe("posting");
    expect(w.tables.reports).toHaveLength(1);
    h.setTransport("accept");
    w.tables.clock = at(RETRY_MINUTES);
    expect((await h.run(job)).status).toBe("waiting");
    expect(w.tables.reports).toHaveLength(1);
    expect(h.posts.map((p) => p.body.report_id)).toEqual(["social-0", "social-0"]);
    expect(job.phase).toBe("sent");
  });

  it("does not send again when the interrupted request's report already finished", async () => {
    const w = world({ kinds: ["social"] });
    w.tables.reports.push({ id: "social-0", client_id: "client-1", status: "completed", date_range_start: "2026-09-01", date_range_end: "2026-09-30", created_at: DUE });
    const h = harness(w);
    const r = await h.run(jobFor("social", { phase: "posting", report_id: "social-0", attempts: 2, result: { range: { start: "2026-09-01", end: "2026-09-30" }, runs: [{ report_id: "social-0", started_at: DUE }] } }));
    expect(r.status).toBe("done");
    expect(h.posts).toHaveLength(0);
    expect(w.tables.schedules[0].next_run_at).toBe(NEXT);
  });

  it("unpins and releases the social report when a competitive run does not finish", async () => {
    const w = world();
    const h = harness(w);
    const comp = jobFor("competitive");
    await h.run(comp);
    const social = jobFor("social");
    expect((await h.run(social)).status).toBe("waiting");
    w.tables.competitive.at(-1)!.status = "failed";
    expect((await h.run(comp)).status).toBe("queued");
    expect(w.tables.competitive.map((r) => r.id)).toEqual(["old-complete"]);
    expect(w.tables.setStatus["set-1"]).toBe("complete");
    expect(w.tables.schedules.find((s) => s.report_kind === "social")!.pending_competitive_report_id).toBeNull();
    expect(w.tables.released).toEqual(["sched-social"]);
    // A competitive job between runs never holds the social report.
    expect((await h.run(social)).status).toBe("waiting");
    expect(h.posts.at(-1)!.url).toBe("https://n8n.fixture/social");
    expect(h.posts.at(-1)!.body.competitive_report_id).toBe("old-complete");
  });

  it("closes quietly when no run fits before the schedule's next run, and that run takes over", async () => {
    const w = world({ kinds: ["social"] });
    const h = harness(w);
    const job = jobFor("social");
    w.tables.clock = new Date(Date.parse(NEXT) - 2 * 3_600_000);
    await h.run(job);
    w.tables.reports[0].status = "failed";
    const r = await h.run(job);
    expect(r.status).toBe("skipped");
    expect(w.tables.reports).toHaveLength(0);
    expect(w.tables.schedules[0]).toMatchObject({ next_run_at: NEXT, last_result: null });
    expect(w.writes).toContain("close sched-social");
  });

  it("runs again when the worker keeps stopping after the report was made", async () => {
    const w = world({ kinds: ["social"] });
    w.tables.reports.push({ id: "social-0", client_id: "client-1", status: "running", date_range_start: "2026-09-01", date_range_end: "2026-09-30", created_at: DUE });
    const h = harness(w);
    const r = await h.run(jobFor("social", { phase: "prepared", report_id: "social-0", attempts: 4, result: { range: { start: "2026-09-01", end: "2026-09-30" }, runs: [{ report_id: "social-0", started_at: DUE }] } }));
    expect(r.status).toBe("queued");
    expect(w.tables.reports).toHaveLength(0);
    expect(w.tables.schedules[0].next_run_at).toBe(DUE);
  });
});

describe("makePoster", () => {
  it("sends the workflow secret with every dispatch", async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const post = makePoster("the-secret", async (url, init) => { seen.push({ url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) }); return new Response("{}", { status: 200 }); });
    const r = await post("https://n8n.fixture/social", { a: 1 });
    expect(r).toEqual({ ok: true, status: 200 });
    expect(seen[0].headers["X-Socialytics-Secret"]).toBe("the-secret");
    expect(JSON.parse(seen[0].body)).toEqual({ a: 1 });
  });
});

/** A run a person asked for: a dispatch job with no schedule, its kind and period on the payload (run-report). */
function manualJob(kind: "competitive" | "social", over: Partial<ScheduledJob> = {}): ScheduledJob {
  return jobFor(kind, {
    id: `manual-${kind}`, schedule_id: null, occurrence: null, priority: 15, created_at: NOW.toISOString(),
    payload: { run: "manual", kind, range: { start: "2026-08-01", end: "2026-08-31" }, requested_by: "person-1", requested_at: NOW.toISOString(), ...(kind === "social" ? { skip_trends: true } : {}) },
    result: { range: { start: "2026-08-01", end: "2026-08-31" } },
    ...over,
  });
}

describe("a manual run follows the scheduled path", () => {
  it("reads only a well-formed manual payload", () => {
    expect(manualRun(manualJob("social"))).toMatchObject({ kind: "social", range: { start: "2026-08-01", end: "2026-08-31" }, requested_by: "person-1" });
    expect(manualRun(jobFor("social"))).toBeNull();
    expect(manualRun({ schedule_id: null, created_at: DUE, payload: { run: "manual", kind: "other", range: { start: "a", end: "b" } } })).toBeNull();
  });

  it("makes the person's report for their period and touches no schedule", async () => {
    const w = world();
    const h = harness(w);
    const job = manualJob("social");
    expect((await h.run(job)).status).toBe("waiting");
    const report = w.tables.reports[0];
    expect(report).toMatchObject({ date_range_start: "2026-08-01", date_range_end: "2026-08-31", created_by: "person-1" });
    expect(h.posts[0].body).toMatchObject({ report_id: report.id, date_range_start: "2026-08-01" });
    report.status = "completed";
    expect((await h.run(job)).status).toBe("done");
    // No schedule moved, was noted or was held for it.
    expect(w.tables.schedules.map((s) => s.next_run_at)).toEqual([DUE, DUE]);
    expect(w.tables.notes).toEqual([]);
    expect(w.writes.filter((x) => /advance|close|note|hold/.test(x))).toEqual([]);
  });

  it("runs again on its own when it does not finish, as a schedule's run does", async () => {
    const w = world({ kinds: ["social"] });
    const h = harness(w);
    const job = manualJob("social");
    await h.run(job);
    w.tables.reports[0].status = "failed";
    const again = await h.run(job);
    expect(again).toMatchObject({ status: "queued", deferred: true, available_at: at(30).toISOString() });
    expect(w.tables.reports).toHaveLength(0);
    w.tables.clock = at(31);
    expect((await h.run(job)).status).toBe("waiting");
    expect(w.tables.reports).toHaveLength(1);
  });

  it("waits for tracking without noting a schedule, and ends quietly when its window has passed", async () => {
    const w = world({ kinds: ["competitive"] });
    const h = harness(w, "accept", { tracking: NOT_TRACKED });
    const job = manualJob("competitive");
    const waiting = await h.run(job);
    expect(waiting.status).toBe("waiting");
    expect(w.tables.competitive.map((r) => r.id)).toEqual(["old-complete"]);
    expect(w.tables.notes).toEqual([]);
    w.tables.clock = new Date(NOW.getTime() + MANUAL_RUN_DAYS * 86_400_000);
    expect((await h.run(job)).status).toBe("skipped");
  });

  it("does not hold the due social report for a manual competitive analysis", async () => {
    const w = world();
    const h = harness(w);
    expect((await h.run(manualJob("competitive"))).status).toBe("waiting");
    expect(w.tables.schedules.find((s) => s.report_kind === "social")!.pending_competitive_report_id).toBeNull();
  });
});

describe("a held competitive analysis", () => {
  it(`is made again once a day, ${HELD_REDOS} times, and then the schedule moves on`, async () => {
    const w = world({ kinds: ["competitive"] });
    const h = harness(w);
    const job = jobFor("competitive");
    for (let redo = 1; redo <= HELD_REDOS; redo++) {
      expect((await h.run(job)).status).toBe("waiting");
      const run = w.tables.competitive.at(-1)!;
      Object.assign(run, { status: "complete", held: true });
      const again = await h.run(job);
      // Kept for staff; the schedule waits on the occurrence; the next run is a day later.
      expect(again).toMatchObject({ status: "queued", deferred: true, available_at: new Date(w.tables.clock.getTime() + HELD_REDO_MINUTES * 60000).toISOString() });
      expect(w.tables.competitive.some((r) => r.id === run.id)).toBe(true);
      expect(w.tables.schedules[0].next_run_at).toBe(DUE);
      expect(job.report_id).toBeNull();
      w.tables.clock = new Date(w.tables.clock.getTime() + HELD_REDO_MINUTES * 60000);
    }
    expect((await h.run(job)).status).toBe("waiting");
    Object.assign(w.tables.competitive.at(-1)!, { status: "complete", held: true });
    expect((await h.run(job)).status).toBe("done");
    expect(w.tables.schedules[0].next_run_at).toBe(NEXT);
    expect((job.result as { runs: Array<{ outcome: string }> }).runs.map((r) => r.outcome)).toEqual(new Array(HELD_REDOS + 1).fill("held"));
  });

  it("ends the redos as soon as a run passes its checks", async () => {
    const w = world({ kinds: ["competitive"] });
    const h = harness(w);
    const job = jobFor("competitive");
    await h.run(job);
    Object.assign(w.tables.competitive.at(-1)!, { status: "complete", held: true });
    expect((await h.run(job)).status).toBe("queued");
    w.tables.clock = new Date(w.tables.clock.getTime() + HELD_REDO_MINUTES * 60000);
    await h.run(job);
    w.tables.competitive.at(-1)!.status = "complete";
    expect((await h.run(job)).status).toBe("done");
    expect((job.result as { runs: Array<{ outcome: string }> }).runs.map((r) => r.outcome)).toEqual(["held", "ran"]);
  });
});
