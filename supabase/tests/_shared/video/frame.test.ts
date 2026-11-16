// @vitest-environment node
// The opening frame run through the video worker's pass and hold over one
// fake job row: a frame is paid for once however long the picture service
// is away, and is drawn again only when its PNG is known to be no good.
import { describe, expect, it } from "vitest";
import { advanceVideoJob, VIDEO_LIMITS } from "../../../functions/_shared/video/advance";
import { type FrameDeps, MAX_FRAMES, frameTry, runFrame } from "../../../functions/_shared/video/frame";
import { REASONS } from "../../../functions/_shared/video/clip";
import { heldWork } from "../../../functions/_shared/canva/hold";
import { saveJobProgress } from "../../../functions/_shared/canva/jobs";
import { ModelBusy } from "../../../functions/_shared/media/modelBusy";
import { PictureError } from "../../../functions/_shared/picture/client";
import type { VideoJob, VideoStepResult } from "../../../functions/_shared/video/steps";
import { jobRow } from "../canva/jobRow";

describe("frameTry", () => {
  it("names the next frame without counting it, up to MAX_FRAMES", () => {
    const s: { frames?: number; frame_png?: string | null } = {};
    expect(frameTry(s)).toEqual({ n: 1, png: null });
    // Asked again before a frame was paid for: still the first.
    expect(frameTry(s)).toEqual({ n: 1, png: null });
    expect(s.frames).toBeUndefined();
    expect(frameTry({ frames: 2 })).toEqual({ n: 3, png: null });
    expect(MAX_FRAMES).toBe(3);
    expect(frameTry({ frames: 3 })).toBeNull();
  });

  it("goes on from a frame already paid for, under its own number, when its JPEG was never made", () => {
    const s = { frames: 2, frame_png: "c1/canva-finish/j1/frame-2.png" };
    expect(frameTry(s)).toEqual({ n: 2, png: "c1/canva-finish/j1/frame-2.png" });
    expect(s.frames).toBe(2);
    // On the last frame too: the paid picture is never thrown away for the count.
    expect(frameTry({ frames: 3, frame_png: "p.png" })).toEqual({ n: 3, png: "p.png" });
  });
});

/** The step's services but its save, which is the workers' own (saveJobProgress) over the fake row. */
type Fakes = Omit<FrameDeps, "save" | "renewLease">;
function fakes(over: Partial<Fakes> = {}) {
  const calls: string[] = [];
  const deps: Fakes = {
    draw: async () => { calls.push("draw"); return new Uint8Array([1]); },
    store: async (path) => { calls.push(`store:${path}`); },
    transcode: async (png, jpeg) => { calls.push(`transcode:${png}:${jpeg}`); return 130; },
    ...over,
  };
  return { calls, deps };
}

/** One pass of the video worker over the row's frame step, with its held work run to its end. */
async function pass(r: ReturnType<typeof jobRow>, deps: Fakes): Promise<void> {
  let held: Promise<void> = Promise.resolve();
  const step = async (job: VideoJob): Promise<VideoStepResult> => {
    if (job.step !== "frame") return "wait";
    return runFrame({ ...deps, save: () => saveJobProgress(r.admin, job), renewLease: async () => {} }, job, (work) => {
      held = heldWork(r.admin, job, work, { ...VIDEO_LIMITS, leaseMs: 420_000 });
      return "held";
    });
  };
  await advanceVideoJob(r.admin, r.read() as VideoJob & { attempts: number }, step, () => true);
  await held;
}

const draws = (calls: string[]) => calls.filter((c) => c === "draw").length;
const unavailable = () => new PictureError("The picture service did not answer: timeout.", "transcode", "unavailable");

describe("the frame step", () => {
  it("keeps the paid frame while the picture service is away, and makes its JPEG when the service is back", async () => {
    const r = jobRow({ step: "frame" });
    const down = fakes({ transcode: async () => { throw unavailable(); } });
    for (let i = 0; i < MAX_FRAMES + 2; i++) {
      await pass(r, down.deps);
      expect(r.row).toMatchObject({ status: "running", step: "frame", attempts: 0, error: "The picture service did not answer: timeout.", lease_until: null });
    }
    expect(draws(down.calls)).toBe(1);
    expect(r.row.state).toMatchObject({ frames: 1, frame_png: "c1/canva-finish/job-1/frame-1.png" });

    const up = fakes();
    await pass(r, up.deps);
    expect(up.calls).toEqual(["transcode:c1/canva-finish/job-1/frame-1.png:c1/canva-finish/job-1/frame-1.jpg"]);
    expect(r.row).toMatchObject({ status: "running", step: "frame_check", attempts: 0, error: null });
    // The kept PNG is forgotten only once its JPEG exists.
    expect(r.row.state).toEqual({ frames: 1, frame_path: "c1/canva-finish/job-1/frame-1.jpg", picture_ms: { transcode: 130 } });
  });

  it("has the paid frame on the job row, counted, before the picture service is called, so a run that dies in the call pays for no second frame", async () => {
    const r = jobRow({ step: "frame" });
    let seen: unknown = null;
    // The run dies inside the picture call: nothing after it runs, and the hold never saves.
    const dying = fakes({ transcode: async () => { seen = structuredClone(r.row); throw new Error("the run died"); } });
    const job = r.read() as VideoJob;
    let held: Promise<void> = Promise.resolve();
    runFrame({ ...dying.deps, save: () => saveJobProgress(r.admin, job), renewLease: async () => {} }, job, (work) => { held = work().catch(() => {}); return "held"; });
    await held;
    expect(seen).toMatchObject({ step: "frame", state: { frames: 1, frame_png: "c1/canva-finish/job-1/frame-1.png" } });
    expect(r.row).toMatchObject({ step: "frame", state: { frames: 1, frame_png: "c1/canva-finish/job-1/frame-1.png" } });

    // The next pass goes on from the row: the stored frame is made a JPEG, and nothing is drawn.
    const up = fakes();
    await pass(r, up.deps);
    expect(up.calls).toEqual(["transcode:c1/canva-finish/job-1/frame-1.png:c1/canva-finish/job-1/frame-1.jpg"]);
    expect(r.row.state).toMatchObject({ frames: 1, frame_path: "c1/canva-finish/job-1/frame-1.jpg" });
  });

  it("renews the job's lease after the frame is saved and before the picture call, so the lease covers the draw plus one call", async () => {
    const r = jobRow({ step: "frame" });
    const order: string[] = [];
    const job = r.read() as VideoJob;
    let held: Promise<void> = Promise.resolve();
    const deps: FrameDeps = {
      draw: async () => { order.push("draw"); return new Uint8Array([1]); },
      store: async () => { order.push("store"); },
      save: async () => { order.push("save"); },
      renewLease: async () => { order.push("renew"); },
      transcode: async () => { order.push("transcode"); return 100; },
    };
    runFrame(deps, job, (work) => { held = work(); return "held"; });
    await held;
    expect(order).toEqual(["draw", "store", "save", "renew", "transcode"]);
  });

  it("counts no frame while the image model is busy", async () => {
    const r = jobRow({ step: "frame" });
    const busy = fakes({ draw: async () => { throw new ModelBusy("Image model 429"); } });
    for (let i = 0; i < MAX_FRAMES + 2; i++) await pass(r, busy.deps);
    expect(r.row).toMatchObject({ status: "running", step: "frame", attempts: 0, error: "Image model 429" });
    expect(r.row.state.frames).toBeUndefined();
  });

  it("drops a kept PNG the picture service could not work with, so the next try draws a new frame", async () => {
    const r = jobRow({ step: "frame" });
    const bad = fakes({ transcode: async () => { throw new PictureError("The picture could not be decoded.", "transcode", "unusable"); } });
    await pass(r, bad.deps);
    expect(r.row).toMatchObject({ status: "running", step: "frame", attempts: 1, error: "The picture could not be decoded." });
    expect(r.row.state).toEqual({ frames: 1 });

    const up = fakes();
    await pass(r, up.deps);
    expect(up.calls).toEqual([
      "draw",
      "store:c1/canva-finish/job-1/frame-2.png",
      "transcode:c1/canva-finish/job-1/frame-2.png:c1/canva-finish/job-1/frame-2.jpg",
    ]);
    expect(r.row.state).toMatchObject({ frames: 2, frame_path: "c1/canva-finish/job-1/frame-2.jpg" });
  });

  it("ends with the frame's reason once MAX_FRAMES frames were drawn and none could be used", async () => {
    const r = jobRow({ step: "frame" });
    const bad = fakes({ transcode: async () => { throw new PictureError("The picture could not be decoded.", "transcode", "unusable"); } });
    for (let i = 0; i < MAX_FRAMES + 1; i++) await pass(r, bad.deps);
    expect(draws(bad.calls)).toBe(MAX_FRAMES);
    expect(r.row).toMatchObject({ status: "failed", error: REASONS.frame });
  });

  it("keeps the paid frame, and spends a try, when the call itself was refused", async () => {
    const r = jobRow({ step: "frame" });
    const refused = fakes({ transcode: async () => { throw new PictureError("The picture service refused the call (401): Not allowed.", "transcode", "refused"); } });
    await pass(r, refused.deps);
    await pass(r, refused.deps);
    expect(draws(refused.calls)).toBe(1);
    expect(r.row).toMatchObject({ status: "running", step: "frame", attempts: 2 });
    expect(r.row.state).toMatchObject({ frames: 1, frame_png: "c1/canva-finish/job-1/frame-1.png" });
  });
});
