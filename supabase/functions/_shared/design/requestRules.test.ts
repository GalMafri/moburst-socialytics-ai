import { describe, it, expect } from "vitest";
import { autoDecision, filmingOutcome, nextDesignAttempt, planningStalled, postInstant } from "./requestRules";

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

describe("nextDesignAttempt", () => {
  it("waits half the time left, between an hour and a day, and never past the post", () => {
    expect(nextDesignAttempt(NOW, h(24 * 5))!.toISOString()).toBe(h(24).toISOString());
    expect(nextDesignAttempt(NOW, h(10))!.toISOString()).toBe(h(5).toISOString());
    expect(nextDesignAttempt(NOW, h(1.5))!.toISOString()).toBe(h(1).toISOString());
    expect(nextDesignAttempt(NOW, h(1))).toBeNull();
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

describe("autoDecision", () => {
  const created = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
  it("starts a post never designed, asking first whether a video needs filming", () => {
    expect(autoDecision([], h(48), NOW)).toEqual({ start: true, route: null, askFilming: true });
  });
  it("leaves a post alone while a request is open, ready, stopped by a person or waiting for footage", () => {
    for (const status of ["preparing", "ready", "canceled", "needs_filming"]) {
      expect(autoDecision([{ status, created_at: created(1) }], h(48), NOW)).toEqual({ start: false });
    }
  });
  it("makes a request that ended without a design again once it is due, the way it was made", () => {
    const ended = { status: "closed", end_reason: "no_design", ended_at: created(25), created_at: created(26), video_route: "posts" };
    expect(autoDecision([ended], h(24 * 4), NOW)).toEqual({ start: true, route: "posts", askFilming: false });
    expect(autoDecision([{ ...ended, ended_at: created(2) }], h(24 * 4), NOW)).toEqual({ start: false });
    // Close to the post the wait is shorter, and none starts once the post is too close.
    expect(autoDecision([{ ...ended, ended_at: created(3) }], h(2), NOW)).toEqual({ start: true, route: "posts", askFilming: false });
    expect(autoDecision([{ ...ended, ended_at: created(0.2) }], h(0.5), NOW)).toEqual({ start: false });
  });
  it("designs a filmed post from the posts once its footage did not arrive, and never again after the post passed", () => {
    expect(autoDecision([{ status: "closed", end_reason: "no_footage", ended_at: created(0), created_at: created(48) }], h(12), NOW)).toEqual({ start: true, route: "posts", askFilming: false });
    expect(autoDecision([{ status: "closed", end_reason: "post_passed", ended_at: created(0), created_at: created(48) }], h(-2), NOW)).toEqual({ start: false });
    expect(autoDecision([{ status: "closed", end_reason: "filmed", ended_at: created(0), created_at: created(48) }], h(12), NOW)).toEqual({ start: false });
  });
  it("goes by the newest request", () => {
    const older = { status: "closed", end_reason: "no_footage", ended_at: created(30), created_at: created(40) };
    const newer = { status: "closed", end_reason: "no_design", ended_at: created(1), created_at: created(2), video_route: "posts" };
    expect(autoDecision([older, newer], h(48), NOW)).toEqual({ start: false });
  });
});
