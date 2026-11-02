import { describe, it, expect } from "vitest";
import { filmingOutcome, planningStalled, postInstant, weekDecision } from "./requestRules";

const NOW = new Date("2026-10-19T12:00:00Z");
const h = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

describe("postInstant", () => {
  it("reads the posting time in the client's time zone", () => {
    expect(postInstant("2026-10-12", "6:00 PM", "UTC")!.toISOString()).toBe("2026-10-12T18:00:00.000Z");
    expect(postInstant("2026-10-14", "7:15 AM", "UTC")!.toISOString()).toBe("2026-10-14T07:15:00.000Z");
    expect(postInstant("2026-10-14", "12:00 AM", "UTC")!.toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(postInstant("2026-10-14", "18:30", "UTC")!.toISOString()).toBe("2026-10-14T18:30:00.000Z");
    // New York is four hours behind UTC in October, five after the clocks change.
    expect(postInstant("2026-10-20", "9:00 AM", "America/New_York")!.toISOString()).toBe("2026-10-20T13:00:00.000Z");
    expect(postInstant("2026-11-10", "9:00 AM", "America/New_York")!.toISOString()).toBe("2026-11-10T14:00:00.000Z");
  });
  it("counts from the start of the day when the time cannot be read, and UTC when the zone is unknown", () => {
    expect(postInstant("2026-10-20", "", "UTC")!.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(postInstant("2026-10-20", "evening", "Not/AZone")!.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(postInstant(null, "9:00 AM", "UTC")).toBeNull();
  });
});

describe("filmingOutcome", () => {
  it("keeps waiting for footage until a day before the post", () => {
    expect(filmingOutcome(h(30), NOW, false)).toBe("keep");
    expect(filmingOutcome(h(23), NOW, false)).toBe("no_footage");
  });
  it("closes once footage arrived, the post passed or the post is gone", () => {
    expect(filmingOutcome(h(30), NOW, true)).toBe("filmed");
    expect(filmingOutcome(h(-1), NOW, false)).toBe("post_passed");
    expect(filmingOutcome(null, NOW, false)).toBe("post_removed");
  });
});

describe("planningStalled", () => {
  it("is true only for a request still planning with nothing new for 30 minutes", () => {
    const at = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();
    expect(planningStalled({ status: "preparing", stage: "planning", updated_at: at(31) }, NOW)).toBe(true);
    expect(planningStalled({ status: "preparing", stage: "planning", updated_at: at(10) }, NOW)).toBe(false);
    expect(planningStalled({ status: "preparing", stage: "designing", updated_at: at(90) }, NOW)).toBe(false);
    expect(planningStalled({ status: "ready", stage: "planning", updated_at: at(90) }, NOW)).toBe(false);
  });
});

describe("weekDecision", () => {
  const created = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
  it("starts a post never designed, asking first whether a video needs filming", () => {
    expect(weekDecision([])).toEqual({ start: true, route: null, askFilming: true });
  });
  it("leaves a post alone while a request is being prepared or waits for footage, and once a design was made", () => {
    expect(weekDecision([{ status: "preparing", created_at: created(1) }])).toEqual({ start: false, why: "preparing" });
    expect(weekDecision([{ status: "needs_filming", created_at: created(1) }])).toEqual({ start: false, why: "filming" });
    expect(weekDecision([{ status: "ready", created_at: created(1) }])).toEqual({ start: false, why: "ready" });
  });
  it("makes a post again at once when its last request ended without a design, the way it was made: no retry timer, a person asked", () => {
    for (const end_reason of ["no_design", "no_progress"]) {
      const ended = { status: "closed", end_reason, ended_at: created(0.1), created_at: created(1), video_route: "posts" };
      expect(weekDecision([ended])).toEqual({ start: true, route: "posts", askFilming: false });
    }
  });
  it("makes a post a person stopped, the way it was made", () => {
    expect(weekDecision([{ status: "canceled", created_at: created(1), video_route: null }])).toEqual({ start: true, route: null, askFilming: false });
  });
  it("designs a filmed post from the client's posts once its footage did not arrive", () => {
    expect(weekDecision([{ status: "closed", end_reason: "no_footage", ended_at: created(0), created_at: created(48) }])).toEqual({ start: true, route: "posts", askFilming: false });
  });
  it("leaves a request that ended for another reason alone", () => {
    for (const end_reason of ["filmed", "post_passed", "post_removed"]) {
      expect(weekDecision([{ status: "closed", end_reason, ended_at: created(0), created_at: created(48) }])).toEqual({ start: false, why: "ended" });
    }
  });
  it("goes by the newest request", () => {
    const older = { status: "closed", end_reason: "no_footage", ended_at: created(30), created_at: created(40) };
    const newer = { status: "ready", created_at: created(2) };
    expect(weekDecision([older, newer])).toEqual({ start: false, why: "ready" });
    expect(weekDecision([newer, { ...older, created_at: created(1) }])).toEqual({ start: true, route: "posts", askFilming: false });
  });
});
