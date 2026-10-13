import { describe, expect, it } from "vitest";
import { competitiveStatusBadge } from "@/lib/competitiveStatus";
import { watchExpired, watchInterval, WATCH_LIMIT_MINUTES } from "@/lib/runWatch";

describe("competitiveStatusBadge", () => {
  it("names every stored status in plain words", () => {
    expect(competitiveStatusBadge("complete")).toEqual({ label: "Ready", variant: "default" });
    expect(competitiveStatusBadge("running")).toEqual({ label: "In progress", variant: "secondary" });
    expect(competitiveStatusBadge("failed")).toEqual({ label: "Did not finish", variant: "destructive" });
  });

  it("never prints a raw database value", () => {
    for (const status of ["complete", "running", "failed", "draft", "", null, undefined, "something_new"]) {
      const { label } = competitiveStatusBadge(status);
      expect(label).not.toBe(status);
      expect(label).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
    }
  });

  it("says a held report is awaiting review, but a running one is still in progress", () => {
    expect(competitiveStatusBadge("complete", { held: true }).label).toBe("Awaiting review");
    expect(competitiveStatusBadge("failed", { held: true }).label).toBe("Awaiting review");
    expect(competitiveStatusBadge("running", { held: true }).label).toBe("In progress");
  });
});

describe("run watch", () => {
  const start = Date.parse("2026-10-13T08:00:00Z");
  const at = (minutes: number) => start + minutes * 60000;

  it("keeps polling an active run inside the limit and stops after it", () => {
    expect(watchInterval(true, "2026-10-13T08:00:00Z", 5000, at(10))).toBe(5000);
    expect(watchInterval(true, "2026-10-13T08:00:00Z", 5000, at(WATCH_LIMIT_MINUTES - 1))).toBe(5000);
    expect(watchInterval(true, "2026-10-13T08:00:00Z", 5000, at(WATCH_LIMIT_MINUTES))).toBe(false);
    expect(watchExpired(start, at(WATCH_LIMIT_MINUTES + 30))).toBe(true);
  });

  it("does not poll a run that is no longer active", () => {
    expect(watchInterval(false, "2026-10-13T08:00:00Z", 5000, at(1))).toBe(false);
  });

  it("does not treat an unknown start time as expired", () => {
    expect(watchExpired(null, at(500))).toBe(false);
    expect(watchExpired("not a date", at(500))).toBe(false);
  });
});

describe("measuredEngagements", () => {
  it("adds up the measured likes, comments and shares", async () => {
    const { measuredEngagements } = await import("@/lib/trendEngagement");
    expect(measuredEngagements({ likes: 1200, comments: 30, shares: 4 })).toBe(1234);
    expect(measuredEngagements({ likes: "10", comments: null, shares: undefined })).toBe(10);
    expect(measuredEngagements({})).toBeNull();
    expect(measuredEngagements({ likes: "n/a" })).toBeNull();
  });
});
