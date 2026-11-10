import { describe, it, expect } from "vitest";
import { creditsUsed, withCredits } from "../../../functions/_shared/video/credits";

const AT = "2026-11-03T12:00:00.000Z";

describe("withCredits", () => {
  it("records each clip and each cleaning with the credits quoted for it, keeping earlier ones", () => {
    let list = withCredits(undefined, { what: "footage", job_id: "f1", credits: 100, at: AT });
    list = withCredits(list, { what: "clean", job_id: "c1", credits: 40, at: AT });
    // A clip made again (no sound, or writing two cleanings couldn't remove) is one more entry.
    list = withCredits(list, { what: "footage", job_id: "f2", credits: null, at: AT });
    expect(list).toEqual([
      { what: "footage", job_id: "f1", credits: 100, at: AT },
      { what: "clean", job_id: "c1", credits: 40, at: AT },
      { what: "footage", job_id: "f2", credits: null, at: AT },
    ]);
  });
  it("records a job only once, however often its step runs", () => {
    const once = withCredits(undefined, { what: "footage", job_id: "f1", credits: 100, at: AT });
    expect(withCredits(once, { what: "footage", job_id: "f1", credits: 100, at: AT })).toHaveLength(1);
  });
});

describe("creditsUsed", () => {
  it("adds up what was quoted on every clip and cleaning of the jobs", () => {
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
