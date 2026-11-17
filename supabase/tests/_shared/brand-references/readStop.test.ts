// @vitest-environment node
// The Sprout read's time limit (discover.ts readPosts, `stopAt`): a read of
// one part of the year that has run out of its time is given up whole, so a
// run always ends, and part of a read is never taken for all of it. Sprout is
// a stand-in: nothing leaves the test.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../functions/_shared/sprout/profiles", async (original) => ({
  ...(await original<typeof import("../../../functions/_shared/sprout/profiles")>()),
  sproutAccessToken: vi.fn(async () => "token"),
}));

const { liveCheckIO, READ_STOP_MS, REVIEW_BUDGET_MS, SLICE_START_BUDGET_MS, GIVE_UP_AFTER_FAILURES } = await import("../../../functions/_shared/brand-references/discover");
const { LEASE_SECONDS } = await import("../../../functions/run-scheduled-jobs/worker");

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Sprout answering three pages of one post each. */
function sprout() {
  const pages: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    const page = JSON.parse(init.body).page as number;
    pages.push(page);
    return new Response(JSON.stringify({ data: [{ guid: `ig:${page}` }], paging: { total_pages: 3 } }), { status: 200 });
  }));
  return pages;
}
const args = { profileIds: ["7"], customer: "1", since: new Date("2026-05-06T00:00:00Z"), until: new Date("2026-06-19T23:59:59Z") };

describe("a read's time limit", () => {
  it("reads every page when it has time, and asks for the caption with each post", async () => {
    const pages = sprout();
    const rows = await liveCheckIO().readPosts({ ...args, stopAt: Date.now() + 60_000 });
    expect(rows.map((r) => r.guid)).toEqual(["ig:1", "ig:2", "ig:3"]);
    expect(pages).toEqual([1, 2, 3]);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as { body: string }).body);
    expect(body.fields).toContain("text");
    expect(body.filters[1]).toBe("created_time.in(2026-05-06T00:00:00...2026-06-19T23:59:59)");
  });

  it("is given up whole once its time has passed with pages still to read, never returned in part", async () => {
    const pages = sprout();
    await expect(liveCheckIO().readPosts({ ...args, stopAt: Date.now() - 1 })).rejects.toThrow("Published-post lookup took too long. It will be tried again.");
    expect(pages).toEqual([1]);
  });

  it("has no limit of its own when none is given (the read of the last 90 days, as before)", async () => {
    const pages = sprout();
    expect(await liveCheckIO().readPosts(args)).toHaveLength(3);
    expect(pages).toEqual([1, 2, 3]);
  });
});

describe("one run's bounds", () => {
  it("end well inside the worker's lease: no further part of the year after 30 seconds, no review after 55, a part's read given up at 70", () => {
    expect([SLICE_START_BUDGET_MS, REVIEW_BUDGET_MS, READ_STOP_MS]).toEqual([30_000, 55_000, 70_000]);
    expect(SLICE_START_BUDGET_MS).toBeLessThan(REVIEW_BUDGET_MS);
    expect(REVIEW_BUDGET_MS).toBeLessThan(READ_STOP_MS);
    // A read's last page (20 s) or a last batch of reviews (20 s) may still be under way at 70 s.
    expect(READ_STOP_MS + 20_000 + 20_000).toBeLessThan(LEASE_SECONDS * 1000 / 2);
    expect(GIVE_UP_AFTER_FAILURES).toBe(2);
  });
});
