import { describe, expect, it } from "vitest";
import { designPrompt } from "../../../functions/_shared/canva/brief";

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

// Notes on regenerate (Lital, 3 Nov 2026): the image model sees the note in
// one sentence, on every kind of design, and the logo stays as it is.
describe("a note on Regenerate", () => {
  const note = "Show the rink at night, no people";
  const sentence = 'Follow this note from the person who asked for the design, keeping the logo exactly as it is: "Show the rink at night, no people".';

  it("is one sentence in the prompt for a post, a carousel slide, a Story and a video card", () => {
    const prompts = {
      post: designPrompt({ ...g, note }, ["Captains pay last"], 2),
      slide: designPrompt({ ...g, note }, ["Captains pay last"], 2, { index: 1, count: 5, withCover: true }),
      story: designPrompt({ ...g, surface: "story", note }, ["Captains pay last"], 2),
      card: designPrompt({ ...g, video_card: "end", note }, ["Captains pay last"], 1),
    };
    for (const [kind, p] of Object.entries(prompts)) {
      expect(p.split(sentence).length - 1, kind).toBe(1);
      expect(p.indexOf(sentence), kind).toBeGreaterThan(p.indexOf("The picture shows"));
    }
  });

  it("leaves the prompt as it was without one", () => {
    expect(designPrompt({ ...g, note: "" }, ["Captains pay last"], 2)).toBe(designPrompt(g, ["Captains pay last"], 2));
    expect(designPrompt(g, ["Captains pay last"], 2)).not.toContain("note");
  });
});

import { ALIGNED, designPrompt as promptOf } from "../../../functions/_shared/canva/brief";

describe("the words follow the logo's axis", () => {
  const g = { brand_name: "Northwind", platform: "Instagram", concept: "a bowl on a table" };

  it("tells the image model so for a post, a Story and a carousel slide, before the closing rules", () => {
    const post = promptOf(g, ["Four signs", "One shop"], 2);
    const story = promptOf({ ...g, surface: "story" as const }, ["Four signs"], 2);
    const slide = promptOf(g, ["Four signs"], 2, { index: 1, count: 5, withCover: true });
    const labeled = promptOf(g, ["Four signs"], 2, undefined, ["Plan", "Build"], "stacked under the headline");
    for (const p of [post, story, slide, labeled]) {
      expect(p).toContain(ALIGNED);
      expect(p.indexOf(ALIGNED)).toBeGreaterThan(p.indexOf("spelled exactly"));
      expect(p.indexOf(ALIGNED)).toBeLessThan(p.lastIndexOf("no other logo"));
    }
    expect(labeled.indexOf(ALIGNED)).toBeGreaterThan(labeled.indexOf("Where the labels sit"));
  });

  it("says a centered logo means a centered block with equal space at its sides, and a side logo means that side's margin", () => {
    expect(ALIGNED).toContain("every word is centered across the page as well, as one block with equal space on its left and right");
    expect(ALIGNED).not.toMatch(/label|square/i);
    expect(ALIGNED).toContain("the words start from that side's margin, in line with the logo");
    expect(ALIGNED).toContain("never push them off that axis");
  });

  it("leaves a video's cards as they were", () => {
    expect(promptOf({ ...g, video_card: "cover" as const }, ["Four signs"], 2)).not.toContain(ALIGNED);
  });
});
