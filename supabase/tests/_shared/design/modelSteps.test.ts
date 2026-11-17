// @vitest-environment node
// The design worker's paid steps run through its own job loop and hold over
// one fake job row: a design or a removal is counted only once the image
// model has made it, so a picture service that is away, or a busy image
// model, never uses up a job's designs.
import { describe, expect, it } from "vitest";
import { DESIGN_LIMITS, type StepResult, advanceDesignJob } from "../../../functions/_shared/design/advance";
import { type GenerateDeps, MAX_GENERATIONS, MAX_UNLOGO, OF_THE_DESIGN, type UnlogoDeps, runGenerate, runUnlogo } from "../../../functions/_shared/design/modelSteps";
import { heldWork } from "../../../functions/_shared/canva/hold";
import { saveJobProgress } from "../../../functions/_shared/canva/jobs";
import { ModelBusy } from "../../../functions/_shared/media/modelBusy";
import { PictureError } from "../../../functions/_shared/picture/client";
import { jobRow } from "../canva/jobRow";

const unavailable = () => new PictureError("The picture service was not called: the database could not open a call.", "canvas", "unavailable");

type Row = ReturnType<typeof jobRow>;
type Job = ReturnType<Row["read"]>;
/** The step's save: the workers' own (saveJobProgress) over the fake row. */
type Save = { save(): Promise<void> };
const saving = (r: Row, job: Job): Save => ({ save: () => saveJobProgress(r.admin, job) });

/** One request of the design worker for the row's job: its step, and the held work run to its end. */
async function advance(r: Row, step: (job: Job, hold: (work: () => Promise<void>) => StepResult, save: Save) => StepResult): Promise<void> {
  const job = r.read();
  let held: Promise<void> = Promise.resolve();
  const hold = (work: () => Promise<void>): StepResult => {
    held = heldWork(r.admin, job, work, { ...DESIGN_LIMITS, leaseMs: 420_000 });
    return "held";
  };
  await advanceDesignJob(r.admin, job, async () => step(job, hold, saving(r, job)), () => true);
  await held;
}

/** The step's held work run to its end by a run that dies there: the hold never saves, so the row holds only what the step saved itself. */
async function dies(r: Row, step: (job: Job, hold: (work: () => Promise<void>) => StepResult, save: Save) => StepResult): Promise<void> {
  const job = r.read();
  let held: Promise<void> = Promise.resolve();
  step(job, (work) => { held = work(); return "held"; }, saving(r, job));
  await held;
}

type GenerateFakes = Omit<GenerateDeps, "save">;
function generateFakes(over: Partial<GenerateFakes> = {}) {
  const calls: string[] = [];
  const deps: GenerateFakes = {
    canvas: async (canvas, mask) => { calls.push(`canvas:${canvas}:${mask}`); return 240; },
    draw: async () => { calls.push("draw"); return new Uint8Array([1]); },
    store: async (path) => { calls.push(`store:${path}`); },
    ...over,
  };
  return { calls, deps };
}

describe("generate", () => {
  it("is still waiting, with no design counted, after more waits for the picture service than a job has designs", async () => {
    const r = jobRow({ step: "generate" });
    const down = generateFakes({ canvas: async () => { throw unavailable(); } });
    for (let i = 0; i < MAX_GENERATIONS + 1; i++) {
      await advance(r, (job, hold, save) => runGenerate({ ...down.deps, ...save }, job, hold));
      expect(r.row).toMatchObject({ status: "running", step: "generate", attempts: 0, error: "The picture service was not called: the database could not open a call.", lease_until: null });
    }
    expect(r.row.state.generations).toBeUndefined();
    expect(down.calls).toEqual([]);

    // The service is back: the first design is made under the first name.
    const up = generateFakes();
    await advance(r, (job, hold, save) => runGenerate({ ...up.deps, ...save }, job, hold));
    expect(up.calls).toEqual([
      "canvas:c1/canva-finish/job-1/canvas-1.png:c1/canva-finish/job-1/mask-1.png",
      "draw",
      "store:c1/canva-finish/job-1/design-1.png",
    ]);
    expect(r.row).toMatchObject({ status: "running", step: "locate", attempts: 0, error: null, lease_until: null });
    expect(r.row.state).toMatchObject({ generations: 1, design_path: "c1/canva-finish/job-1/design-1.png", picture_ms: { canvas: 240 } });
  });

  it("counts no design while the image model is busy", async () => {
    const r = jobRow({ step: "generate" });
    const busy = generateFakes({ draw: async () => { throw new ModelBusy("Image model 429"); } });
    for (let i = 0; i < MAX_GENERATIONS + 1; i++) await advance(r, (job, hold, save) => runGenerate({ ...busy.deps, ...save }, job, hold));
    expect(r.row).toMatchObject({ status: "running", step: "generate", attempts: 0, error: "Image model 429" });
    expect(r.row.state.generations).toBeUndefined();
  });

  it("counts each design the image model made, and ends the job once MAX_GENERATIONS were made and sent back", async () => {
    const r = jobRow({ step: "generate" });
    const up = generateFakes();
    for (let n = 1; n <= MAX_GENERATIONS; n++) {
      await advance(r, (job, hold, save) => runGenerate({ ...up.deps, ...save }, job, hold));
      expect(r.row.state).toMatchObject({ generations: n, design_path: `c1/canva-finish/job-1/design-${n}.png` });
      // A check sent the design back.
      r.row.step = "generate";
    }
    await advance(r, (job, hold, save) => runGenerate({ ...up.deps, ...save }, job, hold));
    expect(r.row).toMatchObject({ status: "failed", error: "The design could not be made with the headline's exact words and the logo in its place." });
    expect(up.calls.filter((c) => c === "draw")).toHaveLength(MAX_GENERATIONS);
  });

  it("counts a design that was paid for even when it could not be stored, and spends a try", async () => {
    const r = jobRow({ step: "generate" });
    const full = generateFakes({ store: async () => { throw new Error("Could not store the design."); } });
    await advance(r, (job, hold, save) => runGenerate({ ...full.deps, ...save }, job, hold));
    expect(r.row).toMatchObject({ status: "running", step: "generate", attempts: 1, error: "Could not store the design." });
    expect(r.row.state.generations).toBe(1);
    expect(r.row.state.design_path).toBeUndefined();
  });

  it("has the paid design on the job row, counted, with the next step, as soon as it is stored, so a run that dies there pays for no second design", async () => {
    const r = jobRow({ step: "generate" });
    const up = generateFakes();
    await dies(r, (job, hold, save) => runGenerate({ ...up.deps, ...save }, job, hold));
    expect(r.row).toMatchObject({ step: "locate", state: { generations: 1, design_path: "c1/canva-finish/job-1/design-1.png" } });
  });

  it("clears the logo's file, names, scores and distances when a design is made again", async () => {
    const tone = { logo_file: "c1/design-settings/logo-0123456789abcdef-other.png", logo_named: "other", logo_matched: "stored", logo_scores: [0.96, 0.31], logo_gaps: { stored: 281.5, other: 37.2 } };
    const r = jobRow({ step: "generate", state: { generations: 1, logo_score: 0.96, logo_rect: { x: 1 }, logo_frame: [1088, 1360], ...tone } });
    const up = generateFakes();
    await advance(r, (job, hold, save) => runGenerate({ ...up.deps, ...save }, job, hold));
    expect(r.row.state).toEqual({ generations: 2, design_path: "c1/canva-finish/job-1/design-2.png", picture_ms: { canvas: 240 } });
    for (const key of ["logo_file", "logo_named", "logo_matched", "logo_scores", "logo_gaps"]) expect(OF_THE_DESIGN).toContain(key);
  });

  it("clears the slot, its ground and what the cleaned slot showed when a design is made again", async () => {
    const slot = { logo_slot: { from: "canvas", of: "stored" }, logo_ground: [98, 2, 73], logo_flat: 0.99, logo_shows: { stored: 1.62, white: 12.93 }, logo_clean: 0.12 };
    const r = jobRow({ step: "generate", state: { generations: 1, logo_score: 0.24, logo_rect: { x: 1 }, logo_frame: [2176, 2720], logo_file: "c1/w.png", ...slot } });
    const up = generateFakes();
    await advance(r, (job, hold, save) => runGenerate({ ...up.deps, ...save }, job, hold));
    expect(r.row.state).toEqual({ generations: 2, design_path: "c1/canva-finish/job-1/design-2.png", picture_ms: { canvas: 240 } });
  });

  it("clears what the checks found on the design before", async () => {
    const r = jobRow({ step: "generate", state: { generations: 1, redesigns: ["words read wrong"], logo_rect: { x: 1 }, nologo_path: "old.png", unlogos: 2, mark_cleans: 1 } });
    const up = generateFakes();
    await advance(r, (job, hold, save) => runGenerate({ ...up.deps, ...save }, job, hold));
    expect(r.row.state).toEqual({ generations: 2, redesigns: ["words read wrong"], design_path: "c1/canva-finish/job-1/design-2.png", picture_ms: { canvas: 240 } });
  });
});

describe("unlogo", () => {
  type Fakes = Omit<UnlogoDeps, "save">;
  const fakes = (over: Partial<Fakes> = {}) => {
    const calls: string[] = [];
    const deps: Fakes = { edit: async () => { calls.push("edit"); return new Uint8Array([2]); }, store: async (path) => { calls.push(`store:${path}`); }, ...over };
    return { calls, deps };
  };

  it("counts no removal while the image model is busy, and the first one made takes the first name", async () => {
    const r = jobRow({ step: "unlogo", state: { generations: 2, design_path: "d.png" } });
    const busy = fakes({ edit: async () => { throw new ModelBusy("Image model 503"); } });
    for (let i = 0; i < MAX_UNLOGO + 1; i++) await advance(r, (job, hold, save) => runUnlogo({ ...busy.deps, ...save }, job, hold));
    expect(r.row).toMatchObject({ status: "running", step: "unlogo", attempts: 0, error: "Image model 503" });
    expect(r.row.state.unlogos).toBeUndefined();

    const up = fakes();
    await advance(r, (job, hold, save) => runUnlogo({ ...up.deps, ...save }, job, hold));
    expect(up.calls).toEqual(["edit", "store:c1/canva-finish/job-1/nologo-2-1.png"]);
    expect(r.row).toMatchObject({ step: "marks", error: null });
    expect(r.row.state).toMatchObject({ unlogos: 1, nologo_path: "c1/canva-finish/job-1/nologo-2-1.png" });
  });

  it("has the paid removal on the job row, counted, with the next step, as soon as it is stored, so a run that dies there pays for no second removal", async () => {
    const r = jobRow({ step: "unlogo", state: { generations: 2, design_path: "d.png" } });
    const up = fakes();
    await dies(r, (job, hold, save) => runUnlogo({ ...up.deps, ...save }, job, hold));
    expect(r.row).toMatchObject({ step: "marks", state: { generations: 2, unlogos: 1, nologo_path: "c1/canva-finish/job-1/nologo-2-1.png" } });
  });

  it("ends the job once MAX_UNLOGO removals were made", async () => {
    const r = jobRow({ step: "unlogo", state: { generations: 1, unlogos: MAX_UNLOGO } });
    await advance(r, (job, hold, save) => runUnlogo({ ...fakes().deps, ...save }, job, hold));
    expect(r.row).toMatchObject({ status: "failed", error: "The logo could not be taken out of the design." });
  });
});
