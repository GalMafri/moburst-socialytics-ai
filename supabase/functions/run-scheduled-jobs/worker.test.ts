import { describe, it, expect } from "vitest";
import { runFeedJob, FEED_RETRY_MINUTES } from "./feed";
import { summarize, workerTick, START_WINDOW_MS } from "./worker";
import type { JobOutcome, ScheduledJob } from "./types";

const T0 = new Date("2026-10-07T07:16:00Z");
const job = (id: string, over: Partial<ScheduledJob> = {}): ScheduledJob => ({
  id, kind: "feed_refresh", client_id: "client-1", schedule_id: null, occurrence: null, priority: 10, stagger_seconds: 0,
  status: "running", phase: null, report_id: null, attempts: 1, max_attempts: 3, available_at: T0.toISOString(), lease_until: null,
  reason: null, result: null, created_at: T0.toISOString(), started_at: null, finished_at: null, ...over,
});

describe("runFeedJob", () => {
  const err = (message: string, status?: number, code?: string) => Object.assign(new Error(message), { status, code });
  it("records what the refresh found", async () => {
    const r = await runFeedJob(job("j"), { now: () => T0, refreshFeed: async () => ({ posts: 12, alerts: 2 }) });
    expect(r).toEqual({ status: "done", result: { posts: 12, alerts: 2 } });
  });
  it("treats a client RivalIQ does not track as configuration, not failure", async () => {
    const r = await runFeedJob(job("j"), { now: () => T0, refreshFeed: async () => { throw err("Client missing", 422, "RIVALIQ_CLIENT_NOT_TRACKED"); } });
    expect(r.status).toBe("skipped");
    expect(r.result).toEqual({ code: "RIVALIQ_CLIENT_NOT_TRACKED" });
  });
  for (const status of [401, 403, 429, 500, 502]) {
    it(`keeps a provider failure (${status}) a failure even when it carries the not-tracked code`, async () => {
      const r = await runFeedJob(job("j", { attempts: 3 }), { now: () => T0, refreshFeed: async () => { throw err("Provider failed", status, "RIVALIQ_CLIENT_NOT_TRACKED"); } });
      expect(r.status).toBe("failed");
      expect(r.reason).toBe("Provider failed");
    });
  }
  it("retries a failure later until the attempts run out", async () => {
    const boom = async () => { throw err("LinkedIn source collection failed [502]"); };
    const first = await runFeedJob(job("j", { attempts: 1 }), { now: () => T0, refreshFeed: boom });
    expect(first.status).toBe("queued");
    expect(first.available_at).toBe(new Date(T0.getTime() + FEED_RETRY_MINUTES * 60000).toISOString());
    const last = await runFeedJob(job("j", { attempts: 3 }), { now: () => T0, refreshFeed: boom });
    expect(last.status).toBe("failed");
  });
  it("fails without running again when it keeps stopping mid-refresh", async () => {
    let ran = false;
    const r = await runFeedJob(job("j", { attempts: 4 }), { now: () => T0, refreshFeed: async () => { ran = true; return {}; } });
    expect(r.status).toBe("failed");
    expect(ran).toBe(false);
  });
});

describe("workerTick", () => {
  function clock(stepMs: number) { let t = T0.getTime(); return () => { const d = new Date(t); t += stepMs; return d; }; }

  it("runs leased jobs one at a time and writes back every outcome", async () => {
    const queue = [job("a"), job("b"), job("c")];
    const finished: Array<[string, string]> = [];
    const r = await workerTick({
      now: clock(1000),
      lease: async () => queue.shift() ?? null,
      run: async (j) => ({ status: j.id === "b" ? "skipped" : "done" }),
      finish: async (j, o) => { finished.push([j.id, o.status]); },
      closeAbandoned: async () => [{ table: "reports", id: "old" }],
    });
    expect(finished).toEqual([["a", "done"], ["b", "skipped"], ["c", "done"]]);
    expect(r.abandoned).toBe(1);
    expect(r.results.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("starts no new job once the start window has passed, so no run reaches the wall clock", async () => {
    const queue = [job("a"), job("b")];
    const r = await workerTick({
      now: clock(START_WINDOW_MS + 1),
      lease: async () => queue.shift() ?? null,
      run: async () => ({ status: "done" }),
      finish: async () => {},
      closeAbandoned: async () => [],
    });
    expect(r.results.map((x) => x.id)).toEqual(["a"]);
    expect(queue.map((j) => j.id)).toEqual(["b"]);
  });

  it("turns an unexpected error into a retry, then a failure on the last attempt", async () => {
    const outcomes: JobOutcome[] = [];
    const queue = [job("a", { attempts: 1 }), job("b", { attempts: 3 })];
    await workerTick({
      now: clock(10),
      lease: async () => queue.shift() ?? null,
      run: async () => { throw new Error("db down"); },
      finish: async (_j, o) => { outcomes.push(o); },
      closeAbandoned: async () => [],
    });
    expect(outcomes.map((o) => o.status)).toEqual(["queued", "failed"]);
    expect(outcomes[0].reason).toBe("db down");
    expect(outcomes[0].available_at).toBeDefined();
  });

  it("still works the queue when the abandoned-run sweep fails", async () => {
    const queue = [job("a")];
    const r = await workerTick({
      now: clock(10),
      lease: async () => queue.shift() ?? null,
      run: async () => ({ status: "done" }),
      finish: async () => {},
      closeAbandoned: async () => { throw new Error("sweep failed"); },
    });
    expect(r.results).toHaveLength(1);
  });
});

describe("summarize", () => {
  const now = new Date("2026-10-07T08:30:00Z");
  const row = (over: Partial<ScheduledJob>) => job(over.id ?? "x", { status: "done", finished_at: "2026-10-07T07:30:00Z", ...over });

  it("is ok when everything finished or is waiting on a running dependency", () => {
    const s = summarize([row({ id: "a" }), row({ id: "b", status: "skipped" }), row({ id: "c", status: "waiting", finished_at: null })], now);
    expect(s.ok).toBe(true);
    expect(s.counts).toEqual({ done: 1, skipped: 1, waiting: 1 });
  });
  it("flags failed jobs from the last day, blocked jobs, dead leases and an undrained queue", () => {
    const s = summarize([
      row({ id: "failed-today", status: "failed", reason: "competitive webhook 503" }),
      row({ id: "failed-last-week", status: "failed", finished_at: "2026-09-30T07:30:00Z" }),
      row({ id: "blocked", status: "blocked", finished_at: null, reason: "Retry that report" }),
      row({ id: "dead-lease", status: "running", finished_at: null, lease_until: "2026-10-07T08:00:00Z" }),
      row({ id: "live-lease", status: "running", finished_at: null, lease_until: "2026-10-07T08:33:00Z" }),
      row({ id: "undrained", status: "queued", finished_at: null, available_at: "2026-10-07T07:15:00Z" }),
      row({ id: "retry-later", status: "queued", finished_at: null, available_at: "2026-10-07T08:35:00Z" }),
    ], now);
    expect(s.ok).toBe(false);
    expect(s.failed.map((j) => j.id)).toEqual(["failed-today"]);
    expect(s.blocked.map((j) => j.id)).toEqual(["blocked"]);
    expect(s.stuck.map((j) => j.id)).toEqual(["dead-lease"]);
    expect(s.overdue.map((j) => j.id)).toEqual(["undrained"]);
  });
});
