import { describe, expect, it } from "vitest";
import { STORY_OUTPUT, STORY_PAGE, STORY_PICTURE, STORY_SAFE, canBeStory, isStoryFormat, isStoryPost, storyLogoPlacement, storyTextBand } from "./story";
import { canvasLogoRect } from "../canva/brief";

// Stories for Facebook and Instagram (Lital, 2 Nov 2026). Spec:
// docs/superpowers/specs/2026-11-02-stories-design.md

describe("what a Story is", () => {
  it("is the format Story, however the planner or a person wrote it", () => {
    for (const f of ["Story", "story", " Stories ", "Instagram Story", "IG Story", "Facebook Story"]) expect(isStoryFormat(f), f).toBe(true);
    for (const f of ["Single image", "Reel", "Story video", "Storyboard", "Carousel", "", null, undefined]) expect(isStoryFormat(f), String(f)).toBe(false);
  });

  it("is made for Facebook and Instagram only", () => {
    expect(canBeStory("Instagram")).toBe(true);
    expect(canBeStory("facebook")).toBe(true);
    expect(canBeStory("fb_instagram_account")).toBe(true);
    for (const p of ["LinkedIn", "TikTok", "X", "YouTube", "", null]) expect(canBeStory(p), String(p)).toBe(false);
    expect(isStoryPost({ format: "Story", platform: "Instagram" })).toBe(true);
    expect(isStoryPost({ format: "Story", platform: "TikTok" })).toBe(false);
    expect(isStoryPost({ format: "Single image", platform: "Instagram" })).toBe(false);
  });
});

describe("the Story's sizes", () => {
  it("draws an exact 9:16 page, has the model draw it near 4K and delivers it at Meta's recommended size", () => {
    expect(STORY_PAGE).toEqual({ width: 1152, height: 2048 });
    expect(STORY_PAGE.width % 16).toBe(0);
    expect(STORY_PAGE.height % 16).toBe(0);
    expect(STORY_PICTURE).toEqual([2160, 3840]);
    expect(STORY_OUTPUT).toEqual([1440, 2560]);
  });

  it("keeps words and logo out of the top 14%, the bottom 35% and 6% at each side", () => {
    expect(STORY_SAFE).toEqual({ top: 0.14, bottom: 0.35, left: 0.06, right: 0.06 });
    expect(storyTextBand(STORY_PAGE.width, STORY_PAGE.height)).toEqual({ x: 69, y: 287, width: 1014, height: 1044 });
  });
});

describe("the logo's spot on a Story", () => {
  // As fractions of the frame, the way design_brand_settings.placement keeps them.
  const pageRect = (p: Parameters<typeof storyLogoPlacement>[0], w: number, h: number) => canvasLogoRect(storyLogoPlacement(p, w, h), w, h, STORY_PAGE.width, STORY_PAGE.height);
  const inBand = (r: { x: number; y: number; width: number; height: number }) => {
    expect(r.y).toBeGreaterThanOrEqual(Math.floor(STORY_PAGE.height * STORY_SAFE.top));
    expect(r.y + r.height).toBeLessThanOrEqual(Math.ceil(STORY_PAGE.height * (1 - STORY_SAFE.bottom)));
    expect(r.x).toBeGreaterThanOrEqual(Math.floor(STORY_PAGE.width * STORY_SAFE.left));
    expect(r.x + r.width).toBeLessThanOrEqual(Math.ceil(STORY_PAGE.width * (1 - STORY_SAFE.right)));
  };

  it("moves a top logo down to the band's top, keeping its anchor and width", () => {
    // Moburst's own spot (13 Oct 2026): centered, 32.3% wide, 4.8% from the top.
    const spot = storyLogoPlacement({ anchor: "center", width: 0.323, top: 0.048 }, 701, 251);
    expect(spot).toEqual({ anchor: "center", width: 0.323, top: 0.14 });
    inBand(pageRect({ anchor: "center", width: 0.323, top: 0.048 }, 701, 251));
  });

  it("moves a bottom logo up until it ends above 65% of the frame", () => {
    const spot = storyLogoPlacement({ anchor: "right", width: 0.2, top: 0.9, left: 0.03 }, 400, 100);
    // The logo is 0.2 * 1152 / 2048 * 100 / 400 = 2.8% of the frame tall.
    expect(spot.top).toBeCloseTo(0.65 - 0.028125, 4);
    expect(spot).toMatchObject({ anchor: "right", width: 0.2, left: 0.06 });
    inBand(pageRect({ anchor: "right", width: 0.2, top: 0.9, left: 0.03 }, 400, 100));
  });

  it("leaves a logo already in the band where the client puts it", () => {
    expect(storyLogoPlacement({ anchor: "left", width: 0.25, top: 0.3, left: 0.1 }, 400, 100)).toEqual({ anchor: "left", width: 0.25, top: 0.3, left: 0.1 });
  });

  it("gives a left or right logo a side margin of at least 6%", () => {
    // LegaBot's own spot: left, 23% wide, 2.9% from the top, 3.5% from the left edge.
    const left = storyLogoPlacement({ anchor: "left", width: 0.23, top: 0.029, left: 0.035 }, 2054, 553);
    expect(left).toEqual({ anchor: "left", width: 0.23, top: 0.14, left: 0.06 });
    inBand(pageRect({ anchor: "left", width: 0.23, top: 0.029, left: 0.035 }, 2054, 553));
    const right = storyLogoPlacement({ anchor: "right", width: 0.23, top: 0.029 }, 2054, 553);
    expect(right).toEqual({ anchor: "right", width: 0.23, top: 0.14, left: 0.06 });
    inBand(pageRect({ anchor: "right", width: 0.23, top: 0.029 }, 2054, 553));
  });

  it("keeps a logo wider than the band inside it", () => {
    const spot = storyLogoPlacement({ anchor: "center", width: 0.95, top: 0.02 }, 1000, 100);
    expect(spot.width).toBeCloseTo(0.88, 4);
    inBand(pageRect({ anchor: "center", width: 0.95, top: 0.02 }, 1000, 100));
  });
});
