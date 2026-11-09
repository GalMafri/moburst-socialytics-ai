// @vitest-environment node
// The feed refresh a person's refresh queues when it saved the feed without
// its LinkedIn posts: the job the daily enqueue makes, 10 minutes out, and
// never a second one while the client has a feed refresh queued or running.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { FEED_RETRY_MINUTES, queueFeedRetry } from "../../../functions/_shared/competitive/feedRetry";

const CLIENT = "d00ce604-2bcc-455a-9826-f80250db75cf";
const NOW = new Date("2026-11-08T07:00:00Z");
const AT = new Date(NOW.getTime() + FEED_RETRY_MINUTES * 60_000).toISOString();

afterEach(() => vi.restoreAllMocks());

describe("queueFeedRetry", () => {
  it("queues one feed refresh for the client 10 minutes out, as the daily enqueue makes it (priority 10, the table's default attempts)", async () => {
    expect(FEED_RETRY_MINUTES).toBe(10);
    const db = fakeDb({ scheduled_jobs: [] });
    expect(await queueFeedRetry(db, CLIENT, NOW)).toBe(true);
    expect(db.tables.scheduled_jobs).toHaveLength(1);
    const { id: _id, ...row } = db.tables.scheduled_jobs[0];
    expect(row).toEqual({ kind: "feed_refresh", client_id: CLIENT, dedupe_key: `feed:${CLIENT}:retry:2026-11-08T07:10`, priority: 10, available_at: AT });
  });

  it("queues nothing while the client has a feed refresh queued or running, and again once it has finished", async () => {
    for (const status of ["queued", "running"]) {
      const db = fakeDb({ scheduled_jobs: [{ kind: "feed_refresh", client_id: CLIENT, dedupe_key: `feed:${CLIENT}:2026-11-08`, status }] });
      expect(await queueFeedRetry(db, CLIENT, NOW)).toBe(false);
      expect(db.tables.scheduled_jobs).toHaveLength(1);
    }
    for (const status of ["done", "failed", "skipped"]) {
      const db = fakeDb({ scheduled_jobs: [{ kind: "feed_refresh", client_id: CLIENT, dedupe_key: `feed:${CLIENT}:2026-11-08`, status }] });
      expect(await queueFeedRetry(db, CLIENT, NOW)).toBe(true);
      expect(db.tables.scheduled_jobs).toHaveLength(2);
    }
    // Another client's queued feed, or this client's queued dispatch, does not count.
    const db = fakeDb({ scheduled_jobs: [
      { kind: "feed_refresh", client_id: "11111111-1111-1111-1111-111111111111", dedupe_key: "feed:other", status: "queued" },
      { kind: "dispatch", client_id: CLIENT, dedupe_key: "dispatch:x", status: "queued" },
    ] });
    expect(await queueFeedRetry(db, CLIENT, NOW)).toBe(true);
  });

  it("a second call in the same minute shares the first one's key", async () => {
    const db = fakeDb({ scheduled_jobs: [] });
    await queueFeedRetry(db, CLIENT, NOW);
    // As if both had looked before either queued.
    db.tables.scheduled_jobs[0].status = "done";
    await queueFeedRetry(db, CLIENT, new Date(NOW.getTime() + 20_000));
    expect(db.tables.scheduled_jobs).toHaveLength(1);
  });

  it("never throws: a queue that cannot be read or written is logged and nothing is queued", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwing = { from: () => { throw new Error("relation does not exist"); } };
    expect(await queueFeedRetry(throwing, CLIENT, NOW)).toBe(false);
    expect(warn.mock.calls[0].join(" ")).toContain("relation does not exist");
  });
});
