import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { claimJob, endOverdueRequests } from "../../../functions/_shared/canva/jobs";

// What keeps a design request from running for days (10 Nov 2026: Pay The Pyper's
// request stayed "preparing" for almost six days because a step was cut off
// again and again without leaving any mark): a worker run that died counts as a
// try, and a request that has been preparing too long ends.

const NOW = new Date("2026-11-10T12:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const LEASE_MS = 120_000;
const MAX = 4;

const job = (over: Record<string, unknown> = {}) => ({
  id: "job-1", client_id: "c1", design_request_id: "req-1", status: "running", step: "locate", attempts: 0, lease_until: null as string | null, error: null, ...over,
});

describe("claimJob", () => {
  it("claims a waiting job for one lease, with no try used", async () => {
    const db = fakeDb({ canva_finish_jobs: [job({ status: "queued" })] });
    const [row] = db.tables.canva_finish_jobs;
    expect(await claimJob(db, { ...row }, NOW, LEASE_MS, MAX)).toBe("claimed");
    expect(row.status).toBe("running");
    expect(row.attempts).toBe(0);
    expect(new Date(row.lease_until).getTime()).toBe(NOW.getTime() + LEASE_MS);
  });

  it("claims a job the last run released on purpose without using a try", async () => {
    const db = fakeDb({ canva_finish_jobs: [job({ attempts: 2, lease_until: null })] });
    const [row] = db.tables.canva_finish_jobs;
    expect(await claimJob(db, { ...row }, NOW, LEASE_MS, MAX)).toBe("claimed");
    expect(row.attempts).toBe(2);
  });

  it("counts a try when the last run's lease ran out with the job still running: that run died", async () => {
    const db = fakeDb({ canva_finish_jobs: [job({ attempts: 1, lease_until: ago(1) })] });
    const [row] = db.tables.canva_finish_jobs;
    expect(await claimJob(db, { ...row }, NOW, LEASE_MS, MAX)).toBe("claimed");
    expect(row.attempts).toBe(2);
    expect(row.status).toBe("running");
    expect(new Date(row.lease_until).getTime()).toBe(NOW.getTime() + LEASE_MS);
  });

  it("fails the job once its dead runs use the last try, so its option is replaced instead of waiting for ever", async () => {
    const db = fakeDb({ canva_finish_jobs: [job({ attempts: MAX - 1, lease_until: ago(1) })] });
    const [row] = db.tables.canva_finish_jobs;
    expect(await claimJob(db, { ...row }, NOW, LEASE_MS, MAX)).toBe("failed");
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(MAX);
    expect(row.lease_until).toBeNull();
    expect(row.error).toMatch(/stopped before it finished/);
  });

  it("counts a dead run once when two passes read the same job at the same time", async () => {
    const db = fakeDb({ canva_finish_jobs: [job({ attempts: 1, lease_until: ago(1) })] });
    const [row] = db.tables.canva_finish_jobs;
    const seen = { ...row };
    expect(await claimJob(db, { ...seen }, NOW, LEASE_MS, MAX)).toBe("claimed");
    expect(await claimJob(db, { ...seen }, NOW, LEASE_MS, MAX)).toBe("lost");
    expect(row.attempts).toBe(2);
  });

  it("does not take a job another run holds, or one that has ended", async () => {
    const db = fakeDb({ canva_finish_jobs: [job({ id: "held", lease_until: new Date(NOW.getTime() + 60_000).toISOString() }), job({ id: "gone", status: "canceled" })] });
    for (const row of db.tables.canva_finish_jobs) {
      const before = { ...row };
      expect(await claimJob(db, { ...row }, NOW, LEASE_MS, MAX)).toBe("lost");
      expect(row).toEqual(before);
    }
  });
});

describe("endOverdueRequests", () => {
  const request = (over: Record<string, unknown> = {}) => ({
    id: "req-1", client_id: "c1", status: "preparing", stage: "finishing", kind: "single", end_reason: null, ended_at: null, error: null,
    created_at: ago(300), started_at: ago(300), ...over,
  });

  it("closes a request preparing for more than 90 minutes, quietly, and stops its jobs", async () => {
    const db = fakeDb({
      design_requests: [request({ started_at: ago(8270), created_at: ago(8270) })],
      canva_finish_jobs: [job({ id: "j1", status: "running", lease_until: ago(0.5) }), job({ id: "j2", status: "queued" }), job({ id: "j3", status: "done" })],
    });
    expect(await endOverdueRequests(db, NOW)).toEqual(["req-1"]);
    const [req] = db.tables.design_requests;
    expect(req.status).toBe("closed");
    // The same reason as a request whose planning stopped: the week's design button counts the post again.
    expect(req.end_reason).toBe("no_progress");
    expect(req.ended_at).toBeTruthy();
    expect(req.error).toMatch(/90 minutes/);
    const [j1, j2, j3] = db.tables.canva_finish_jobs;
    expect([j1.status, j2.status, j3.status]).toEqual(["canceled", "canceled", "done"]);
    expect(j1.lease_until).toBeNull();
  });

  it("closes a request in any stage, and any kind, once it is over the limit", async () => {
    const db = fakeDb({
      design_requests: [request({ id: "a", stage: "planning" }), request({ id: "b", stage: "designing", kind: "carousel" }), request({ id: "c", stage: "finishing", kind: "video" })],
      canva_finish_jobs: [],
    });
    expect((await endOverdueRequests(db, NOW)).sort()).toEqual(["a", "b", "c"]);
    expect(db.tables.design_requests.every((r) => r.status === "closed" && r.end_reason === "no_progress")).toBe(true);
  });

  it("leaves a request still inside its time alone, with its jobs running", async () => {
    const db = fakeDb({ design_requests: [request({ started_at: ago(30), created_at: ago(30) })], canva_finish_jobs: [job({ status: "running" })] });
    expect(await endOverdueRequests(db, NOW)).toEqual([]);
    expect(db.tables.design_requests[0].status).toBe("preparing");
    expect(db.tables.canva_finish_jobs[0].status).toBe("running");
  });

  it("leaves requests that made a design, wait for footage, closed earlier or were canceled alone", async () => {
    const db = fakeDb({
      design_requests: ["ready", "needs_filming", "closed", "canceled"].map((status, i) => request({ id: `r${i}`, status, started_at: ago(9000) })),
      canva_finish_jobs: [],
    });
    expect(await endOverdueRequests(db, NOW)).toEqual([]);
    expect(db.tables.design_requests.map((r) => r.status)).toEqual(["ready", "needs_filming", "closed", "canceled"]);
  });

  it("closes a request once: a second sweep finds nothing", async () => {
    const db = fakeDb({ design_requests: [request()], canva_finish_jobs: [] });
    expect(await endOverdueRequests(db, NOW)).toEqual(["req-1"]);
    expect(await endOverdueRequests(db, NOW)).toEqual([]);
  });
});

describe("a request whose worker dies on every try", () => {
  // The real claim, sweep and settle code, minute by minute: every run is cut off before it writes anything
  // (nothing is ever recorded by the run itself), as Pay The Pyper's was on 4 to 10 Nov 2026.
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(png.buffer).setUint32(16, 2160);
  new DataView(png.buffer).setUint32(20, 2160);

  const world = (extra: Record<string, unknown> = {}) => {
    const db = fakeDb({
      design_requests: [{
        id: "req-1", client_id: "c1", report_id: null, calendar_post_key: "post:1", platform: "Facebook", format: "image", post_copy: "Pay the Pyper.",
        requested_by: "p1", status: "preparing", stage: "finishing", kind: "single", options_wanted: 1, options_ready: 0, candidates_started: 1,
        briefs: [1, 2, 3].map((n) => ({ headline: [`Headline ${n}`], picture: `Picture ${n}`, refs: ["c1/a.jpg"] })),
        end_reason: null, ended_at: null, error: null, created_at: NOW.toISOString(), started_at: NOW.toISOString(), ...extra,
      }],
      canva_finish_jobs: [{ id: "j0", client_id: "c1", design_request_id: "req-1", option_index: 0, slide_index: null, slide_count: null, status: "queued", step: "locate", attempts: 0, lease_until: null, input: {}, state: {} }],
      design_brand_settings: [{ client_id: "c1", logo_path: "c1/logo.png", placement: { anchor: "center", width: 0.17, top: 0.824 }, background: "#1A1A1A", reference_paths: ["c1/a.jpg"] }],
      clients: [{ id: "c1", name: "Pay The Pyper" }],
    }, { claim_worker_lease: () => true, release_worker_lease: () => null });
    db.uploads.set("generated-media/c1/logo.png", png);
    return db;
  };

  /** One worker tick at `at`: the sweep, the claims (each claimed run dies at once), then the request is settled. */
  async function tick(db: ReturnType<typeof fakeDb>, at: Date) {
    await endOverdueRequests(db, at);
    const due = db.tables.canva_finish_jobs.filter((j) => (j.status === "queued" || j.status === "running") && (!j.lease_until || Date.parse(j.lease_until) <= at.getTime()));
    for (const j of due) await claimJob(db, { ...j }, at, LEASE_MS, MAX);
    const { settleRequest } = await import("../../../functions/_shared/canva/jobs");
    await settleRequest(db, "req-1");
    // The database gives a new job its defaults (status queued, attempts 0, no lease); the fake does not.
    for (const j of db.tables.canva_finish_jobs) { j.status ??= "queued"; j.attempts ??= 0; j.lease_until ??= null; }
  }

  it("ends with no design after its three options, within half an hour, with no help from the runs that died", async () => {
    const db = world();
    let closedAt: number | null = null;
    for (let m = 0; m <= 120 && closedAt === null; m++) {
      await tick(db, new Date(NOW.getTime() + m * 60_000));
      if (db.tables.design_requests[0].status === "closed") closedAt = m;
    }
    const req = db.tables.design_requests[0];
    expect(req.status).toBe("closed");
    expect(req.end_reason).toBe("no_design");
    expect(closedAt).not.toBeNull();
    expect(closedAt!).toBeLessThanOrEqual(30);
    // One job per option, three options, each failed by its dead runs.
    expect(db.tables.canva_finish_jobs.map((j) => j.status)).toEqual(["failed", "failed", "failed"]);
    expect(db.tables.canva_finish_jobs.every((j) => j.attempts === MAX)).toBe(true);
  });

  it("is closed by the time limit even if its job somehow keeps being claimed without ever failing", async () => {
    const db = world({ started_at: new Date(NOW.getTime() - 89 * 60_000).toISOString(), created_at: new Date(NOW.getTime() - 89 * 60_000).toISOString() });
    // A job that never uses a try: its lease is always released cleanly.
    const keep = async (at: Date) => {
      await endOverdueRequests(db, at);
      for (const j of db.tables.canva_finish_jobs) if (j.status === "running") { j.lease_until = null; j.attempts = 0; }
      for (const j of db.tables.canva_finish_jobs) if (j.status === "queued" || j.status === "running") { j.status = "running"; j.lease_until = null; }
    };
    await keep(NOW);
    expect(db.tables.design_requests[0].status).toBe("preparing");
    await keep(new Date(NOW.getTime() + 2 * 60_000));
    expect(db.tables.design_requests[0].status).toBe("closed");
    expect(db.tables.design_requests[0].end_reason).toBe("no_progress");
    expect(db.tables.canva_finish_jobs[0].status).toBe("canceled");
  });
});
