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
import { askCleanedSlot, basePicture, beforeTheRule, composeWanted, composedPath, dropComposed, slotFound } from "../../../functions/_shared/design/firstPictureJob";

const BASE = "client-1/canva-finish/job-1";
const state = (more: Record<string, unknown> = {}) => ({ design_path: `${BASE}/design-1.png`, nologo_path: `${BASE}/nologo-1-2.png`, generations: 1, unlogos: 2, logo_slot: { from: "drawn" }, ...more }) as Parameters<typeof composeWanted>[0];
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
    const got = await askCleanedSlot(s, BASE, true, call);
    expect(call.mock.calls).toEqual([[true]]);
    expect(got.result.file).toBe("stored");
    expect(s.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: `${BASE}/composed-1-2.png`, share: 0.0137, join: 3.13, box: made.box });
    expect(basePicture(s)).toBe(`${BASE}/composed-1-2.png`);
  });

  it("keeps why no picture was composed, and goes on with the cleaned picture", async () => {
    const s = state();
    await askCleanedSlot(s, BASE, true, async () => ({ result: answer({ made: false, why: "join", share: 0, join: 31.4 }), ms: 5 }));
    expect(s.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: null, why: "join", share: 0, join: 31.4 });
    expect(basePicture(s)).toBe(`${BASE}/nologo-1-2.png`);
    expect(composeWanted(s)).toBe(false);
    // A composed picture the service could not store is the same case.
    const t = state();
    await askCleanedSlot(t, BASE, true, async () => ({ result: answer({ made: false, why: "store", share: 0.0137, join: 3.13 }), ms: 5 }));
    expect(t.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: null, why: "store", share: 0.0137, join: 3.13 });
    expect(basePicture(t)).toBe(`${BASE}/nologo-1-2.png`);
  });

  it("never composes for a slot at the canvas rectangle: the drawing was not found, so its place is not known", async () => {
    for (const [slot, checked] of [[{ from: "canvas" }, true], [{ from: "canvas" }, false], [{ from: "drawn" }, false], [undefined, true], [null, true]] as Array<[unknown, boolean]>) {
      const s = state({ logo_slot: slot });
      const call = vi.fn(async (_compose: boolean) => ({ result: answer(), ms: 4 }));
      await askCleanedSlot(s, BASE, checked, call);
      // Asked exactly as before the rule, once; the cleaned picture is the base.
      expect(call.mock.calls).toEqual([[false]]);
      expect(s.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: null, why: "canvas" });
      expect(basePicture(s)).toBe(`${BASE}/nologo-1-2.png`);
    }
    expect(slotFound(state(), true)).toBe(true);
    expect(slotFound(state(), false)).toBe(false);
    expect(slotFound(state({ logo_slot: { from: "canvas" } }), true)).toBe(false);
  });

  it("asks a service from before the rule again without the two fields, so the design goes on as before", async () => {
    const s = state();
    const call = vi.fn(async (compose: boolean) => {
      if (compose) throw new PictureError("The picture service refused the call (400): The request is not well formed: body.", "slot-file", "refused", 400);
      return { result: answer(), ms: 7 };
    });
    const got = await askCleanedSlot(s, BASE, true, call);
    expect(call.mock.calls).toEqual([[true], [false]]);
    expect(got.ms).toBe(7);
    expect(s.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: null, why: "service" });
    expect(basePicture(s)).toBe(`${BASE}/nologo-1-2.png`);
  });

  it("does not ask again once composing was ruled out for this cleaned picture, and keeps the record", async () => {
    const kept = { of: `${BASE}/nologo-1-2.png`, path: null, why: "check: marks: could not be cleaned out: a crest" };
    const s = state({ composed: kept });
    const call = vi.fn(async (_compose: boolean) => ({ result: answer(), ms: 3 }));
    await askCleanedSlot(s, BASE, true, call);
    expect(call.mock.calls).toEqual([[false]]);
    expect(s.composed).toEqual(kept);
  });

  it("lets every other failure through as it is", async () => {
    const busy = new PictureError("The picture service did not answer: 503.", "slot-file", "unavailable");
    await expect(askCleanedSlot(state(), BASE, true, async () => { throw busy; })).rejects.toBe(busy);
    const unusable = new PictureError("The file is not a picture that can be read.", "slot-file", "unusable");
    await expect(askCleanedSlot(state(), BASE, true, async () => { throw unusable; })).rejects.toBe(unusable);
    // A refusal of a request that carried no first picture is a refusal.
    const refused = new PictureError("The picture service refused the call (400).", "slot-file", "refused", 400);
    const ruledOut = state({ composed: { of: `${BASE}/nologo-1-2.png`, path: null, why: "join" } });
    await expect(askCleanedSlot(ruledOut, BASE, true, async () => { throw refused; })).rejects.toBe(refused);
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
    await askCleanedSlot(s, BASE, true, call);
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
    const got = await askCleanedSlot(s, BASE, true, (compose) => callPicture(admin, "slot-file", request(compose), { fetchImpl, sleep: async () => {} }));
    expect(bodies.map((b) => "first" in b)).toEqual([true, false]);
    expect(got.result.file).toBe("stored");
    expect(s.composed).toEqual({ of: `${BASE}/nologo-1-2.png`, path: null, why: "service" });
  });
});
