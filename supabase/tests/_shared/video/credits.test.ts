import { describe, it, expect } from "vitest";
import { creditsUsed, withCredits } from "../../../functions/_shared/video/credits";

const AT = "2026-11-03T12:00:00.000Z";

describe("withCredits", () => {
  it("records the clip with the price it was ordered at, keeping earlier records", () => {
    const earlier = [{ what: "footage", job_id: "f0", credits: 90, at: AT }];
    const list = withCredits(earlier, { what: "footage", job_id: "f1", credits: null, at: AT });
    expect(list).toEqual([
      { what: "footage", job_id: "f0", credits: 90, at: AT },
      { what: "footage", job_id: "f1", credits: null, at: AT },
    ]);
  });
  it("records a job only once, however often its step runs", () => {
    const once = withCredits(undefined, { what: "footage", job_id: "f1", credits: 100, at: AT });
    expect(withCredits(once, { what: "footage", job_id: "f1", credits: 100, at: AT })).toHaveLength(1);
  });
});

describe("creditsUsed", () => {
  it("adds up what was recorded on the jobs' clips, and on the cleanings of jobs from before 11 Nov", () => {
    const states = [
      { credits: [{ what: "footage", job_id: "f1", credits: 100, at: AT }, { what: "clean", job_id: "c1", credits: 40.5, at: AT }] },
      { credits: [{ what: "footage", job_id: "f2", credits: null, at: AT }] },
      { final_path: "x.png" },
      null,
    ];
    expect(creditsUsed(states)).toBe(140.5);
    expect(creditsUsed([])).toBe(0);
  });
});
