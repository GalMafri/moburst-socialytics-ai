import { describe, expect, it } from "vitest";
import { decodeCursor } from "../../functions/_shared/api/cursor";
import { capItems, capPage, listLimit, pickSections, RESULT_CAP } from "../../functions/mcp/limits";

const size = (v: unknown) => JSON.stringify(v).length;
const row = (i: number, text = "x".repeat(1000)) => ({ id: `id-${String(i).padStart(2, "0")}`, created_at: `2026-09-${String(30 - i).padStart(2, "0")}T10:00:00.000Z`, text });

describe("listLimit", () => {
  it("is 20 by default and at most 50, at least 1", () => {
    expect(listLimit(undefined)).toBe(20);
    expect(listLimit(5)).toBe(5);
    expect(listLimit(500)).toBe(50);
    expect(listLimit(0)).toBe(1);
    expect(listLimit(7.8)).toBe(7);
  });
});

describe("capPage", () => {
  it("leaves a page under the cap as the API answered it", () => {
    const page = { data: [row(1), row(2)], next_cursor: "abc" };
    expect(capPage(page)).toBe(page);
  });

  it("ends a page that would pass the cap at the last whole item, with a cursor for the rest", () => {
    const data = Array.from({ length: 12 }, (_, i) => row(i, "y".repeat(10_000)));
    const out = capPage({ data, next_cursor: null }, 50_000);
    expect(size(out)).toBeLessThanOrEqual(50_000);
    expect(out.data.length).toBe(4);
    expect(out.data).toEqual(data.slice(0, 4));
    expect(decodeCursor(out.next_cursor)).toEqual({ c: data[3].created_at, i: data[3].id });
  });

  it("always returns at least one item, so a page can be read through", () => {
    const out = capPage({ data: [row(1, "z".repeat(200)), row(2)], next_cursor: null }, 100);
    expect(out.data).toHaveLength(1);
    expect(decodeCursor(out.next_cursor)).toEqual({ c: row(1).created_at, i: "id-01" });
  });
});

describe("capItems", () => {
  it("keeps the leading whole items that fit and counts the rest", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ n: i, text: "w".repeat(1000) }));
    const out = capItems(items, (kept) => ({ collected: true, themes: kept }), 5_000);
    expect(out.kept).toEqual(items.slice(0, 4));
    expect(out.omitted).toBe(6);
    expect(capItems(items, (kept) => ({ themes: kept })).omitted).toBe(0);
  });
});

describe("pickSections", () => {
  const ORDER = ["analysis", "calendar", "performance", "trends"] as const;
  const report = { id: "rep-1", status: "completed", period: { start: "2026-08-01", end: "2026-08-31" }, analysis: { text: "a".repeat(40_000) }, calendar: [{ text: "c".repeat(30_000) }], performance: { text: "p".repeat(20_000) }, trends: { tiktok: { posts: 3 } } };

  it("returns the header and every section when the whole fits", () => {
    expect(pickSections(report, ORDER)).toEqual({ data: report });
  });

  it("keeps the header and the whole sections that fit, in order, and names the rest", () => {
    const out = pickSections(report, ORDER, undefined, 75_000);
    expect(Object.keys(out.data)).toEqual(["id", "status", "period", "analysis", "calendar", "trends"]);
    expect(out.omitted_sections).toEqual(["performance"]);
    expect(size(out)).toBeLessThanOrEqual(75_000);
  });

  it("returns only the sections asked for, in the fixed order, and never names the others as omitted", () => {
    const out = pickSections(report, ORDER, ["trends", "calendar"]);
    expect(Object.keys(out.data)).toEqual(["id", "status", "period", "calendar", "trends"]);
    expect(out.omitted_sections).toBeUndefined();
  });

  it("returns one section asked for on its own even when it alone passes the cap", () => {
    const out = pickSections(report, ORDER, ["analysis"], 10_000);
    expect(out.data.analysis).toEqual(report.analysis);
    expect(out.omitted_sections).toBeUndefined();
  });

  it("caps at 100,000 characters by default", () => {
    expect(RESULT_CAP).toBe(100_000);
  });
});
