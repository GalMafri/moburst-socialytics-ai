// @vitest-environment node
// A video job's tries are tries of one step (MAX_VIDEO_ATTEMPTS): a step that
// moves on starts the next one with all its tries (QA 22 Nov 2026, P53-01:
// passing errors in different steps added up, so three in the title step and
// one later in the clip step failed the whole video).
import { describe, expect, it } from "vitest";
import { advanceVideoJob, MAX_VIDEO_ATTEMPTS } from "../../../functions/_shared/video/advance";
import type { VideoJob, VideoStepResult } from "../../../functions/_shared/video/steps";
import { jobRow } from "../canva/jobRow";

const pass = (r: ReturnType<typeof jobRow>, step: (job: VideoJob) => Promise<VideoStepResult>) =>
  advanceVideoJob(r.admin, r.read() as VideoJob & { attempts: number }, step, () => true);

describe("video tries are per step", () => {
  it("does not fail a job on the first error of a step after an earlier step used tries and moved on", async () => {
    expect(MAX_VIDEO_ATTEMPTS).toBe(4);
    const r = jobRow({ step: "title" });
    let titleFails = 3;
    const step = async (job: VideoJob): Promise<VideoStepResult> => {
      if (job.step === "title") {
        if (titleFails-- > 0) throw new Error("The image model timed out.");
        job.step = "clip";
        return "wait";
      }
      throw new Error("Could not hand the opening frame to the video service.");
    };
    for (let i = 0; i < 4; i++) await pass(r, step);
    expect(r.row).toMatchObject({ step: "clip", attempts: 0 });
    await pass(r, step);
    expect(r.row).toMatchObject({ status: "running", attempts: 1 });
  });

  it("an error in a later step of the same pass counts from that step's first try", async () => {
    const r = jobRow({ step: "title", attempts: 3 });
    const step = async (job: VideoJob): Promise<VideoStepResult> => {
      if (job.step === "title") { job.step = "clip"; return "next"; }
      throw new Error("Could not hand the opening frame to the video service.");
    };
    await pass(r, step);
    expect(r.row).toMatchObject({ status: "running", step: "clip", attempts: 1 });
  });

  it("a step that keeps failing still ends the job after its own tries", async () => {
    const r = jobRow({ step: "clip" });
    const step = async (): Promise<VideoStepResult> => { throw new Error("Higgsfield is down."); };
    for (let i = 0; i < MAX_VIDEO_ATTEMPTS; i++) await pass(r, step);
    expect(r.row).toMatchObject({ status: "failed", attempts: MAX_VIDEO_ATTEMPTS });
  });

  it("a pass that stays on its step keeps the tries spent so far", async () => {
    const r = jobRow({ step: "clip_wait", attempts: 2 });
    await pass(r, async () => "wait");
    expect(r.row.attempts).toBe(2);
  });
});
