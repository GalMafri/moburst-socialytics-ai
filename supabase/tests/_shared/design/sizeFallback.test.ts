import { describe, expect, it, vi } from "vitest";
import { asBeforeInput, drawOrFallBack, drawOutcome, dropStaleDesign, leads, pageKey, type DrawDeps, type SizeOutcome } from "../../../functions/_shared/design/sizeFallback";
import { ModelBusy, ModelRefused } from "../../../functions/_shared/media/modelBusy";
import { runGenerate } from "../../../functions/_shared/design/modelSteps";
import { heldWork } from "../../../functions/_shared/canva/hold";
import { DESIGN_LIMITS } from "../../../functions/_shared/design/advance";
import { fakeDb } from "../../support/lifecycleFakeDb";
import { deliveredSize } from "../../../functions/_shared/canva/finish";

// A size the image model refuses never fails a design: the job is made as
// it was before the sizes table, once, without spending a try, and a
// carousel's option falls back as one.

const stored = { anchor: "left", width: 0.3, top: 0.05, left: 0.06 };
const sized = (over: Record<string, unknown> = {}) => ({
  logo_path: "c1/logo.png", copy: ["Hello"], placement: { anchor: "left", width: 0.2683, top: 0.0559, left: 0.0537 },
  as_before: { placement: stored },
  generate: { brand_name: "Acme", platform: "LinkedIn", concept: "a desk", background: "#000000", refs: [], size: { width: 1216, height: 1216 }, deliver: { width: 1200, height: 1200, platform: "linkedin", format: "image" } },
  ...over,
});
const png = new Uint8Array([1, 2, 3]);
const refusal = () => new ModelRefused(400, "Image model 400: size is not supported");

function deps(job: DrawDeps["job"], draws: Array<() => Uint8Array>): DrawDeps & { calls: string[]; noted: SizeOutcome[] } {
  const calls: string[] = [];
  const noted: SizeOutcome[] = [];
  return {
    job, calls, noted,
    canvas: async () => { calls.push(`canvas ${pageKey(job.input) || "default"}`); },
    draw: async () => { calls.push(`draw ${pageKey(job.input) || "default"}`); return draws.shift()!(); },
    // Twice the page, as the worker asks: 2432x2432 for the square page, 2176x2720 for the 4:5 page.
    asked: () => { const p = job.input?.generate?.size ?? { width: 1088, height: 1360 }; return `${p.width * 2}x${p.height * 2}`; },
    fallBack: async (reason) => { calls.push(`fallBack ${reason}`); },
    note: async (o) => { noted.push(o); },
  };
}

describe("a job as it would have been without the sizes table", () => {
  it("drops the page and the delivered size, puts the stored placement back and keeps the refused size", () => {
    const before = asBeforeInput(sized())!;
    expect(before.placement).toEqual(stored);
    expect(before.generate.size).toBeUndefined();
    expect(before.generate.deliver).toBeUndefined();
    expect(before.as_before).toBeUndefined();
    expect(before.size_refused).toEqual({ platform: "linkedin", format: "image", width: 1200, height: 1200 });
    expect(before.generate).toMatchObject({ brand_name: "Acme", concept: "a desk" });
    // Delivered as today: 1440 wide on the 4:5 page.
    expect(deliveredSize([1088, 1360], before.generate.deliver)).toEqual([1440, 1800]);
  });

  it("keeps a Story on its own page", () => {
    const story = sized({ as_before: { placement: stored, size: { width: 1152, height: 2048 } } });
    expect(asBeforeInput(story)!.generate.size).toEqual({ width: 1152, height: 2048 });
  });

  it("is nothing for a job that carries no upload size, so a job falls back once and cannot loop", () => {
    const once = asBeforeInput(sized())!;
    expect(asBeforeInput(once)).toBeNull();
    expect(asBeforeInput({ generate: { brand_name: "Acme" }, placement: stored })).toBeNull();
    expect(asBeforeInput({ generate: { deliver: { width: 1200, height: 1200 } } })).toBeNull();
    expect(asBeforeInput(null)).toBeNull();
  });
});

describe("drawing a design whose size may be refused", () => {
  it("draws in the job's size and notes that the model drew it", async () => {
    const job = { input: sized(), state: {} as Record<string, unknown>, slide_index: null };
    const d = deps(job, [() => png]);
    expect(await drawOrFallBack(d)).toBe(png);
    expect(d.calls).toEqual(["draw 1216x1216"]);
    expect(d.noted).toEqual([{ platform: "linkedin", format: "image", width: 1200, height: 1200, outcome: "drawn" }]);
    expect(job.state.drawn_for).toBe("1216x1216");
  });

  it("makes the job as before when the model refuses its size: the database first, a new canvas, one more draw", async () => {
    const job = { input: sized(), state: {} as Record<string, unknown>, slide_index: 0 };
    const d = deps(job, [() => { throw refusal(); }, () => png]);
    expect(await drawOrFallBack(d)).toBe(png);
    expect(d.calls).toEqual(["draw 1216x1216", "fallBack Image model 400: size is not supported", "canvas default", "draw default"]);
    expect(job.input.generate.deliver).toBeUndefined();
    expect(job.input.placement).toEqual(stored);
    expect(job.state.drawn_for).toBe("");
    // Both hold: the redraw asked for another picture size (2176x2720, not 2432x2432) and it succeeded. The size is recorded as refused, with what the model said.
    expect(d.noted).toEqual([{ platform: "linkedin", format: "image", width: 1200, height: 1200, outcome: "refusal_confirmed", reason: "Image model 400: size is not supported" }]);
    // Later designs of the job, made as before, say nothing more about the size.
    const again = deps(job, [() => png]);
    await drawOrFallBack(again);
    expect(again.noted).toEqual([]);
  });

  it("records nothing against the size when the redraw is the same picture size: the refusal was not about the size", async () => {
    // Instagram: the upload size's page is today's page, so the redraw is the identical request.
    const instagram = sized({ placement: stored, generate: { ...sized().generate, platform: "Instagram", size: { width: 1088, height: 1360 }, deliver: { width: 1080, height: 1350, platform: "instagram", format: "image" } } });
    const job = { input: instagram, state: {} as Record<string, unknown>, slide_index: null };
    const d = deps(job, [() => { throw refusal(); }, () => png]);
    expect(await drawOrFallBack(d)).toBe(png);
    expect(d.calls.filter((c) => c.startsWith("fallBack"))).toHaveLength(1);
    expect(job.input.generate.deliver).toBeUndefined();
    expect(d.noted).toEqual([]);
  });

  it("records nothing against the size when the redraw is refused too, even if a later try then draws", async () => {
    // A key, billing or content refusal: the 4:5 request is refused as well.
    const job = { input: sized(), state: {} as Record<string, unknown>, slide_index: null };
    const d = deps(job, [() => { throw new ModelRefused(401, "Image model 401: invalid key"); }, () => { throw new ModelRefused(401, "Image model 401: invalid key"); }]);
    await expect(drawOrFallBack(d)).rejects.toBeInstanceOf(ModelRefused);
    expect(d.noted).toEqual([]);
    // The next pass, with the key fixed, draws the job as before: still nothing about the size.
    const next = deps(job, [() => png]);
    expect(await drawOrFallBack(next)).toBe(png);
    expect(next.noted).toEqual([]);
  });

  it("falls back once: a refusal of the job as before is an error as it always was", async () => {
    const job = { input: sized(), state: {} as Record<string, unknown>, slide_index: null };
    const d = deps(job, [() => { throw refusal(); }, () => { throw refusal(); }]);
    await expect(drawOrFallBack(d)).rejects.toBeInstanceOf(ModelRefused);
    expect(d.calls.filter((c) => c.startsWith("fallBack"))).toHaveLength(1);
    // The next pass has a job with no upload size: nothing to fall back from.
    const next = deps(job, [() => { throw refusal(); }]);
    await expect(drawOrFallBack(next)).rejects.toBeInstanceOf(ModelRefused);
    expect(next.calls).toEqual(["draw default"]);
  });

  it("leaves a busy model, any other error and a job with no upload size as they were", async () => {
    for (const error of [new ModelBusy("Image model 429"), new Error("Image model 500"), new Error("Could not read the client post")]) {
      const d = deps({ input: sized(), state: {}, slide_index: null }, [() => { throw error; }]);
      await expect(drawOrFallBack(d)).rejects.toBe(error);
      expect(d.calls).toEqual(["draw 1216x1216"]);
    }
    const plain = deps({ input: asBeforeInput(sized())!, state: {}, slide_index: null }, [() => { throw refusal(); }]);
    await expect(drawOrFallBack(plain)).rejects.toBeInstanceOf(ModelRefused);
    expect(plain.calls).toEqual(["draw default"]);
  });

  it("never lets a slide after the cover fall back alone", async () => {
    expect(leads({ slide_index: null })).toBe(true);
    expect(leads({ slide_index: 0 })).toBe(true);
    expect(leads({ slide_index: 2 })).toBe(false);
    const job = { input: sized(), state: {}, slide_index: 2 };
    const d = deps(job, [() => { throw refusal(); }]);
    await expect(drawOrFallBack(d)).rejects.toBeInstanceOf(ModelRefused);
    expect(d.calls).toEqual(["draw 1216x1216"]);
    expect(job.input.generate.deliver).toBeDefined();
  });

  it("never fails a design because the outcome could not be noted", async () => {
    const d = deps({ input: sized(), state: {}, slide_index: null }, [() => png]);
    d.note = async () => { throw new Error("no connection"); };
    expect(await drawOrFallBack(d)).toBe(png);
  });

  it("says nothing about a size for a job that never carried one", () => {
    expect(drawOutcome({ generate: { brand_name: "Acme" } })).toBeNull();
    expect(drawOutcome(asBeforeInput(sized())!)).toBeNull();
  });
});

describe("the generate step with a refused size", () => {
  it("spends no try and no extra design: the job goes on to locate with the design drawn as before", async () => {
    const row = { id: "j1", client_id: "c1", step: "generate", status: "running", attempts: 0, input: sized(), state: {} as Record<string, unknown>, design_request_id: "r1", slide_index: null };
    const db = fakeDb({ canva_finish_jobs: [row] });
    const job = { ...row, input: structuredClone(row.input), state: {} as Record<string, unknown> };
    const draws = [() => { throw refusal(); }, () => png];
    const fallBack = vi.fn(async () => {});
    const stored: string[] = [];
    let run: Promise<void> = Promise.resolve();
    const paths = { canvas: "", mask: "" };
    runGenerate({
      canvas: async (c, m) => { paths.canvas = c; paths.mask = m; return 5; },
      draw: () => drawOrFallBack({ job, canvas: async () => {}, draw: async () => draws.shift()!(), asked: () => (job.input.generate.deliver ? "2432x2432" : "2176x2720"), fallBack, note: async () => {} }),
      store: async (path) => { stored.push(path); },
      save: async () => {},
    }, job, (work) => { run = heldWork(db, job, work, { ...DESIGN_LIMITS, leaseMs: 1000 }); });
    await run;
    expect(fallBack).toHaveBeenCalledTimes(1);
    const saved = db.tables.canva_finish_jobs[0];
    expect(saved).toMatchObject({ status: "running", attempts: 0, step: "locate", error: null });
    expect(saved.state).toMatchObject({ generations: 1, design_path: "c1/canva-finish/j1/design-1.png", drawn_for: "" });
    expect(stored).toEqual(["c1/canva-finish/j1/design-1.png"]);
  });
});

describe("a design drawn for another page than its job now has", () => {
  it("is dropped and does not count, so the slide is drawn again in its option's size", () => {
    // The slide's draw was in flight on the square page while its option fell back to the 4:5 page.
    const input = asBeforeInput(sized())!;
    // With it go the slot, the cleaned picture and what the stepwise searches kept of that design (the point they stopped at and their ask counts).
    const state: Record<string, unknown> = { design_path: "x/design-1.png", drawn_for: "1216x1216", generations: 1, logo_rect: { x: 1, y: 1, width: 2, height: 2 }, nologo_path: "x/nologo.png", cover_path: "x/cover.png", slot_so_far: { picture: "x/design-1.png", asks: 2, from: {} }, slot_file_so_far: { picture: "x/nologo.png", asks: 1, from: {} }, composed: "x/composed.png" };
    expect(dropStaleDesign(input, state)).toBe(true);
    expect(state).toEqual({ generations: 0, cover_path: "x/cover.png" });
  });

  it("is kept when it was drawn for the job's page, or before pages were recorded", () => {
    expect(dropStaleDesign(sized(), { design_path: "x.png", drawn_for: "1216x1216", generations: 1 })).toBe(false);
    expect(dropStaleDesign(asBeforeInput(sized())!, { design_path: "x.png", drawn_for: "", generations: 1 })).toBe(false);
    expect(dropStaleDesign(sized(), { design_path: "x.png", generations: 2 })).toBe(false);
    expect(dropStaleDesign(sized(), { drawn_for: "1088x1360" })).toBe(false);
  });
});
