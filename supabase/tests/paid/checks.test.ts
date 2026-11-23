import { describe, expect, it } from "vitest";
import type { ApifyRunItem } from "../../functions/_shared/cost/audit";
import { attributeRuns, coveredRuns, loadWeeks, type WorkWindow } from "../../functions/_shared/paid/checks";

const t = (iso: string) => Date.parse(iso);
const TIKTOK = "5K30i8aFccKNF5ICs";
const LINKEDIN_POSTS = "WI0tj4Ieb5Kq458gB";
const run = (id: string, actId: string, startedAt: string): ApifyRunItem => ({ id, actId, actorTaskId: null, status: "SUCCEEDED", startedAt, finishedAt: startedAt, usageTotalUsd: 1 });
const win = (id: string, clientId: string, start: string, end: string, backfilled = false): WorkWindow => ({ id, clientId, start: t(start), end: t(end), backfilled });

describe("Socialytics history: who a past Apify run was for", () => {
  const weeks = [
    win("w-a", "client-a", "2026-10-20T07:10:00Z", "2026-10-20T07:40:00Z"),
    win("w-b", "client-b", "2026-10-21T07:10:00Z", "2026-10-21T07:40:00Z"),
    win("w-c", "client-c", "2026-10-21T07:12:00Z", "2026-10-21T07:50:00Z"),
  ];
  const reports = [win("rep-1", "client-a", "2026-10-22T10:00:00Z", "2026-10-22T13:00:00Z")];

  it("charges a trends run to the one client whose trends week was running", () => {
    const m = attributeRuns([run("r1", TIKTOK, "2026-10-20T07:15:00Z")], weeks, reports);
    expect(m.get("r1")).toEqual([{ clientId: "client-a", executionId: "w-a", share: 1, feature: "trends.week" }]);
  });

  it("leaves a trends run unattributed when several clients' weeks were running", () => {
    expect(attributeRuns([run("r2", TIKTOK, "2026-10-21T07:20:00Z")], weeks, reports).has("r2")).toBe(false);
  });

  it("charges a LinkedIn posts run to the report running, and nothing to other actors", () => {
    const m = attributeRuns([run("r3", LINKEDIN_POSTS, "2026-10-22T10:30:00Z"), run("r4", "OTHER", "2026-10-22T10:30:00Z")], weeks, reports);
    expect(m.get("r3")).toEqual([{ clientId: "client-a", executionId: "rep-1", share: 1, feature: "report.linkedin_posts" }]);
    expect(m.has("r4")).toBe(false);
  });

  it("treats a trends run inside a backfilled week as already counted, and nothing else", () => {
    const covered = coveredRuns(
      [run("in", TIKTOK, "2026-11-10T07:20:00Z"), run("out", TIKTOK, "2026-11-11T09:00:00Z"), run("li", LINKEDIN_POSTS, "2026-11-10T07:20:00Z")],
      [win("w-x", "client-a", "2026-11-10T07:10:00Z", "2026-11-10T07:40:00Z", true), win("w-y", "client-a", "2026-11-11T07:10:00Z", "2026-11-11T07:40:00Z", false)],
    );
    expect([...covered]).toEqual(["in"]);
  });

  it("marks a week backfilled when the 23 Nov backfill row for its Apify dollars exists", async () => {
    const rows: Record<string, any[]> = {
      trend_weeks: [{ id: "w1", client_id: "c1", created_at: "2026-11-10T07:10:00Z", finished_at: "2026-11-10T07:40:00Z" }, { id: "w2", client_id: "c2", created_at: "2026-11-10T07:10:00Z", finished_at: null }],
      cost_events: [{ idempotency_key: "backfill:trend_weeks:w1:apify" }],
    };
    const q = (table: string) => {
      const chain: any = { select: () => chain, gte: () => chain, lte: () => chain, order: () => chain, in: () => Promise.resolve({ data: rows[table], error: null }), range: () => Promise.resolve({ data: rows[table], error: null }) };
      return chain;
    };
    const weeks = await loadWeeks({ from: q, rpc: async () => ({ data: null, error: null }) }, t("2026-11-10T07:00:00Z"), t("2026-11-10T08:00:00Z"));
    expect(weeks.map((w) => [w.id, w.backfilled, w.end - w.start])).toEqual([["w1", true, 30 * 60_000], ["w2", false, 3 * 60 * 60_000]]);
  });
});
