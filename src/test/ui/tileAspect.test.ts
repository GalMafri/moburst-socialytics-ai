import { describe, expect, it } from "vitest";
import { tileAspectFor } from "@/lib/tileAspect";

describe("tileAspectFor", () => {
  it("gives a landscape post a landscape box, so a 16:9 clip is not cropped to a portrait tile", () => {
    // A LinkedIn clip really is 1280x720. Showing it in a 9:16 box with
    // object-cover cut the headline off both sides.
    expect(tileAspectFor({ format: "landscape", platform: "LinkedIn" })).toBe("aspect-video");
    expect(tileAspectFor({ format: "article", platform: "LinkedIn" })).toBe("aspect-video");
  });

  it("keeps vertical formats vertical", () => {
    expect(tileAspectFor({ format: "reel", platform: "Instagram" })).toBe("aspect-[9/16]");
    expect(tileAspectFor({ format: "story", platform: "Instagram" })).toBe("aspect-[9/16]");
    expect(tileAspectFor({ format: "", platform: "TikTok" })).toBe("aspect-[9/16]");
  });

  it("falls back to square", () => {
    expect(tileAspectFor({ format: "carousel", platform: "Instagram" })).toBe("aspect-square");
    expect(tileAspectFor(null)).toBe("aspect-square");
  });
});
