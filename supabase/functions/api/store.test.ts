import { describe, it, expect } from "vitest";
import { CLIENT_COLUMNS, competitiveFromLight, makeStore, reportFromLight, TREND_POST_COLUMNS, TREND_THEME_COLUMNS, TREND_WEEK_COLUMNS } from "./store";
import { TABLE_COLUMNS } from "./schema-check";
import { competitiveReportOut, reportOut } from "./serializers";

describe("light list rows", () => {
  it("rebuild the report_data the summary serializer reads", () => {
    const row = reportFromLight({ id: "r", client_id: "c", report_type: "weekly", status: "completed", date_range_start: "2026-08-01", date_range_end: "2026-08-31", gamma_url: null, duration_minutes: 38, created_at: "2026-09-01T00:00:00.000Z", demo_job_id: null,
      rd_period: { current_month: { start: "2026-08-01", end: "2026-08-31" }, previous_month: { start: "2026-07-01", end: "2026-07-31" } }, rd_counts: { total_recommendations: 12 }, rd_metrics: { impressions_change: -2 }, rd_warnings: ["w"], rd_trend: "ok", rd_gamma_status: "ok", rd_gamma_url: "https://gamma.app/x", rd_completed: "2026-09-01T07:38:00.000Z", rd_error: null, rd_duration: 38 });
    expect(reportOut(row)).toMatchObject({ previous_period: { start: "2026-07-01" }, counts: { total_recommendations: 12 }, warnings: ["w"], trend_status: "ok", deck: { url: "https://gamma.app/x", status: "ok" }, completed_at: "2026-09-01T07:38:00.000Z" });
    const c = competitiveFromLight({ id: "x", client_id: "c", set_id: "s", status: "complete", gamma_url: null, duration_minutes: 20, date_range_start: null, date_range_end: null, created_at: "2026-09-25T00:00:00.000Z", demo_job_id: null, rd_period: { start: "2026-08-25", end: "2026-09-24", days: 31 }, rd_totals: { posts_analyzed: 4 }, rd_quality: { state: "needs_review" }, rd_provider: "ok", rd_generated: "2026-09-25T08:00:00.000Z", rd_gamma_url: null });
    expect(competitiveReportOut(c)).toMatchObject({ period: { start: "2026-08-25", days: 31 }, totals: { posts_analyzed: 4 }, quality_check: { state: "needs_review" }, completed_at: "2026-09-25T08:00:00.000Z" });
  });
});

describe("the client columns", () => {
  it("no longer read trends_keywords, which trends have no use for now", () => {
    const columns = CLIENT_COLUMNS.split(", ");
    expect(columns).not.toContain("trends_keywords");
    expect(columns).toContain("social_keywords");
  });
});

type Call = { table: string; ops: Array<[string, ...unknown[]]> };
/** A database that records the query each read builds and answers it with canned rows, so the filters of a read can be checked. */
function recordingDb(answer: (call: Call) => unknown[] | { error: string }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const q: unknown = new Proxy({}, {
        get: (_t, op: string) => (op === "then"
          ? (resolve: (v: unknown) => unknown) => {
            const a = answer(call);
            return resolve(Array.isArray(a) ? { data: a, error: null } : { data: null, error: { message: a.error } });
          }
          : (...args: unknown[]) => { call.ops.push([op, ...args]); return q; }),
      });
      return q;
    },
  };
  return { db: db as never, calls };
}
const op = (c: Call, name: string, ...args: unknown[]) => c.ops.find((o) => o[0] === name && args.every((a, i) => JSON.stringify(o[i + 1]) === JSON.stringify(a)));
const idsOf = (c: Call) => (op(c, "in")?.[2] as string[]) ?? [];

describe("trendRows", () => {
  const week = (id: string) => ({ id, client_id: "c-bader", week_start: "2026-08-03", status: "done" });
  const theme = (id: string, week_id: string, post_ids: string[]) => ({ id, week_id, client_id: "c-bader", position: 0, title: id, happening: "", why_it_matters: "", angle: "", platforms: [], post_ids, dismissed_at: null });
  const post = (id: string) => ({ id, client_id: "c-bader", platform: "tiktok", url: `https://tiktok.example/${id}`, author: "", text: "", posted_at: null, format: null, kept: true });

  it("reads the finished weeks that start in the period, then their live themes, then the kept posts those themes list", async () => {
    const { db, calls } = recordingDb((c) => (c.table === "trend_weeks" ? [week("w1")] : c.table === "trend_themes" ? [theme("t1", "w1", ["p1", "p2"]), theme("t2", "w1", ["p2", "p3"])] : idsOf(c).map(post)));
    const out = await makeStore(db).trendRows("c-bader", "2026-08-01", "2026-08-31");
    expect(calls.map((c) => c.table)).toEqual(["trend_weeks", "trend_themes", "trend_posts"]);
    const [weeks, themes, posts] = calls;
    for (const c of calls) expect(op(c, "eq", "client_id", "c-bader"), c.table).toBeDefined();
    expect(op(weeks, "in", "status", ["done", "partial"])).toBeDefined();
    expect(op(weeks, "gte", "week_start", "2026-08-01")).toBeDefined();
    expect(op(weeks, "lte", "week_start", "2026-08-31")).toBeDefined();
    expect(op(themes, "in", "week_id", ["w1"])).toBeDefined();
    expect(op(themes, "is", "dismissed_at", null)).toBeDefined();
    expect(op(posts, "eq", "kept", true)).toBeDefined();
    expect(op(posts, "in", "id", ["p1", "p2", "p3"])).toBeDefined();
    expect(out.weeks.map((w) => w.id)).toEqual(["w1"]);
    expect(out.themes.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(out.posts.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });
  it("selects the columns the API serves and none of the team's own", () => {
    const own = ["engagement", "fit", "why", "lesson", "search", "drop_reason", "tripwire", "views", "likes", "comments", "shares", "saves", "dismissed_by"];
    for (const list of [TREND_WEEK_COLUMNS, TREND_THEME_COLUMNS, TREND_POST_COLUMNS]) for (const column of own) expect(list.split(", ")).not.toContain(column);
    // Every list is tried against the live database with the other column lists.
    expect(TABLE_COLUMNS).toEqual(expect.arrayContaining([["trend_weeks", TREND_WEEK_COLUMNS], ["trend_themes", TREND_THEME_COLUMNS], ["trend_posts", TREND_POST_COLUMNS]]));
  });
  it("asks for nothing more once a step finds nothing", async () => {
    const none = recordingDb(() => []);
    expect(await makeStore(none.db).trendRows("c-bader", "2026-08-01", "2026-08-31")).toEqual({ weeks: [], themes: [], posts: [] });
    expect(none.calls.map((c) => c.table)).toEqual(["trend_weeks"]);
    const bare = recordingDb((c) => (c.table === "trend_weeks" ? [week("w1")] : c.table === "trend_themes" ? [theme("t1", "w1", [])] : []));
    await makeStore(bare.db).trendRows("c-bader", "2026-08-01", "2026-08-31");
    expect(bare.calls.map((c) => c.table)).toEqual(["trend_weeks", "trend_themes"]);
  });
  it("reads a long period in groups, so no request line or answer grows past its limit", async () => {
    const weekIds = Array.from({ length: 150 }, (_, i) => `w${i}`);
    const postIds = Array.from({ length: 250 }, (_, i) => `p${i}`);
    const { db, calls } = recordingDb((c) => (c.table === "trend_weeks" ? weekIds.map(week) : c.table === "trend_themes" ? idsOf(c).map((w) => theme(`t-${w}`, w, w === "w0" ? postIds : [])) : idsOf(c).map(post)));
    const out = await makeStore(db).trendRows("c-bader", "2026-01-01", "2026-12-31");
    const themeCalls = calls.filter((c) => c.table === "trend_themes"), postCalls = calls.filter((c) => c.table === "trend_posts");
    expect(themeCalls.map((c) => idsOf(c).length)).toEqual([100, 50]);
    expect(postCalls.map((c) => idsOf(c).length)).toEqual([100, 100, 50]);
    expect(out.themes).toHaveLength(150);
    expect(out.posts.map((p) => p.id)).toEqual(postIds);
  });
  it("fails the report read when a trend read fails, rather than serving a period with themes missing", async () => {
    const { db } = recordingDb((c) => (c.table === "trend_weeks" ? [week("w1")] : { error: "permission denied for table trend_themes" }));
    await expect(makeStore(db).trendRows("c-bader", "2026-08-01", "2026-08-31")).rejects.toThrow("permission denied");
  });
});
