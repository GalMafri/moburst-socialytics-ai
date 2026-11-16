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
