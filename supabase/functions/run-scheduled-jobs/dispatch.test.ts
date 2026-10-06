import { describe, it, expect } from "vitest";
import { makePoster, runDispatch, type DispatchDeps, type DispatchStore, type ScheduleRow } from "./dispatch";
import type { ScheduledJob } from "./types";

// The behaviours QA-10, QA-11 and QA-04 in scripts/qa-backend.cjs checked
// against the old single-request scheduler, now checked against the queue's
// dispatch step.

const NOW = new Date("2026-10-07T07:20:00Z");
const DUE = "2026-10-07T07:00:00.000Z";

function world(opts: { kinds?: Array<"competitive" | "social">; set?: boolean } = {}) {
  const kinds = opts.kinds ?? ["competitive", "social"];
  const schedules: ScheduleRow[] = kinds.map((kind) => ({
    id: `sched-${kind}`, client_id: "client-1", report_kind: kind, is_active: true, next_run_at: DUE,
    run_day_of_month: 7, frequency: "monthly", range_mode: "previous_month", created_by: "user-1", pending_competitive_report_id: null,
  }));
  const tables = {
    schedules,
    clients: [{ id: "client-1", name: "Fixture", archived_at: null as string | null }],
    sets: opts.set === false ? [] : [{ id: "set-1", client_id: "client-1", status: "complete" }],
    competitive: [{ id: "old-complete", client_id: "client-1", status: "complete", date_range_start: "2026-08-01", date_range_end: "2026-08-31" }] as Array<{ id: string; client_id: string; status: string; date_range_start: string | null; date_range_end: string | null; set_id?: string; created_at?: string }>,
    reports: [] as Array<{ id: string; client_id: string; status: string; date_range_start: string; date_range_end: string; error?: string }>,
    setStatus: {} as Record<string, string>,
    notes: [] as Array<{ id: string; result: string }>,
    webhooks: { social: "https://n8n.fixture/social", competitive: "https://n8n.fixture/competitive" } as { social: string | null; competitive: string | null },
  };
  const writes: string[] = [];
  const store: DispatchStore = {
    async schedule(id) { const s = tables.schedules.find((x) => x.id === id); return s ? { ...s } : null; },
    async client(id) { return tables.clients.find((c) => c.id === id) ?? null; },
    async competitorSet(clientId) { return tables.sets.find((s) => s.client_id === clientId) ?? null; },
    async competitiveReport(id, clientId) { return tables.competitive.find((r) => r.id === id && r.client_id === clientId) ?? null; },
    async pairedCompetitiveDue(clientId, now) {
      return tables.schedules.some((s) => s.client_id === clientId && s.report_kind === "competitive" && s.is_active && new Date(s.next_run_at) <= now);
    },
    async webhooks() { return tables.webhooks; },
    async insertCompetitiveReport(row) {
      const id = `comp-${tables.competitive.length}`;
      tables.competitive.push({ id, client_id: row.client_id, status: "running", date_range_start: row.date_range_start, date_range_end: row.date_range_end, set_id: row.set_id, created_at: row.created_at });
      writes.push(`insert competitive ${id}`);
      return id;
    },
    async insertSocialReport(row) {
      const id = `social-${tables.reports.length}`;
      tables.reports.push({ id, client_id: row.client_id, status: "running", date_range_start: row.date_range_start, date_range_end: row.date_range_end });
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
    async failReport(table, id, message) {
      const rows = table === "reports" ? tables.reports : tables.competitive;
      const r = rows.find((x) => x.id === id);
      if (r && r.status === "running") { r.status = "failed"; (r as { error?: string }).error = message; }
      writes.push(`fail ${table} ${id}`);
    },
    async failSet(setId) { if (tables.setStatus[setId] === "analyzing") tables.setStatus[setId] = "failed"; writes.push(`fail set ${setId}`); },
    async advance(schedule, now, result) {
      const s = tables.schedules.find((x) => x.id === schedule.id)!;
      s.next_run_at = "2026-11-07T07:15:00.000Z";
      s.pending_competitive_report_id = null;
      tables.notes.push({ id: s.id, result });
      writes.push(`advance ${s.id}`);
    },
    async note(scheduleId, result) { tables.notes.push({ id: scheduleId, result }); writes.push(`note ${scheduleId}`); },
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

function harness(w: ReturnType<typeof world>, transport: "accept" | "reject" | "throw" = "accept", opts: { onCompetitivePost?: () => void; dryRun?: boolean } = {}) {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const saved: Array<Record<string, unknown>> = [];
  const jobs: Record<string, ScheduledJob> = {};
  const deps = (job: ScheduledJob): DispatchDeps => ({
    store: w.store,
    now: () => NOW,
    dryRun: opts.dryRun,
    async post(url, body) {
      posts.push({ url, body: body as Record<string, unknown> });
      if (transport === "throw") throw new Error("Fixture network failure");
      if (url.endsWith("/competitive")) opts.onCompetitivePost?.();
      return transport === "reject" ? { ok: false, status: 503 } : { ok: true, status: 200 };
    },
    async buildSocialPayload(a) {
      const comp = a.competitiveReportId ? w.tables.competitive.find((r) => r.id === a.competitiveReportId) : w.tables.competitive.filter((r) => r.status === "complete").at(-1);
      return { report_id: a.reportId, client_id: a.client.id, date_range_start: a.range.start, date_range_end: a.range.end, competitive_report_id: comp?.id ?? null, stagger_seconds: a.staggerSeconds };
    },
    async buildCompetitivePayload(a) {
      return { report_id: a.reportId, set_id: a.set.id, attempt_started_at: a.attemptStartedAt, date_range_start: a.range.start, date_range_end: a.range.end, stagger_seconds: a.staggerSeconds };
    },
    async saveJob(patch) { saved.push(patch); Object.assign(job, patch); jobs[job.id] = job; },
  });
  return { posts, saved, run: (job: ScheduledJob) => runDispatch(job, deps(job)) };
}

describe("runDispatch", () => {
  for (const order of [["competitive", "social"], ["social", "competitive"]] as const) {
    it(`holds social until a fresh competitive report completes (${order.join(" then ")})`, async () => {
      const w = world();
      const h = harness(w);
      const outcomes = [];
      for (const kind of order) outcomes.push([kind, await h.run(jobFor(kind))] as const);
      // Only the competitive request went out; the social report is held.
      expect(h.posts.map((p) => p.url)).toEqual(["https://n8n.fixture/competitive"]);
      const comp = w.tables.competitive.at(-1)!;
      expect(comp.status).toBe("running");
      const social = w.tables.schedules.find((s) => s.report_kind === "social")!;
      expect(social.next_run_at).toBe(DUE);
      // Either way the social schedule ends up pinned to the fresh competitive report.
      expect(outcomes.find(([k]) => k === "social")![1].status).toBe("waiting");
      expect(social.pending_competitive_report_id).toBe(comp.id);
      // The competitive report completes; the social job runs again and posts against it.
      comp.status = "complete";
      comp.date_range_start = "2026-09-01"; comp.date_range_end = "2026-09-30";
      const again = await h.run(jobFor("social"));
      expect(again.status).toBe("done");
      const post = h.posts.find((p) => p.url.endsWith("/social"))!;
      expect(post.body.competitive_report_id).toBe(comp.id);
      expect(w.tables.schedules.find((s) => s.report_kind === "social")!.next_run_at).toBe("2026-11-07T07:15:00.000Z");
    });
  }

  it("runs a social-only schedule against the latest complete competitive report", async () => {
    const w = world({ kinds: ["social"] });
    const h = harness(w);
    const r = await h.run(jobFor("social"));
    expect(r.status).toBe("done");
    expect(h.posts[0].body.competitive_report_id).toBe("old-complete");
    expect(h.posts[0].body.date_range_start).toBe("2026-09-01");
  });

  it("uses a competitive report that completed before the social job ran", async () => {
    const w = world();
    const h = harness(w, "accept", { onCompetitivePost: () => { const c = w.tables.competitive.at(-1)!; c.status = "complete"; } });
    await h.run(jobFor("competitive"));
    const social = await h.run(jobFor("social"));
    expect(social.status).toBe("done");
    expect(h.posts.map((p) => p.url)).toEqual(["https://n8n.fixture/competitive", "https://n8n.fixture/social"]);
    expect(h.posts[1].body.competitive_report_id).toBe(w.tables.competitive.at(-1)!.id);
  });

  it("holds both schedules when the client has no competitor set", async () => {
    const w = world({ set: false });
    const h = harness(w);
    const comp = await h.run(jobFor("competitive"));
    const social = await h.run(jobFor("social"));
    expect([comp.status, social.status]).toEqual(["waiting", "waiting"]);
    expect(h.posts).toHaveLength(0);
    expect(w.tables.schedules.every((s) => s.next_run_at === DUE)).toBe(true);
    expect(w.tables.notes.map((n) => n.result)).toContain("Waiting for a confirmed competitor set; paired social report is held.");
  });

  it("blocks the social job, visibly, when its competitive report failed", async () => {
    const w = world();
    const h = harness(w);
    await h.run(jobFor("competitive"));
    w.tables.competitive.at(-1)!.status = "failed";
    const social = await h.run(jobFor("social"));
    expect(social.status).toBe("blocked");
    expect(social.reason).toMatch(/Retry that report/);
    expect(w.tables.reports).toHaveLength(0);
    expect(w.tables.schedules.find((s) => s.report_kind === "social")!.next_run_at).toBe(DUE);
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

  for (const transport of ["throw", "reject"] as const) {
    it(`closes the report and advances the schedule when the webhook ${transport}s`, async () => {
      const w = world({ kinds: ["social"] });
      const h = harness(w, transport);
      const r = await h.run(jobFor("social"));
      expect(r.status).toBe("failed");
      expect(w.tables.reports[0].status).toBe("failed");
      expect(w.tables.reports[0].error).toMatch(/^Dispatch could not be confirmed/);
      expect(w.tables.schedules[0].next_run_at).toBe("2026-11-07T07:15:00.000Z");
      expect(w.tables.notes.at(-1)!.result).toMatch(/^error: /);
    });
  }

  it("fails the competitive set back out of analyzing when its dispatch fails", async () => {
    const w = world({ kinds: ["competitive"] });
    const h = harness(w, "reject");
    const r = await h.run(jobFor("competitive"));
    expect(r.status).toBe("failed");
    expect(w.tables.setStatus["set-1"]).toBe("failed");
    expect(w.tables.competitive.at(-1)!.status).toBe("failed");
  });

  it("records each phase before the step that needs it", async () => {
    const w = world({ kinds: ["competitive"] });
    const h = harness(w);
    const job = jobFor("competitive", { stagger_seconds: 150 });
    const r = await h.run(job);
    expect(r.status).toBe("done");
    expect(h.saved.map((s) => s.phase)).toEqual(["prepared", "posting"]);
    expect(h.saved[0].report_id).toBe(w.tables.competitive.at(-1)!.id);
    expect(h.posts[0].body.stagger_seconds).toBe(150);
    expect(h.posts[0].body.attempt_started_at).toBe(w.tables.competitive.at(-1)!.created_at);
    expect(r.result?.report_id).toBe(w.tables.competitive.at(-1)!.id);
  });

  it("never posts twice: a job interrupted while posting closes its report as unconfirmed", async () => {
    const w = world({ kinds: ["social"] });
    w.tables.reports.push({ id: "social-0", client_id: "client-1", status: "running", date_range_start: "2026-09-01", date_range_end: "2026-09-30" });
    const h = harness(w);
    const r = await h.run(jobFor("social", { phase: "posting", report_id: "social-0", attempts: 2 }));
    expect(r.status).toBe("failed");
    expect(h.posts).toHaveLength(0);
    expect(w.tables.reports[0].status).toBe("failed");
    expect(w.tables.reports[0].error).toMatch(/could not be confirmed/);
    expect(w.tables.schedules[0].next_run_at).toBe("2026-11-07T07:15:00.000Z");
  });

  it("reuses the report a job prepared before it was interrupted", async () => {
    const w = world({ kinds: ["social"] });
    w.tables.reports.push({ id: "social-0", client_id: "client-1", status: "running", date_range_start: "2026-09-01", date_range_end: "2026-09-30" });
    const h = harness(w);
    const r = await h.run(jobFor("social", { phase: "prepared", report_id: "social-0", attempts: 2, result: { range: { start: "2026-09-01", end: "2026-09-30" } } }));
    expect(r.status).toBe("done");
    expect(w.tables.reports).toHaveLength(1);
    expect(h.posts[0].body.report_id).toBe("social-0");
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
    moved.tables.schedules[0].next_run_at = "2026-11-07T07:15:00.000Z";
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
