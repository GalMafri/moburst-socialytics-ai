import { describe, it, expect } from "vitest";
import { mondayOf, weeksToPlan, type WeekOwner } from "./plans";

const OLD = { id: "old-report", created_at: "2026-10-07T07:31:00Z" };
const NEW = { id: "new-report", created_at: "2026-11-07T07:31:00Z" };
const owners = (entries: Array<[string, { id: string; created_at: string }]>) =>
  new Map<string, WeekOwner>(entries.map(([week, r]) => [week, { report_id: r.id, created_at: r.created_at }]));

describe("weeksToPlan", () => {
  it("fills every week of the window no plan holds, the current one included", () => {
    // Bader on Monday 19 Oct: nothing planned after 18 Oct.
    expect(weeksToPlan({ today: "2026-10-19", latest: OLD, owners: new Map() })).toEqual(["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]);
  });

  it("plans nothing when the latest report's plan holds the whole window", () => {
    const held = owners([["2026-10-19", OLD], ["2026-10-26", OLD], ["2026-11-02", OLD], ["2026-11-09", OLD]]);
    expect(weeksToPlan({ today: "2026-10-21", latest: OLD, owners: held })).toEqual([]);
  });

  it("re-plans an older plan's weeks from next week on when a newer report lands, never the current week", () => {
    const held = owners([["2026-11-02", OLD], ["2026-11-09", NEW], ["2026-11-16", OLD]]);
    // The new report (Sat 7 Nov) took its own week of 9 Nov; on Sat 7 Nov the window is 2 Nov to 23 Nov.
    expect(weeksToPlan({ today: "2026-11-07", latest: NEW, owners: held })).toEqual(["2026-11-16", "2026-11-23"]);
  });

  it("leaves a week a newer plan holds", () => {
    const held = owners([["2026-11-09", NEW], ["2026-11-16", NEW]]);
    expect(weeksToPlan({ today: "2026-11-09", latest: OLD, owners: held })).toEqual(["2026-11-23", "2026-11-30"]);
  });
});

describe("mondayOf", () => {
  it("finds the week's Monday from a date or a timestamp", () => {
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(mondayOf("2026-11-07T07:15:00+00:00")).toBe("2026-11-02");
  });
});
