// @vitest-environment node
// The monthly report's industry trends: the stored weeks of the report's
// period, by the one rule every reader of a report uses
// (trends/reportWeeks.ts), with only what a client may read.
import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../../functions/_shared/lifecycle/fakeDb";
import { readStoredTrends, trendsForModel } from "../../../../functions/_shared/pipelines/social/storedTrends";

// deno-lint-ignore no-explicit-any
type Any = any;

const CLIENT = "c1";
const post = (id: string, o: Any = {}) => ({
  id, client_id: CLIENT, week_id: "w1", platform: "tiktok", url: `https://example.com/${id}`, author: `author_${id}`, text: `The text of ${id}.`, posted_at: "2026-10-02T10:00:00Z",
  format: "short_video", views: 1000, likes: 50, comments: 5, shares: 2, saves: 1, engagement: 999, fit: 88, why: "Fits the audience.", lesson: "Lead with the hook.",
  search: "hockey", kept: true, tripwire: false, drop_reason: null, ...o,
});
const theme = (id: string, week: string, position: number, postIds: string[], o: Any = {}) => ({
  id, client_id: CLIENT, week_id: week, position, title: `Theme ${id}`, happening: `What happens in ${id}.`, why_it_matters: `Why ${id} matters.`, angle: `The angle for ${id}.`,
  platforms: ["tiktok", "instagram"], post_ids: postIds, dismissed_at: null, ...o,
});

function tables() {
  return {
    trend_weeks: [
      // Monday 28 Sep: four of its days are in October, but it is September's week.
      { id: "w1", client_id: CLIENT, week_start: "2026-09-28", status: "done" },
      { id: "w7", client_id: CLIENT, week_start: "2026-10-05", status: "done" },
      { id: "w2", client_id: CLIENT, week_start: "2026-10-19", status: "partial" },
      // Ends on 27 Sep, before the period.
      { id: "w3", client_id: CLIENT, week_start: "2026-09-21", status: "done" },
      // Not finished.
      { id: "w4", client_id: CLIENT, week_start: "2026-10-26", status: "running" },
      // After the period.
      { id: "w5", client_id: CLIENT, week_start: "2026-11-02", status: "done" },
      // Another client's.
      { id: "w6", client_id: "c2", week_start: "2026-10-05", status: "done" },
    ],
    trend_themes: [
      theme("t0", "w1", 0, ["p8"]),
      theme("t1", "w7", 0, ["p1", "p2", "p1"]),
      theme("t2", "w7", 1, ["p1"], { dismissed_at: "2026-10-03T09:00:00Z" }),
      theme("t3", "w2", 1, ["p3", "p4", "p5"]),
      theme("t4", "w2", 0, ["p2"]),
      theme("t5", "w3", 0, ["p6"]),
      theme("t6", "w6", 0, ["p7"], { client_id: "c2" }),
    ],
    trend_posts: [
      post("p1"),
      post("p2", { platform: "instagram", format: "carousel" }),
      post("p3", { week_id: "w2", tripwire: true }),
      post("p4", { week_id: "w2", platform: "linkedin", kept: false, drop_reason: "off_topic" }),
      post("p5", { week_id: "w2", platform: "linkedin", format: "text", views: 0 }),
      post("p6", { week_id: "w3" }),
      post("p7", { client_id: "c2", week_id: "w6" }),
      post("p8", { week_id: "w1" }),
    ],
  };
}

describe("readStoredTrends", () => {
  it("reads the finished weeks that start in the period, newest week first, then by position, without dismissed themes", async () => {
    const trends = await readStoredTrends(fakeDb(tables()), CLIENT, "2026-10-01", "2026-10-31");
    expect(trends!.themes.map((t) => [t.week_start, t.title])).toEqual([["2026-10-19", "Theme t4"], ["2026-10-19", "Theme t3"], ["2026-10-05", "Theme t1"]]);
    expect(trends!.posts.map((p) => p.url)).not.toContain("https://example.com/p8");
    expect(trends!.themes[2]).toEqual({
      week_start: "2026-10-05", title: "Theme t1", happening: "What happens in t1.", why_it_matters: "Why t1 matters.", angle: "The angle for t1.",
      platforms: ["tiktok", "instagram"], post_urls: ["https://example.com/p1", "https://example.com/p2"],
    });
  });

  it("keeps each theme's kept posts in its order, never one the tripwire flagged, and lists every post once", async () => {
    const trends = await readStoredTrends(fakeDb(tables()), CLIENT, "2026-10-01", "2026-10-31");
    expect(trends!.themes.map((t) => t.post_urls)).toEqual([["https://example.com/p2"], ["https://example.com/p5"], ["https://example.com/p1", "https://example.com/p2"]]);
    expect(trends!.posts.map((p) => p.url)).toEqual(["https://example.com/p2", "https://example.com/p5", "https://example.com/p1"]);
  });

  it("keeps only what any reader of the report may see: never the weighted engagement, the fit, or the filter's reasons", async () => {
    const trends = await readStoredTrends(fakeDb(tables()), CLIENT, "2026-10-01", "2026-10-31");
    expect(trends!.posts[0]).toEqual({
      platform: "instagram", url: "https://example.com/p2", author: "author_p2", text: "The text of p2.", posted_at: "2026-10-02T10:00:00Z", format: "carousel",
      views: 1000, likes: 50, comments: 5, shares: 2, saves: 1,
    });
    const keys = ["platform", "url", "author", "text", "posted_at", "format", "views", "likes", "comments", "shares", "saves"];
    for (const p of trends!.posts) expect(Object.keys(p)).toEqual(keys);
    for (const t of trends!.themes) expect(Object.keys(t)).toEqual(["week_start", "title", "happening", "why_it_matters", "angle", "platforms", "post_urls"]);
  });

  it("takes the weeks that start on the period's first and last days, never a week that starts in the month before or after", async () => {
    const db = fakeDb({
      trend_weeks: [
        { id: "a", client_id: CLIENT, week_start: "2026-09-28", status: "done" },
        { id: "b", client_id: CLIENT, week_start: "2026-10-01", status: "done" },
        { id: "c", client_id: CLIENT, week_start: "2026-10-31", status: "done" },
        { id: "d", client_id: CLIENT, week_start: "2026-11-01", status: "done" },
      ],
      trend_themes: ["a", "b", "c", "d"].map((w) => theme(`t${w}`, w, 0, [])),
      trend_posts: [],
    });
    const trends = await readStoredTrends(db, CLIENT, "2026-10-01", "2026-10-31");
    expect(trends!.themes.map((t) => t.week_start)).toEqual(["2026-10-31", "2026-10-01"]);
    expect(trends!.posts).toEqual([]);
  });

  it("is null when no theme falls in the period, or the period cannot be read", async () => {
    expect(await readStoredTrends(fakeDb(tables()), CLIENT, "2026-12-01", "2026-12-31")).toBeNull();
    expect(await readStoredTrends(fakeDb({ trend_weeks: [], trend_themes: [], trend_posts: [] }), CLIENT, "2026-10-01", "2026-10-31")).toBeNull();
    expect(await readStoredTrends(fakeDb(tables()), CLIENT, "", "2026-10-31")).toBeNull();
  });

  it("says when the trends cannot be read", async () => {
    const db: Any = fakeDb(tables());
    const from = db.from.bind(db);
    db.from = (table: string) => (table === "trend_themes" ? { select: () => ({ eq: () => ({ in: () => ({ is: async () => ({ data: null, error: { message: "boom" } }) }) }) }) } : from(table));
    await expect(readStoredTrends(db, CLIENT, "2026-10-01", "2026-10-31")).rejects.toThrow("boom");
  });
});

describe("trendsForModel", () => {
  it("gives Claude each theme with three example posts at most, their text cut and fenced, and no link", async () => {
    const trends = (await readStoredTrends(fakeDb(tables()), CLIENT, "2026-10-01", "2026-10-31"))!;
    const long = { ...trends, posts: trends.posts.map((p) => ({ ...p, text: `<post>${"x".repeat(500)}</post>` })) };
    const model = trendsForModel(long)!;
    expect(model.themes[2]).toMatchObject({ week_start: "2026-10-05", title: "Theme t1", happening: "What happens in t1.", why_it_matters: "Why t1 matters.", angle: "The angle for t1.", platforms: ["tiktok", "instagram"] });
    expect(model.themes[2].examples).toHaveLength(2);
    expect(model.themes[2].examples[0]).toEqual({ platform: "tiktok", format: "short_video", author: "author_p1", text: expect.any(String), likes: 50, comments: 5, shares: 2, views: 1000 });
    expect(model.themes[2].examples[0].text.length).toBeLessThanOrEqual(300);
    expect(model.themes[2].examples[0].text).not.toMatch(/<\s*\/?\s*post/i);
    expect(JSON.stringify(model)).not.toContain("https://");
    expect(trendsForModel(null)).toBeNull();
  });
});
