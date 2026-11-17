import { describe, expect, it, vi } from "vitest";

// A design reads the client's stored logo through its trimming. The image
// library (a URL import under Deno) is a fake that holds an RGBA canvas, so
// the real trimming rules run (as in lifecycle/imaging.test.ts).
vi.mock("https://deno.land/x/imagescript@1.3.0/mod.ts", () => {
  class Image {
    bitmap: Uint8ClampedArray;
    constructor(public width: number, public height: number, bitmap?: Uint8ClampedArray) { this.bitmap = bitmap ?? new Uint8ClampedArray(width * height * 4); }
    static async decode(bytes: Uint8Array): Promise<Image> {
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return new Image(v.getUint32(16), v.getUint32(20), new Uint8ClampedArray(bytes.slice(24)));
    }
    crop(x: number, y: number, w: number, h: number): Image {
      const out = new Uint8ClampedArray(w * h * 4);
      for (let j = 0; j < h; j++) out.set(this.bitmap.subarray(((y + j) * this.width + x) * 4, ((y + j) * this.width + x + w) * 4), j * w * 4);
      this.bitmap = out; this.width = w; this.height = h;
      return this;
    }
    resize(w: number, h: number): Image { this.bitmap = new Uint8ClampedArray(w * h * 4).fill(255); this.width = w; this.height = h; return this; }
    async encode(): Promise<Uint8Array> {
      const out = new Uint8Array(24 + this.bitmap.length);
      out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      const v = new DataView(out.buffer);
      v.setUint32(16, this.width); v.setUint32(20, this.height);
      out.set(this.bitmap, 24);
      return out;
    }
  }
  return { Image };
});
vi.mock("../../../functions/_shared/render/resvg.ts", () => ({ svgToPng: vi.fn() }));
vi.mock("../../../functions/_shared/design-system/logoAsset.ts", () => ({ cutLogo: vi.fn() }));
vi.mock("../../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: vi.fn() }));

import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { placementFor } from "../../../functions/_shared/lifecycle/designSettings";
import { type DesignRequest, type Settings, BUCKET, pngSize, settleRequest, startOption } from "../../../functions/_shared/canva/jobs";
import { designPrompt, type GenerateInput } from "../../../functions/_shared/canva/brief";
import { STORY_PAGE, storyLogoPlacement } from "../../../functions/_shared/design/story";
import { STILL_PAGE, pagePlacement } from "../../../functions/_shared/design/platformSize";
import { deliveredSize, pictureSize } from "../../../functions/_shared/canva/finish";
import { asBeforeInput } from "../../../functions/_shared/design/sizeFallback";
import type { LogoSet } from "../../../functions/_shared/design/logoTone";

// Starting a post's design: the job a request hands the design worker.

/** A PNG's first 24 bytes: its signature and its IHDR width and height. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(bytes.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return bytes;
}

const settings: Settings = {
  client_id: "c1", logo_path: "c1/logo.png", placement: { anchor: "center", width: 0.323, top: 0.048 }, background: "#0B0E1A", reference_paths: ["c1/a.jpg", "c1/b.jpg", "c1/c.jpg"],
  // Its file was looked at already (the trimming has its own tests below).
  derived: { logo_checked: "c1/logo.png" },
};
const request = (over: Partial<DesignRequest> = {}): DesignRequest => ({
  id: "req-1", client_id: "c1", report_id: null, calendar_post_key: "post:1", platform: "Instagram", format: "Single image", post_copy: "Captains pay last.",
  requested_by: "person-1", status: "preparing", kind: "single", options_wanted: 1, candidates_started: 0,
  briefs: [{ headline: ["Captains pay last"], picture: "a hockey bench at dawn", refs: ["c1/b.jpg"] }], ...over,
});

async function started(req: DesignRequest) {
  const db = fakeDb({ canva_finish_jobs: [] });
  db.uploads.set(`${BUCKET}/${settings.logo_path}`, pngHeader(701, 251));
  await startOption(db, req, settings, "Pay The Pyper", 0, 0);
  expect(db.tables.canva_finish_jobs).toHaveLength(1);
  return db.tables.canva_finish_jobs[0];
}

/** Every job one option starts, in slide order. */
async function startedAll(req: DesignRequest) {
  const db = fakeDb({ canva_finish_jobs: [] });
  db.uploads.set(`${BUCKET}/${settings.logo_path}`, pngHeader(701, 251));
  await startOption(db, req, settings, "Pay The Pyper", 0, 0);
  return db.tables.canva_finish_jobs;
}

// The page a job is drawn on and the size it is delivered at, as the design worker reads them (pageOf, deliveredOf).
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pageOf = (job: any): [number, number] => { const p = job.input.generate.size ?? STILL_PAGE; return [p.width, p.height]; };
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const delivered = (job: any): [number, number] => deliveredSize(pageOf(job), job.input.generate.deliver);

describe("startOption", () => {
  it("draws a feed still on the default 4:5 page at the client's own logo spot", async () => {
    const job = await started(request());
    expect(job.input.placement).toEqual(settings.placement);
    expect(job.input.generate.size).toBeUndefined();
    expect(job.input.generate.surface).toBeUndefined();
  });

  it("draws a Story on its 9:16 page, as a Story, with the logo moved into the safe band", async () => {
    for (const platform of ["Instagram", "Facebook"]) {
      const job = await started(request({ format: "Story", platform }));
      expect(job.input.generate.size).toEqual(STORY_PAGE);
      expect(job.input.generate.surface).toBe("story");
      expect(job.input.placement).toEqual(storyLogoPlacement(settings.placement, 701, 251));
      expect(job.input.placement.top).toBe(0.14);
      const prompt = designPrompt(job.input.generate as GenerateInput, job.input.copy, job.input.generate.refs.length);
      expect(prompt).toContain("Story (9:16)");
      expect(prompt).not.toContain("4:5");
    }
  });

  it("draws a still in its platform's shape: the page, the row it is delivered by and the logo's place on that page", async () => {
    // LinkedIn, square: planned on 1216x1216, delivered 1440x1440 (the quality width).
    const square = await started(request({ platform: "LinkedIn", upload_size: { platform: "linkedin", format: "image", width: 1200, height: 1200 } }));
    expect(square.input.generate.size).toEqual({ width: 1216, height: 1216 });
    expect(square.input.generate.deliver).toEqual({ width: 1200, height: 1200, platform: "linkedin", format: "image" });
    // What it would have been without the table goes with it: a size the image model refuses falls back to this.
    expect(square.input.as_before).toEqual({ placement: settings.placement });
    expect(asBeforeInput(square.input)).toMatchObject({ placement: settings.placement, size_refused: { platform: "linkedin", format: "image", width: 1200, height: 1200 } });
    expect(asBeforeInput(square.input)!.generate).toEqual((await started(request({ platform: "LinkedIn" }))).input.generate);
    expect(square.input.placement).toEqual(pagePlacement(settings.placement, 701, 251, { width: 1216, height: 1216 }));
    expect(square.input.placement).toEqual({ anchor: "center", width: 0.2889, top: 0.0537 });
    expect(designPrompt(square.input.generate as GenerateInput, square.input.copy, 1)).toContain("LinkedIn post (1:1)");
    expect(delivered(square)).toEqual([1440, 1440]);
    // X, wide: planned on 1536x864, delivered at 1600x900 (its own width is the larger).
    const wide = await started(request({ platform: "Twitter/X", upload_size: { platform: "x", format: "image", width: 1600, height: 900 } }));
    expect(wide.input.generate.size).toEqual({ width: 1536, height: 864 });
    expect(wide.input.generate.deliver).toEqual({ width: 1600, height: 900, platform: "x", format: "image" });
    expect(designPrompt(wide.input.generate as GenerateInput, wide.input.copy, 1)).toContain("post (16:9)");
    expect(delivered(wide)).toEqual([1600, 900]);
  });

  it("draws an Instagram still on the page it always had at the client's own logo spot, delivered 1440 wide", async () => {
    const job = await started(request({ upload_size: { platform: "instagram", format: "image", width: 1080, height: 1350 } }));
    expect(job.input.generate.size).toEqual({ width: 1088, height: 1360 });
    expect(job.input.generate.deliver).toEqual({ width: 1080, height: 1350, platform: "instagram", format: "image" });
    expect(job.input.placement).toEqual(settings.placement);
    expect(delivered(job)).toEqual([1440, 1800]);
    // The image model is told what it was always told.
    const before = await started(request());
    expect(designPrompt(job.input.generate as GenerateInput, job.input.copy, 1)).toBe(designPrompt(before.input.generate as GenerateInput, before.input.copy, 1));
  });

  it("keeps the quality every 4:5 post and Story had before the sizes table: the page, the picture asked of the image model, the logo's place and the delivered size", async () => {
    const slides = [{ headline: ["A"], picture: "p1" }, { headline: ["B"], picture: "p2" }, { headline: ["C"], picture: "p3" }];
    const cases: Array<{ post: Partial<DesignRequest>; row: { platform: string; format: string; width: number; height: number }; page: [number, number]; asked: [number, number]; out: [number, number] }> = [
      { post: { platform: "Instagram" }, row: { platform: "instagram", format: "image", width: 1080, height: 1350 }, page: [1088, 1360], asked: [2176, 2720], out: [1440, 1800] },
      { post: { platform: "Facebook" }, row: { platform: "facebook", format: "image", width: 1080, height: 1350 }, page: [1088, 1360], asked: [2176, 2720], out: [1440, 1800] },
      { post: { platform: "Instagram", format: "Carousel", kind: "carousel", briefs: [{ headline: ["A"], picture: "p", slides }] }, row: { platform: "instagram", format: "carousel", width: 1080, height: 1350 }, page: [1088, 1360], asked: [2176, 2720], out: [1440, 1800] },
      { post: { platform: "Instagram", format: "Story" }, row: { platform: "instagram", format: "story", width: 1080, height: 1920 }, page: [1152, 2048], asked: [2160, 3840], out: [1440, 2560] },
      { post: { platform: "Facebook", format: "Story" }, row: { platform: "facebook", format: "story", width: 1080, height: 1920 }, page: [1152, 2048], asked: [2160, 3840], out: [1440, 2560] },
    ];
    for (const c of cases) {
      // The same post with no row is the job as it was made before the table.
      const [before, now] = await Promise.all([startedAll(request(c.post)), startedAll(request({ ...c.post, upload_size: c.row }))]);
      expect(now).toHaveLength(before.length);
      for (const [i, job] of now.entries()) {
        const was = before[i];
        expect(pageOf(job)).toEqual(pageOf(was));
        expect(pageOf(job)).toEqual(c.page);
        expect(pictureSize(pageOf(job))).toEqual(c.asked);
        expect(pictureSize(pageOf(job))).toEqual(pictureSize(pageOf(was)));
        expect(job.input.placement).toEqual(was.input.placement);
        expect(delivered(job)).toEqual(c.out);
        expect(delivered(job)).toEqual(delivered(was));
        const slide = now.length > 1 ? { index: i, count: now.length, withCover: i > 0 } : undefined;
        expect(designPrompt(job.input.generate as GenerateInput, job.input.copy, 1, slide)).toBe(designPrompt(was.input.generate as GenerateInput, was.input.copy, 1, slide));
      }
    }
  });

  it("gives every slide of a carousel the one size its request read", async () => {
    const carousel = request({ platform: "LinkedIn", format: "Carousel", kind: "carousel", upload_size: { platform: "linkedin", format: "image", width: 1200, height: 1200 }, briefs: [{ headline: ["A"], picture: "p", slides: [{ headline: ["A"], picture: "p1" }, { headline: ["B"], picture: "p2" }, { headline: ["C"], picture: "p3" }] }] });
    const db = fakeDb({ canva_finish_jobs: [] });
    db.uploads.set(`${BUCKET}/${settings.logo_path}`, pngHeader(701, 251));
    await startOption(db, carousel, settings, "Acme", 0, 0);
    expect(db.tables.canva_finish_jobs).toHaveLength(3);
    for (const job of db.tables.canva_finish_jobs) {
      expect(job.input.generate.size).toEqual({ width: 1216, height: 1216 });
      expect(job.input.generate.deliver).toEqual({ width: 1200, height: 1200, platform: "linkedin", format: "image" });
      expect(job.input.placement).toEqual(db.tables.canva_finish_jobs[0].input.placement);
      expect(job.input.as_before).toEqual({ placement: settings.placement });
      expect(designPrompt(job.input.generate as GenerateInput, job.input.copy, 1, { index: job.slide_index, count: 3, withCover: false })).toContain("carousel (1:1)");
      expect(delivered(job)).toEqual([1440, 1440]);
    }
  });

  it("delivers a Story 1440 wide on the same 9:16 page and safe band", async () => {
    const job = await started(request({ format: "Story", upload_size: { platform: "instagram", format: "story", width: 1080, height: 1920 } }));
    expect(job.input.generate.size).toEqual(STORY_PAGE);
    expect(job.input.generate.surface).toBe("story");
    expect(job.input.generate.deliver).toEqual({ width: 1080, height: 1920, platform: "instagram", format: "story" });
    expect(job.input.placement).toEqual(storyLogoPlacement(settings.placement, 701, 251));
    expect(delivered(job)).toEqual([1440, 2560]);
    // As before, a Story keeps its page and its safe band.
    expect(job.input.as_before).toEqual({ placement: storyLogoPlacement(settings.placement, 701, 251), size: STORY_PAGE });
  });

  it("makes a request with no size, or a size that fails a check, exactly as before", async () => {
    for (const upload_size of [null, undefined, { format: "image", width: 320, height: 320 }, { format: "story", width: 1080, height: 1920 }, "1200x1200"]) {
      const job = await started(request({ platform: "LinkedIn", upload_size }));
      expect(job.input.generate.size).toBeUndefined();
      expect(job.input.generate.deliver).toBeUndefined();
      expect(job.input.as_before).toBeUndefined();
      expect(job.input.placement).toEqual(settings.placement);
    }
    // A Story whose request holds a still's size keeps today's Story.
    const story = await started(request({ format: "Story", upload_size: { format: "image", width: 1080, height: 1350 } }));
    expect(story.input.generate.size).toEqual(STORY_PAGE);
    expect(story.input.generate.deliver).toBeUndefined();
  });

  it("hands the note a design was asked with to the job, so the image model sees it and a retry keeps it", async () => {
    const note = "Show the rink at night, no people";
    for (const req of [request({ note }), request({ note, format: "Story" }), request({ note, kind: "carousel", briefs: [{ headline: ["A"], picture: "p", slides: [{ headline: ["A"], picture: "p1" }, { headline: ["B"], picture: "p2" }] }] })]) {
      const db = fakeDb({ canva_finish_jobs: [] });
      db.uploads.set(`${BUCKET}/${settings.logo_path}`, pngHeader(701, 251));
      await startOption(db, req, settings, "Pay The Pyper", 0, 0);
      for (const job of db.tables.canva_finish_jobs) {
        expect(job.input.generate.note).toBe(note);
        expect(designPrompt(job.input.generate as GenerateInput, job.input.copy, job.input.generate.refs.length)).toContain(`"${note}"`);
      }
    }
    expect((await started(request())).input.generate.note).toBeUndefined();
  });

  it("keeps a post called Story on another network the way it was made before", async () => {
    const job = await started(request({ format: "Story", platform: "LinkedIn" }));
    expect(job.input.generate.surface).toBeUndefined();
    expect(job.input.placement).toEqual(settings.placement);
  });

  it("leaves one job per slide when the same option is started twice", async () => {
    const carousel = request({ kind: "carousel", briefs: [{ headline: ["A"], picture: "p", slides: [{ headline: ["A"], picture: "p1" }, { headline: ["B"], picture: "p2" }] }] });
    for (const req of [request(), carousel, request({ kind: "video", format: "Reel", briefs: [{ headline: ["A"], picture: "p", footage: "f" }] })]) {
      const db = fakeDb({ canva_finish_jobs: [], clients: [{ id: "c1", video_style: null, video_references: [] }] });
      db.uploads.set(`${BUCKET}/${settings.logo_path}`, pngHeader(701, 251));
      await startOption(db, req, settings, "Pay The Pyper", 0, 0);
      const first = db.tables.canva_finish_jobs.length;
      await startOption(db, req, settings, "Pay The Pyper", 0, 0);
      expect(db.tables.canva_finish_jobs).toHaveLength(first);
    }
  });

  it("skips only the slide another run already started, and starts the others", async () => {
    const carousel = request({ kind: "carousel", briefs: [{ headline: ["A"], picture: "p", slides: [{ headline: ["A"], picture: "p1" }, { headline: ["B"], picture: "p2" }, { headline: ["C"], picture: "p3" }] }] });
    const db = fakeDb({ canva_finish_jobs: [] });
    db.uploads.set(`${BUCKET}/${settings.logo_path}`, pngHeader(701, 251));
    // The unique index refuses slide 0 because a second run inserted it between this run's read and its write.
    const from = db.from.bind(db);
    db.from = (table: string) => {
      const q = from(table);
      if (table !== "canva_finish_jobs") return q;
      const insert = q.insert.bind(q);
      q.insert = (row: { slide_index: number }) => {
        if (row.slide_index !== 0) return insert(row);
        db.tables.canva_finish_jobs.push({ ...row, id: "other-run" });
        return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
      };
      return q;
    };
    await startOption(db, carousel, settings, "Pay The Pyper", 0, 0);
    expect(db.tables.canva_finish_jobs.map((j) => j.slide_index).sort()).toEqual([0, 1, 2]);
  });

  it("hands a video's job the price approved on its request, its one clip's prompt and no reference videos", async () => {
    const video = (over: Partial<DesignRequest> = {}) => request({
      kind: "video", format: "Reel", briefs: [{ headline: ["Captains pay last"], picture: "a hockey bench at dawn", footage: "slow push in on the bench", seconds: 12, refs: [] }], ...over,
    });
    const run = async (req: DesignRequest) => {
      const db = fakeDb({ canva_finish_jobs: [], clients: [{ id: "c1", video_references: [{ path: "c1/videos/a.mp4" }], video_style: null }] });
      db.uploads.set(`${BUCKET}/${settings.logo_path}`, pngHeader(701, 251));
      await startOption(db, req, settings, "Pay The Pyper", 0, 0);
      return db.tables.canva_finish_jobs[0];
    };
    const job = await run(video({ approved_credits: 128 }));
    expect(job.input.approved_credits).toBe(128);
    // Every clip has the same fixed length: the brief no longer chooses one.
    expect(job.input.video).toEqual({ prompt: "slow push in on the bench" });
    expect("video_refs" in job.input).toBe(false);
    // A request whose price could not be read: the clip step waits for it.
    expect((await run(video())).input.approved_credits).toBeNull();
    expect((await run(video({ briefs: [{ headline: ["A"], picture: "the bench", refs: [] }] }))).input.video).toEqual({ prompt: "the bench" });
  });
});

describe("pngSize", () => {
  it("reads the size from the header and names the file when it is not a PNG", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    new DataView(png.buffer).setUint32(16, 1088);
    new DataView(png.buffer).setUint32(20, 1360);
    expect(pngSize(png)).toEqual([1088, 1360]);
    const jpeg = new Uint8Array(24).fill(0xff);
    expect(() => pngSize(jpeg)).toThrow("The logo must be a PNG file.");
    expect(() => pngSize(jpeg, "The image model's answer")).toThrow("The image model's answer must be a PNG file.");
  });
});

/** A PNG as these tests carry it: the real header, then the RGBA canvas. */
function canvas(w: number, h: number, ink: { x: number; y: number; w: number; h: number }): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = ink.y; y < ink.y + ink.h; y++) for (let x = ink.x; x < ink.x + ink.w; x++) px.set([20, 20, 20, 255], (y * w + x) * 4);
  const out = new Uint8Array(24 + px.length);
  out.set(pngHeader(w, h));
  out.set(px, 24);
  return out;
}

describe("startOption and the stored logo", () => {
  const lifecycle = (over: Record<string, unknown> = {}) => ({
    ...settings, source: "lifecycle", updated_at: "2026-10-01T09:00:00Z",
    derived: { placement_from: "client_posts", logo_read: { shown: true, at: "bottom-center", width: 0.3 } }, ...over,
  });
  const world = (row: Record<string, unknown>, file: Uint8Array) => {
    const db = fakeDb({ canva_finish_jobs: [], design_brand_settings: [{ ...row }] });
    db.uploads.set(`${BUCKET}/${settings.logo_path}`, file);
    let downloads = 0;
    const from = db.storage.from.bind(db.storage);
    db.storage.from = (bucket: string) => { const b = from(bucket); const d = b.download.bind(b); b.download = (p: string) => { downloads++; return d(p); }; return b; };
    return { db, reads: () => downloads };
  };
  const padded = () => canvas(400, 400, { x: 40, y: 134, w: 320, h: 128 });
  const stored = (db: ReturnType<typeof fakeDb>) => db.tables.design_brand_settings[0] as unknown as Settings;

  it("trims a padded stored logo for the client's next design, with nobody doing anything", async () => {
    const { db } = world(lifecycle(), padded());
    const used = await startOption(db, request(), stored(db), "Pay The Pyper", 0, 0);
    const [job] = db.tables.canva_finish_jobs;
    const row = db.tables.design_brand_settings[0];
    expect(job.input.logo_path).toMatch(/^c1\/design-settings\/logo-site-[0-9a-f]{16}\.png$/);
    expect(job.input.logo_size).toEqual([320, 128]);
    expect(job.input.placement).toEqual(placementFor({ shown: true, at: "bottom-center", width: 0.3 }, 320 / 128).placement);
    expect(row.logo_path).toBe(job.input.logo_path);
    expect(used.logo_path).toBe(row.logo_path);
    expect(row.updated_at).toBe("2026-10-01T09:00:00Z");
    // The original stays in storage.
    expect(db.uploads.has(`${BUCKET}/c1/logo.png`)).toBe(true);
  });

  it("reads the file once: the second option and the next design use the trimmed logo without a fitting pass", async () => {
    const { db, reads } = world(lifecycle(), padded());
    const used = await startOption(db, request(), stored(db), "Pay The Pyper", 0, 0);
    const after = reads();
    await startOption(db, request(), used, "Pay The Pyper", 0, 1);
    // Only the read of the logo's size.
    expect(reads()).toBe(after + 1);
    const again = await startOption(db, request(), stored(db), "Pay The Pyper", 0, 2);
    expect(again.logo_path).toBe(used.logo_path);
    expect(reads()).toBe(after + 2);
  });

  it("leaves a logo a person set as it is, padded or not", async () => {
    const { db } = world(lifecycle({ source: "person" }), padded());
    await startOption(db, request(), stored(db), "Pay The Pyper", 0, 0);
    expect(db.tables.canva_finish_jobs[0].input.logo_path).toBe("c1/logo.png");
    expect(db.tables.canva_finish_jobs[0].input.logo_size).toEqual([400, 400]);
    expect(db.tables.design_brand_settings[0].logo_path).toBe("c1/logo.png");
    expect(db.tables.design_brand_settings[0].derived).not.toHaveProperty("logo_checked");
  });

  it("keeps a logo that is already its ink alone and marks it looked at", async () => {
    const { db } = world(lifecycle(), canvas(300, 100, { x: 0, y: 0, w: 300, h: 100 }));
    await startOption(db, request(), stored(db), "Pay The Pyper", 0, 0);
    expect(db.tables.canva_finish_jobs[0].input.logo_path).toBe("c1/logo.png");
    expect(db.tables.design_brand_settings[0].derived).toMatchObject({ logo_checked: "c1/logo.png" });
  });
});

describe("startOption and the client's logo set", () => {
  const OTHER = "c1/design-settings/logo-0123456789abcdef-other.png";
  const WHITE = "c1/design-settings/logo-0123456789abcdef-white.png";
  /** A set that belongs to the row's logo: the copy for dark pictures on the canvas, on a ground the client's posts have. */
  const set = (over: Partial<LogoSet> = {}): LogoSet => ({
    of: "c1/logo.png", rule: 2, own: "light", both: false, inks: [[23, 87, 132]],
    other: { path: OTHER, from: "made", size: [701, 251] }, white: { path: WHITE }, made: { other: OTHER, white: WHITE }, site: null,
    posts: { read: 8, found: 5, shown: { stored: 1, other: 3, white: 1 } },
    canvas: { file: "other", ground: "#0F294C", from: "client_posts" }, at: "2026-11-16T09:00:00.000Z", ...over,
  });
  const LOGOS = { files: { stored: "c1/logo.png", other: OTHER, white: WHITE }, canvas: "other", second: { file: "stored", ground: "#FFFFFF" }, fixed: [], names: { canvas: ["white"], second: [] } };
  const world = (row: Settings, tables: Record<string, unknown[]> = {}) => {
    const db = fakeDb({ canva_finish_jobs: [], ...tables });
    db.uploads.set(`${BUCKET}/c1/logo.png`, pngHeader(701, 251));
    // The copy has the stored file's size in life; another size here shows whose size the job carries.
    db.uploads.set(`${BUCKET}/${OTHER}`, pngHeader(600, 300));
    db.uploads.set(`${BUCKET}/${WHITE}`, pngHeader(701, 251));
    return db;
  };

  it("carries the canvas file, its size, its ground and the set in a still job's input", async () => {
    const row: Settings = { ...settings, logo_set: set() };
    const db = world(row);
    await startOption(db, request(), row, "Northwind Hockey", 0, 0);
    const [job] = db.tables.canva_finish_jobs;
    expect(job.input.logo_path).toBe(OTHER);
    expect(job.input.logo_size).toEqual([600, 300]);
    expect(job.input.generate.background).toBe("#0F294C");
    expect(job.input.logos).toEqual(LOGOS);
    expect(job.input.placement).toEqual(settings.placement);
  });

  it("carries the files the design may be stamped with beside the set: the copies the service made, whether or not a post shows them", async () => {
    // The set holds no second file and no white file (no post shows one), and the service made both copies.
    const row: Settings = { ...settings, logo_set: set({ other: null, white: null, canvas: { file: "stored", ground: "#F7E8E5", from: "client_posts" }, posts: { read: 8, found: 0, shown: { stored: 0, other: 0, white: 0 } } }) };
    const db = world(row);
    await startOption(db, request(), row, "Northwind Hockey", 0, 0);
    const [job] = db.tables.canva_finish_jobs;
    expect(job.input.logos.files).toEqual({ stored: "c1/logo.png" });
    expect(job.input.stamp).toEqual([{ file: "stored", path: "c1/logo.png" }, { file: "other", path: OTHER }, { file: "white", path: WHITE }]);
    // Logos were found on the client's posts and none shows the white copy: it is tried last.
    const seen: Settings = { ...settings, logo_set: set({ white: null, posts: { read: 8, found: 4, shown: { stored: 1, other: 3, white: 0 } } }) };
    const other = world(seen);
    await startOption(other, request(), seen, "Northwind Hockey", 0, 0);
    expect(other.tables.canva_finish_jobs[0].input.stamp).toEqual([{ file: "stored", path: "c1/logo.png" }, { file: "other", path: OTHER }, { file: "white", path: WHITE, last: true }]);
    // A job with one file has no list, and neither has a video.
    const one = world({ ...settings });
    await startOption(one, request(), { ...settings }, "Northwind Hockey", 0, 0);
    expect("stamp" in one.tables.canva_finish_jobs[0].input).toBe(false);
  });

  it("leaves the settings it returns unchanged and gives a video job the stored file", async () => {
    const row: Settings = { ...settings, logo_set: set() };
    const before = structuredClone(row);
    const db = world(row);
    const used = await startOption(db, request(), row, "Northwind Hockey", 0, 0);
    expect(used).toEqual(before);
    expect(row).toEqual(before);
    expect(used.logo_path).toBe("c1/logo.png");
    expect(used.background).toBe("#0B0E1A");

    const video = world(row, { clients: [{ id: "c1", video_style: null, video_references: [] }] });
    await startOption(video, request({ kind: "video", format: "Reel", briefs: [{ headline: ["A"], picture: "p", footage: "f" }] }), row, "Northwind Hockey", 0, 0);
    const [job] = video.tables.canva_finish_jobs;
    expect(job.input.logo_path).toBe("c1/logo.png");
    expect(job.input.logo_size).toEqual([701, 251]);
    expect("logos" in job.input).toBe(false);
    expect("stamp" in job.input).toBe(false);
  });

  it("starts a job with the one file when there is no set or the set belongs to another logo", async () => {
    for (const logo_set of [undefined, null, set({ of: "c1/older-logo.png" }), { ...set(), rule: 3 }]) {
      const row = { ...settings, logo_set } as Settings;
      const db = world(row);
      await startOption(db, request(), row, "Northwind Hockey", 0, 0);
      const [job] = db.tables.canva_finish_jobs;
      expect(job.input.logo_path).toBe("c1/logo.png");
      expect(job.input.logo_size).toEqual([701, 251]);
      expect(job.input.generate.background).toBe("#0B0E1A");
      // The header-only file of this test has no pixel to read: the row's background as it is, and the job says so.
      expect(job.input.generate.background_from).toBe("row");
      expect("logos" in job.input).toBe(false);
    }
  });

  it("reads a set of the rule of 16 Nov as it is when its canvas needs nothing else, and says where the ground came from", async () => {
    const { inks: _inks, ...rule1 } = { ...set(), rule: 1 };
    const row = { ...settings, logo_set: rule1 } as Settings;
    const db = world(row);
    await startOption(db, request(), row, "Northwind Hockey", 0, 0);
    const [job] = db.tables.canva_finish_jobs;
    expect(job.input.logo_path).toBe(OTHER);
    expect(job.input.generate.background).toBe("#0F294C");
    expect(job.input.generate.background_from).toBe("set");
    expect(job.input.logos).toEqual(LOGOS);
  });

  it("works out a Story's placement from the canvas file's size", async () => {
    // A logo at the bottom: how far up the safe band pushes it depends on the logo's height.
    const low = { anchor: "center" as const, width: 0.323, top: 0.9 };
    const row: Settings = { ...settings, placement: low, logo_set: set() };
    const db = world(row);
    await startOption(db, request({ format: "Story" }), row, "Northwind Hockey", 0, 0);
    const [job] = db.tables.canva_finish_jobs;
    expect(job.input.placement).toEqual(storyLogoPlacement(low, 600, 300));
    expect(job.input.placement).not.toEqual(storyLogoPlacement(low, 701, 251));
    expect(job.input.generate.background).toBe("#0F294C");
    expect(job.input.logos).toEqual(LOGOS);
  });

  it("gives every slide of a carousel the same set", async () => {
    const row: Settings = { ...settings, logo_set: set() };
    const db = world(row);
    const carousel = request({ kind: "carousel", briefs: [{ headline: ["A"], picture: "p", slides: [{ headline: ["A"], picture: "p1" }, { headline: ["B"], picture: "p2" }, { headline: ["C"], picture: "p3" }] }] });
    await startOption(db, carousel, row, "Northwind Hockey", 0, 0);
    expect(db.tables.canva_finish_jobs).toHaveLength(3);
    for (const job of db.tables.canva_finish_jobs) {
      expect(job.input.logo_path).toBe(OTHER);
      expect(job.input.generate.background).toBe("#0F294C");
      expect(job.input.logos).toEqual(LOGOS);
    }
  });

  it("never starts a design from the stored file on a background one of its whole parts does not show on", async () => {
    // Two green letters and a near-black one on a near-black settings background (the row of 16 Nov), with the copy for dark pictures in the set.
    const dark = { ...settings, background: "#1A1A1A" };
    const twoInks = set({ inks: [[59, 172, 85], [26, 25, 25]], white: null, made: { other: OTHER, white: null }, canvas: { file: "stored", ground: "#1A1A1A", from: "settings" } });
    const db = world({ ...dark, logo_set: twoInks });
    await startOption(db, request(), { ...dark, logo_set: twoInks }, "Northwind Hockey", 0, 0);
    const [job] = db.tables.canva_finish_jobs;
    // The canvas is the stored file on the neutral of its own ground, and locate looks for it there and for the copy on a dark one.
    expect(job.input.logo_path).toBe("c1/logo.png");
    expect(job.input.generate.background).toBe("#FFFFFF");
    expect(job.input.logos).toEqual({ files: { stored: "c1/logo.png", other: OTHER }, canvas: "stored", second: { file: "other", ground: "#0B0E1A" }, fixed: [], names: { canvas: [], second: [] } });
    // Its posts show the stored file on a light gray: the canvas is that ground, whatever the settings background is.
    const fromPosts = { ...twoInks, canvas: { file: "stored", ground: "#E8E8E8", from: "client_posts" } };
    const again = world({ ...dark, logo_set: fromPosts });
    await startOption(again, request(), { ...dark, logo_set: fromPosts } as Settings, "Northwind Hockey", 0, 0);
    expect(again.tables.canva_finish_jobs[0].input.generate.background).toBe("#E8E8E8");
  });

  it("starts a job with one file on a ground every whole part of that file shows on, read from the file itself", async () => {
    // Two green letters and a near-black one, as the pixels of the stored file.
    const letters = (() => {
      const w = 64, h = 20, px = new Uint8Array(w * h * 4);
      const fill = (x0: number, x1: number, color: number[]) => { for (let y = 2; y < 18; y++) for (let x = x0; x < x1; x++) px.set([...color, 255], (y * w + x) * 4); };
      fill(2, 20, [40, 140, 70]); fill(24, 40, [26, 25, 25]); fill(44, 62, [40, 140, 70]);
      const out = new Uint8Array(24 + px.length);
      out.set(pngHeader(w, h));
      out.set(px, 24);
      return out;
    })();
    const start = async (row: Settings) => {
      const db = world(row, { design_brand_settings: [{ ...row }] });
      db.uploads.set(`${BUCKET}/c1/logo.png`, letters);
      const used = await startOption(db, request(), row, "Northwind Hockey", 0, 0);
      return { job: db.tables.canva_finish_jobs[0], used, stored: db.tables.design_brand_settings[0] };
    };
    // No set yet, or a set for another logo: the job has the one file, and the near-black settings background would hide
    // a letter of it. The job starts from the neutral of the ground the file was made for.
    for (const logo_set of [null, set({ of: "c1/older-logo.png" })]) {
      const row = { ...settings, background: "#1A1A1A", logo_set } as Settings;
      const { job, used, stored } = await start(row);
      expect("logos" in job.input).toBe(false);
      expect(job.input.logo_path).toBe("c1/logo.png");
      expect(job.input.generate.background).toBe("#FFFFFF");
      expect(job.input.generate.background_from).toBe("file");
      // Nothing of the settings is changed by it.
      expect(used.background).toBe("#1A1A1A");
      expect(stored.background).toBe("#1A1A1A");
    }
    // The set of 16 Nov of that client (rule 1: the stored file on the settings background, the copy for dark pictures beside it)
    // is read with the file's own parts: the stored file on white, and the copy keeps its template for dark pictures.
    const { inks: _inks, ...rule1 } = { ...set({ white: null, made: { other: OTHER, white: null }, canvas: { file: "stored", ground: "#1A1A1A", from: "settings" } }), rule: 1 };
    const window = await start({ ...settings, background: "#1A1A1A", logo_set: rule1 } as Settings);
    expect(window.job.input.logo_path).toBe("c1/logo.png");
    expect(window.job.input.generate.background).toBe("#FFFFFF");
    expect(window.job.input.generate.background_from).toBe("file");
    expect(window.job.input.logos).toEqual({ files: { stored: "c1/logo.png", other: OTHER }, canvas: "stored", second: { file: "other", ground: "#0B0E1A" }, fixed: [], names: { canvas: [], second: [] } });
    // A background the file shows whole on is where it starts.
    expect((await start({ ...settings, background: "#f4f4f0", logo_set: null } as Settings)).job.input.generate.background).toBe("#F4F4F0");
    // A person's row whose background a part of their file does not show on; their background is never written.
    const theirs = await start({ ...settings, source: "person", background: "#1A1A1A", logo_set: null } as Settings);
    expect(theirs.job.input.generate.background).toBe("#FFFFFF");
    expect(theirs.stored.background).toBe("#1A1A1A");
    // A background a part of their file is only weak on is theirs to choose.
    expect((await start({ ...settings, source: "person", background: "#D7D7D7", logo_set: null } as Settings)).job.input.generate.background).toBe("#D7D7D7");
    expect((await start({ ...settings, background: "#D7D7D7", logo_set: null } as Settings)).job.input.generate.background).toBe("#FFFFFF");
  });

  it("reads the stored file's parts once for a request: each option starts from the settings the one before handed back", async () => {
    const row = { ...settings, background: "#1A1A1A", logo_set: null } as Settings;
    const db = world(row);
    // A file with pixels: 20 by 10, all of one near-black ink.
    const file = new Uint8Array(24 + 20 * 10 * 4);
    file.set(pngHeader(20, 10));
    for (let i = 24; i < file.length; i += 4) file.set([26, 25, 25, 255], i);
    db.uploads.set(`${BUCKET}/c1/logo.png`, file);
    const imaging = await import("../../../functions/_shared/lifecycle/imaging");
    const read = vi.spyOn(imaging, "logoWhole");
    const req = request({ options_wanted: 3, briefs: [{ headline: ["A"], picture: "p" }, { headline: ["B"], picture: "q" }, { headline: ["C"], picture: "r" }] });
    let current = row;
    for (let i = 0; i < 3; i++) current = await startOption(db, req, current, "Northwind Hockey", i, i);
    expect(db.tables.canva_finish_jobs).toHaveLength(3);
    for (const job of db.tables.canva_finish_jobs) expect(job.input.generate).toMatchObject({ background: "#FFFFFF", background_from: "file" });
    expect(read).toHaveBeenCalledTimes(1);
    read.mockRestore();
  });

  it("keeps the set through a design's start when the stored logo is already its ink alone", async () => {
    // A lifecycle row whose file was not looked at yet: the fitting pass finds nothing to trim, and the path stays.
    const row = { ...settings, source: "lifecycle", derived: { placement_from: "default" }, logo_set: set() } as Settings;
    const db = world(row, { design_brand_settings: [{ ...row }] });
    db.uploads.set(`${BUCKET}/c1/logo.png`, canvas(300, 100, { x: 0, y: 0, w: 300, h: 100 }));
    await startOption(db, request(), db.tables.design_brand_settings[0] as unknown as Settings, "Northwind Hockey", 0, 0);
    const [job] = db.tables.canva_finish_jobs;
    expect(db.tables.design_brand_settings[0].logo_path).toBe("c1/logo.png");
    expect(db.tables.design_brand_settings[0].derived).toMatchObject({ logo_checked: "c1/logo.png" });
    expect(job.input.logo_path).toBe(OTHER);
    expect(job.input.logos).toEqual(LOGOS);
  });

  it("starts with one file when the logo was trimmed at this design's start", async () => {
    // A logo stored padded: the fitting pass moves logo_path, so the set made for the padded file is not this logo's.
    const row = { ...settings, source: "lifecycle", derived: { placement_from: "default" }, logo_set: set() } as Settings;
    const db = world(row, { design_brand_settings: [{ ...row }] });
    db.uploads.set(`${BUCKET}/c1/logo.png`, canvas(400, 400, { x: 40, y: 134, w: 320, h: 128 }));
    const used = await startOption(db, request(), db.tables.design_brand_settings[0] as unknown as Settings, "Northwind Hockey", 0, 0);
    const [job] = db.tables.canva_finish_jobs;
    expect(used.logo_path).toMatch(/^c1\/design-settings\/logo-site-[0-9a-f]{16}\.png$/);
    expect(job.input.logo_path).toBe(used.logo_path);
    expect(job.input.logo_size).toEqual([320, 128]);
    // The one file is near black and the settings background is the dark neutral: the job starts from the neutral of the file's own ground.
    expect(job.input.generate.background).toBe("#FFFFFF");
    expect("logos" in job.input).toBe(false);
  });
});

describe("settleRequest", () => {
  const lease = { claim_worker_lease: () => true, release_worker_lease: () => true };
  const failedJob = (kind: "video" | undefined) => ({
    id: "job-0", design_request_id: "req-1", status: "failed", step: "assemble_wait", option_index: 0, slide_index: null, slide_count: null,
    output_path: null, state: {}, input: kind ? { kind } : {}, error: "The video's title could not be drawn with the exact words.", created_at: "2026-11-10T08:00:00Z",
  });
  const world = (req: DesignRequest, kind: "video" | undefined) => {
    const db = fakeDb({
      design_requests: [{ ...req }],
      canva_finish_jobs: [failedJob(kind)],
      design_brand_settings: [{ ...settings }],
      clients: [{ id: "c1", name: "Pay The Pyper", video_references: [], video_style: null }],
      post_iterations: [],
    }, lease);
    db.uploads.set(`${BUCKET}/${settings.logo_path}`, pngHeader(701, 251));
    return db;
  };

  it("closes a video request whose one job failed, with that job's reason, and starts no second clip", async () => {
    const req = request({ kind: "video", approved_credits: 144, briefs: [0, 1, 2].map((i) => ({ headline: [`Hook ${i}`], picture: "p", footage: "a slow push in on a hockey bench at dawn", text_style: "bold white sans-serif" })) });
    const db = world(req, "video");
    await settleRequest(db, "req-1");
    expect(db.tables.canva_finish_jobs).toHaveLength(1);
    expect(db.tables.design_requests[0]).toMatchObject({ status: "closed", end_reason: "no_design", error: "The video's title could not be drawn with the exact words." });
  });

  it("stamps when a request became ready, which the post panel measures the usual time from", async () => {
    const db = world(request(), undefined);
    db.tables.canva_finish_jobs[0] = { ...failedJob(undefined), status: "done", step: "finished", output_path: "c1/out.png", error: null };
    await settleRequest(db, "req-1");
    expect(db.tables.design_requests[0].status).toBe("ready");
    expect(typeof db.tables.design_requests[0].ended_at).toBe("string");
  });

  it("still replaces a still design that did not finish, from the next brief", async () => {
    const req = request({ briefs: [0, 1, 2].map((i) => ({ headline: [`Line ${i}`], picture: `picture ${i}` })) });
    const db = world(req, undefined);
    await settleRequest(db, "req-1");
    expect(db.tables.canva_finish_jobs).toHaveLength(2);
    expect(db.tables.canva_finish_jobs[1]).toMatchObject({ option_index: 1, step: "generate" });
    expect(db.tables.canva_finish_jobs[1].input.copy).toEqual(["Line 1"]);
    expect(db.tables.design_requests[0]).toMatchObject({ status: "preparing", candidates_started: 2 });
  });
});
