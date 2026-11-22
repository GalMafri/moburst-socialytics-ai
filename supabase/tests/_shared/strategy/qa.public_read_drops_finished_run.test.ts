// @vitest-environment node
// P50-01: a public read with two runs. Run r1 (Acme's TikTok) finishes while r2
// (BenchApp's TikTok) is still running. The look that sees r1 finished collects
// its posts but returns early because r2 is still waiting, and stores r1 as
// SUCCEEDED; the next look skips r1 as final. Acme's posts are never kept.
import { describe, expect, it } from "vitest";
import { REREAD_FAILED, stepRead } from "../../../functions/_shared/strategy/publicRead";
import type { ApifyClient, ApifyRun } from "../../../functions/_shared/apify/client";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const run = (id: string, status: ApifyRun["status"]): ApifyRun => ({ id, status, defaultDatasetId: `ds-${id}`, usageTotalUsd: 0.04 });
function apify(states: Record<string, ApifyRun["status"]>, rows: Record<string, unknown[]>): ApifyClient {
  let n = 0;
  return {
    startRun: async () => run(`r${++n}`, "RUNNING"),
    getRun: async (id) => run(id, states[id] ?? "RUNNING"),
    datasetPage: async () => [],
    datasetItems: async (ds) => rows[ds] ?? [],
  };
}
const targets = [
  { company: "Acme", client: true, platform: "TikTok", url: "https://www.tiktok.com/@acme" },
  { company: "BenchApp", client: false, platform: "TikTok", url: "https://www.tiktok.com/@benchapp" },
];
const acmeRow = { id: "1", postPage: "https://www.tiktok.com/@acme/video/1", uploadedAtFormatted: "2026-10-30T10:00:00.000Z", views: 100, likes: 5, comments: 1, shares: 0, channel: { username: "acme", followers: 50 } };

describe("a public read whose runs end at different times", () => {
  it("keeps the posts of a run that finished while another was still running", async () => {
    let s = await stepRead(null, targets, () => apify({}, {}), NOW);
    expect(s.runs.map((r) => r.run_id)).toEqual(["r1", "r2"]);
    // r1 done, r2 still running.
    s = await stepRead(JSON.parse(JSON.stringify(s)), targets, () => apify({ r1: "SUCCEEDED" }, { "ds-r1": [acmeRow] }), new Date(NOW.getTime() + 180_000));
    expect(s.status).toBe("reading");
    // r2 done (no posts).
    s = await stepRead(JSON.parse(JSON.stringify(s)), targets, () => apify({ r1: "SUCCEEDED", r2: "SUCCEEDED" }, { "ds-r1": [acmeRow] }), new Date(NOW.getTime() + 360_000));
    expect(s.status).toBe("done");
    expect(s.posts.map((p) => p.company)).toEqual(["Acme"]);
  });
});

// P50-05: a read whose run failed is not kept for 7 days as a finished read with no posts.
describe("a public read with a failed run", () => {
  it("runs the failed run's profiles again on the next run, keeping the posts read, at most REREAD_FAILED times", async () => {
    let s = await stepRead(null, targets, () => apify({}, {}), NOW);
    s = await stepRead(JSON.parse(JSON.stringify(s)), targets, () => apify({ r1: "SUCCEEDED", r2: "FAILED" }, { "ds-r1": [acmeRow] }), new Date(NOW.getTime() + 180_000));
    expect(s).toMatchObject({ status: "done" });
    // The next lifecycle run: only BenchApp's run is started again.
    const started: unknown[] = [];
    const again = { ...apify({}, {}), startRun: async (_a: string, input: unknown) => { started.push(input); return run("r9", "RUNNING"); } };
    s = await stepRead(JSON.parse(JSON.stringify(s)), targets, () => again, new Date(NOW.getTime() + 3_600_000));
    expect(s).toMatchObject({ status: "reading", rereads: 1 });
    expect(started).toHaveLength(1);
    expect(JSON.stringify(started[0])).toContain("benchapp");
    expect(s.posts.map((p) => p.company)).toEqual(["Acme"]);
    // Used up: a read whose failed runs were run again REREAD_FAILED times is kept as it is.
    const usedUp = { ...s, status: "done" as const, runs: [{ ...s.runs[1], status: "FAILED" }], rereads: REREAD_FAILED };
    expect(await stepRead(usedUp, targets, () => again, new Date(NOW.getTime() + 2 * 3_600_000))).toBe(usedUp);
  });
});
