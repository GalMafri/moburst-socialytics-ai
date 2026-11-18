// @vitest-environment node
// server/test/firstPicture.test.ts
//
// The cleaned-slot route with the first picture as the base (17 Nov 2026):
// a request for a found drawing that carries `first` and `out` gets the
// composed picture stored and the slot read on it, the search for the
// drawing included; a request without them is answered exactly as
// before; and when no picture can be composed nothing is written and the
// slot is read on the cleaned picture. Each call goes through createApp and
// a fake store keyed by URL, as in routes.test.ts.

import { describe, expect, it } from "vitest";
import { PICTURE_CALL_HEADER, type Rect, type Rgb, type SlotFileResult } from "../../supabase/functions/_shared/picture/contract.ts";
import { composeFirst } from "../../supabase/functions/_shared/design/firstPicture.ts";
import { composeFirstOrStrokes } from "../../supabase/functions/_shared/design/firstPictureStrokes.ts";
import { box, copyOf, drawLogo, flat, inked, mark } from "../../supabase/tests/_shared/design/draw.ts";
import { createApp } from "../src/app.ts";
import { composeForSlot } from "../src/picture/compose.ts";
import { decodeRaster, encodePng, type Raster } from "../src/picture/raster.ts";
import { slotFile } from "../src/picture/slot.ts";

const CALL = "5f0c2f6e-8a1b-4c3d-9e2f-1a2b3c4d5e6f";
const STORAGE = "https://store.test/";
const GET = `${STORAGE}get/`;
const PUT = `${STORAGE}put/`;

function harness(files: Record<string, Uint8Array>) {
  const puts: Record<string, Buffer> = {};
  const lines: Record<string, unknown>[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? "GET") === "PUT" && url.startsWith(PUT)) {
      if (url.endsWith("/refused")) return new Response("no", { status: 403 });
      if (url.endsWith("/busy")) return new Response("busy", { status: 503 });
      puts[url.slice(PUT.length)] = Buffer.from(await new Response(init?.body).arrayBuffer());
      return new Response("{}", { status: 200 });
    }
    const name = url.slice(GET.length);
    if (name === "down") return new Response("bad gateway", { status: 502 });
    const bytes = files[name];
    if (!url.startsWith(GET) || !bytes) return new Response("not found", { status: 404 });
    return new Response(bytes, { status: 200 });
  }) as typeof fetch;
  let t = 1_700_000_000_000;
  const app = createApp({ claimCall: async () => true, fetchImpl: fake, log: (line) => lines.push(line), now: () => (t += 5), storage: STORAGE });
  async function call(body: unknown) {
    const res = await app.request("/api/picture/slot-file", { method: "POST", headers: { [PICTURE_CALL_HEADER]: CALL, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }
  return { puts, lines, call };
}

const W = 320, H = 240;
const GROUND: Rgb = [98, 2, 73];
const CAST: Rgb = [4, 6, -5];
const rect: Rect = { x: 66, y: 34, width: 64, height: 26 };
const shape = mark(40, 16, [0, 0, 0]);
const white = inked(shape, [255, 255, 255]);
const stamps = [{ file: "stored" as const, raster: shape }, { file: "other" as const, raster: white }];
const files = [{ file: "stored", logo: `${GET}stored.png` }, { file: "other", logo: `${GET}other.png` }];
const base = { job: "job-1", step: "marks", picture: `${GET}cleaned.png`, rect, frame: [W, H] as [number, number], of: "stored", files };
/** The slot is the found drawing: the request looks for it again, and only then may it ask for a composed picture. */
const drawn = { file: "stored" as const, ground: [255, 255, 255] as Rgb };
const ask = { first: `${GET}first.png`, out: `${PUT}composed.png`, drawn };

/** The first picture: a ground, a dark object, and the model's logo drawing in the slot. */
function firstPicture(): Raster {
  const r = flat(W, H, GROUND);
  box(r, 220, 100, W, 200, [20, 24, 30]);
  return drawLogo(r, shape, rect, [255, 255, 255]);
}

/** The cleaned picture: the drawing gone, and a color cast of its own. */
function cleanedPicture(): Raster {
  const r = flat(W, H, [GROUND[0] + CAST[0], GROUND[1] + CAST[1], GROUND[2] + CAST[2]]);
  box(r, 220, 100, W, 200, [20 + CAST[0], 24 + CAST[1], 30 + CAST[2]]);
  return r;
}

async function store(pictures: Record<string, Raster>) {
  const all: Record<string, Uint8Array> = { "stored.png": await encodePng(shape), "other.png": await encodePng(white) };
  for (const [name, r] of Object.entries(pictures)) all[`${name}.png`] = await encodePng(r);
  return harness(all);
}

const result = (json: Record<string, unknown>) => json.result as SlotFileResult;

describe("POST /api/picture/slot-file with the first picture", () => {
  it("stores the composed picture and reads the slot on it", async () => {
    const { puts, lines, call } = await store({ first: firstPicture(), cleaned: cleanedPicture() });
    const { status, json } = await call({ ...base, ...ask });
    expect(status).toBe(200);

    const expected = composeFirst(firstPicture(), cleanedPicture(), rect, true);
    expect(expected.facts.made).toBe(true);
    const got = result(json);
    expect(got.composed).toEqual(expected.facts);
    // The stored picture is the composed one, byte for byte what the rule gives on the same decoded inputs.
    const stored = await decodeRaster(new Uint8Array(puts["composed.png"]));
    expect(Buffer.from(stored.data).equals(Buffer.from(expected.picture!.data))).toBe(true);
    // Everything else the answer says is read on that picture: its ground is the first picture's, not the cleaned picture's with its cast.
    expect(got.ground).toEqual(GROUND);
    const { composed: _composed, ...rest } = got;
    expect(rest).toEqual(slotFile(expected.picture!, rect, [W, H], "stored", stamps, drawn));
    // The drawing was looked for on the composed picture, and is gone from it; on the first picture it is found.
    expect(got.drawn?.found).toBe(false);
    expect(slotFile(firstPicture(), rect, [W, H], "stored", stamps, drawn).drawn?.found).toBe(true);
    expect(slotFile(cleanedPicture(), rect, [W, H], "stored", stamps).ground).toEqual([GROUND[0] + CAST[0], GROUND[1] + CAST[1], GROUND[2] + CAST[2]]);
    // Outside the patch the stored picture is the first picture exactly.
    const first = firstPicture();
    let outside = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const b = got.composed!.box!;
      if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) continue;
      const p = (y * W + x) * 4;
      if (stored.data[p] !== first.data[p] || stored.data[p + 1] !== first.data[p + 1] || stored.data[p + 2] !== first.data[p + 2]) outside++;
    }
    expect(outside).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ route: "slot-file", job: "job-1", step: "marks", ok: true, in: { picture: "320x240", first: "320x240" } });
    expect(lines[0].out).toEqual({ out: `320x240, ${puts["composed.png"].length} B` });
  });

  it("answers a request without the two fields exactly as before, and writes nothing", async () => {
    const { puts, lines, call } = await store({ first: firstPicture(), cleaned: cleanedPicture() });
    const { status, json } = await call(base);
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, result: slotFile(cleanedPicture(), rect, [W, H], "stored", stamps), ms: 5 });
    expect(result(json)).not.toHaveProperty("composed");
    expect(Object.keys(puts)).toEqual([]);
    expect(lines[0]).toMatchObject({ in: { picture: "320x240", "file.stored": "40x16", "file.other": "40x16" }, out: {} });
    expect(lines[0].in).not.toHaveProperty("first");
    // With the drawing's check and no first picture: also as before.
    const checked = await call({ ...base, drawn });
    expect(checked.json).toEqual({ ok: true, result: slotFile(cleanedPicture(), rect, [W, H], "stored", stamps, drawn), ms: 5 });
    expect(Object.keys(puts)).toEqual([]);
  });

  it("looks for the drawing on the composed picture", async () => {
    // The removal left the drawing where it was: the composed picture shows it too, and the answer says so.
    const left = firstPicture();
    const { call } = await store({ first: firstPicture(), cleaned: left });
    const got = result((await call({ ...base, ...ask })).json);
    expect(got.composed?.made).toBe(true);
    expect(got.drawn).toEqual(slotFile(composeFirst(firstPicture(), copyOf(left), rect, true).picture!, rect, [W, H], "stored", stamps, drawn).drawn);
    expect(got.drawn?.found).toBe(true);
  });

  it("scales the slot to the pictures' own size before composing", async () => {
    const twice = (r: Raster): Raster => {
      const out = flat(W * 2, H * 2, [0, 0, 0]);
      for (let y = 0; y < H * 2; y++) for (let x = 0; x < W * 2; x++) out.data.set(r.data.subarray(((y >> 1) * W + (x >> 1)) * 4, ((y >> 1) * W + (x >> 1)) * 4 + 4), (y * W * 2 + x) * 4);
      return out;
    };
    const { puts, call } = await store({ first: twice(firstPicture()), cleaned: twice(cleanedPicture()) });
    const got = result((await call({ ...base, ...ask })).json);
    const expected = composeFirst(twice(firstPicture()), twice(cleanedPicture()), { x: rect.x * 2, y: rect.y * 2, width: rect.width * 2, height: rect.height * 2 }, true);
    expect(got.composed).toEqual(expected.facts);
    expect(Buffer.from((await decodeRaster(new Uint8Array(puts["composed.png"]))).data).equals(Buffer.from(expected.picture!.data))).toBe(true);
    expect(got.ground).toEqual(GROUND);
  });

  it("writes nothing and reads the cleaned picture when no picture can be composed", async () => {
    const cleanedAnswer = slotFile(cleanedPicture(), rect, [W, H], "stored", stamps, drawn);
    // The first picture is not in storage.
    const missing = await store({ cleaned: cleanedPicture() });
    const gone = await missing.call({ ...base, ...ask });
    expect(gone.status).toBe(200);
    expect(result(gone.json)).toEqual({ ...cleanedAnswer, composed: { made: false, why: "first", share: 0, join: 0 } });
    expect(Object.keys(missing.puts)).toEqual([]);

    // The two pictures are not one size.
    const sized = await store({ first: flat(W, H + 8, GROUND), cleaned: cleanedPicture() });
    const other = result((await sized.call({ ...base, ...ask })).json);
    expect(other.composed).toEqual({ made: false, why: "size", share: 0, join: 0 });
    expect({ ...other, composed: undefined }).toEqual({ ...cleanedAnswer, composed: undefined });
    expect(Object.keys(sized.puts)).toEqual([]);

    // The ring around the slot does not show the same thing in the two pictures (stripes 8 pixels off): no clean join.
    const striped = (shift: number) => {
      const r = cleanedPicture();
      for (let x = 30 + shift; x < 180; x += 24) box(r, x, 0, x + 12, 90, [230, 232, 236]);
      return r;
    };
    const apart = await store({ first: striped(0), cleaned: striped(8) });
    const failed = result((await apart.call({ ...base, ...ask })).json);
    expect(failed.composed).toMatchObject({ made: false, why: "join" });
    expect(failed.composed!.join).toBeGreaterThan(20);
    expect({ ...failed, composed: undefined }).toEqual({ ...slotFile(striped(8), rect, [W, H], "stored", stamps, drawn), composed: undefined });
    expect(Object.keys(apart.puts)).toEqual([]);
  });

  it("answers as not composed when the composed picture cannot be stored, and the call succeeds", async () => {
    const cleanedAnswer = slotFile(cleanedPicture(), rect, [W, H], "stored", stamps, drawn);
    const made = composeFirst(firstPicture(), cleanedPicture(), rect, true).facts;
    for (const out of [`${PUT}refused`, `${PUT}busy`]) {
      const { puts, lines, call } = await store({ first: firstPicture(), cleaned: cleanedPicture() });
      const { status, json } = await call({ ...base, ...ask, out });
      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      // Everything is read on the cleaned picture, which stays the design's base.
      expect(result(json)).toEqual({ ...cleanedAnswer, composed: { made: false, why: "store", share: made.share, join: made.join } });
      expect(Object.keys(puts)).toEqual([]);
      expect(lines[0]).toMatchObject({ route: "slot-file", ok: true, out: {} });
    }
  });

  it("leaves a first picture storage cannot serve right now to the worker's retry", async () => {
    const { call } = await store({ cleaned: cleanedPicture() });
    expect((await call({ ...base, ...ask, first: `${GET}down` })).status).toBe(503);
  });

  it("refuses one of the two fields without the other, and a link outside the product's storage", async () => {
    const { call } = await store({ first: firstPicture(), cleaned: cleanedPicture() });
    const onlyFirst = await call({ ...base, drawn, first: ask.first });
    expect(onlyFirst.status).toBe(400);
    expect(onlyFirst.json.reason).toBe("The request is not well formed: out");
    const onlyOut = await call({ ...base, drawn, out: ask.out });
    expect(onlyOut.status).toBe(400);
    expect(onlyOut.json.reason).toBe("The request is not well formed: first");
    expect((await call({ ...base, ...ask, first: "https://elsewhere.test/first.png" })).json.reason).toBe("The request is not well formed: first");
    expect((await call({ ...base, ...ask, out: "https://elsewhere.test/out.png" })).json.reason).toBe("The request is not well formed: out");
  });

  it("composes for a slot that is not a found drawing only where the two pictures show the removal: inside it, or at the one place away from it", async () => {
    // A slot at the canvas rectangle carries no `drawn`: the service measures the removal itself.
    const shown = await store({ first: firstPicture(), cleaned: cleanedPicture() });
    const got = await shown.call({ ...base, first: ask.first, out: ask.out });
    expect(got.status).toBe(200);
    const expected = composeFirst(firstPicture(), cleanedPicture(), rect, false);
    expect(expected.facts.made).toBe(true);
    expect(expected.facts.removed).toBeGreaterThanOrEqual(0.2);
    expect(expected.facts.measured).toBeUndefined();
    expect(result(got.json)).toEqual({ ...slotFile(expected.picture!, rect, [W, H], "stored", stamps), composed: expected.facts });
    expect(result(got.json)).not.toHaveProperty("drawn");
    expect(Buffer.from((await decodeRaster(new Uint8Array(shown.puts["composed.png"]))).data).equals(Buffer.from(expected.picture!.data))).toBe(true);

    // The model drew its logo somewhere else, and the slot holds no removal. The cleaning took the drawing out there: that place is
    // composed, the slot is read on the composed picture (its ground is the first picture's own), and the answer says where.
    const elsewhere = () => {
      const r = flat(W, H, GROUND);
      box(r, 220, 100, W, 200, [20, 24, 30]);
      return drawLogo(r, shape, { ...rect, y: rect.y + 120 }, [255, 255, 255]);
    };
    const away = await store({ first: elsewhere(), cleaned: cleanedPicture() });
    const moved = await away.call({ ...base, first: ask.first, out: ask.out });
    expect(moved.status).toBe(200);
    const there = composeFirst(elsewhere(), cleanedPicture(), rect, false);
    expect(there.facts).toMatchObject({ made: true, removed: 0, measured: { elsewhere: { place: { x: 64, y: 152, width: 68, height: 28 } } } });
    expect(there.facts.box!.y).toBeGreaterThan(rect.y + rect.height);
    expect(result(moved.json)).toEqual({ ...slotFile(there.picture!, rect, [W, H], "stored", stamps), composed: there.facts });
    expect(result(moved.json).ground).toEqual(GROUND);
    expect(Buffer.from((await decodeRaster(new Uint8Array(away.puts["composed.png"]))).data).equals(Buffer.from(there.picture!.data))).toBe(true);

    // Two drawings far from each other and from the slot: no one place holds what the cleaning took out, nothing is composed,
    // nothing is written, and the cleaned picture is read, as before.
    const twice = drawLogo(elsewhere(), shape, { ...rect, x: 230, y: 20 }, [255, 255, 255]);
    const none = await store({ first: twice, cleaned: cleanedPicture() });
    const refused = await none.call({ ...base, first: ask.first, out: ask.out });
    expect(refused.status).toBe(200);
    const read = result(refused.json).composed!.measured!;
    expect(read.elsewhere!.place.width).toBeGreaterThan(200);
    expect(read.elsewhere!.floor).toBeUndefined();
    expect(result(refused.json)).toEqual({ ...slotFile(cleanedPicture(), rect, [W, H], "stored", stamps), composed: { made: false, why: "removal", share: 0, join: 0, removed: 0, measured: read } });
    expect(Object.keys(none.puts)).toEqual([]);

    // A thin logo at the slot, under one fifth of its cells, and nothing else the two pictures differ in: composed, which a fixed
    // share did not, and what it was read against is answered with it.
    const thin = () => {
      const r = flat(W, H, GROUND);
      box(r, 220, 100, W, 200, [20, 24, 30]);
      for (let k = 0; k < 3; k++) box(r, rect.x + 8 + k * 16, rect.y + 6, rect.x + 11 + k * 16, rect.y + 18, [255, 255, 255]);
      return r;
    };
    const small = await store({ first: thin(), cleaned: cleanedPicture() });
    const took = await small.call({ ...base, first: ask.first, out: ask.out });
    const want = composeFirst(thin(), cleanedPicture(), rect, false);
    expect(want.facts).toMatchObject({ made: true, measured: { floor: 0 } });
    expect(want.facts.removed).toBeLessThan(0.2);
    expect(want.facts.removed).toBeGreaterThan(0);
    expect(result(took.json)).toEqual({ ...slotFile(want.picture!, rect, [W, H], "stored", stamps), composed: want.facts });
    expect(Buffer.from((await decodeRaster(new Uint8Array(small.puts["composed.png"]))).data).equals(Buffer.from(want.picture!.data))).toBe(true);
  });
});

describe("composeForSlot", () => {
  it("gives the cleaned picture back with the reason when there is no first picture", () => {
    const cleaned = cleanedPicture();
    const made = composeForSlot(null, cleaned, rect, [W, H], true);
    expect(made.picture).toBe(cleaned);
    expect(made.facts).toEqual({ made: false, why: "first", share: 0, join: 0 });
  });
});

describe("POST /api/picture/slot-file where the rule can lay no rectangle", () => {
  it("composes from the strokes the cleaning took out, and answers it as a composed picture", async () => {
    // A larger picture: the model drew a wordmark low on it, away from the slot and wider than a slot's place ever is, so the
    // rectangle rule answers "removal" (18 Nov 2026, night, firstPictureStrokes.ts).
    const w = 640, h = 480, slot: Rect = { x: 290, y: 40, width: 60, height: 24 };
    const plain = (by: Rgb = [0, 0, 0]) => flat(w, h, [52 + by[0], 84 + by[1], 140 + by[2]]);
    const word = (r: Raster, x: number, y: number) => {
      for (let k = 0; k < 6; k++) { box(r, x + k * 22, y, x + 4 + k * 22, y + 32, [240, 242, 236]); box(r, x + k * 22, y, x + 16 + k * 22, y + 4, [240, 242, 236]); box(r, x + 12 + k * 22, y, x + 16 + k * 22, y + 32, [240, 242, 236]); }
      return r;
    };
    const drawnLow = () => word(plain(), 120, 300);
    const request = { ...base, rect: slot, frame: [w, h] as [number, number], first: ask.first, out: ask.out };
    const { puts, call } = await store({ first: drawnLow(), cleaned: plain(CAST) });
    const got = await call(request);
    expect(got.status).toBe(200);
    expect(composeFirst(drawnLow(), plain(CAST), slot, false).facts).toMatchObject({ made: false, why: "removal" });
    const expected = composeFirstOrStrokes(drawnLow(), plain(CAST), slot, false);
    expect(expected.facts).toMatchObject({ made: true, by: "strokes", box: { x: 104, y: 284, width: 158, height: 64 }, measured: { strokes: { instead: "removal", cluster: { x: 120, y: 300, width: 126, height: 32 } } } });
    // The answer is the one a composed picture always had: the facts, and the slot read on the stored picture.
    expect(result(got.json)).toEqual({ ...slotFile(expected.picture!, slot, [w, h], "stored", stamps), composed: expected.facts });
    const stored = await decodeRaster(new Uint8Array(puts["composed.png"]));
    expect(Buffer.from(stored.data).equals(Buffer.from(expected.picture!.data))).toBe(true);
    // The stored picture is the first picture with the wordmark gone: its ground everywhere, the cleaned picture's cast nowhere.
    expect(Buffer.from(stored.data).equals(Buffer.from(plain().data))).toBe(true);
    expect(result(got.json).ground).toEqual([52, 84, 140]);

    // The same wordmark drawn twice: the step composes nothing, nothing is written, and the answer is the rule's own, read on the cleaned picture.
    const twice = () => word(drawnLow(), 380, 150);
    const none = await store({ first: twice(), cleaned: plain(CAST) });
    const refused = await none.call(request);
    const was = composeFirst(twice(), plain(CAST), slot, false);
    expect(was.facts).toMatchObject({ made: false, why: "removal" });
    expect(result(refused.json)).toEqual({ ...slotFile(plain(CAST), slot, [w, h], "stored", stamps), composed: was.facts });
    expect(Object.keys(none.puts)).toEqual([]);
  });
});
