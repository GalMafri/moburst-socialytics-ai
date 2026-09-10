import { describe, expect, it } from "vitest";
import { HOLD_THE_FRAME } from "../../../supabase/functions/_shared/higgsfield/renderVideo";

describe("HOLD_THE_FRAME", () => {
  it("forbids the camera moves that walked the headline out of shot", () => {
    // Measured on a real clip: the opening frame was correct and by the last
    // frame the headline had drifted off the left edge behind a prop.
    for (const forbidden of ["push in", "pan", "crop", "reframing"]) {
      expect(HOLD_THE_FRAME.toLowerCase()).toContain(forbidden);
    }
  });

  it("says the text must stay legible for the whole clip", () => {
    expect(HOLD_THE_FRAME.toLowerCase()).toContain("legible");
    expect(HOLD_THE_FRAME.toLowerCase()).toContain("first frame to the last");
  });

  it("still allows the motion that makes a clip worth having", () => {
    expect(HOLD_THE_FRAME.toLowerCase()).toContain("glow");
  });
});
