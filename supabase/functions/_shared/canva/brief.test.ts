import { describe, expect, it } from "vitest";
import { designPrompt } from "./brief";

const g = { brand_name: "Pay The Pyper", platform: "Instagram", concept: "a hockey bench at dawn" };

describe("designPrompt", () => {
  it("draws a feed post on a 4:5 canvas", () => {
    const p = designPrompt(g, ["Captains pay last"], 2);
    expect(p).toContain("post (4:5)");
    expect(p).not.toContain("9:16");
  });

  it("draws a Story on a 9:16 canvas, the picture filling the frame and every word inside Meta's band", () => {
    const p = designPrompt({ ...g, surface: "story" }, ["Captains pay last", "Tap to see how"], 2);
    expect(p).toContain("Story (9:16)");
    expect(p).toContain("filling the tall frame");
    expect(p).toContain("leaves out the top 14%, the bottom 35% and 6% at each side");
    expect(p).toContain('Headline, spelled exactly: "Captains pay last"');
    expect(p).toContain('Second line, spelled exactly: "Tap to see how"');
    expect(p).not.toContain("4:5");
  });

  it("keeps a video card's prompt as it was", () => {
    const p = designPrompt({ ...g, video_card: "cover" }, ["Captains pay last"], 1);
    expect(p).toContain("vertical video (9:16)");
    expect(p).not.toContain("Story");
  });
});
