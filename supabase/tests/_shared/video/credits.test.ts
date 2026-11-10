import { describe, it, expect } from "vitest";
import { creditsUsed } from "../../../functions/_shared/video/credits";

const AT = "2026-11-03T12:00:00.000Z";

describe("creditsUsed", () => {
  it("adds up each clip order's credits", () => {
    expect(creditsUsed([
      { state: {}, clip_order: { price: 128, at: AT, job_id: "hf-1", credits: 128 } },
      { state: {}, clip_order: { price: 100, at: AT, job_id: "hf-2", credits: 99.5 } },
      // Placed but never answered, or not read: nothing recorded.
      { state: {}, clip_order: { price: 128, at: AT } },
      { state: {}, clip_order: { price: 128, at: AT, job_id: "hf-3", credits: null } },
    ])).toBe(227.5);
  });
  it("also counts the clips and cleanings recorded in state by jobs from before 11 Nov", () => {
    expect(creditsUsed([
      { state: { credits: [{ what: "footage", job_id: "f1", credits: 100, at: AT }, { what: "clean", job_id: "c1", credits: 40.5, at: AT }] }, clip_order: null },
      { state: { credits: [{ what: "footage", job_id: "f2", credits: null, at: AT }] } },
      { state: { final_path: "x.png" }, clip_order: "null" },
      null,
    ])).toBe(140.5);
    expect(creditsUsed([])).toBe(0);
  });
});
