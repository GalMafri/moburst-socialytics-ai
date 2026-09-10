import { describe, expect, it } from "vitest";
import { pictureBrief } from "../../../supabase/functions/_shared/design-prompts/pictureBrief";

describe("pictureBrief", () => {
  it("drops a headline label line", () => {
    expect(pictureBrief('Headline: Five Assumptions Breaking in Digital Growth\n\nA dark cosmic ground with one gem.')).toBe(
      "A dark cosmic ground with one gem.",
    );
  });

  it("drops the sentence that exists to place type", () => {
    const out = pictureBrief(
      "A close-up of layered translucent shapes converging into one form. Headline 'Creative Ideation' in heavy sans, lower-left.",
    );
    expect(out).toBe("A close-up of layered translucent shapes converging into one form.");
  });

  it("keeps a sentence that forbids text", () => {
    const out = pictureBrief("One emerald on a navy ground. No text anywhere in the frame.");
    expect(out).toContain("No text anywhere");
  });

  it("removes a quoted phrase but keeps the picture around it", () => {
    const out = pictureBrief('An overturned car at dusk with the word "STOP" on a sign.');
    expect(out).not.toContain("STOP");
  });

  it("leaves a clean picture brief untouched", () => {
    const s = "A black-and-white attorney cutout on a saturated red ground, shot from slightly below.";
    expect(pictureBrief(s)).toBe(s);
  });
});
