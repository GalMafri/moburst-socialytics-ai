import { describe, expect, it } from "vitest";
import {
  awaitJobs,
  costOf,
  creditBalance,
  firstResult,
  HiggsfieldError,
  imageAspect,
  importReferences,
  submitImage,
  submitVideo,
  videoAspect,
} from "../../../supabase/functions/_shared/higgsfield/generate";

/** Records what was asked for and answers with whatever the test supplies. */
function stub(replies: Record<string, unknown | ((args: any) => unknown)>) {
  const calls: Array<{ name: string; args: any }> = [];
  const caller = {
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const reply = replies[name];
      const data = typeof reply === "function" ? (reply as (a: any) => unknown)(args) : reply;
      if (data === undefined) throw new Error(`test stub has no reply for ${name}`);
      return { data, text: "", isError: false };
    },
  };
  return { caller, calls };
}

const jobsReply = { jobs: [{ index: 0, job_id: "job-1", status: "pending" }], submitted_count: 1, failed_count: 0 };

describe("aspect ratios", () => {
  it("keeps a ratio the model already supports", () => {
    expect(imageAspect("4:5")).toBe("4:5");
    expect(videoAspect("9:16")).toBe("9:16");
  });

  it("moves an unsupported video ratio to the nearest one, not the tallest", () => {
    // Seedance has no 4:5. 3:4 is much closer than 9:16, so a portrait post
    // should not come back as a full-height reel.
    expect(videoAspect("4:5")).toBe("3:4");
  });

  it("falls back sanely on nonsense", () => {
    expect(IMAGE_RATIOS).toContain(imageAspect("banana"));
  });
});

const IMAGE_RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "9:16", "16:9", "21:9"];

describe("submitImage", () => {
  it("always states which balance to spend", async () => {
    // Omitting use_unlim lets the server reply with a question instead of
    // generating, which no server-side caller can answer.
    const { caller, calls } = stub({ generate_image_batch: jobsReply });
    await submitImage(caller, { prompt: "p", aspect: "4:5" });
    expect(calls[0].args.requests[0].params.use_unlim).toBe(false);
  });

  it("passes references as media ids under the reference role", async () => {
    const { caller, calls } = stub({ generate_image_batch: jobsReply });
    await submitImage(caller, { prompt: "p", aspect: "1:1", referenceIds: ["m1", "m2"] });
    expect(calls[0].args.requests[0].params.medias).toEqual([
      { value: "m1", role: "image_references" },
      { value: "m2", role: "image_references" },
    ]);
  });

  it("sends no medias key at all when there are no references", async () => {
    const { caller, calls } = stub({ generate_image_batch: jobsReply });
    await submitImage(caller, { prompt: "p", aspect: "1:1" });
    expect(calls[0].args.requests[0].params.medias).toBeUndefined();
  });

  it("refuses a reply that asks which balance to spend", async () => {
    const { caller } = stub({ generate_image_batch: { unlim_choice: { question: "which?" } } });
    await expect(submitImage(caller, { prompt: "p", aspect: "1:1" })).rejects.toThrow(HiggsfieldError);
  });

  it("refuses a reply that carries no job", async () => {
    const { caller } = stub({ generate_image_batch: { jobs: [], submitted_count: 0 } });
    await expect(submitImage(caller, { prompt: "p", aspect: "1:1" })).rejects.toThrow(/no job/i);
  });
});

describe("submitVideo", () => {
  it("switches to omni_reference when a still is supplied, because t2v rejects media", async () => {
    const { caller, calls } = stub({ generate_video_batch: jobsReply });
    await submitVideo(caller, { prompt: "p", aspect: "9:16", startImageId: "still-1" });
    const params = calls[0].args.requests[0].params;
    expect(params.mode).toBe("omni_reference");
    expect(params.medias).toEqual([{ value: "still-1", role: "start_image" }]);
  });

  it("leaves the mode alone for a text-only clip", async () => {
    const { caller, calls } = stub({ generate_video_batch: jobsReply });
    await submitVideo(caller, { prompt: "p", aspect: "16:9" });
    expect(calls[0].args.requests[0].params.mode).toBeUndefined();
  });

  it("declines a recommended preset and resubmits, rather than reporting a failure", async () => {
    // Measured live: the server can answer a submission with a style preset
    // instead of a job. Nothing is created and nothing is charged.
    let call = 0;
    const { caller, calls } = stub({
      generate_video_batch: () => {
        call += 1;
        return call === 1
          ? {
              jobs: [
                {
                  index: 0,
                  status: "submission_failed",
                  error: 'Preset "IN THE DARK" was recommended instead of submitting a job.',
                  preset_recommendation: { preset_id: "preset-9", name: "IN THE DARK" },
                },
              ],
              submitted_count: 0,
              failed_count: 1,
            }
          : jobsReply;
      },
    });
    const jobs = await submitVideo(caller, { prompt: "p", aspect: "9:16", startImageId: "still-1" });
    expect(calls.length).toBe(2);
    expect(calls[1].args.requests[0].params.declined_preset_id).toBe("preset-9");
    expect(jobs).toEqual([{ index: 0, job_id: "job-1" }]);
  });

  it("explains a submission the server refused outright", async () => {
    const { caller } = stub({
      generate_video_batch: { jobs: [{ index: 0, status: "submission_failed", error: "content policy" }] },
    });
    await expect(submitVideo(caller, { prompt: "p", aspect: "9:16" })).rejects.toThrow(/content policy/);
  });

  it("is silent unless audio is asked for", async () => {
    const { caller, calls } = stub({ generate_video_batch: jobsReply });
    await submitVideo(caller, { prompt: "p", aspect: "16:9" });
    expect(calls[0].args.requests[0].params.generate_audio).toBe(false);
  });
});

describe("awaitJobs", () => {
  it("polls until the server says everything is terminal", async () => {
    let round = 0;
    const { caller, calls } = stub({
      jobs_wait: () => {
        round += 1;
        return round < 3
          ? { jobs: [{ index: 0, job_id: "job-1", status: "running" }], all_terminal: false }
          : {
              jobs: [{ index: 0, job_id: "job-1", status: "completed", result_url: "https://cdn/x.png", model: "nano_banana_2" }],
              all_terminal: true,
            };
      },
    });
    const result = await awaitJobs(caller, [{ index: 0, job_id: "job-1" }], { budgetMs: 60_000 });
    expect(calls.length).toBe(3);
    expect(result.allTerminal).toBe(true);
    expect(firstResult(result)).toEqual({ url: "https://cdn/x.png", model: "nano_banana_2" });
  });

  it("gives up on its own budget rather than running until the platform kills it", async () => {
    let clock = 0;
    const { caller } = stub({
      jobs_wait: () => {
        clock += 15_000;
        return { jobs: [{ index: 0, job_id: "job-1", status: "running" }], all_terminal: false };
      },
    });
    const result = await awaitJobs(caller, [{ index: 0, job_id: "job-1" }], {
      budgetMs: 40_000,
      now: () => clock,
    });
    expect(result.allTerminal).toBe(false);
    expect(result.waitedMs).toBeLessThanOrEqual(45_000);
    expect(() => firstResult(result)).toThrow(/still working/i);
  });

  it("asks once even with no budget, so a snapshot is possible", async () => {
    const { caller, calls } = stub({
      jobs_wait: {
        jobs: [{ index: 0, job_id: "job-1", status: "completed", result_url: "https://cdn/x.mp4" }],
        all_terminal: true,
      },
    });
    const result = await awaitJobs(caller, [{ index: 0, job_id: "job-1" }], { budgetMs: 0, pollSeconds: 0, now: () => 0 });
    expect(calls.length).toBe(1);
    expect(calls[0].args.timeout_seconds).toBe(0);
    expect(result.allTerminal).toBe(true);
  });

  it("reports a failed job as a failure, not a timeout", () => {
    expect(() =>
      firstResult({
        outcomes: [{ index: 0, job_id: "j", status: "failed", error: "content policy" }],
        allTerminal: true,
        waitedMs: 100,
      }),
    ).toThrow(/content policy/);
  });
});

describe("references and credits", () => {
  it("drops a reference that will not import instead of failing the run", async () => {
    let n = 0;
    const { caller } = stub({
      media_import_url: () => {
        n += 1;
        if (n === 2) throw new Error("gone");
        return { media_id: `m${n}` };
      },
    });
    expect(await importReferences(caller, ["a", "b", "c"])).toEqual(["m1", "m3"]);
  });

  it("reads the balance", async () => {
    const { caller } = stub({ balance: { credits: 2233.67, subscription_plan_type: "scale" } });
    expect(await creditBalance(caller)).toEqual({ credits: 2233.67, plan: "scale" });
  });

  it("preflights a cost without submitting anything", async () => {
    const { caller, calls } = stub({ generate_image: { cost: { credits: 2, credits_exact: 2 } } });
    expect(await costOf(caller, "image", { model: "nano_banana_pro", prompt: "p" })).toBe(2);
    expect(calls[0].args.params.get_cost).toBe(true);
    expect(calls[0].name).toBe("generate_image");
  });

  it("treats an unreadable balance as unknown rather than zero", async () => {
    const { caller } = stub({ balance: { nope: true } });
    expect(await creditBalance(caller)).toBeNull();
  });
});
