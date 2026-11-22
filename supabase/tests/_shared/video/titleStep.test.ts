// @vitest-environment node
// The title and its check run through the video worker's pass over one fake
// job row: a title is paid for once, however long the picture service is
// away, and is drawn again only when it is known to be no good.
import { describe, expect, it, vi } from "vitest";
import { advanceVideoJob } from "../../../functions/_shared/video/advance";
import { saveJobProgress } from "../../../functions/_shared/canva/jobs";
import { MAX_HOOKS, type TitleDeps, runTitle, runTitleCheck } from "../../../functions/_shared/video/titleStep";
import { ModelBusy } from "../../../functions/_shared/media/modelBusy";
import { PictureError } from "../../../functions/_shared/picture/client";
import type { VideoJob } from "../../../functions/_shared/video/steps";
import { jobRow } from "../canva/jobRow";

const COPY = ["Fresh every morning"];
const FOUND = { result: { layer: { width: 1024, height: 1536 }, box: { x: 100, y: 900, width: 800, height: 200 }, read: { width: 512, height: 768 } }, ms: 180 };
const unavailable = () => new PictureError("The picture service did not answer: 503.", "title-read", "unavailable");

/** The steps' services but their save, which is the workers' own (saveJobProgress) over the fake row. */
type Fakes = Omit<TitleDeps, "save">;
function fakes(over: Partial<Fakes> = {}) {
  const calls: string[] = [];
  const deps: Fakes = {
    draw: async () => { calls.push("draw"); return new Uint8Array([1]); },
    store: async (path) => { calls.push(`store:${path}`); },
    renewLease: async () => { calls.push("renewLease"); },
    locate: async () => { calls.push("locate"); return FOUND; },
    read: async () => { calls.push("read"); return COPY; },
    ...over,
  };
  return { calls, deps };
}

/** One pass of the video worker over the row, with the title steps only (the frame is what follows them). */
async function pass(r: ReturnType<typeof jobRow>, fake: Fakes): Promise<boolean> {
  const step = (job: VideoJob) => {
    const deps: TitleDeps = { ...fake, save: () => saveJobProgress(r.admin, job) };
    if (job.step === "title") return runTitle(deps, job, "frame");
    if (job.step === "title_check") return runTitleCheck(deps, job, "frame");
    return Promise.resolve("wait" as const);
  };
  return advanceVideoJob(r.admin, r.read() as VideoJob & { attempts: number }, step, () => true);
}

const draws = (calls: string[]) => calls.filter((c) => c === "draw").length;

describe("the title through an unavailable picture service", () => {
  it("keeps the paid title and its check's step, so no later pass draws it again", async () => {
    const r = jobRow({ step: "title", input: { copy: COPY, brand_name: "Acme" } });
    const down = fakes({ locate: async () => { down.calls.push("locate"); throw unavailable(); } });

    expect(await pass(r, down.deps)).toBe(false);
    expect(r.row).toMatchObject({ status: "running", step: "title_check", attempts: 0, error: "The picture service did not answer: 503.", lease_until: null });
    expect(r.row.state).toMatchObject({ hooks: 1, hook_path: "c1/canva-finish/job-1/hook-1.png" });

    // An outage far longer than the titles a video may draw: nothing more is paid for, no try is spent.
    for (let i = 0; i < MAX_HOOKS + 2; i++) await pass(r, down.deps);
    expect(draws(down.calls)).toBe(1);
    expect(r.row).toMatchObject({ status: "running", step: "title_check", attempts: 0 });
    expect(r.row.state.hooks).toBe(1);

    // The service is back: the same title is checked and the video goes on.
    const up = fakes();
    expect(await pass(r, up.deps)).toBe(true);
    expect(draws(up.calls)).toBe(0);
    expect(up.calls).toEqual(["renewLease", "locate", "read"]);
    expect(r.row).toMatchObject({ status: "running", step: "frame", error: null });
    expect(r.row.state).toMatchObject({ title_ok: true, hooks: 1, hook_box: FOUND.result.box, hook_layer: FOUND.result.layer, picture_ms: { "title-read": 180 } });
  });

  it("has the paid title on the job row, counted, with its check's step, before the picture service is called, so a run that dies in the call pays for no second title", async () => {
    const r = jobRow({ step: "title", input: { copy: COPY, brand_name: "Acme" } });
    let seen: unknown = null;
    // The pass dies inside the picture call, which never comes back: nothing after it runs and nothing more is saved.
    const dying = fakes({ locate: () => { seen = structuredClone(r.row); return new Promise(() => {}); } });
    void pass(r, dying.deps);
    await vi.waitFor(() => expect(seen).not.toBeNull());
    expect(seen).toMatchObject({ step: "title_check", state: { hooks: 1, hook_path: "c1/canva-finish/job-1/hook-1.png" } });

    // The next pass goes on from the row: the same title is checked, and nothing is drawn.
    const up = fakes();
    expect(await pass(r, up.deps)).toBe(true);
    expect(up.calls).toEqual(["renewLease", "locate", "read"]);
    expect(r.row).toMatchObject({ status: "running", step: "frame" });
    expect(r.row.state).toMatchObject({ title_ok: true, hooks: 1 });
  });

  it("counts no title while the image model is busy", async () => {
    const r = jobRow({ step: "title", input: { copy: COPY, brand_name: "Acme" } });
    const busy = fakes({ draw: async () => { throw new ModelBusy("Image model 429"); } });
    for (let i = 0; i < MAX_HOOKS + 2; i++) await pass(r, busy.deps);
    expect(r.row).toMatchObject({ status: "running", step: "title", attempts: 0, error: "Image model 429" });
    expect(r.row.state.hooks).toBeUndefined();
  });
});

describe("a title that is no good", () => {
  it("is drawn again when its words are not the copy's, up to MAX_HOOKS titles", async () => {
    const r = jobRow({ step: "title", input: { copy: COPY, brand_name: "Acme" } });
    const wrong = fakes({ read: async () => ["Fresh evry morning"] });
    await pass(r, wrong.deps);
    expect(draws(wrong.calls)).toBe(MAX_HOOKS);
    expect(r.row).toMatchObject({ status: "failed", error: "The video's title could not be drawn with the exact words." });
    expect(r.row.state.hooks).toBe(MAX_HOOKS);
  });

  it("is drawn again when it came back empty, or when the picture service could not work with it", async () => {
    const empty = jobRow({ step: "title", input: { copy: COPY, brand_name: "Acme" } });
    let first = true;
    const once = fakes({ locate: async () => {
      if (!first) return FOUND;
      first = false;
      return { result: { layer: FOUND.result.layer, box: null, read: null }, ms: 90 };
    } });
    await pass(empty, once.deps);
    expect(draws(once.calls)).toBe(2);
    expect(empty.row).toMatchObject({ step: "frame", attempts: 0 });
    expect(empty.row.state).toMatchObject({ title_ok: true, hooks: 2, hook_path: "c1/canva-finish/job-1/hook-2.png" });

    const unusable = jobRow({ step: "title", input: { copy: COPY, brand_name: "Acme" } });
    let bad = true;
    const refused = fakes({ locate: async () => {
      if (!bad) return FOUND;
      bad = false;
      throw new PictureError("The picture could not be decoded.", "title-read", "unusable");
    } });
    await pass(unusable, refused.deps);
    expect(draws(refused.calls)).toBe(2);
    expect(unusable.row).toMatchObject({ step: "frame", attempts: 0 });
  });

  it("is kept, and a try spent, when the call was refused or the words' answer could not be read", async () => {
    const r = jobRow({ step: "title", input: { copy: COPY, brand_name: "Acme" } });
    const refused = fakes({ locate: async () => { throw new PictureError("The picture service refused the call (401): Not allowed.", "title-read", "refused"); } });
    await pass(r, refused.deps);
    await pass(r, refused.deps);
    expect(draws(refused.calls)).toBe(1);
    expect(r.row).toMatchObject({ status: "running", step: "title_check", attempts: 2, error: "The picture service refused the call (401): Not allowed." });

    const unread = fakes({ read: async () => null });
    await pass(r, unread.deps);
    expect(draws(unread.calls)).toBe(0);
    expect(r.row).toMatchObject({ status: "running", step: "title_check", attempts: 3, error: "The title's words could not be read." });
    expect(r.row.state.hooks).toBe(1);
  });
});

describe("a title that shows the copy's words passes the check, however its lettering is set", () => {
  // QA 22 Nov 2026 (P54-03): these were drawn again, paid each time, and the video ended after MAX_HOOKS.
  async function check(copy: string[], read: string[]) {
    const deps: TitleDeps = {
      draw: async () => new Uint8Array(), store: async () => undefined, renewLease: async () => undefined,
      locate: async () => FOUND, read: async () => read, save: async () => undefined,
    };
    const job = { id: "j", client_id: "c", step: "title_check", state: { hooks: 1, hook_path: "c/canva-finish/j/hook-1.png" }, input: { copy }, design_request_id: null, option_index: 0 } as unknown as VideoJob;
    await runTitleCheck(deps, job, "frame");
    return job.step;
  }
  it.each([
    ["a hyphenated word broken over the title's two lines", ["Your self-care Sunday"], ["Your self-", "care Sunday"]],
    ["an ellipsis drawn as one character", ["Wait for it..."], ["Wait for it…"]],
    ["a heart read without its emoji selector", ["We ❤️ our regulars"], ["We ❤ our regulars"]],
    ["a spaced dash drawn tight", ["Fresh — every morning"], ["Fresh—every morning"]],
    ["a brand mark kept", ["Acme® every day"], ["Acme® every day"]],
  ])("%s", async (_why, copy, read) => {
    expect(await check(copy, read)).toBe("frame");
  });
  it.each([
    ["a missing word", ["Fresh every morning"], ["Fresh morning"]],
    ["another word", ["Your self-care Sunday"], ["Your self-", "love Sunday"]],
    ["a brand mark missing", ["Acme® every day"], ["Acme every day"]],
  ])("still sends back %s", async (_why, copy, read) => {
    expect(await check(copy, read)).toBe("title");
  });
});
