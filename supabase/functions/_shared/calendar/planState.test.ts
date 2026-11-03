// What a week's plan lets people do (Lital, 3 Nov 2026), the one rule the
// calendar-posts function and the calendar screen share.

import { describe, expect, it } from "vitest";
import { planInFlight, plannable } from "./planState";

describe("a week's plan", () => {
  it("can be planned when it has no plan, failed before 20 Oct 2026, or was stopped or removed by a person", () => {
    expect(plannable(undefined)).toBe(true);
    expect(plannable(null)).toBe(true);
    expect(plannable("failed")).toBe(true);
    expect(plannable("canceled")).toBe(true);
    for (const status of ["queued", "planning", "ready", "expired"]) expect(plannable(status), status).toBe(false);
  });

  it("is on its way while queued or being written, and only then can planning be stopped", () => {
    expect(planInFlight("queued")).toBe(true);
    expect(planInFlight("planning")).toBe(true);
    for (const status of ["ready", "failed", "expired", "canceled", undefined]) expect(planInFlight(status), String(status)).toBe(false);
  });
});
