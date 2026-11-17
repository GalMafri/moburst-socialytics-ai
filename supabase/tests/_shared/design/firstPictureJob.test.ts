// @vitest-environment node
// Node, not jsdom: the picture client sets AbortSignal.timeout.
// The design worker's side of the first picture as the base (17 Nov 2026,
// spec 2026-11-16-logo-tone-design.md, section 14): when the cleaned-slot
// call asks for a composed picture, what the job keeps, which picture every
// later step reads, and how a service from before the rule is handled.
import { describe, expect, it, vi } from "vitest";
import { PictureError, callPicture } from "../../../functions/_shared/picture/client";
import type { FirstPictureFacts, SlotFileRequest, SlotFileResult } from "../../../functions/_shared/picture/contract";
import { OF_THE_DESIGN } from "../../../functions/_shared/design/modelSteps";
import { afterMark, afterSlot, askCleanedSlot, basePicture, beforeTheRule, composeRedesign, composeWanted, composedPath, dropComposed, lastDesign } from "../../../functions/_shared/design/firstPictureJob";
import { MAX_GENERATIONS, MAX_UNLOGO } from "../../../functions/_shared/design/modelSteps";
import { REASONS } from "../../../functions/_shared/design/logoChoice";

const BASE = "client-1/canva-finish/job-1";
const state = (more: Record<string, unknown> = {}) => ({ design_path: `${BASE}/design-1.png`, nologo_path: `${BASE}/nologo-1-2.png`, generations: 1, unlogos: 2, ...more }) as Parameters<typeof composeWanted>[0];
const made: FirstPictureFacts = { made: true, share: 0.0137, join: 3.13, box: { x: 792, y: 116, width: 588, height: 148 } };
const answer = (composed?: FirstPictureFacts): SlotFileResult => ({ ground: [200, 200, 200], flat: 0.9, file: "stored", rect: { x: 1, y: 2, width: 3, height: 4 }, shows: { stored: 9 }, ...(composed ? { composed } : {}) });

describe("the composed picture's place and when it is asked for", () => {
  it("names the composed picture after the design and the removal it came from", () => {
    expect(composedPath(BASE, state())).toBe(`${BASE}/composed-1-2.png`);
    expect(composedPath(BASE, state({ generations: 2, unlogos: 1 }))).toBe(`${BASE}/composed-2-1.png`);
  });

  it("asks for a composed picture until it was ruled out for this cleaned picture", () => {
    expect(composeWanted(state())).toBe(true);
    expect(composeWanted(state({ composed: { of: `${BASE}/nologo-1-2.png`, path: `${BASE}/composed-1-2.png` } }))).toBe(true);
    expect(composeWanted(state({ composed: { of: `${BASE}/nologo-1-2.png`, path: null, why: "join" } }))).toBe(false);
    // A new removal is a new cleaned picture: asked again.
    expect(composeWanted(state({ composed: { of: `${BASE}/nologo-1-1.png`, path: null, why: "join" } }))).toBe(true);
    // A job with no first picture on record has nothing to compose.
    expect(composeWanted(state({ design_path: undefined }))).toBe(false);
  });

  it("reads and stamps the composed picture of the current cleaned picture, else the cleaned picture", () => {
    expect(basePicture(state())).toBe(`${BASE}/nologo-1-2.png`);
    expect(basePicture(state({ composed: { of: `${BASE}/nologo-1-2.png`, path: `${BASE}/composed-1-2.png` } }))).toBe(`${BASE}/composed-1-2.png`);
    expect(basePicture(state({ composed: { of: `${BASE}/nologo-1-2.png`, path: null, why: "join" } }))).toBe(`${BASE}/nologo-1-2.png`);
    // A composed picture of an earlier removal is never used for a later one.
    expect(basePicture(state({ composed: { of: `${BASE}/nologo-1-1.png`, path: `${BASE}/composed-1-1.png` } }))).toBe(`${BASE}/nologo-1-2.png`);
    // A job from before the rule.
    expect(basePicture({ nologo_path: "x/nologo-1-1.png" })).toBe("x/nologo-1-1.png");
  });

  it("clears what it keeps when a design is made again", () => {
    expect(OF_THE_DESIGN).toContain("composed");
  });
});

describe("askCleanedSlot", () => {
  it("keeps the composed picture the service stored, and every later step reads it", async () => {
    const s = state();
    const call = vi.fn(async (_compose: boolean) => ({ result: answer(made), ms: 2100 }));
    const got = await askCleanedSlot(s, BASE, call);
    expect(call.mock.calls).toEqual([[true]]);
    expect(got.result.file).toBe("stored");
    expect(s.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: `${BASE}/composed-1-2.png`, share: 0.0137, join: 3.13, box: made.box });
    expect(basePicture(s)).toBe(`${BASE}/composed-1-2.png`);
  });

  it("keeps why no picture was composed, and goes on with the cleaned picture", async () => {
    const s = state();
    await askCleanedSlot(s, BASE, async () => ({ result: answer({ made: false, why: "join", share: 0, join: 31.4 }), ms: 5 }));
    expect(s.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: null, why: "join", share: 0, join: 31.4 });
    expect(basePicture(s)).toBe(`${BASE}/nologo-1-2.png`);
    expect(composeWanted(s)).toBe(false);
    // A composed picture the service could not store is the same case.
    const t = state();
    await askCleanedSlot(t, BASE, async () => ({ result: answer({ made: false, why: "store", share: 0.0137, join: 3.13 }), ms: 5 }));
    expect(t.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: null, why: "store", share: 0.0137, join: 3.13 });
    expect(basePicture(t)).toBe(`${BASE}/nologo-1-2.png`);
  });

  it("asks the same way whatever the slot is, and keeps the service's reason when the rectangle shows no removal", async () => {
    for (const slot of [{ from: "drawn" }, { from: "canvas" }, undefined]) {
      const s = state({ logo_slot: slot });
      const call = vi.fn(async (_compose: boolean) => ({ result: answer({ made: false, why: "removal", share: 0, join: 2.1, removed: 0.031 }), ms: 4 }));
      await askCleanedSlot(s, BASE, call);
      expect(call.mock.calls).toEqual([[true]]);
      expect(s.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: null, why: "removal", share: 0, join: 2.1, removed: 0.031 });
      expect(basePicture(s)).toBe(`${BASE}/nologo-1-2.png`);
      expect(composeWanted(s)).toBe(false);
    }
    // A canvas slot whose rectangle shows the removal is composed like any other.
    const s = state({ logo_slot: { from: "canvas" } });
    await askCleanedSlot(s, BASE, async () => ({ result: answer({ ...made, removed: 0.35 }), ms: 4 }));
    expect(s.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: `${BASE}/composed-1-2.png`, share: 0.0137, join: 3.13, removed: 0.35, box: made.box });
    expect(basePicture(s)).toBe(`${BASE}/composed-1-2.png`);
  });

  it("asks a service from before the rule again without the two fields, so the design goes on as before", async () => {
    const s = state();
    const call = vi.fn(async (compose: boolean) => {
      if (compose) throw new PictureError("The picture service refused the call (400): The request is not well formed: body.", "slot-file", "refused", 400);
      return { result: answer(), ms: 7 };
    });
    const got = await askCleanedSlot(s, BASE, call);
    expect(call.mock.calls).toEqual([[true], [false]]);
    expect(got.ms).toBe(7);
    expect(s.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: null, why: "service" });
    expect(basePicture(s)).toBe(`${BASE}/nologo-1-2.png`);
  });

  it("does not ask again once composing was ruled out for this cleaned picture, and keeps the record", async () => {
    const kept = { of: `${BASE}/nologo-1-2.png`, path: null, why: "check: marks: could not be cleaned out: a crest" };
    const s = state({ composed: kept });
    const call = vi.fn(async (_compose: boolean) => ({ result: answer(), ms: 3 }));
    await askCleanedSlot(s, BASE, call);
    expect(call.mock.calls).toEqual([[false]]);
    expect(s.composed).toEqual(kept);
  });

  it("lets every other failure through as it is", async () => {
    const busy = new PictureError("The picture service did not answer: 503.", "slot-file", "unavailable");
    await expect(askCleanedSlot(state(), BASE, async () => { throw busy; })).rejects.toBe(busy);
    const unusable = new PictureError("The file is not a picture that can be read.", "slot-file", "unusable");
    await expect(askCleanedSlot(state(), BASE, async () => { throw unusable; })).rejects.toBe(unusable);
    // A refusal of a request that carried no first picture is a refusal.
    const refused = new PictureError("The picture service refused the call (400).", "slot-file", "refused", 400);
    const ruledOut = state({ composed: { of: `${BASE}/nologo-1-2.png`, path: null, why: "join" } });
    await expect(askCleanedSlot(ruledOut, BASE, async () => { throw refused; })).rejects.toBe(refused);
    expect(beforeTheRule(refused)).toBe(true);
    expect(beforeTheRule(busy)).toBe(false);
    expect(beforeTheRule(new PictureError("x", "slot-file", "refused", 401))).toBe(false);
    expect(beforeTheRule(new Error("x"))).toBe(false);
  });
});

describe("dropComposed", () => {
  it("drops a composed picture that failed a check, so the design is judged on its cleaned picture, once", async () => {
    const s = state({ composed: { of: `${BASE}/nologo-1-2.png`, path: `${BASE}/composed-1-2.png`, share: 0.01, join: 4, box: { x: 0, y: 0, width: 8, height: 8 } } });
    expect(dropComposed(s, "marks: could not be cleaned out: a crest on the shirt")).toBe(true);
    expect(s.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: null, why: "check: marks: could not be cleaned out: a crest on the shirt", share: 0.01, join: 4 });
    expect(basePicture(s)).toBe(`${BASE}/nologo-1-2.png`);
    expect(composeWanted(s)).toBe(false);
    // The step runs again: the cleaned picture is asked for as before the rule, and a check that fails now is the design's own.
    const call = vi.fn(async (_compose: boolean) => ({ result: answer(), ms: 3 }));
    await askCleanedSlot(s, BASE, call);
    expect(call.mock.calls).toEqual([[false]]);
    expect(dropComposed(s, "marks: could not be cleaned out: a crest on the shirt")).toBe(false);
    // The next removal is a new cleaned picture, and is composed again.
    s.nologo_path = `${BASE}/nologo-1-3.png`;
    s.unlogos = 3;
    expect(composeWanted(s)).toBe(true);
  });

  it("says no when the check was made on the cleaned picture: the design then goes the way it always did", () => {
    const s = state({ composed: { of: `${BASE}/nologo-1-2.png`, path: null, why: "join" } });
    expect(dropComposed(s, "marks: x")).toBe(false);
    expect(s.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: null, why: "join" });
    expect(dropComposed(state(), "marks: x")).toBe(false);
  });
});

describe("a new worker with a service from before the rule", () => {
  it("does not fail the design: the refused request is asked again as before the rule", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    // The old service: strict about its fields, so the two it does not know are refused before anything is read.
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if ("first" in body || "out" in body) return new Response(JSON.stringify({ ok: false, reason: "The request is not well formed: body" }), { status: 400 });
      return new Response(JSON.stringify({ ok: true, result: answer(), ms: 9 }), { status: 200 });
    }) as typeof fetch;
    const admin = { rpc: async () => ({ data: "5f0c2f6e-8a1b-4c3d-9e2f-1a2b3c4d5e6f", error: null }) };
    const request = (compose: boolean): SlotFileRequest => ({
      job: "job-1", step: "marks", picture: "https://store.test/nologo", rect: { x: 1, y: 2, width: 3, height: 4 }, frame: [10, 10], of: "stored", files: [{ file: "stored", logo: "https://store.test/logo" }],
      drawn: { file: "stored", ground: [255, 255, 255] },
      ...(compose ? { first: "https://store.test/design", out: "https://store.test/composed" } : {}),
    });
    const s = state();
    const got = await askCleanedSlot(s, BASE, (compose) => callPicture(admin, "slot-file", request(compose), { fetchImpl, sleep: async () => {} }));
    expect(bodies.map((b) => "first" in b)).toEqual([true, false]);
    expect(got.result.file).toBe("stored");
    expect(s.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: null, why: "service" });
  });
});

// A picture is never delivered re-rendered when a fresh one can be made (17 Nov 2026).
describe("a design that cannot be delivered as its first picture", () => {
  const of = `${BASE}/nologo-1-2.png`;
  const composed = { of, path: `${BASE}/composed-1-2.png`, share: 0.012, join: 2.4, removed: 0.31 };

  it("knows the last design the option may make from the cap itself", () => {
    for (let n = 0; n < MAX_GENERATIONS; n++) expect(lastDesign(state({ generations: n }))).toBe(false);
    expect(lastDesign(state({ generations: MAX_GENERATIONS }))).toBe(true);
    expect(lastDesign(state({ generations: MAX_GENERATIONS + 1 }))).toBe(true);
    expect(lastDesign(state({ generations: undefined }))).toBe(false);
  });

  it("is made again when the logo was removed at the slot and the first picture could not take the cleaned pixels there", () => {
    for (let n = 1; n < MAX_GENERATIONS; n++) {
      expect(composeRedesign(state({ generations: n, composed: { of, path: null, why: "join", share: 0, join: 44.15, removed: 0.35 } }))).toBe("logo's place: the first picture could not take the cleaned logo's place (join, join 44.15)");
    }
    expect(REASONS.composed("join", 44.15).startsWith("logo's place:")).toBe(true);
  });

  // A slot at the canvas rectangle with no removal shown inside it: nothing to compose, as for every such slot before the rule.
  it("is never made again for a slot that shows no removal: its cleaned picture is delivered, with no call added", async () => {
    for (let n = 1; n <= MAX_GENERATIONS; n++) {
      const s = state({ generations: n, logo_slot: { from: "canvas" } });
      const call = vi.fn(async (_compose: boolean) => ({ result: answer({ made: false, why: "removal", share: 0, join: 0, removed: 0.03 }), ms: 4 }));
      await askCleanedSlot(s, BASE, call);
      const kept = { of, path: null, why: "removal", share: 0, join: 0, removed: 0.03 };
      expect(s.composed).toEqual(kept);
      // No new design, on any design the option makes: the step goes on from the cleaned picture.
      expect(composeRedesign(s), `design ${n}`).toBeNull();
      expect(basePicture(s)).toBe(of);
      // Its checks are the cleaned picture's own, as before the rule: a failed slot check has its own consequence, and a mark is
      // named in the next removal. Nothing is dropped and nothing is recorded as a design made again.
      expect(afterSlot(s, "ground: no logo file shows on the picture under the logo (#FFFFFF)")).toBe("own");
      expect(afterMark(s, "a crest")).toEqual({ next: "clean", reason: REASONS.marks("a crest") });
      expect(s.composed).toEqual(kept);
      // The step asked once, in the call it always made; run again, it asks as before the rule.
      await askCleanedSlot(s, BASE, call);
      expect(call.mock.calls).toEqual([[true], [false]]);
    }
  });

  it("is not made again on the last design, which falls back to its cleaned picture and is judged there as before the rule", () => {
    const last = state({ generations: MAX_GENERATIONS, composed: { of, path: null, why: "join", share: 0, join: 44.15 } });
    expect(composeRedesign(last)).toBeNull();
    expect(basePicture(last)).toBe(of);
  });

  it("is not made again for a reason no new drawing would change, a composed picture, or another cleaned picture's record", () => {
    for (const why of ["removal", "service", "store", "first", "size", "slot", "check: marks: could not be cleaned out: a crest"]) {
      expect(composeRedesign(state({ composed: { of, path: null, why } })), why).toBeNull();
    }
    expect(composeRedesign(state({ composed }))).toBeNull();
    expect(composeRedesign(state({ composed: { of: `${BASE}/nologo-1-1.png`, path: null, why: "join", join: 44 } }))).toBeNull();
    expect(composeRedesign(state())).toBeNull();
  });

  it("makes the design again for a mark the reader found on the composed picture, and cleans nothing", () => {
    const s = state({ generations: 1, composed: { ...composed } });
    const got = afterMark(s, "a crest behind the headline");
    expect(got).toEqual({ next: "again", reason: "marks: drawn in the picture, away from the logo's place: a crest behind the headline" });
    // Nothing was dropped: the design is over, and the next one starts from its own first picture.
    expect(s.composed).toEqual(composed);
    expect(afterMark(state({ generations: MAX_GENERATIONS - 1, composed: { ...composed } }), "a crest").next).toBe("again");
  });

  it("judges the last design on its cleaned picture, and a mark on a cleaned picture is cleaned out as before", () => {
    const s = state({ generations: MAX_GENERATIONS, composed: { ...composed } });
    expect(afterMark(s, "a crest behind the headline")).toEqual({ next: "cleaned", reason: REASONS.marks("a crest behind the headline") });
    expect(s.composed).toEqual({ of, path: null, why: "check: marks: could not be cleaned out: a crest behind the headline", share: 0.012, join: 2.4, removed: 0.31 });
    expect(basePicture(s)).toBe(of);
    // The step runs again on the cleaned picture: a mark still there goes to the removal, as before the rule.
    expect(afterMark(s, "a crest behind the headline")).toEqual({ next: "clean", reason: REASONS.marks("a crest behind the headline") });
    // A design whose base is its cleaned picture for another reason is also as before, whichever design it is.
    expect(afterMark(state({ generations: 1, composed: { of, path: null, why: "service" } }), "a crest").next).toBe("clean");
    expect(afterMark(state({ generations: 1 }), "a crest").next).toBe("clean");
  });
});

// A check of the slot itself (the drawing still found there, or no logo file showing on the ground under it) that fails.
describe("a slot check that fails", () => {
  const STILL = "marks: the logo drawn at its place is still there after cleaning (match 0.81)";
  const GROUND = "ground: no logo file shows on the picture under the logo (#7A7A7A)";
  const withComposed = (generations: number, unlogos = 1) => state({
    generations, unlogos, nologo_path: `${BASE}/nologo-${generations}-${unlogos}.png`,
    composed: { of: `${BASE}/nologo-${generations}-${unlogos}.png`, path: `${BASE}/composed-${generations}-${unlogos}.png`, share: 0.012, join: 2.4, removed: 0.31, box: { x: 0, y: 0, width: 8, height: 8 } },
  });

  it("on a composed picture before the last design has its own consequence, and the cleaned picture is never the base", () => {
    for (let n = 1; n < MAX_GENERATIONS; n++) {
      for (const reason of [STILL, GROUND]) {
        const s = withComposed(n);
        const before = structuredClone(s.composed);
        expect(afterSlot(s, reason), `design ${n}: ${reason}`).toBe("own");
        // Nothing is dropped: the picture judged is still the composed one, so no re-rendered picture can be delivered from here.
        expect(s.composed).toEqual(before);
        expect(basePicture(s)).toBe(`${BASE}/composed-${n}-1.png`);
      }
    }
  });

  it("on the composed picture of the last design falls back to the cleaned picture, once, to be judged there as before the rule", async () => {
    for (const reason of [STILL, GROUND]) {
      const s = withComposed(MAX_GENERATIONS);
      const cleaned = s.nologo_path as string;
      expect(afterSlot(s, reason)).toBe("cleaned");
      expect(s.composed).toEqual({ of: cleaned, path: null, why: `check: ${reason}`, share: 0.012, join: 2.4, removed: 0.31 });
      expect(basePicture(s)).toBe(cleaned);
      // The step runs again: the cleaned picture is asked for as before the rule, and no new design is asked for.
      const call = vi.fn(async (_compose: boolean) => ({ result: answer(), ms: 3 }));
      await askCleanedSlot(s, BASE, call);
      expect(call.mock.calls).toEqual([[false]]);
      expect(composeRedesign(s)).toBeNull();
      // A check that fails now is the cleaned picture's own: it cannot send the step round again.
      expect(afterSlot(s, reason)).toBe("own");
      expect(basePicture(s)).toBe(cleaned);
    }
  });

  it("on a cleaned picture has its own consequence on any design, as before the rule", () => {
    for (let n = 1; n <= MAX_GENERATIONS; n++) {
      for (const composed of [undefined, { of: `${BASE}/nologo-1-2.png`, path: null, why: "removal" }, { of: `${BASE}/nologo-1-2.png`, path: null, why: "service" }]) {
        const s = state({ generations: n, composed });
        expect(afterSlot(s, GROUND)).toBe("own");
        expect(s.composed).toEqual(composed);
      }
    }
  });

  // The marks step as the worker runs it, for an option whose every picture, composed or cleaned, still shows the drawing at
  // the slot: the worst this path can do. The two counts are the worker's own (cleanAgain, where MAX_MARK_CLEANS is 2, and
  // designAgain, which clears what the job keeps of the design).
  it("never goes round: every design ends within its removals, and the option within its designs", async () => {
    const MAX_MARK_CLEANS = 2;
    let drawings = 0, removals = 0, runs = 0;
    const fellBack: string[] = [], judgedCleaned: string[] = [];
    for (let generations = 1; generations <= MAX_GENERATIONS; generations++) {
      drawings++;
      // What the job keeps of this design, carried from one removal to the next as the worker's state is.
      let composed: unknown;
      for (let unlogos = 1, markCleans = 0; markCleans <= MAX_MARK_CLEANS; unlogos++) {
        removals++;
        expect(unlogos).toBeLessThanOrEqual(MAX_UNLOGO);
        const nologo_path = `${BASE}/nologo-${generations}-${unlogos}.png`;
        const s = state({ generations, unlogos, nologo_path, composed });
        // The step, run until the slot check has its consequence. The service composes every cleaned picture it is asked to.
        for (let settled = false; !settled;) {
          expect(++runs).toBeLessThan(50);
          await askCleanedSlot(s, BASE, async (compose) => ({ result: answer(compose ? made : undefined), ms: 1 }));
          expect(composeRedesign(s)).toBeNull();
          if (afterSlot(s, STILL) === "cleaned") { fellBack.push(nologo_path); continue; }
          if (basePicture(s) === nologo_path) judgedCleaned.push(nologo_path);
          settled = true;
        }
        composed = s.composed;
        // cleanAgain: one more removal while the design has mark cleans left, then the design is made again.
        markCleans++;
      }
    }
    // The caps a design always had: 3 designs, each with its first removal and one after each of 2 mark cleans.
    expect([drawings, removals]).toEqual([MAX_GENERATIONS, MAX_GENERATIONS * (1 + MAX_MARK_CLEANS)]);
    expect(drawings + removals).toBe(12);
    // Only the last design was judged on its cleaned pictures, once for each, and each after its composed picture was dropped.
    const last = [1, 2, 3].map((n) => `${BASE}/nologo-${MAX_GENERATIONS}-${n}.png`);
    expect(fellBack).toEqual(last);
    expect(judgedCleaned).toEqual(last);
    // One run of the step for each removal, and one more for each fall back.
    expect(runs).toBe(removals + last.length);
  });
});

// The live case of 17 Nov 2026, as the job was at its marks step: the logo found and the picture composed, and the reader
// naming a mark the model drew. Before: the cleaned picture was read, cleaned again and delivered after two redraws.
describe("the design that was delivered after two whole-picture redraws", () => {
  const WHERE = "a large, faint dark-blue monogram watermark in the background";
  const job = (generations: number) => state({
    generations, unlogos: 1, nologo_path: `${BASE}/nologo-${generations}-1.png`, logo_slot: { from: "drawn" },
    composed: { of: `${BASE}/nologo-${generations}-1.png`, path: `${BASE}/composed-${generations}-1.png`, share: 0.012, join: 2.4, removed: 0.31 },
  });

  it("is now made again after its one removal, with the reader's words as the reason", () => {
    const s = job(1);
    expect(composeRedesign(s)).toBeNull();
    expect(basePicture(s)).toBe(`${BASE}/composed-1-1.png`);
    expect(afterMark(s, WHERE)).toEqual({ next: "again", reason: `marks: drawn in the picture, away from the logo's place: ${WHERE}` });
    // No second removal was asked for: the picture went through the image model once to take the logo out, and is not delivered.
    expect(s.unlogos).toBe(1);
  });

  it("still delivers on the option's last design: its cleaned picture is judged and cleaned as before the rule", () => {
    const s = job(MAX_GENERATIONS);
    expect(afterMark(s, WHERE).next).toBe("cleaned");
    expect(basePicture(s)).toBe(`${BASE}/nologo-${MAX_GENERATIONS}-1.png`);
    expect(composeWanted(s)).toBe(false);
    // On the cleaned picture the mark is named in the next removal; a clean read then goes on to finish from that picture.
    expect(afterMark(s, WHERE).next).toBe("clean");
  });

  it("costs no more image-model calls for an option than before, at the worst", () => {
    // Removals one design can reach: the first, and one after each mark clean (the worker's MAX_MARK_CLEANS is 2), under MAX_UNLOGO.
    const cleans = 2, removals = 1 + cleans;
    expect(removals).toBeLessThanOrEqual(MAX_UNLOGO);
    const before = MAX_GENERATIONS * (1 + removals);
    // After: a mark the model drew ends every design but the last after one removal.
    const after = (MAX_GENERATIONS - 1) * (1 + 1) + (1 + removals);
    expect([before, after]).toEqual([12, 8]);
    expect(after).toBeLessThanOrEqual(before);
  });
});
