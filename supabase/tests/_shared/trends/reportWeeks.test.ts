// @vitest-environment node
// A report's trend weeks: one rule for the API's report detail and the
// in-app social report (trends/reportWeeks.ts). The weeks that start in the
// period, their live themes, and the kept posts they list, never one the
// tripwire flagged.
import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { readReportTrendRows } from "../../../functions/_shared/trends/reportWeeks";
import { readStoredTrends } from "../../../functions/_shared/pipelines/social/storedTrends";
import { makeStore } from "../../../functions/_shared/socialytics-api/store";
import { industryTrendsOut } from "../../../functions/_shared/socialytics-api/serializers";

// deno-lint-ignore no-explicit-any
type Any = any;

const CLIENT = "c-bader";
const COLUMNS = { weeks: "id, client_id, week_start, status", themes: "id, week_id, client_id, position, title, post_ids, dismissed_at", posts: "id, client_id, url, kept" };
const post = (id: string, o: Any = {}) => ({ id, client_id: CLIENT, platform: "tiktok", url: `https://tiktok.example/${id}`, author: "a", text: "t", posted_at: null, format: "short_video", kept: true, tripwire: false, ...o });
const theme = (id: string, week_id: string, post_ids: string[], o: Any = {}) => ({ id, week_id, client_id: CLIENT, position: 0, title: id, happening: "", why_it_matters: "", angle: "", platforms: ["tiktok"], post_ids, dismissed_at: null, ...o });

/** August 2026: a week that starts on Monday 27 July runs into August, and is July's. */
const tables = () => ({
  trend_weeks: [
    { id: "july", client_id: CLIENT, week_start: "2026-07-27", status: "done" },
    { id: "aug-3", client_id: CLIENT, week_start: "2026-08-03", status: "done" },
    { id: "aug-31", client_id: CLIENT, week_start: "2026-08-31", status: "partial" },
    { id: "running", client_id: CLIENT, week_start: "2026-08-10", status: "running" },
  ],
  trend_themes: [
    theme("t-july", "july", ["p-july"]),
    theme("t-1", "aug-3", ["p-1", "p-flagged"]),
    theme("t-dismissed", "aug-3", ["p-1"], { dismissed_at: "2026-08-05T00:00:00Z" }),
    theme("t-2", "aug-31", ["p-2", "p-dropped"]),
    theme("t-running", "running", ["p-1"]),
  ],
  trend_posts: [post("p-july"), post("p-1"), post("p-flagged", { tripwire: true }), post("p-2"), post("p-dropped", { kept: false })],
});

describe("readReportTrendRows", () => {
  it("reads the finished weeks that start in the period: a week whose Monday is in the month before is left out", async () => {
    const rows = await readReportTrendRows<Any, Any, Any>(fakeDb(tables()), CLIENT, "2026-08-01", "2026-08-31", COLUMNS);
    expect(rows.weeks.map((w) => w.id).sort()).toEqual(["aug-3", "aug-31"]);
    expect(rows.themes.map((t) => t.id).sort()).toEqual(["t-1", "t-2"]);
  });

  it("never reads a post the tripwire flagged, nor one the filter dropped", async () => {
    const rows = await readReportTrendRows<Any, Any, Any>(fakeDb(tables()), CLIENT, "2026-08-01", "2026-08-31", COLUMNS);
    expect(rows.posts.map((p) => p.id).sort()).toEqual(["p-1", "p-2"]);
  });
});

describe("every reader of a report reads the same weeks and posts", () => {
  it("the API's report detail and the in-app report", async () => {
    const report = { client_id: CLIENT, date_range_start: "2026-08-01", date_range_end: "2026-08-31" };
    const api = industryTrendsOut(await makeStore(fakeDb(tables()) as never).trendRows(CLIENT, report.date_range_start, report.date_range_end), report as never)!;
    const inApp = (await readStoredTrends(fakeDb(tables()), CLIENT, report.date_range_start, report.date_range_end))!;
    expect(api.themes.map((t) => t.title)).toEqual(inApp.themes.map((t) => t.title));
    expect(api.themes.map((t) => t.posts.map((p) => p.url))).toEqual(inApp.themes.map((t) => t.post_urls));
    expect(JSON.stringify(api)).not.toContain("p-flagged");
    expect(JSON.stringify(inApp)).not.toContain("p-flagged");
    expect(JSON.stringify(api)).not.toContain("p-july");
  });

  it("the API leaves out a flagged post even when one reaches it", () => {
    const rows = { weeks: [{ id: "aug-3", client_id: CLIENT, week_start: "2026-08-03", status: "done" }], themes: [theme("t-1", "aug-3", ["p-1", "p-flagged"])], posts: [post("p-1"), post("p-flagged", { tripwire: true })] };
    const out = industryTrendsOut(rows as never, { client_id: CLIENT, date_range_start: "2026-08-01", date_range_end: "2026-08-31" })!;
    expect(out.themes[0].posts.map((p) => p.url)).toEqual(["https://tiktok.example/p-1"]);
  });
});
