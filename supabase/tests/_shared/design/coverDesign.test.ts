// @vitest-environment node
// A slide's work belongs to the cover design it was drawn from, and a write
// for another cover design never lands (17 Nov 2026, coverDesign.ts). The
// worker's own writers (its job loop, the hold, the step's save, the error
// rule, the lease's renewal and the claim) run here over one fake row that
// applies each statement's conditions as the database does, and the cover's
// run starts the row again with the worker's own statement (startAgain).
import { describe, expect, it } from "vitest";
import { DESIGN_LIMITS, type StepResult, advanceDesignJob } from "../../../functions/_shared/design/advance";
import { FOR_COVER, followsCover, forSameCover, jobFolder, landed, startAgain } from "../../../functions/_shared/design/coverDesign";
import { type GenerateDeps, OF_THE_DESIGN, runGenerate, runUnlogo } from "../../../functions/_shared/design/modelSteps";
import { heldWork } from "../../../functions/_shared/canva/hold";
import { claimJob, renewJobLease, saveJobProgress } from "../../../functions/_shared/canva/jobs";
import { recordStepError } from "../../../functions/_shared/canva/stepError";
import { type Statement, jobRow } from "../canva/jobRow";

type Row = ReturnType<typeof jobRow>;
type Job = ReturnType<Row["read"]>;

const FOLDER = "c1/canva-finish/job-1";
const OLD_COVER = "c1/canva-finish/cover-job/design-1.png";
const NEW_COVER = "c1/canva-finish/cover-job/design-2.png";
const LEASE_MS = 420_000;
const COLUMN = `state->>${FOR_COVER}`;

/** A promise the test settles when it chooses: an image call in flight. */
function inFlight<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Lets everything already queued run, so a run gets as far as its next wait on the test. */
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise<void>((r) => setTimeout(r, 0)); };

/**
 * One request of the design worker for the row's slide at its generate
 * step, as the worker runs it: the cover's design is read, then the design
 * is drawn under a hold. `draw` is the image model's call.
 */
function generate(r: Row, cover: string, draw: () => Promise<Uint8Array>) {
  const job = r.read();
  const calls: string[] = [];
  let held: Promise<void> = Promise.resolve();
  const hold = (work: () => Promise<void>): StepResult => { held = heldWork(r.admin, job, work, { ...DESIGN_LIMITS, leaseMs: LEASE_MS }); return "held"; };
  const deps: GenerateDeps = {
    canvas: async (canvas) => { calls.push(`canvas:${canvas}`); return 240; },
    draw: async () => { calls.push("draw"); return draw(); },
    store: async (path) => { calls.push(`store:${path}`); },
    save: () => saveJobProgress(r.admin, job),
  };
  const ran = advanceDesignJob(r.admin, job, async () => { job.state.cover_path = cover; return runGenerate(deps, job, hold); }, () => true);
  return { job, calls, ended: async () => { await ran; await held; } };
}

/** The cover is made again: the slide's row is started again, by the worker's own statement. */
async function coverMadeAgain(r: Row): Promise<void> {
  await r.admin.from("canva_finish_jobs").update(startAgain(structuredClone(r.row.state), new Date().toISOString())).eq("id", r.row.id);
}

/** A pass takes the row, as the worker's pass does. */
const claim = (r: Row) => claimJob(r.admin, { id: r.row.id, status: r.row.status, attempts: r.row.attempts, lease_until: r.row.lease_until }, new Date(), 120_000, DESIGN_LIMITS.maxAttempts);

const slide = (init: Parameters<typeof jobRow>[0] = {}) => jobRow({ step: "generate", slide_index: 2, ...init });
const png = () => new Uint8Array([1]);
const comparedOn = (s: Statement) => s.conditions.filter(([, column]) => column === COLUMN);

describe("which design of its cover a slide's row is for", () => {
  it("is the first from the start, and one more each time the row is started again, with nothing else kept but the design it replaces", () => {
    const at = "2026-11-17T10:00:00.000Z";
    const worked = { generations: 2, design_path: "d.png", cover_path: OLD_COVER, nologo_path: "n.png", unlogos: 1, redesigns: ["words: x"], replaces: "iteration-9" };
    expect(startAgain(worked, at)).toEqual({ step: "generate", status: "running", state: { replaces: "iteration-9", [FOR_COVER]: 2 }, output_path: null, attempts: 0, error: null, lease_until: null, updated_at: at });
    expect(startAgain({}, at).state).toEqual({ [FOR_COVER]: 2 });
    expect(startAgain(null, at).state).toEqual({ [FOR_COVER]: 2 });
    // Every time it is another value than the row had, so a run that read the row before never matches it again.
    let state: Record<string, unknown> = {};
    const seen = new Set<unknown>([undefined]);
    for (let n = 2; n <= 6; n++) {
      state = startAgain(state, at).state as Record<string, unknown>;
      expect(state[FOR_COVER]).toBe(n);
      expect(seen.has(state[FOR_COVER])).toBe(false);
      seen.add(state[FOR_COVER]);
    }
  });

  it("is kept by every step of the slide: a new design of the slide clears what belongs to the design, not this", async () => {
    expect(OF_THE_DESIGN).not.toContain(FOR_COVER);
    const r = slide({ state: { [FOR_COVER]: 3, generations: 1, logo_rect: { x: 1 }, nologo_path: "old.png", unlogos: 1 } });
    await generate(r, NEW_COVER, async () => png()).ended();
    expect(r.row.state).toMatchObject({ [FOR_COVER]: 3, generations: 2, design_path: `${FOLDER}/cover-3/design-2.png` });
  });

  it("names the jobs it is about: a slide after the cover, and no other job", () => {
    expect(followsCover({ slide_index: 1 })).toBe(true);
    expect(followsCover({ slide_index: 4 })).toBe(true);
    // A carousel's cover, a single design, a video.
    expect(followsCover({ slide_index: 0 })).toBe(false);
    expect(followsCover({ slide_index: null })).toBe(false);
    expect(followsCover({})).toBe(false);
  });

  it("keeps the files of a row started again in a folder of that cover design, and every other job's where they were", () => {
    expect(jobFolder({ id: "job-1", client_id: "c1", slide_index: 2, state: {} })).toBe(FOLDER);
    expect(jobFolder({ id: "job-1", client_id: "c1", slide_index: 2, state: { [FOR_COVER]: 2 } })).toBe(`${FOLDER}/cover-2`);
    expect(jobFolder({ id: "job-1", client_id: "c1", slide_index: 2, state: { [FOR_COVER]: 3 } })).toBe(`${FOLDER}/cover-3`);
    expect(jobFolder({ id: "job-1", client_id: "c1", slide_index: 0, state: { generations: 2 } })).toBe(FOLDER);
    expect(jobFolder({ id: "job-1", client_id: "c1", state: null })).toBe(FOLDER);
    expect(jobFolder({ id: "job-1", client_id: "c1" })).toBe(FOLDER);
  });
});

describe("the cover is made again while a slide's image call is in flight", () => {
  it("drops the old run's work: the row stays as it was started again, and the next run draws from the new cover", async () => {
    const r = slide();
    const call = inFlight<Uint8Array>();
    const old = generate(r, OLD_COVER, () => call.promise);
    await settle();
    // The old run holds the row, its call to the image model in flight.
    expect(old.calls).toEqual([`canvas:${FOLDER}/canvas-1.png`, "draw"]);
    expect(r.row.lease_until).not.toBeNull();
    expect(r.row.state).toEqual({ cover_path: OLD_COVER });

    await coverMadeAgain(r);
    const startedAgain = structuredClone(r.row);
    expect(startedAgain).toMatchObject({ step: "generate", status: "running", state: { [FOR_COVER]: 2 }, lease_until: null, attempts: 0 });

    // The image model answers the old run.
    call.resolve(png());
    await old.ended();
    // Nothing of it reached the row: not its design in the old cover's look, not its step, not its release of the lease.
    expect(r.row).toEqual(startedAgain);
    const after = r.statements.slice(-2);
    expect(after.map((s) => [s.values.step, s.landed])).toEqual([["locate", false], ["locate", false]]);
    expect(after.every((s) => comparedOn(s).length === 1 && comparedOn(s)[0][0] === "is")).toBe(true);
    // Its picture went to the first cover design's folder, where no later run stores one.
    expect(old.calls.at(-1)).toBe(`store:${FOLDER}/design-1.png`);

    // The row runs on from where it was started again: the next pass takes it and draws from the new cover.
    expect(await claim(r)).toBe("claimed");
    const next = generate(r, NEW_COVER, async () => png());
    await next.ended();
    expect(r.row).toMatchObject({ status: "running", step: "locate", attempts: 0, error: null, lease_until: null });
    expect(r.row.state).toEqual({ [FOR_COVER]: 2, cover_path: NEW_COVER, generations: 1, design_path: `${FOLDER}/cover-2/design-1.png`, picture_ms: { canvas: 240 } });
    expect(next.calls).toEqual([`canvas:${FOLDER}/cover-2/canvas-1.png`, "draw", `store:${FOLDER}/cover-2/design-1.png`]);
  });

  it("keeps an old run's failure off the row: no try is spent, nothing fails and no reason is written", async () => {
    for (const failure of [new Error("The image model returned no image."), new Error("FINAL: The logo could not be taken out of the design.")]) {
      const r = slide();
      const call = inFlight<Uint8Array>();
      const old = generate(r, OLD_COVER, () => call.promise);
      await settle();
      await coverMadeAgain(r);
      const startedAgain = structuredClone(r.row);
      call.reject(failure);
      await old.ended();
      expect(r.row).toEqual(startedAgain);
      expect(r.statements.at(-1)).toMatchObject({ landed: false, values: { error: failure.message.replace(/^FINAL:\s*/, "") } });
    }
  });

  it("is the same for the removal: a cleaned picture of the old design is saved to no row", async () => {
    const state = { cover_path: OLD_COVER, generations: 1, design_path: `${FOLDER}/design-1.png`, logo_rect: { x: 1 } };
    const r = slide({ step: "unlogo", state });
    const call = inFlight<Uint8Array>();
    const job = r.read();
    const stored: string[] = [];
    let held: Promise<void> = Promise.resolve();
    const ran = advanceDesignJob(r.admin, job, async () => runUnlogo({ edit: () => call.promise, store: async (path) => { stored.push(path); }, save: () => saveJobProgress(r.admin, job) }, job, (work) => {
      held = heldWork(r.admin, job, work, { ...DESIGN_LIMITS, leaseMs: LEASE_MS });
      return "held";
    }), () => true);
    await settle();
    await coverMadeAgain(r);
    const startedAgain = structuredClone(r.row);
    call.resolve(png());
    await ran;
    await held;
    expect(stored).toEqual([`${FOLDER}/nologo-1-1.png`]);
    expect(r.row).toEqual(startedAgain);
  });
});

describe("the cover is made again, and a new pass takes the slide while the old call is still in flight", () => {
  const twoRuns = async () => {
    const r = slide();
    const oldCall = inFlight<Uint8Array>(), newCall = inFlight<Uint8Array>();
    const old = generate(r, OLD_COVER, () => oldCall.promise);
    await settle();
    await coverMadeAgain(r);
    expect(await claim(r)).toBe("claimed");
    const next = generate(r, NEW_COVER, () => newCall.promise);
    await settle();
    // The new run holds the row now, for the image model's time.
    const heldByNew = structuredClone(r.row);
    expect(heldByNew.state).toEqual({ [FOR_COVER]: 2, cover_path: NEW_COVER });
    expect(Date.parse(heldByNew.lease_until as string)).toBeGreaterThan(Date.now() + LEASE_MS - 60_000);
    return { r, old, next, oldCall, newCall, heldByNew };
  };
  const kept = { [FOR_COVER]: 2, cover_path: NEW_COVER, generations: 1, design_path: `${FOLDER}/cover-2/design-1.png`, picture_ms: { canvas: 240 } };

  it("has one writer when the old call ends first: the new run's hold is not released and its design is the one kept", async () => {
    const { r, old, next, oldCall, newCall, heldByNew } = await twoRuns();
    oldCall.resolve(png());
    await old.ended();
    // The old run changed nothing: the row is still held by the new run, so no third pass can take it and pay for another design.
    expect(r.row).toEqual(heldByNew);
    expect(await claim(r)).toBe("lost");
    newCall.resolve(png());
    await next.ended();
    expect(r.row).toMatchObject({ status: "running", step: "locate", attempts: 0, error: null, lease_until: null });
    expect(r.row.state).toEqual(kept);
    // Two designs were paid for and stored apart; the row names the new cover's.
    expect(old.calls.at(-1)).toBe(`store:${FOLDER}/design-1.png`);
    expect(next.calls.at(-1)).toBe(`store:${FOLDER}/cover-2/design-1.png`);
  });

  it("has one writer when the old call ends last: the new run's design stays on the row", async () => {
    const { r, old, next, oldCall, newCall } = await twoRuns();
    newCall.resolve(png());
    await next.ended();
    const done = structuredClone(r.row);
    expect(done.state).toEqual(kept);
    oldCall.resolve(png());
    await old.ended();
    expect(r.row).toEqual(done);
    // The old run's picture did not take the place of the new run's file either.
    expect(old.calls.at(-1)).not.toBe(next.calls.at(-1));
  });

  it("starts no work for a run that read the row before the cover was made again", async () => {
    const r = slide();
    const stale = r.read();
    await coverMadeAgain(r);
    const startedAgain = structuredClone(r.row);
    let worked = false;
    await heldWork(r.admin, stale, async () => { worked = true; }, { ...DESIGN_LIMITS, leaseMs: LEASE_MS });
    // The hold did not land, so the image model is not called and nothing is paid.
    expect(worked).toBe(false);
    expect(r.row).toEqual(startedAgain);
  });

  it("stops a run at its first write that does not land: it runs no further step, finishes nothing and releases no lease", async () => {
    const r = slide({ step: "marks", state: { cover_path: OLD_COVER, generations: 1, design_path: "d.png", final_path: "old-final.png" }, lease_until: "2026-11-17T10:02:00.000Z" });
    const job = r.read();
    const steps: string[] = [];
    await advanceDesignJob(r.admin, job, async () => {
      steps.push(job.step);
      if (job.step === "marks") { await coverMadeAgain(r); job.step = "finish"; return "next"; }
      return "done";
    }, () => true);
    expect(steps).toEqual(["marks"]);
    expect(r.row).toMatchObject({ status: "running", step: "generate", state: { [FOR_COVER]: 2 }, output_path: null, lease_until: null });
    expect(r.statements.filter((s) => !s.landed)).toHaveLength(1);
  });

  it("lets no old run hold, save to or record an error on the row with the shared writers", async () => {
    const r = slide({ state: { cover_path: OLD_COVER } });
    const stale = r.read();
    await coverMadeAgain(r);
    const startedAgain = structuredClone(r.row);
    await renewJobLease(r.admin, stale, new Date(), LEASE_MS);
    stale.step = "locate";
    stale.state.design_path = "old.png";
    await saveJobProgress(r.admin, stale);
    expect(await recordStepError(r.admin, stale, new Error("The picture could not be read."), DESIGN_LIMITS)).toBe("retry");
    expect(await recordStepError(r.admin, stale, new Error("FINAL: The logo could not be taken out of the design."), DESIGN_LIMITS)).toBe("failed");
    expect(r.row).toEqual(startedAgain);
    expect(r.statements.slice(1).map((s) => s.landed)).toEqual([false, false, false, false]);
    // The run that read the row after it was started again writes as always.
    const fresh = r.read();
    await renewJobLease(r.admin, fresh, new Date("2026-11-17T10:00:00.000Z"), LEASE_MS);
    expect(r.row.lease_until).toBe("2026-11-17T10:07:00.000Z");
    expect(comparedOn(r.statements.at(-1) as Statement)).toEqual([["eq", COLUMN, "2"]]);
  });
});

describe("no cover is made again", () => {
  /** A job's generate step run to its end, with the times taken out of what reached the row. */
  const drawn = async (init: Parameters<typeof jobRow>[0]) => {
    const r = jobRow({ step: "generate", ...init });
    await generate(r, OLD_COVER, async () => png()).ended();
    const values = r.updates.map(({ updated_at: _at, lease_until, ...rest }) => ({ ...rest, held: lease_until != null }));
    return { r, values };
  };

  it("lands every write of a slide as it always did, each compared with what the run read", async () => {
    const { r, values } = await drawn({ slide_index: 3 });
    expect(r.row).toMatchObject({ status: "running", step: "locate", attempts: 0, error: null, lease_until: null });
    expect(r.row.state).toEqual({ cover_path: OLD_COVER, generations: 1, design_path: `${FOLDER}/design-1.png`, picture_ms: { canvas: 240 } });
    // The hold, the step's own save of the paid design, and the hold's end.
    expect(r.statements.map((s) => s.landed)).toEqual([true, true, true]);
    expect(r.statements.every((s) => comparedOn(s).length === 1 && comparedOn(s)[0][0] === "is")).toBe(true);
    // What reached the row is what reaches a single design's row.
    expect(values).toEqual((await drawn({ slide_index: null })).values);
  });

  it("waits for the cover as it always did, and a wait that the cover's new start overtook is dropped", async () => {
    const r = slide({ lease_until: "2026-11-17T10:02:00.000Z" });
    const job = r.read();
    await advanceDesignJob(r.admin, job, async () => "wait", () => true);
    expect(r.row).toMatchObject({ status: "running", step: "generate", state: {}, lease_until: null });
    expect(r.statements.map((s) => s.landed)).toEqual([true, true]);
  });

  it("lets a slide wait for the carousel's logo file only while its row is for the cover design it read", async () => {
    // The slide's own checks have passed and it waits for the cover's decision (carouselLogo.ts): its step and state are saved and its lease released, with no try spent.
    const waiting = { [FOR_COVER]: 2, cover_path: NEW_COVER, logo_rect: { x: 1 }, logo_inks: { stored: [[11, 14, 26]] }, logo_named: "stored", final_path: `${FOLDER}/cover-2/final-abc.png`, checks_passed: `${FOLDER}/cover-2/final-abc.png` };
    const r = slide({ step: "verify", state: waiting, lease_until: "2026-11-17T10:02:00.000Z" });
    const wait = async (job: Job) => advanceDesignJob(r.admin, job, async () => "wait", () => true);
    await wait(r.read());
    expect(r.row).toMatchObject({ status: "running", step: "verify", state: waiting, attempts: 0, error: null, lease_until: null });
    expect(r.statements.map((s) => s.landed)).toEqual([true, true]);
    expect(r.statements.every((s) => comparedOn(s).length === 1 && comparedOn(s)[0][0] === "eq" && comparedOn(s)[0][2] === "2")).toBe(true);

    // A run reads the row, the cover is made again, and a new pass takes the row for the cover's next design.
    const old = r.read();
    await coverMadeAgain(r);
    expect(await claim(r)).toBe("claimed");
    const held = r.row.lease_until;
    const before = r.statements.length;
    // The old run's wait is the same write as above, and it does not land: the row keeps the new start, and the new pass's lease.
    await wait(old);
    expect(r.statements.slice(before).map((s) => s.landed)).toEqual([false]);
    expect(r.row).toMatchObject({ status: "running", step: "generate", state: { [FOR_COVER]: 3 }, lease_until: held });
  });

  it("goes through a slide's whole job to done, and stops with the cover's option, as always", async () => {
    const r = slide({ step: "verify", state: { [FOR_COVER]: 2, final_path: `${FOLDER}/cover-2/final-abc.png` }, lease_until: "2026-11-17T10:02:00.000Z" });
    await advanceDesignJob(r.admin, r.read(), async () => "done", () => true);
    expect(r.row).toMatchObject({ status: "done", step: "finished", output_path: `${FOLDER}/cover-2/final-abc.png`, lease_until: null });
    expect(r.statements.every((s) => s.landed && comparedOn(s)[0][0] === "eq" && comparedOn(s)[0][2] === "2")).toBe(true);
  });
});

describe("a job that follows no cover", () => {
  it("is written by the very statements it always was: no cover condition is added", async () => {
    for (const slide_index of [null, 0]) {
      const r = jobRow({ step: "generate", slide_index, state: slide_index === 0 ? { generations: 1 } : {} });
      await generate(r, OLD_COVER, async () => png()).ended();
      expect(r.row).toMatchObject({ status: "running", step: "locate", lease_until: null });
      expect(r.row.state.design_path).toBe(`${FOLDER}/design-${slide_index === 0 ? 2 : 1}.png`);
      const job = r.read();
      await renewJobLease(r.admin, job, new Date(), LEASE_MS);
      await recordStepError(r.admin, job, new Error("x"), DESIGN_LIMITS);
      await advanceDesignJob(r.admin, r.read(), async () => "done", () => true);
      expect(r.statements.length).toBeGreaterThan(5);
      // The hold's own lease (canva/hold.ts, QA 22 Nov 2026) is the only condition such a job's writes carry.
      expect(r.statements.every((s) => s.conditions.every(([, column]) => column === "lease_until") && s.landed)).toBe(true);
    }
  });

  it("is answered as it is by the rule's two functions, whatever its state says", async () => {
    const statement = { eq: () => { throw new Error("no condition is added"); }, is: () => { throw new Error("no condition is added"); }, then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
    for (const job of [{ id: "j", slide_index: null, state: {} }, { id: "j", slide_index: 0, state: { [FOR_COVER]: 2 } }, { id: "j", state: null }]) {
      expect(forSameCover(statement, job)).toBe(statement);
      expect(await landed(statement, job)).toBe(true);
    }
  });

  it("goes on as always when the database could not answer a slide's write: nothing is known, so nothing is dropped", async () => {
    const down = { eq: () => down, is: () => down, select: () => Promise.resolve({ data: null, error: { message: "timeout" } }) };
    expect(await landed(down, { id: "j", slide_index: 2, state: {} })).toBe(true);
    const none = { eq: () => none, is: () => none, select: () => Promise.resolve({ data: [], error: null }) };
    expect(await landed(none, { id: "j", slide_index: 2, state: {} })).toBe(false);
  });
});
