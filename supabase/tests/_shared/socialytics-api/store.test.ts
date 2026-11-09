import { describe, it, expect, vi } from "vitest";
import { CLIENT_COLUMNS, competitiveFromLight, makeStore, reportFromLight, TREND_POST_COLUMNS, TREND_THEME_COLUMNS, TREND_WEEK_COLUMNS } from "../../../functions/_shared/socialytics-api/store";
import { TABLE_COLUMNS } from "../../../functions/api/schema-check";
import { competitiveReportOut, reportOut } from "../../../functions/_shared/socialytics-api/serializers";
import { SHOWN_INSIGHT_COLUMNS } from "../../../functions/_shared/reports/shownFields";

describe("light list rows", () => {
  it("rebuild the report_data the summary serializer reads", () => {
    const row = reportFromLight({ id: "r", client_id: "c", report_type: "weekly", status: "completed", date_range_start: "2026-08-01", date_range_end: "2026-08-31", gamma_url: null, duration_minutes: 38, created_at: "2026-09-01T00:00:00.000Z", demo_job_id: null,
      rd_period: { current_month: { start: "2026-08-01", end: "2026-08-31" }, previous_month: { start: "2026-07-01", end: "2026-07-31" } }, rd_counts: { total_recommendations: 12 }, rd_metrics: { impressions_change: -2 }, rd_warnings: ["w"], rd_trend: "ok", rd_gamma_status: "ok", rd_gamma_url: "https://gamma.app/x", rd_completed: "2026-09-01T07:38:00.000Z", rd_error: null, rd_duration: 38 });
    expect(reportOut(row)).toMatchObject({ previous_period: { start: "2026-07-01" }, counts: { total_recommendations: 12 }, warnings: ["w"], trend_status: "ok", deck: { url: "https://gamma.app/x", status: "ok" }, completed_at: "2026-09-01T07:38:00.000Z" });
    const c = competitiveFromLight({ id: "x", client_id: "c", set_id: "s", status: "complete", gamma_url: null, duration_minutes: 20, date_range_start: null, date_range_end: null, created_at: "2026-09-25T00:00:00.000Z", demo_job_id: null, rd_period: { start: "2026-08-25", end: "2026-09-24", days: 31 }, rd_totals: { posts_analyzed: 4 }, rd_quality: { state: "needs_review" }, rd_provider: "ok", rd_generated: "2026-09-25T08:00:00.000Z", rd_gamma_url: null });
    expect(competitiveReportOut(c)).toMatchObject({ period: { start: "2026-08-25", days: 31 }, totals: { posts_analyzed: 4 }, quality_check: { state: "needs_review" }, completed_at: "2026-09-25T08:00:00.000Z" });
  });
});

/** A supabase-js stand-in that records each query and answers with the table's rows. */
function recordingDb(tables: Record<string, unknown[]>) {
  const queries: Array<{ table: string; select: string; filters: Array<[string, string, unknown]> }> = [];
  const db = {
    from(table: string) {
      const q = { table, select: "", filters: [] as Array<[string, string, unknown]> };
      queries.push(q);
      const b: Record<string, unknown> = {
        select: (cols: string) => { q.select = cols; return b; },
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok, bad),
      };
      for (const op of ["in", "eq", "neq", "is", "order", "limit"]) b[op] = (col: string, val: unknown) => { q.filters.push([op, col, val]); return b; };
      return b;
    },
  };
  return { db, queries };
}

describe("clientExtras", () => {
  it("reads the design settings and the design lifecycle steps for the whole page at once, never per client", async () => {
    const ids = ["c1", "c2", "c3"];
    const { db, queries } = recordingDb({
      design_brand_settings: [{ client_id: "c1", confirmed_at: "2026-10-20T10:00:00.000Z" }, { client_id: "c2", confirmed_at: null }],
      client_lifecycle_steps: [{ client_id: "c3", step: "design_refs", status: "waiting", result: { waiting_for: "designed_posts" } }, { client_id: "c3", step: "design_settings", status: "waiting", result: { waiting_for: "logo_file" } }],
    });
    // deno-lint-ignore no-explicit-any
    const extras = await makeStore(db as any).clientExtras(ids);
    const of = (table: string) => queries.filter((q) => q.table === table);
    expect(of("design_brand_settings")).toHaveLength(1);
    expect(of("design_brand_settings")[0]).toMatchObject({ select: "client_id, confirmed_at", filters: [["in", "client_id", ids]] });
    expect(of("client_lifecycle_steps")).toHaveLength(1);
    expect(of("client_lifecycle_steps")[0].select).toBe("client_id, step, status, result");
    expect(of("client_lifecycle_steps")[0].filters).toEqual(expect.arrayContaining([["in", "client_id", ids], ["in", "step", ["design_refs", "design_settings"]]]));
    for (const q of queries) expect(q.filters.some(([op, col]) => op === "eq" && col === "client_id"), q.table).toBe(false);
    expect(extras.c1.designSettings).toEqual({ client_id: "c1", confirmed_at: "2026-10-20T10:00:00.000Z" });
    expect(extras.c2.designSettings).toEqual({ client_id: "c2", confirmed_at: null });
    expect(extras.c3.designSettings).toBeNull();
    expect(extras.c3.designSteps.map((r) => r.step)).toEqual(["design_refs", "design_settings"]);
    expect(extras.c1.designSteps).toEqual([]);
  });
});

describe("a single report", () => {
  it("comes with its shown insights (the newest confirmed row), read by the shown columns", async () => {
    const id = "6f1c1a3e-6c1b-4c63-9a1b-0c1d2e3f4a5b";
    const calls: Array<{ table: string; select: string; filters: unknown[][] }> = [];
    const db = {
      from(table: string) {
        const c = { table, select: "", filters: [] as unknown[][] };
        calls.push(c);
        const b: Record<string, unknown> = { select: (cols: string) => { c.select = cols; return b; }, maybeSingle: async () => ({ data: table === "report_insights" ? { report_id: id, facts: [], fields: { kind: "competitive" } } : { id, client_id: "c1" }, error: null }) };
        for (const op of ["eq", "order", "limit"]) b[op] = (...a: unknown[]) => { c.filters.push([op, ...a]); return b; };
        return b;
      },
    };
    // deno-lint-ignore no-explicit-any
    const store = makeStore(db as any);
    const scope = { allows: () => true } as never;
    for (const [get, table] of [["getReport", "reports"], ["getCompetitiveReport", "competitive_reports"]] as const) {
      calls.length = 0;
      expect(await store[get](id, scope)).toMatchObject({ id, insights: { report_id: id } });
      expect(calls[1]).toEqual({ table: "report_insights", select: SHOWN_INSIGHT_COLUMNS, filters: [["eq", "report_table", table], ["eq", "report_id", id], ["order", "confirmed_at", { ascending: false }], ["limit", 1]] });
    }
  });

  it("is read with its own fields when its insights can't be read: an API read never fails for them", async () => {
    const id = "6f1c1a3e-6c1b-4c63-9a1b-0c1d2e3f4a5b";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = {
      from(table: string) {
        const b: Record<string, unknown> = { select: () => b, eq: () => b, order: () => b, limit: () => b,
          maybeSingle: async () => (table === "report_insights" ? { data: null, error: { message: "permission denied for table report_insights" } } : { data: { id, client_id: "c1" }, error: null }) };
        return b;
      },
    };
    // deno-lint-ignore no-explicit-any
    const store = makeStore(db as any);
    expect(await store.getReport(id, { allows: () => true } as never)).toEqual({ id, client_id: "c1", insights: null });
    expect(await store.getCompetitiveReport(id, { allows: () => true } as never)).toEqual({ id, client_id: "c1", insights: null });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
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
function answeringDb(answer: (call: Call) => unknown[] | { error: string }) {
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
    const { db, calls } = answeringDb((c) => (c.table === "trend_weeks" ? [week("w1")] : c.table === "trend_themes" ? [theme("t1", "w1", ["p1", "p2"]), theme("t2", "w1", ["p2", "p3"])] : idsOf(c).map(post)));
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
    const none = answeringDb(() => []);
    expect(await makeStore(none.db).trendRows("c-bader", "2026-08-01", "2026-08-31")).toEqual({ weeks: [], themes: [], posts: [] });
    expect(none.calls.map((c) => c.table)).toEqual(["trend_weeks"]);
    const bare = answeringDb((c) => (c.table === "trend_weeks" ? [week("w1")] : c.table === "trend_themes" ? [theme("t1", "w1", [])] : []));
    await makeStore(bare.db).trendRows("c-bader", "2026-08-01", "2026-08-31");
    expect(bare.calls.map((c) => c.table)).toEqual(["trend_weeks", "trend_themes"]);
  });
  it("reads a long period in groups, so no request line or answer grows past its limit", async () => {
    const weekIds = Array.from({ length: 150 }, (_, i) => `w${i}`);
    const postIds = Array.from({ length: 250 }, (_, i) => `p${i}`);
    const { db, calls } = answeringDb((c) => (c.table === "trend_weeks" ? weekIds.map(week) : c.table === "trend_themes" ? idsOf(c).map((w) => theme(`t-${w}`, w, w === "w0" ? postIds : [])) : idsOf(c).map(post)));
    const out = await makeStore(db).trendRows("c-bader", "2026-01-01", "2026-12-31");
    const themeCalls = calls.filter((c) => c.table === "trend_themes"), postCalls = calls.filter((c) => c.table === "trend_posts");
    expect(themeCalls.map((c) => idsOf(c).length)).toEqual([100, 50]);
    expect(postCalls.map((c) => idsOf(c).length)).toEqual([100, 100, 50]);
    expect(out.themes).toHaveLength(150);
    expect(out.posts.map((p) => p.id)).toEqual(postIds);
  });
  it("fails the report read when a trend read fails, rather than serving a period with themes missing", async () => {
    const { db } = answeringDb((c) => (c.table === "trend_weeks" ? [week("w1")] : { error: "permission denied for table trend_themes" }));
    await expect(makeStore(db).trendRows("c-bader", "2026-08-01", "2026-08-31")).rejects.toThrow("permission denied");
  });
});
