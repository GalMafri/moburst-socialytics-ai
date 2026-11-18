import { describe, expect, it } from "vitest";
import {
  MAX_EDGE, MIN_EDGE, SHAPE_TOLERANCE, STILL_PAGE,
  checkSize, jobShape, pageFor, pagePlacement, plannerShape, shapeLabel, shapeWord, uploadSizeKey, uploadSizeKeys,
} from "../../../functions/_shared/design/platformSize";
import { readUploadSize } from "../../../functions/_shared/design/platformSizeDb";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { logoAreaRect } from "../../../functions/_shared/picture/geometry";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { functionsDir } from "../../paths.ts";
import { carouselPlannerPrompt, plannerPrompt } from "../../../functions/_shared/canva/options";
import { designPrompt } from "../../../functions/_shared/canva/brief";
import { canvasLogoRect } from "../../../functions/_shared/canva/brief";
import { deliveredSize, outputSize, pictureSize, type Placement } from "../../../functions/_shared/canva/finish";
import { STORY_PAGE } from "../../../functions/_shared/design/story";

// A design in the shape its platform is uploaded in: the row a request reads,
// the checks a size passes, the page it is drawn on, the size it is delivered
// at and where the logo goes.

describe("the row a post reads", () => {
  it("names the platform as the publish path does", () => {
    for (const [platform, key] of [["Instagram", "instagram"], ["Facebook", "facebook"], ["LinkedIn", "linkedin"], ["Twitter/X", "x"], ["X (Twitter)", "x"], ["x", "x"], ["Twitter", "x"], ["YouTube", "youtube"], ["TikTok", "tiktok"]]) {
      expect(uploadSizeKey({ platform, format: "image" })).toEqual({ platform: key, format: "image" });
    }
  });

  it("reads an image row for every still format the calendar writes", () => {
    for (const format of ["Single Image", "image", "photo", "static post", "Static", null, ""]) {
      expect(uploadSizeKey({ platform: "LinkedIn", format })).toEqual({ platform: "linkedin", format: "image" });
    }
  });

  it("reads a carousel row for a carousel, then the platform's image row", () => {
    expect(uploadSizeKey({ platform: "Instagram", format: "Carousel" })).toEqual({ platform: "instagram", format: "carousel" });
    expect(uploadSizeKeys({ platform: "X", format: "carousel" })).toEqual([{ platform: "x", format: "carousel" }, { platform: "x", format: "image" }]);
    expect(uploadSizeKeys({ platform: "Instagram", format: "image" })).toEqual([{ platform: "instagram", format: "image" }]);
  });

  it("reads a story row for a Story on Facebook or Instagram only", () => {
    expect(uploadSizeKey({ platform: "Instagram", format: "Story" })).toEqual({ platform: "instagram", format: "story" });
    expect(uploadSizeKey({ platform: "Facebook", format: "Stories" })).toEqual({ platform: "facebook", format: "story" });
    // A post called Story on another network is made as a still, as before.
    expect(uploadSizeKey({ platform: "LinkedIn", format: "Story" })).toEqual({ platform: "linkedin", format: "image" });
  });

  it("reads nothing for a document, a video or a post with no platform", () => {
    expect(uploadSizeKey({ platform: "LinkedIn", format: "Document/PDF" })).toBeNull();
    expect(uploadSizeKey({ platform: "Instagram", format: "Reel" })).toBeNull();
    expect(uploadSizeKey({ platform: "TikTok", format: null })).toBeNull();
    expect(uploadSizeKey({ platform: "YouTube", format: "" })).toBeNull();
    expect(uploadSizeKey({ platform: null, format: "image" })).toBeNull();
    expect(uploadSizeKey({ platform: "Twitter / X today", format: "image" })).toEqual({ platform: "x", format: "image" });
    expect(uploadSizeKey({ platform: "our blog 2", format: "image" })).toBeNull();
    expect(uploadSizeKeys({ platform: "LinkedIn", format: "PDF" })).toEqual([]);
  });
});

describe("the page a size is drawn on", () => {
  it("is today's page for a 4:5 size, so Instagram and Facebook stills are drawn as before", () => {
    expect(STILL_PAGE).toEqual({ width: 1088, height: 1360 });
    expect(pageFor({ width: 1080, height: 1350 }, "image")).toEqual(STILL_PAGE);
    expect(pageFor({ width: 1440, height: 1800 }, "carousel")).toEqual(STILL_PAGE);
  });

  it("is today's Story page for a 9:16 Story", () => {
    expect(pageFor({ width: 1080, height: 1920 }, "story")).toEqual({ ...STORY_PAGE });
  });

  it("has the size's own shape, in multiples of 16, near today's pixel count", () => {
    const today = STILL_PAGE.width * STILL_PAGE.height;
    for (const [w, h, pw, ph] of [[1200, 1200, 1216, 1216], [1080, 1080, 1216, 1216], [1600, 900, 1536, 864], [1080, 1440, 1056, 1408], [1200, 628, 1712, 896]]) {
      const page = pageFor({ width: w, height: h }, "image")!;
      expect([page.width, page.height]).toEqual([pw, ph]);
      expect(page.width % 16).toBe(0);
      expect(page.height % 16).toBe(0);
      expect(Math.abs((page.width * page.height) / today - 1)).toBeLessThanOrEqual(0.25);
      expect(Math.abs((page.width / page.height) / (w / h) - 1)).toBeLessThanOrEqual(SHAPE_TOLERANCE);
    }
  });

  it("is drawn by the image model at twice the page, as today", () => {
    expect(pictureSize([1216, 1216])).toEqual([2432, 2432]);
    expect(pictureSize([1536, 864])).toEqual([3072, 1728]);
    expect(pictureSize([1088, 1360])).toEqual([2176, 2720]);
  });
});

describe("the checks a size passes", () => {
  it("passes the sizes the table starts with", () => {
    for (const [w, h, format] of [[1080, 1350, "image"], [1080, 1350, "carousel"], [1080, 1920, "story"], [1200, 1200, "image"], [1600, 900, "image"]] as const) {
      const check = checkSize({ width: w, height: h }, format);
      expect(check.ok).toBe(true);
      if (check.ok) {
        expect(check.picture.width).toBeGreaterThanOrEqual(check.delivered.width);
        expect(check.picture.height).toBeGreaterThanOrEqual(check.delivered.height);
        expect(check.delivered.width).toBeGreaterThanOrEqual(w);
        expect(check.delivered.height).toBeGreaterThanOrEqual(h);
      }
    }
  });

  it("gives each row the table starts with its page, the picture the image model draws and the delivered size", () => {
    const rows: Array<[string, "image" | "carousel" | "story", number, number, number[], number[], number[]]> = [
      // The 4:5 rows and the Stories: every number is the one a design had before the table.
      ["instagram", "image", 1080, 1350, [1088, 1360], [2176, 2720], [1440, 1800]],
      ["instagram", "carousel", 1080, 1350, [1088, 1360], [2176, 2720], [1440, 1800]],
      ["instagram", "story", 1080, 1920, [1152, 2048], [2160, 3840], [1440, 2560]],
      ["facebook", "image", 1080, 1350, [1088, 1360], [2176, 2720], [1440, 1800]],
      ["facebook", "story", 1080, 1920, [1152, 2048], [2160, 3840], [1440, 2560]],
      // Another shape, at the quality width; X's own width is the larger.
      ["linkedin", "image", 1200, 1200, [1216, 1216], [2432, 2432], [1440, 1440]],
      ["x", "image", 1600, 900, [1536, 864], [3072, 1728], [1600, 900]],
    ];
    for (const [platform, format, width, height, page, picture, delivered] of rows) {
      const check = checkSize({ width, height }, format);
      expect(check, `${platform} ${format}`).toEqual({ ok: true, page: { width: page[0], height: page[1] }, picture: { width: picture[0], height: picture[1] }, delivered: { width: delivered[0], height: delivered[1] } });
      // The worker reads the same delivered size from the job's page and row.
      expect(deliveredSize(page as [number, number], { platform, format, width, height })).toEqual(delivered);
    }
    // Before the table a still was the 4:5 page and a Story its own, each delivered 1440 wide.
    expect(outputSize([STILL_PAGE.width, STILL_PAGE.height])).toEqual([1440, 1800]);
    expect(outputSize([STORY_PAGE.width, STORY_PAGE.height])).toEqual([1440, 2560]);
  });

  it("never delivers under the quality width or under the row's size, in the row's shape, and never enlarges the picture", () => {
    for (let width = MIN_EDGE; width <= MAX_EDGE; width += 40) {
      for (let height = MIN_EDGE; height <= MAX_EDGE; height += 40) {
        const check = checkSize({ width, height }, "image");
        if (!check.ok) continue;
        const d = check.delivered;
        expect(d.width).toBe(Math.max(1440, width));
        expect(d.height).toBeGreaterThanOrEqual(height);
        expect(Math.abs(d.height - (d.width * height) / width)).toBeLessThanOrEqual(0.5);
        expect(d.width).toBeLessThanOrEqual(check.picture.width);
        expect(d.height).toBeLessThanOrEqual(check.picture.height);
      }
    }
  });

  it("refuses an edge that is not a whole number or out of bounds", () => {
    expect(checkSize({ width: 1080.5, height: 1350 }, "image")).toEqual({ ok: false, reason: "not_whole" });
    expect(checkSize({ width: "1080", height: 1350 }, "image")).toEqual({ ok: false, reason: "not_whole" });
    expect(checkSize({ width: MIN_EDGE - 1, height: 800 }, "image")).toEqual({ ok: false, reason: "edge" });
    expect(checkSize({ width: 1080, height: MAX_EDGE + 1 }, "image")).toEqual({ ok: false, reason: "edge" });
    // A profile picture and a cover photo, read by mistake.
    expect(checkSize({ width: 320, height: 320 }, "image")).toEqual({ ok: false, reason: "edge" });
    expect(checkSize({ width: 851, height: 315 }, "image")).toEqual({ ok: false, reason: "edge" });
  });

  it("refuses a shape the app does not draw", () => {
    expect(checkSize({ width: 2560, height: 1000 }, "image")).toEqual({ ok: false, reason: "shape" });
    expect(checkSize({ width: 800, height: 2000 }, "image")).toEqual({ ok: false, reason: "shape" });
    // A Story is 9:16 and nothing else: its band and its prompt are.
    expect(checkSize({ width: 1080, height: 1350 }, "story")).toEqual({ ok: false, reason: "shape" });
    expect(checkSize({ width: 1080, height: 1921 }, "story")).toEqual({ ok: false, reason: "shape" });
  });

  it("refuses a shape no page comes within 0.2% of", () => {
    expect(checkSize({ width: 1006, height: 1000 }, "image")).toEqual({ ok: false, reason: "page" });
  });

  it("refuses a size whose delivery is larger than the picture the image model draws, so delivery never enlarges", () => {
    // A 4:5 page is drawn at 2176x2720.
    expect(checkSize({ width: 2048, height: 2560 }, "image").ok).toBe(true);
    // A wide page is drawn at 3072x1728 at most in this band; 2560x1440 fits, and a Story of 2160x3840 is over the edge bound.
    expect(checkSize({ width: 2560, height: 1440 }, "image").ok).toBe(true);
    expect(checkSize({ width: 2160, height: 3840 }, "story")).toEqual({ ok: false, reason: "edge" });
  });
});

describe("what a job is given", () => {
  it("is the page of the request's row, and the row itself", () => {
    expect(jobShape({ platform: "linkedin", format: "image", width: 1200, height: 1200 }, false)).toEqual({ page: { width: 1216, height: 1216 }, deliver: { width: 1200, height: 1200, platform: "linkedin", format: "image" } });
    expect(jobShape({ platform: "x", format: "image", width: 1600, height: 900 }, false)).toEqual({ page: { width: 1536, height: 864 }, deliver: { width: 1600, height: 900, platform: "x", format: "image" } });
    expect(jobShape({ platform: "instagram", format: "story", width: 1080, height: 1920 }, true)).toEqual({ page: { ...STORY_PAGE }, deliver: { width: 1080, height: 1920, platform: "instagram", format: "story" } });
  });

  it("is nothing, so the job is made as before, for a request with no size or a size that fails a check", () => {
    for (const bad of [null, undefined, "1080x1350", {}, { format: "image", width: 1080 }, { format: "poster", width: 1080, height: 1350 }, { format: "image", width: 100, height: 100 }, { format: "image", width: "1080", height: "1350" }]) {
      expect(jobShape(bad, false)).toBeNull();
    }
    // A Story's size on a still, and a still's size on a Story.
    expect(jobShape({ format: "story", width: 1080, height: 1920 }, false)).toBeNull();
    expect(jobShape({ format: "image", width: 1080, height: 1350 }, true)).toBeNull();
  });

  it("delivers a job with no size as today: 1440 wide in the page's shape", () => {
    expect(outputSize([1088, 1360])).toEqual([1440, 1800]);
    expect(outputSize([STORY_PAGE.width, STORY_PAGE.height])).toEqual([1440, 2560]);
    for (const none of [undefined, null, {}, { width: 1200 }, { width: "1200", height: "1200" }, { width: 0, height: 0 }, { width: 1200.5, height: 1200 }]) {
      expect(deliveredSize([1088, 1360], none as never)).toEqual([1440, 1800]);
      expect(deliveredSize([STORY_PAGE.width, STORY_PAGE.height], none as never)).toEqual([1440, 2560]);
    }
  });

  it("delivers a job that carries its platform's row in the row's shape at the quality width, or at the row's own width when that is larger", () => {
    expect(deliveredSize([1216, 1216], { width: 1200, height: 1200 })).toEqual([1440, 1440]);
    expect(deliveredSize([1536, 864], { width: 1600, height: 900 })).toEqual([1600, 900]);
    expect(deliveredSize([1088, 1360], { width: 1080, height: 1350 })).toEqual([1440, 1800]);
    expect(deliveredSize([1152, 2048], { width: 1080, height: 1920 })).toEqual([1440, 2560]);
    // A row at the quality width or over it is delivered as it is.
    expect(deliveredSize([1088, 1360], { width: 1440, height: 1800 })).toEqual([1440, 1800]);
    expect(deliveredSize([1088, 1360], { width: 2048, height: 2560 })).toEqual([2048, 2560]);
    // The shape is the row's, not the page's: 1080x1440 on its 1056x1408 page.
    expect(deliveredSize([1056, 1408], { width: 1080, height: 1440 })).toEqual([1440, 1920]);
  });
});

describe("the reads of a delivered design", () => {
  const worker = readFileSync(join(functionsDir, "design-worker", "index.ts"), "utf8");

  it("cuts the area around the logo from the delivered size: on a 4:5 design the same crop as before the table", () => {
    // The logo at 65, 68 on a 4:5 design drawn at 2176x2720, 652x218 there.
    const rect = { x: 130, y: 136, width: 652, height: 218 }, frame: [number, number] = [2176, 2720];
    const [ow, oh] = deliveredSize([1088, 1360], { width: 1080, height: 1350 });
    expect([ow, oh]).toEqual([1440, 1800]);
    const area = logoAreaRect(rect, frame, { width: ow, height: oh });
    expect(area).toEqual({ x: 0, y: 3, width: 605, height: 318 });
    // The same logo on a job with no row: the same crop of the same file.
    expect(logoAreaRect(rect, frame, { width: 1440, height: 1800 })).toEqual(area);
    // A wide design: the crop stays inside 1600x900.
    const wide = logoAreaRect({ x: 2800, y: 1500, width: 250, height: 200 }, [3072, 1728], { width: 1600, height: 900 });
    expect(wide.x + wide.width).toBeLessThanOrEqual(1600);
    expect(wide.y + wide.height).toBeLessThanOrEqual(900);
  });

  it("is what the worker's verify step uses, with the words read at the page size", () => {
    const verify = worker.slice(worker.indexOf('case "verify": {'), worker.indexOf('throw new Error(`FINAL: Unknown step'));
    expect(verify).toContain("const [ow, oh] = deliveredOf(job);");
    expect(verify).toContain("logoAreaRect(s.logo_rect, s.logo_frame, { width: ow, height: oh })");
    expect(verify).toContain("const page = pageOf(job);");
    expect(worker).not.toContain("outputSize(");
  });
});

describe("the logo's place on a page that is not 4:5", () => {
  const logo = [600, 200] as const;
  const left: Placement = { anchor: "left", width: 0.3, top: 0.05, left: 0.06 };
  const rect = (p: Placement, page: { width: number; height: number }) => canvasLogoRect(p, logo[0], logo[1], page.width, page.height);

  it("is the stored placement itself on a 4:5 page", () => {
    expect(pagePlacement(left, ...logo, STILL_PAGE)).toBe(left);
    expect(pagePlacement(left, ...logo, { width: 1024, height: 1280 })).toBe(left);
  });

  it("keeps the logo's pixels and its distance from its corner on a square page", () => {
    const square = { width: 1216, height: 1216 };
    const p = pagePlacement(left, ...logo, square);
    expect(p).toEqual({ anchor: "left", width: 0.2683, top: 0.0559, left: 0.0537 });
    // 326x109 at 65, 68 on the 4:5 frame.
    expect(rect(left, STILL_PAGE)).toEqual({ x: 65, y: 68, width: 326, height: 109 });
    expect(rect(p, square)).toEqual({ x: 65, y: 68, width: 326, height: 109 });
  });

  it("scales both by the pages' areas on a wide page", () => {
    const wide = { width: 1536, height: 864 };
    const p = pagePlacement(left, ...logo, wide);
    expect(p).toEqual({ anchor: "left", width: 0.2012, top: 0.0745, left: 0.0402 });
    expect(rect(p, wide)).toEqual({ x: 62, y: 64, width: 309, height: 103 });
  });

  it("keeps a right anchor on the right and a centered logo centered", () => {
    const wide = { width: 1536, height: 864 };
    const right = pagePlacement({ ...left, anchor: "right" }, ...logo, wide);
    expect(right.anchor).toBe("right");
    const r = rect(right, wide);
    expect(wide.width - (r.x + r.width)).toBe(62);
    const center = pagePlacement({ anchor: "center", width: 0.323, top: 0.048 }, 701, 251, { width: 1216, height: 1216 });
    expect(center).toEqual({ anchor: "center", width: 0.2889, top: 0.0537 });
    expect(center).not.toHaveProperty("left");
  });

  it("keeps a logo at the bottom at the bottom, the same distance from it", () => {
    // 109 px tall on the frame, ending 68 px above the bottom.
    const bottom: Placement = { anchor: "left", width: 0.3, top: (1360 - 68 - 108.8) / 1360, left: 0.06 };
    for (const page of [{ width: 1216, height: 1216 }, { width: 1536, height: 864 }]) {
      const r = rect(pagePlacement(bottom, ...logo, page), page);
      const k = Math.sqrt((page.width * page.height) / (1088 * 1360));
      expect(Math.abs(page.height - (r.y + r.height) - 68 * k)).toBeLessThanOrEqual(1.5);
    }
  });

  it("never moves a logo from the middle past the middle, and always ends inside the page", () => {
    const wide = { width: 1536, height: 864 };
    // In the middle of the 4:5 frame: 626 px above it, 625 below.
    const mid = rect(pagePlacement({ anchor: "center", width: 0.3, top: 0.46 }, ...logo, wide), wide);
    expect(Math.abs(mid.y + mid.height / 2 - wide.height / 2)).toBeLessThanOrEqual(1);
    for (const page of [{ width: 1216, height: 1216 }, { width: 1536, height: 864 }, { width: 1712, height: 896 }, { width: 1056, height: 1408 }]) {
      for (const p of [left, { anchor: "right", width: 0.8, top: 0.9, left: 0.3 } as Placement, { anchor: "center", width: 0.8, top: 0 } as Placement, { anchor: "left", width: 0.5, top: 0.99, left: 0 } as Placement]) {
        for (const [lw, lh] of [[600, 200], [300, 300], [200, 700]]) {
          const r = canvasLogoRect(pagePlacement(p, lw, lh, page), lw, lh, page.width, page.height);
          expect(r.x).toBeGreaterThanOrEqual(-1);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x + r.width).toBeLessThanOrEqual(page.width + 1);
          expect(r.y + r.height).toBeLessThanOrEqual(page.height + 1);
          expect(r.width).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("a page's shape in words", () => {
  it("names the ratio", () => {
    expect(shapeLabel(STILL_PAGE)).toBe("4:5");
    expect(shapeLabel({ width: 1216, height: 1216 })).toBe("1:1");
    expect(shapeLabel({ width: 1536, height: 864 })).toBe("16:9");
    expect(shapeLabel({ width: 1056, height: 1408 })).toBe("3:4");
    expect(shapeLabel({ ...STORY_PAGE })).toBe("9:16");
    expect(shapeLabel({ width: 1712, height: 896 })).toBe("1.91:1");
    expect(shapeLabel({ width: 896, height: 1712 })).toBe("1:1.91");
  });

  it("names the shape", () => {
    expect(shapeWord({ width: 1216, height: 1216 })).toBe("square");
    expect(shapeWord({ width: 1536, height: 864 })).toBe("wide");
    expect(shapeWord(STILL_PAGE)).toBe("tall");
  });
});

describe("the size a new request reads", () => {
  const rows = () => [
    { platform: "instagram", format: "image", width: 1080, height: 1350 },
    { platform: "instagram", format: "carousel", width: 1080, height: 1350 },
    { platform: "instagram", format: "story", width: 1080, height: 1920 },
    { platform: "facebook", format: "image", width: 1080, height: 1350 },
    { platform: "facebook", format: "story", width: 1080, height: 1920 },
    { platform: "linkedin", format: "image", width: 1200, height: 1200 },
    { platform: "x", format: "image", width: 1600, height: 900 },
  ];
  const read = (post: { platform: string | null; format: string | null }, table = rows()) => readUploadSize(fakeDb({ platform_sizes: table }), post);

  it("is the row of the post's platform and format", async () => {
    expect(await read({ platform: "LinkedIn", format: "Single Image" })).toEqual({ platform: "linkedin", format: "image", width: 1200, height: 1200 });
    expect(await read({ platform: "Twitter/X", format: "static post" })).toEqual({ platform: "x", format: "image", width: 1600, height: 900 });
    expect(await read({ platform: "Instagram", format: "Carousel" })).toEqual({ platform: "instagram", format: "carousel", width: 1080, height: 1350 });
    expect(await read({ platform: "Facebook", format: "Story" })).toEqual({ platform: "facebook", format: "story", width: 1080, height: 1920 });
  });

  it("is the platform's image row for a carousel with no row of its own", async () => {
    expect(await read({ platform: "LinkedIn", format: "Carousel" })).toEqual({ platform: "linkedin", format: "image", width: 1200, height: 1200 });
    expect(await read({ platform: "Facebook", format: "carousel" })).toEqual({ platform: "facebook", format: "image", width: 1080, height: 1350 });
  });

  it("is nothing for a platform or a format with no row, so the design is made at today's size", async () => {
    expect(await read({ platform: "YouTube", format: "image" })).toBeNull();
    expect(await read({ platform: "TikTok", format: "photo" })).toBeNull();
    expect(await read({ platform: "LinkedIn", format: "Document/PDF" })).toBeNull();
    expect(await read({ platform: "Pinterest", format: "image" })).toBeNull();
    expect(await read({ platform: null, format: null })).toBeNull();
    expect(await read({ platform: "LinkedIn", format: "image" }, [])).toBeNull();
  });

  it("is nothing for a row whose size cannot be made, and never another shape in its place", async () => {
    const table = rows().map((r) => (r.platform === "instagram" && r.format === "carousel" ? { ...r, width: 320, height: 320 } : r));
    expect(await read({ platform: "Instagram", format: "Carousel" }, table)).toBeNull();
    expect(await read({ platform: "Instagram", format: "image" }, table)).toEqual({ platform: "instagram", format: "image", width: 1080, height: 1350 });
  });

  it("is nothing when the table cannot be read: the request is still made", async () => {
    const broken = { from: () => ({ select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: null, error: { message: "relation \"platform_sizes\" does not exist" } }) }) }) }) };
    expect(await readUploadSize(broken, { platform: "LinkedIn", format: "image" })).toBeNull();
    const throwing = { from: () => { throw new Error("no connection"); } };
    expect(await readUploadSize(throwing, { platform: "LinkedIn", format: "image" })).toBeNull();
  });
});

describe("what the planner and the image model are told", () => {
  const common = { brand: "Acme", platform: "LinkedIn", copy: "Hello.", voice: null, count: 3, postCount: 4, recent: "" };

  it("tells the planner the shape only when it is not 4:5", () => {
    expect(plannerShape({ format: "image", width: 1200, height: 1200 }, false)).toBe("square frame (1:1)");
    expect(plannerShape({ format: "image", width: 1600, height: 900 }, false)).toBe("wide frame (16:9)");
    expect(plannerShape({ format: "image", width: 1080, height: 1440 }, false)).toBe("tall frame (3:4)");
    expect(plannerShape({ format: "image", width: 1080, height: 1350 }, false)).toBeNull();
    expect(plannerShape({ format: "story", width: 1080, height: 1920 }, true)).toBeNull();
    expect(plannerShape(null, false)).toBeNull();
  });

  it("adds one line to the plan for another shape, and nothing for 4:5", () => {
    const line = "The design is drawn on a square frame (1:1): plan a layout and a picture that fill that shape.";
    expect(plannerPrompt({ ...common, shape: "square frame (1:1)" })).toContain(line);
    expect(carouselPlannerPrompt({ ...common, slides: 5, shape: "square frame (1:1)" })).toContain(line);
    expect(plannerPrompt({ ...common, shape: null })).toBe(plannerPrompt(common));
    expect(carouselPlannerPrompt({ ...common, slides: 5, shape: null })).toBe(carouselPlannerPrompt({ ...common, slides: 5 }));
    expect(plannerPrompt(common)).not.toContain("drawn on a");
  });

  it("names the page's own shape to the image model, and 4:5 for a job with no size", () => {
    const g = { brand_name: "Acme", platform: "LinkedIn", concept: "a desk" };
    expect(designPrompt(g, ["Hello"], 2)).toContain("LinkedIn post (4:5)");
    expect(designPrompt({ ...g, size: { width: 1088, height: 1360 } }, ["Hello"], 2)).toBe(designPrompt(g, ["Hello"], 2));
    expect(designPrompt({ ...g, size: { width: 1216, height: 1216 } }, ["Hello"], 2)).toContain("LinkedIn post (1:1)");
    expect(designPrompt({ ...g, size: { width: 1536, height: 864 } }, ["Hello"], 2, { index: 0, count: 4, withCover: false })).toContain("carousel (16:9)");
  });
});
