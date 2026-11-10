import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
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
