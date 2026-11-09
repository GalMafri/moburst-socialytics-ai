import { describe, expect, it } from "vitest";
import { STORY_NOT_SCHEDULABLE, publishProblems } from "../../../functions/_shared/sprout/publishRules";

const ready = { text: "Captains pay last.", mediaUrls: ["https://x.supabase.co/storage/v1/object/public/generated-media/c1/final.png"] };

describe("publishProblems and Stories", () => {
  it("answers a Story with how it is posted instead, on Instagram and on Facebook", () => {
    expect(STORY_NOT_SCHEDULABLE).toBe("Stories can't be scheduled through Sprout. Post this one from the Instagram or Facebook app, or Meta Business Suite.");
    for (const network of ["instagram", "fb_instagram_account", "facebook", "Instagram"]) {
      expect(publishProblems({ ...ready, network, format: "Story" }), network).toEqual([STORY_NOT_SCHEDULABLE]);
    }
  });

  it("leaves every other post to the network's own rules", () => {
    expect(publishProblems({ ...ready, network: "instagram", format: "Single image" })).toEqual([]);
    expect(publishProblems({ ...ready, network: "instagram" })).toEqual([]);
    // A post called Story on another network is checked as it always was.
    expect(publishProblems({ ...ready, network: "linkedin", format: "Story" })).toEqual([]);
  });
});
