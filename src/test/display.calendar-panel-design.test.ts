// Names on the design progress cards come from the one display layer
// (src/lib/display.ts), and the cards' own words are American English.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { postLabel } from "@/lib/designRequestLabels";

describe("a post's name on a progress card", () => {
  it("starts with the platform as the one display layer spells it", () => {
    expect(postLabel({ platform: "LinkedIn", post_copy: "x" })).toMatch(/^LinkedIn · /);
    expect(postLabel({ platform: "linkedin_company", post_copy: "x" })).toMatch(/^LinkedIn · /);
    expect(postLabel({ platform: "Twitter/X", post_copy: "x" })).toMatch(/^X · /);
    expect(postLabel({ platform: "youtube", post_copy: "x" })).toMatch(/^YouTube · /);
    expect(postLabel({ platform: "Instagram", post_copy: "x" })).toMatch(/^Instagram · /);
  });

  it("says Post when the request names no platform, and cuts long copy to eight words", () => {
    expect(postLabel({ platform: null, post_copy: "one two" })).toBe("Post · one two");
    expect(postLabel({ platform: "Instagram", post_copy: "a b c d e f g h i" })).toBe("Instagram · a b c d e f g h…");
  });
});
