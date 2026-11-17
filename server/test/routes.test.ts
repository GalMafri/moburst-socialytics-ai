// @vitest-environment node
// server/test/routes.test.ts
//
// The picture routes end to end (12 Nov 2026; eight since 16 Nov): each call goes through
// createApp and app.request, reads its inputs from a fake store keyed by
// URL, and the bytes it writes back are checked against the operation's own
// output on the same decoded inputs. The canvas and finish cases run once at
// real sizes; the others use small pictures.

import { describe, expect, it } from "vitest";
import { canvasLogoRect } from "../../supabase/functions/_shared/canva/brief.ts";
import { PUBLIC_DEFAULTS } from "../../public-env.ts";
import { PICTURE_CALL_HEADER, READ_JPEG_QUALITY, type LocateResult, type LogoSetResult, type Placement, type PostLogo, type Rgb, type SlotFileResult, type SlotResult } from "../../supabase/functions/_shared/picture/contract.ts";
import { partsOf, wholeExposedInks, wholeInksOf } from "../../supabase/functions/_shared/design/logoTone.ts";
import { carouselSlot } from "../../supabase/functions/_shared/design/carouselLogo.ts";
import { blank, box, drawLogo, flat, inked, mark } from "../../supabase/tests/_shared/design/draw.ts";
import { createApp } from "../src/app.ts";
import { generationCanvas } from "../src/picture/canvas.ts";
import { finishPicture } from "../src/picture/finish.ts";
import { locateLogo } from "../src/picture/locate.ts";
import { readPictures } from "../src/picture/read.ts";
import { decodeRaster, encodeJpeg, encodePng, raster, type Raster } from "../src/picture/raster.ts";
import { titleRead } from "../src/picture/title.ts";
import { locateTemplates } from "../src/picture/tone.ts";
import { findSlot, slotFile } from "../src/picture/slot.ts";
import { pagePicture, ringAndBarLogo, wideLogo } from "./fixtures.ts";

const BIG = 60_000;
const CALL = "5f0c2f6e-8a1b-4c3d-9e2f-1a2b3c4d5e6f";
/** The tests' own storage address: the service reads and writes nowhere else. */
const STORAGE = "https://store.test/";
const GET = `${STORAGE}get/`;
const PUT = `${STORAGE}put/`;

type Put = { bytes: Buffer; contentType: string | null; upsert: string | null };

/** A fake storage: GETs serve the prepared bytes by name, PUTs are recorded by name; "refused" PUTs answer 403. */
function harness(files: Record<string, Uint8Array>, options: { storageTimeoutMs?: number } = {}) {
  const puts: Record<string, Put> = {};
  const lines: Record<string, unknown>[] = [];
  const fetched: string[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    fetched.push(url);
    // A storage that never answers: it ends only when the call's own time limit stops it.
    if (url.endsWith("/stalled")) return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    if ((init?.method ?? "GET") === "PUT" && url.startsWith(PUT)) {
      const name = url.slice(PUT.length);
      if (name === "refused") return new Response("no", { status: 403 });
      if (name === "busy") return new Response("busy", { status: 503 });
      const headers = new Headers(init?.headers);
      puts[name] = { bytes: Buffer.from(await new Response(init?.body).arrayBuffer()), contentType: headers.get("content-type"), upsert: headers.get("x-upsert") };
      return new Response("{}", { status: 200 });
    }
    const name = url.slice(GET.length);
    if (name === "huge") return new Response(new Uint8Array(4), { headers: { "content-length": String(64 * 1024 * 1024 + 1) } });
    if (name === "down") return new Response("bad gateway", { status: 502 });
    if (name === "offline") throw new TypeError("fetch failed");
    const bytes = files[name];
    if (!url.startsWith(GET) || !bytes) return new Response("not found", { status: 404 });
    return new Response(bytes, { status: 200 });
  }) as typeof fetch;
  let t = 1_700_000_000_000;
  const now = () => (t += 5);
  // Every call here is one the database claims; the door itself is covered in app.test.ts.
  const app = createApp({ claimCall: async () => true, fetchImpl: fake, log: (line) => lines.push(line), now, storage: STORAGE, storageTimeoutMs: options.storageTimeoutMs });
  async function call(route: string, body: unknown) {
    const res = await app.request(`/api/picture/${route}`, {
      method: "POST",
      headers: { [PICTURE_CALL_HEADER]: CALL, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }
  return { puts, lines, fetched, call };
}

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  return Buffer.from(a as Uint8Array).equals(Buffer.from(b as Uint8Array));
}

async function decoded(put: Put): Promise<Raster> {
  return decodeRaster(new Uint8Array(put.bytes));
}

const meta = { job: "job-1", step: "design" };

describe("POST /api/picture/canvas", () => {
  it("writes the canvas and the mask and answers the rectangle", async () => {
    const logoPng = await encodePng(wideLogo());
    const { puts, lines, call } = harness({ "logo.png": logoPng });
    const placement: Placement = { anchor: "center", width: 0.32, top: 0.08 };
    const page = { width: 1088, height: 1360 };
    const background: [number, number, number] = [12, 34, 56];
    const { status, json } = await call("canvas", { ...meta, logo: `${GET}logo.png`, page, placement, background, out: { canvas: `${PUT}canvas.png`, mask: `${PUT}mask.png` } });

    const expected = generationCanvas(await decodeRaster(logoPng), placement, page, background);
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, result: { rect: expected.rect, canvas: page, mask: page }, ms: 5 });
    expect(expected.rect).toEqual(canvasLogoRect(placement, 700, 239, page.width, page.height));
    expect(puts["canvas.png"].contentType).toBe("image/png");
    expect(puts["mask.png"].contentType).toBe("image/png");
    expect(puts["canvas.png"].bytes.equals(Buffer.from(await encodePng(expected.canvas)))).toBe(true);
    expect(puts["mask.png"].bytes.equals(Buffer.from(await encodePng(expected.mask)))).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ route: "canvas", job: "job-1", step: "design", ok: true, ms: 5, in: { logo: "700x239" } });
    expect(lines[0].out).toEqual({ canvas: `1088x1360, ${puts["canvas.png"].bytes.length} B`, mask: `1088x1360, ${puts["mask.png"].bytes.length} B` });
  }, BIG);
});

describe("POST /api/picture/finish", () => {
  it("writes the delivered PNG at the output size and answers its byte count", async () => {
    const picturePng = await encodePng(pagePicture(2176, 2720, 11));
    const logoPng = await encodePng(ringAndBarLogo());
    const { puts, lines, call } = harness({ "picture.png": picturePng, "logo.png": logoPng });
    const rect = { x: 980, y: 2240, width: 370, height: 370 };
    const output = { width: 1440, height: 1800 };
    const { status, json } = await call("finish", { ...meta, picture: `${GET}picture.png`, logo: `${GET}logo.png`, rect, frame: [2176, 2720], output, out: `${PUT}final.png` });

    const expected = finishPicture(await decodeRaster(picturePng), await decodeRaster(logoPng), rect, [2176, 2720], output);
    const expectedBytes = Buffer.from(await encodePng(expected));
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, result: { picture: { width: 2176, height: 2720 }, output, bytes: expectedBytes.length }, ms: 5 });
    expect(puts["final.png"].contentType).toBe("image/png");
    expect(puts["final.png"].bytes.equals(expectedBytes)).toBe(true);
    expect(lines[0]).toMatchObject({ route: "finish", ok: true, in: { picture: "2176x2720", logo: "2160x2160" }, out: { out: `1440x1800, ${expectedBytes.length} B` } });
  }, BIG);
});

describe("POST /api/picture/read", () => {
  const picture = pagePicture(64, 96, 31);
  const page = { width: 32, height: 48 };
  const band = { x: 2, y: 6, width: 26, height: 20 };
  const area = { x: 10, y: 40, width: 30, height: 24 };

  it("writes the page JPEG, the band JPEG and the area PNG, each at its size", async () => {
    const picturePng = await encodePng(picture);
    const { puts, call } = harness({ "picture.png": picturePng });
    const { status, json } = await call("read", { ...meta, picture: `${GET}picture.png`, page, band, area, out: { page: `${PUT}page.jpg`, band: `${PUT}band.jpg`, area: `${PUT}area.png` } });

    const expected = readPictures(await decodeRaster(picturePng), page, { band, area });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, result: { picture: { width: 64, height: 96 }, page, band: { width: 26, height: 20 }, area: { width: 30, height: 24 } }, ms: 5 });
    expect(puts["page.jpg"].contentType).toBe("image/jpeg");
    expect(puts["band.jpg"].contentType).toBe("image/jpeg");
    expect(puts["area.png"].contentType).toBe("image/png");
    expect(puts["page.jpg"].bytes.equals(Buffer.from(await encodeJpeg(expected.page, READ_JPEG_QUALITY)))).toBe(true);
    expect(puts["band.jpg"].bytes.equals(Buffer.from(await encodeJpeg(expected.band!, READ_JPEG_QUALITY)))).toBe(true);
    expect(sameBytes((await decoded(puts["area.png"])).data, expected.area!.data)).toBe(true);
  });

  it("writes only the page JPEG when no crop is asked", async () => {
    const { puts, json } = await (async () => {
      const h = harness({ "picture.png": await encodePng(picture) });
      const r = await h.call("read", { ...meta, picture: `${GET}picture.png`, page, out: { page: `${PUT}page.jpg` } });
      return { puts: h.puts, json: r.json };
    })();
    expect(Object.keys(puts)).toEqual(["page.jpg"]);
    expect(json).toEqual({ ok: true, result: { picture: { width: 64, height: 96 }, page }, ms: 5 });
  });
});

describe("POST /api/picture/locate", () => {
  it("answers the rectangle, the score, the usual spot and the frame", async () => {
    const lw = 40, lh = 16;
    const logo = raster(lw, lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const ink = !(x > 10 && x < 18 && y > 4 && y < 12) && (x < 30 || y < 8);
      logo.data.set(ink ? [255, 255, 255, 255] : [0, 0, 0, 0], (y * lw + x) * 4);
    }
    const W = 320, H = 240;
    const placement: Placement = { anchor: "left", left: 0.1875, width: 0.25, top: 0.125 };
    const usual = canvasLogoRect(placement, lw, lh, W, H);
    const sw = Math.round(usual.width * 0.8), sh = Math.round((usual.width * 0.8 * lh) / lw), sx = usual.x + 6, sy = usual.y + 4;
    const design = raster(W, H);
    for (let i = 0; i < W * H; i++) design.data.set([10, 12, 30, 255], i * 4);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const lx = Math.floor((x * lw) / sw), ly = Math.floor((y * lh) / sh);
      if (logo.data[(ly * lw + lx) * 4 + 3]) design.data.set([255, 255, 255, 255], ((sy + y) * W + sx + x) * 4);
    }
    const designPng = await encodePng(design), logoPng = await encodePng(logo);
    const { puts, lines, call } = harness({ "design.png": designPng, "logo.png": logoPng });
    const { status, json } = await call("locate", { ...meta, design: `${GET}design.png`, logo: `${GET}logo.png`, placement, background: [10, 12, 30], scales: [0.45, 1.15] });

    const expected = locateLogo(await decodeRaster(designPng), await decodeRaster(logoPng), placement, [10, 12, 30], [0.45, 1.15]);
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, result: expected, ms: 5 });
    expect(expected.usual).toEqual(usual);
    expect(expected.frame).toEqual([320, 240]);
    expect(Object.keys(puts)).toEqual([]);
    expect(lines[0]).toMatchObject({ route: "locate", ok: true, in: { design: "320x240", logo: "40x16" }, out: {} });
    // A request with one file is answered with the old fields and the picture's own ground around the found logo.
    expect(Object.keys(json.result as object)).toEqual(["x", "y", "width", "height", "score", "usual", "frame", "ground"]);
    expect((json.result as LocateResult).ground).toEqual([10, 12, 30]);

    // The same logo kept on a picture of its own color (a part of the file has the ground's color): found by its shape, and answered as lost.
    const faint = raster(W, H);
    for (let i = 0; i < W * H; i++) faint.data.set([246, 246, 246, 255], i * 4);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const lx = Math.floor((x * lw) / sw), ly = Math.floor((y * lh) / sh);
      if (logo.data[(ly * lw + lx) * 4 + 3]) faint.data.set([255, 255, 255, 255], ((sy + y) * W + sx + x) * 4);
    }
    const kept = harness({ "design.png": await encodePng(faint), "logo.png": logoPng });
    const lost = (await kept.call("locate", { ...meta, design: `${GET}design.png`, logo: `${GET}logo.png`, placement, background: [10, 12, 30], scales: [0.45, 1.15] })).json.result as LocateResult;
    expect(lost.score).toBeGreaterThanOrEqual(0.75);
    expect(lost.ground).toEqual([246, 246, 246]);
    expect(lost.lost).toBe(true);
  });
});

describe("POST /api/picture/locate with a logo set", () => {
  const W = 320, H = 240;
  const placement: Placement = { anchor: "left", left: 0.1875, width: 0.25, top: 0.125 };
  const scales: [number, number] = [0.45, 1.35];
  const shape = mark(40, 16, [24, 28, 40]);
  const usual = canvasLogoRect(placement, 40, 16, W, H);
  const drawn = { x: usual.x + 6, y: usual.y + 4, width: Math.round(usual.width * 0.8), height: Math.round((usual.width * 0.8 * 16) / 40) };
  const LIGHT: Rgb = [255, 255, 255], DARK: Rgb = [11, 14, 26];
  const whiteOn = (ground: Rgb) => drawLogo(flat(W, H, ground), shape, drawn, [255, 255, 255]);
  const base = { ...meta, design: `${GET}design.png`, placement, scales };
  /** A store with the design and each named logo file as a PNG. */
  async function store(design: Raster, logos: Record<string, Raster>) {
    const files: Record<string, Uint8Array> = { "design.png": await encodePng(design) };
    for (const [name, r] of Object.entries(logos)) files[`${name}.png`] = await encodePng(r);
    return harness(files);
  }
  const result = (json: Record<string, unknown>) => json.result as LocateResult;

  it("answers the better of two templates, the first when equal, with each score", async () => {
    const design = whiteOn([10, 12, 30]);
    const white = inked(shape, [255, 255, 255]);
    const { call, lines, puts } = await store(design, { stored: shape, other: white, again: white });
    const templates = [{ file: "stored", logo: `${GET}stored.png`, ground: LIGHT }, { file: "other", logo: `${GET}other.png`, ground: DARK }];
    const { status, json } = await call("locate", { ...base, templates, compare: [] });

    const expected = locateTemplates(design, [{ file: "stored", raster: shape, ground: LIGHT }, { file: "other", raster: white, ground: DARK }], [], placement, scales);
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, result: expected, ms: 5 });
    const got = result(json);
    expect(got.matched).toBe("other");
    expect(got.file).toBe("other");
    expect(got.scores).toHaveLength(2);
    expect(got.score).toBe(got.scores![1]);
    expect(got.scores![1]).toBeGreaterThanOrEqual(0.75);
    expect(got.scores![1]).toBeGreaterThan(got.scores![0]);
    expect(got.usual).toEqual(usual);
    expect(got.frame).toEqual([W, H]);
    expect(got).not.toHaveProperty("stamp");
    expect(Object.keys(puts)).toEqual([]);
    // The line names each template's size, and never a link.
    expect(lines[0]).toMatchObject({ route: "locate", ok: true, in: { design: "320x240", template0: "40x16", template1: "40x16" }, out: {} });
    expect(JSON.stringify(lines)).not.toContain("http");

    // The same pixels under two names: the first template wins.
    const twice = await call("locate", { ...base, templates: [{ file: "stored", logo: `${GET}again.png`, ground: DARK }, { file: "other", logo: `${GET}other.png`, ground: DARK }], compare: [] });
    expect(result(twice.json).scores![0]).toBe(result(twice.json).scores![1]);
    expect(result(twice.json).matched).toBe("stored");
  });

  it("names the white file when the drawn logo is white on a mid-tone ground, whichever template matched", async () => {
    const stored = inked(shape, [40, 120, 235]), white = inked(shape, [255, 255, 255]);
    const { call, lines } = await store(whiteOn([150, 110, 80]), { stored, white });
    // The white file is on the canvas; the stored file covers the light ground.
    const canvasWhite = await call("locate", { ...base, templates: [{ file: "white", logo: `${GET}white.png`, ground: [42, 149, 253] }, { file: "stored", logo: `${GET}stored.png`, ground: LIGHT }], compare: [] });
    expect(result(canvasWhite.json).file).toBe("white");
    expect(result(canvasWhite.json).gaps!.white).toBeLessThan(result(canvasWhite.json).gaps!.stored!);
    // The stored file's own template matches the same drawing, and the white file is still named.
    const canvasStored = await call("locate", { ...base, templates: [{ file: "stored", logo: `${GET}stored.png`, ground: DARK }], compare: [{ file: "white", logo: `${GET}white.png` }] });
    const got = result(canvasStored.json);
    expect(got.matched).toBe("stored");
    expect(got.score).toBeGreaterThanOrEqual(0.75);
    expect(got.file).toBe("white");
    expect(got.gaps!.white).toBeLessThan(got.gaps!.stored!);
    expect(lines[1]).toMatchObject({ in: { design: "320x240", template0: "40x16", "compare.white": "40x16" } });
  });

  it("names only the matched file or a file its template lists, and still answers every distance", async () => {
    // A mid-tone file drawn in white on a dark picture: the white file is the closest in color.
    const stored = inked(shape, [40, 120, 235]), white = inked(shape, [255, 255, 255]);
    const { call } = await store(whiteOn([10, 12, 30]), { stored, white });
    const template = (names?: string[]) => [{ file: "stored", logo: `${GET}stored.png`, ground: DARK, ...(names ? { names } : {}) }];
    const compare = [{ file: "white", logo: `${GET}white.png` }];
    // No list, as a job from before 17 Nov sends it: answered as before.
    expect(result((await call("locate", { ...base, templates: template(), compare })).json).file).toBe("white");
    // The list names the white file: it may be stamped.
    expect(result((await call("locate", { ...base, templates: template(["white"]), compare })).json).file).toBe("white");
    // An empty list: the matched file is stamped, and the white file's distance is still answered.
    const held = await call("locate", { ...base, templates: template([]), compare });
    expect(held.status).toBe(200);
    expect(result(held.json).file).toBe("stored");
    expect(result(held.json).gaps!.white).toBeLessThan(result(held.json).gaps!.stored!);
    expect(held.json).toEqual({ ok: true, result: locateTemplates(whiteOn([10, 12, 30]), [{ file: "stored", raster: stored, ground: DARK, names: [] }], [{ file: "white", raster: white }], placement, scales), ms: 5 });
    // A name that is no file of a set is a body that is not well formed.
    const bad = await call("locate", { ...base, templates: template(["blue"]), compare });
    expect(bad.status).toBe(400);
    expect(String(bad.json.reason)).toContain("templates.0.names.0");
  });

  it("names no file when a whole part of each does not show on the picture's ground, and says the design's logo is lost", async () => {
    // Two green bars and a near-black one, kept by the model on a near-black band: found by its shape, with a part that would not show.
    const GREEN: Rgb = [60, 170, 90];
    const stored = box(inked(shape, GREEN), 24, 0, 40, 7, [26, 25, 25]);
    const copy = box(inked(shape, GREEN), 24, 0, 40, 7, [255, 255, 255]);
    const band: Rgb = [28, 28, 27];
    const design = drawLogo(flat(W, H, band), stored, drawn);
    const { call } = await store(design, { stored, other: copy });
    const one = await call("locate", { ...base, templates: [{ file: "stored", logo: `${GET}stored.png`, ground: [26, 26, 26], names: [] }], compare: [{ file: "other", logo: `${GET}other.png` }] });
    expect(one.status).toBe(200);
    const got = result(one.json);
    expect(got.score).toBeGreaterThanOrEqual(0.75);
    expect(got.matched).toBe("stored");
    expect(got.file).toBeNull();
    expect(got.lost).toBe(true);
    expect(got.ground).toEqual(band);
    expect(got).not.toHaveProperty("stamp");
    // The copy with the white part serves that ground and is listed: it is the file to stamp, and nothing is lost.
    const two = result((await call("locate", { ...base, templates: [{ file: "stored", logo: `${GET}stored.png`, ground: [26, 26, 26], names: ["other"] }], compare: [{ file: "other", logo: `${GET}other.png` }] })).json);
    expect(two.file).toBe("other");
    expect(two).not.toHaveProperty("lost");
    // On a light picture every part of the stored file shows: named as before, with the ground answered.
    const light = await store(drawLogo(flat(W, H, [232, 232, 232]), stored, drawn), { stored });
    const seen = result((await light.call("locate", { ...base, templates: [{ file: "stored", logo: `${GET}stored.png`, ground: [232, 232, 232], names: [] }], compare: [] })).json);
    expect(seen.file).toBe("stored");
    expect(seen.ground).toEqual([232, 232, 232]);
    expect(seen).not.toHaveProperty("lost");
  });

  it("names a person's file when its template matched and compares nothing", async () => {
    const { call } = await store(whiteOn([10, 12, 30]), { stored: shape, other: inked(shape, [255, 255, 255]), white: inked(shape, [250, 250, 250]) });
    const templates = [{ file: "stored", logo: `${GET}stored.png`, ground: LIGHT }, { file: "other", logo: `${GET}other.png`, ground: DARK, fixed: true }];
    const { status, json } = await call("locate", { ...base, templates, compare: [{ file: "white", logo: `${GET}white.png` }] });
    expect(status).toBe(200);
    expect(result(json).matched).toBe("other");
    expect(result(json).file).toBe("other");
    expect(result(json).gaps).toEqual({});
  });

  it("takes one template", async () => {
    const design = whiteOn([10, 12, 30]);
    const white = inked(shape, [255, 255, 255]);
    const { call } = await store(design, { other: white });
    const { status, json } = await call("locate", { ...base, templates: [{ file: "other", logo: `${GET}other.png`, ground: DARK }], compare: [] });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, result: locateTemplates(design, [{ file: "other", raster: white, ground: DARK }], [], placement, scales), ms: 5 });
    expect(result(json).scores).toHaveLength(1);
    expect(result(json).file).toBe("other");
  });

  it("answers the rectangle to stamp when the named file has another shape", async () => {
    // The stored mid-tone file matches a logo drawn in white; the closest file in color is a white file of slightly other proportions.
    const stored = inked(shape, [40, 120, 235]), tall = mark(80, 34, [255, 255, 255]);
    const { call } = await store(whiteOn([10, 12, 30]), { stored, tall });
    const { json } = await call("locate", { ...base, templates: [{ file: "stored", logo: `${GET}stored.png`, ground: DARK }], compare: [{ file: "other", logo: `${GET}tall.png` }] });
    const got = result(json);
    expect(got.matched).toBe("stored");
    expect(got.file).toBe("other");
    const height = Math.round((got.width * 34) / 80);
    expect(got.stamp).toEqual({ x: got.x, y: Math.round(got.y + got.height / 2 - height / 2), width: got.width, height });
    expect(got.stamp!.height).not.toBe(got.height);
  });

  it("takes the same file in two templates when their grounds differ", async () => {
    const stored = inked(shape, [40, 120, 235]);
    const { call } = await store(whiteOn([10, 12, 30]), { stored });
    const { status, json } = await call("locate", { ...base, templates: [{ file: "stored", logo: `${GET}stored.png`, ground: DARK }, { file: "stored", logo: `${GET}stored.png`, ground: LIGHT }], compare: [] });
    expect(status).toBe(200);
    expect(result(json).matched).toBe("stored");
    expect(result(json).scores![0]).toBeGreaterThan(result(json).scores![1]);
    expect(Object.keys(result(json).gaps!)).toEqual(["stored"]);
  });

  it("refuses a locate body with both a logo and templates, a compare file that is also a template, and two templates of one file on one ground", async () => {
    const { call, fetched } = await store(whiteOn([10, 12, 30]), { stored: shape });
    const t = (file: string, ground: Rgb = DARK) => ({ file, logo: `${GET}stored.png`, ground });
    const refused = async (body: Record<string, unknown>) => {
      const { status, json } = await call("locate", { ...base, ...body });
      expect(status).toBe(400);
      return String(json.reason).replace("The request is not well formed: ", "");
    };
    expect(await refused({ logo: `${GET}stored.png`, background: DARK, templates: [t("stored")], compare: [] })).toBe("templates");
    expect(await refused({})).toBe("logo");
    expect(await refused({ logo: `${GET}stored.png` })).toBe("background");
    expect(await refused({ templates: [t("stored")] })).toBe("compare");
    expect(await refused({ templates: [t("stored")], compare: [{ file: "stored", logo: `${GET}stored.png` }] })).toBe("compare.0.file");
    expect(await refused({ templates: [t("stored")], compare: [{ file: "white", logo: `${GET}stored.png` }, { file: "white", logo: `${GET}stored.png` }] })).toBe("compare.1.file");
    expect(await refused({ templates: [t("stored"), t("stored")], compare: [] })).toBe("templates.1.file");
    expect(await refused({ templates: [], compare: [] })).toBe("templates");
    expect(await refused({ templates: [t("stored"), t("other"), t("white")], compare: [] })).toBe("templates");
    expect(await refused({ templates: [t("logo")], compare: [] })).toBe("templates.0.file");
    expect(await refused({ templates: [{ ...t("stored"), logo: "https://evil.example/a.png" }], compare: [] })).toBe("templates.0.logo");
    expect(await refused({ templates: [{ ...t("stored"), extra: 1 }], compare: [] })).toBe("templates.0");
    expect(fetched).toEqual([]);
  });
});

describe("POST /api/picture/logo-set", () => {
  const set = { job: "client-1", step: "design_settings" };
  const out = { other: `${PUT}other.png`, white: `${PUT}white.png` };
  /** A dark one-color logo with one soft column at its right edge. */
  const dark = () => box(mark(120, 48, [24, 28, 40]), 119, 0, 120, 21, [24, 28, 40], 90);
  const result = (json: Record<string, unknown>) => json.result as LogoSetResult;

  it("writes the copies and says which it dropped", async () => {
    const stored = dark();
    const { call, puts, lines } = harness({ "logo.png": await encodePng(stored) });
    const { status, json } = await call("logo-set", { ...set, logo: `${GET}logo.png`, out });
    expect(status).toBe(200);
    expect(result(json)).toEqual({
      size: { width: 120, height: 48 }, own: "light", both: false,
      made: { other: { turned: 1 }, white: null }, site: null, person: null,
      inks: { stored: wholeExposedInks(partsOf(stored)), other: wholeExposedInks(partsOf(stored)).map((ink) => ({ ...ink, color: [255, 255, 255] })), white: null },
    });
    // The copy for the dark ground: every ink pixel white, every alpha as stored. The white copy is the same file, so it is not written.
    expect(Object.keys(puts)).toEqual(["other.png"]);
    expect(puts["other.png"].contentType).toBe("image/png");
    const copy = await decoded(puts["other.png"]);
    expect([copy.width, copy.height]).toEqual([120, 48]);
    let ink = 0;
    for (let i = 0; i < stored.data.length; i += 4) {
      expect(copy.data[i + 3]).toBe(stored.data[i + 3]);
      if (stored.data[i + 3] < 16) continue;
      ink++;
      expect([copy.data[i], copy.data[i + 1], copy.data[i + 2]]).toEqual([255, 255, 255]);
    }
    expect(ink).toBeGreaterThan(1000);
    expect(lines[0]).toMatchObject({ route: "logo-set", job: "client-1", step: "design_settings", ok: true, in: { logo: "120x48" }, out: { other: `120x48, ${puts["other.png"].bytes.length} B` } });

    // The same request again writes the same bytes.
    const first = Buffer.from(puts["other.png"].bytes);
    await call("logo-set", { ...set, logo: `${GET}logo.png`, out });
    expect(puts["other.png"].bytes.equals(first)).toBe(true);
  });

  it("writes both copies for a logo of a color that shows on dark and a black letter", async () => {
    const stored = box(box(blank(60, 20), 2, 2, 30, 18, [40, 170, 120]), 34, 2, 58, 18, [0, 0, 0]);
    const { call, puts } = harness({ "logo.png": await encodePng(stored) });
    const { json } = await call("logo-set", { ...set, logo: `${GET}logo.png`, out });
    expect(result(json).made.other!.turned).toBeCloseTo(384 / 832, 10);
    expect(result(json).made.white).toEqual({ turned: 1 });
    expect(result(json).inks.other).toEqual([{ color: [40, 170, 120], share: 448 / 832 }, { color: [255, 255, 255], share: 384 / 832 }]);
    expect(result(json).inks.white!.map((ink) => ink.color)).toEqual([[255, 255, 255], [255, 255, 255]]);
    expect(Object.keys(puts).sort()).toEqual(["other.png", "white.png"]);
  });

  it("names the website file that passed", async () => {
    const stored = dark();
    const white = inked(mark(240, 96, [255, 255, 255]), [255, 255, 255]);
    const files = {
      "logo.png": await encodePng(stored),
      // Another logo that fills the same box, the same logo in white and larger, and the same logo in white but narrower than the stored file.
      "another.png": await encodePng(box(box(blank(120, 48), 0, 0, 120, 12, [255, 255, 255]), 50, 12, 70, 48, [255, 255, 255])),
      "white.png": await encodePng(white),
      "narrow.png": await encodePng(mark(80, 32, [255, 255, 255])),
    };
    const { call, lines } = harness(files);
    const { status, json } = await call("logo-set", { ...set, logo: `${GET}logo.png`, site: [`${GET}another.png`, `${GET}white.png`, `${GET}narrow.png`], out });
    expect(status).toBe(200);
    expect(result(json).site).toMatchObject({ index: 1, size: { width: 240, height: 96 } });
    expect(result(json).site!.overlap).toBeGreaterThanOrEqual(0.9);
    // The second file's inks are the website file's own, and the made copy is still made and recorded.
    expect(result(json).inks.other).toEqual(wholeExposedInks(partsOf(white)));
    expect(result(json).made.other).toEqual({ turned: 1 });
    expect(lines[0]).toMatchObject({ in: { logo: "120x48", site0: "120x48", site1: "240x96", site2: "80x32" } });
  });

  it("leaves out a website file it cannot read, and still answers", async () => {
    const { call } = harness({ "logo.png": await encodePng(dark()), "notes.txt": new TextEncoder().encode("just some words"), "white.png": await encodePng(mark(120, 48, [255, 255, 255])) });
    const { status, json } = await call("logo-set", { ...set, logo: `${GET}logo.png`, site: [`${GET}missing.png`, `${GET}notes.txt`, `${GET}white.png`], out });
    expect(status).toBe(200);
    expect(result(json).site).toMatchObject({ index: 2 });
    // Storage that cannot answer right now is still a 503: the caller's retry covers it.
    expect((await call("logo-set", { ...set, logo: `${GET}logo.png`, site: [`${GET}down`], out })).status).toBe(503);
  });

  it("answers a person's file with its size and its inks, before a website file", async () => {
    const person = mark(200, 90, [250, 250, 250]);
    const { call } = harness({ "logo.png": await encodePng(dark()), "person.png": await encodePng(person), "white.png": await encodePng(mark(120, 48, [255, 255, 255])) });
    const { json } = await call("logo-set", { ...set, logo: `${GET}logo.png`, site: [`${GET}white.png`], person: `${GET}person.png`, out });
    expect(result(json).person).toEqual({ size: { width: 200, height: 90 } });
    expect(result(json).site).toMatchObject({ index: 0 });
    expect(result(json).inks.other).toEqual(wholeExposedInks(partsOf(person)));
  });

  it("makes the set without a person's file it cannot read", async () => {
    const { call } = harness({ "logo.png": await encodePng(dark()), "notes.txt": new TextEncoder().encode("just some words") });
    for (const person of [`${GET}missing.png`, `${GET}notes.txt`]) {
      const { status, json } = await call("logo-set", { ...set, logo: `${GET}logo.png`, person, out });
      expect(status).toBe(200);
      expect(result(json)).toMatchObject({ own: "light", person: null, made: { other: { turned: 1 } } });
    }
    // Storage that cannot answer right now is still a 503: the caller's retry covers it.
    expect((await call("logo-set", { ...set, logo: `${GET}logo.png`, person: `${GET}down`, out })).status).toBe(503);
  });

  it("answers with a reason when the logo has no ink", async () => {
    const { call, puts } = harness({ "logo.png": await encodePng(blank(40, 16)) });
    expect(await call("logo-set", { ...set, logo: `${GET}logo.png`, out })).toEqual({ status: 200, json: { ok: false, reason: "The logo file has no ink." } });
    expect(Object.keys(puts)).toEqual([]);
  });

  it("refuses a body with more than six website files or no place for a copy", async () => {
    const { call, fetched } = harness({});
    const seven = Array.from({ length: 7 }, (_, i) => `${GET}s${i}.png`);
    expect(await call("logo-set", { ...set, logo: `${GET}logo.png`, site: seven, out })).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: site" } });
    expect(await call("logo-set", { ...set, logo: `${GET}logo.png`, out: { other: `${PUT}o.png` } })).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: out.white" } });
    expect(fetched).toEqual([]);
  });
});

describe("POST /api/picture/post-logos", () => {
  const set = { job: "client-1", step: "design_settings" };
  const W = 320, H = 240;
  const placement: Placement = { anchor: "left", left: 0.1875, width: 0.25, top: 0.125 };
  const scales: [number, number] = [0.45, 1.35];
  const shape = mark(40, 16, [24, 28, 40]);
  const usual = canvasLogoRect(placement, 40, 16, W, H);
  const drawn = { x: usual.x + 6, y: usual.y + 4, width: Math.round(usual.width * 0.8), height: Math.round((usual.width * 0.8 * 16) / 40) };
  const searches = [{ file: "stored", logo: `${GET}stored.png`, ground: [255, 255, 255] }, { file: "other", logo: `${GET}other.png`, ground: [11, 14, 26] }];

  it("answers each post, and null for one it cannot read", async () => {
    const files = {
      "stored.png": await encodePng(shape),
      "other.png": await encodePng(inked(shape, [255, 255, 255])),
      "white-on-dark.png": await encodePng(drawLogo(flat(W, H, [16, 40, 76]), shape, drawn, [255, 255, 255])),
      "no-logo.png": await encodePng(pagePicture(W, H, 7)),
    };
    const { call, lines, puts } = harness(files);
    const { status, json } = await call("post-logos", { ...set, posts: [`${GET}white-on-dark.png`, `${GET}missing.jpg`, `${GET}no-logo.png`], placement, scales, searches, compare: [] });
    expect(status).toBe(200);
    const posts = (json.result as { posts: Array<PostLogo | null> }).posts;
    expect(posts).toHaveLength(3);
    const found = posts[0] as Extract<PostLogo, { found: true }>;
    expect(found).toMatchObject({ found: true, matched: "other", shows: "other", ground: [16, 40, 76] });
    // The found rectangle is within two pixels of the drawn one, so a few of the logo's own edge pixels are among those sampled around it.
    expect(found.flat).toBeGreaterThan(0.95);
    expect(found.score).toBeGreaterThanOrEqual(0.75);
    expect(found.gaps.other).toBeLessThan(found.gaps.stored!);
    expect(Math.abs(found.rect.x - drawn.x)).toBeLessThanOrEqual(2);
    expect(posts[1]).toBeNull();
    expect(posts[2]).toEqual({ found: false, score: expect.any(Number) });
    expect((posts[2] as { score: number }).score).toBeLessThan(0.75);
    expect(Object.keys(puts)).toEqual([]);
    expect(lines[0]).toMatchObject({ route: "post-logos", job: "client-1", ok: true, in: { search0: "40x16", search1: "40x16", post0: "320x240", post2: "320x240" } });
    expect(lines[0].in).not.toHaveProperty("post1");
  }, BIG);

  it("says a post shows a person's file when its search matched, and measures nothing", async () => {
    const files = { "stored.png": await encodePng(shape), "other.png": await encodePng(inked(shape, [255, 255, 255])), "post.png": await encodePng(drawLogo(flat(W, H, [16, 40, 76]), shape, drawn, [255, 255, 255])) };
    const { call } = harness(files);
    const { json } = await call("post-logos", { ...set, posts: [`${GET}post.png`], placement, scales, searches: [searches[0], { ...searches[1], fixed: true }], compare: [] });
    expect((json.result as { posts: PostLogo[] }).posts[0]).toMatchObject({ found: true, matched: "other", shows: "other", gaps: {} });
  }, BIG);

  it("refuses more than four posts", async () => {
    const { call, fetched } = harness({});
    const five = Array.from({ length: 5 }, (_, i) => `${GET}p${i}.jpg`);
    expect(await call("post-logos", { ...set, posts: five, placement, scales, searches, compare: [] })).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: posts" } });
    expect(await call("post-logos", { ...set, posts: [], placement, scales, searches, compare: [] })).toMatchObject({ status: 400 });
    expect(await call("post-logos", { ...set, posts: [five[0]], placement, scales, searches: [searches[0], searches[0]], compare: [] })).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: searches.1.file" } });
    expect(await call("post-logos", { ...set, posts: [five[0]], placement, scales, searches, compare: [{ file: "other", logo: `${GET}other.png` }] })).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: compare.0.file" } });
    expect(fetched).toEqual([]);
  });
});

describe("POST /api/picture/transcode", () => {
  it("writes a JPEG at the asked quality and answers its size", async () => {
    const picturePng = await encodePng(pagePicture(48, 32, 5));
    const { puts, call } = harness({ "picture.png": picturePng });
    const { status, json } = await call("transcode", { ...meta, picture: `${GET}picture.png`, quality: 70, out: `${PUT}frame.jpg` });

    const expectedBytes = Buffer.from(await encodeJpeg(await decodeRaster(picturePng), 70));
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, result: { size: { width: 48, height: 32 }, bytes: expectedBytes.length }, ms: 5 });
    expect(puts["frame.jpg"].contentType).toBe("image/jpeg");
    expect(puts["frame.jpg"].bytes.equals(expectedBytes)).toBe(true);
  });
});

describe("POST /api/picture/title-read", () => {
  it("answers the lettering's box and writes the read-back", async () => {
    const layer = raster(40, 30);
    for (let y = 8; y < 20; y++) for (let x = 5; x < 33; x++) layer.data.set([255, 255, 255, (x * 9) % 256], (y * 40 + x) * 4);
    const layerPng = await encodePng(layer);
    const { puts, call } = harness({ "layer.png": layerPng });
    const { status, json } = await call("title-read", { ...meta, layer: `${GET}layer.png`, out: `${PUT}read.jpg` });

    const expected = titleRead(await decodeRaster(layerPng));
    expect(expected.box).not.toBeNull();
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, result: { layer: { width: 40, height: 30 }, box: expected.box, read: { width: 20, height: 15 } }, ms: 5 });
    expect(puts["read.jpg"].contentType).toBe("image/jpeg");
    expect(puts["read.jpg"].bytes.equals(Buffer.from(await encodeJpeg(expected.read!, READ_JPEG_QUALITY)))).toBe(true);
  });

  it("answers a null box and writes nothing for an empty layer", async () => {
    const { puts, call } = harness({ "layer.png": await encodePng(raster(40, 30)) });
    const { status, json } = await call("title-read", { ...meta, layer: `${GET}layer.png`, out: `${PUT}read.jpg` });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, result: { layer: { width: 40, height: 30 }, box: null, read: null }, ms: 5 });
    expect(Object.keys(puts)).toEqual([]);
  });
});

describe("what the service answers when it cannot work", () => {
  const transcode = (picture: string, out = `${PUT}frame.jpg`) => ({ ...meta, picture, quality: 80, out });

  it("answers with a reason when the picture is missing from storage", async () => {
    const { call } = harness({});
    expect(await call("transcode", transcode(`${GET}missing.png`))).toEqual({ status: 200, json: { ok: false, reason: "A picture could not be read from storage." } });
  });

  it("answers with a reason when the bytes are not a picture", async () => {
    const { call } = harness({ "notes.txt": new TextEncoder().encode("just some words") });
    expect(await call("transcode", transcode(`${GET}notes.txt`))).toEqual({ status: 200, json: { ok: false, reason: "The file is not a picture that can be read." } });
  });

  it("answers with a reason when the picture is larger than 64 MB", async () => {
    const { call } = harness({});
    expect(await call("transcode", transcode(`${GET}huge`))).toEqual({ status: 200, json: { ok: false, reason: "A picture is larger than 64 MB." } });
  });

  it("answers 503 with a reason when storage cannot serve a picture right now, so the worker's retry covers it", async () => {
    const { call } = harness({});
    expect(await call("transcode", transcode(`${GET}down`))).toEqual({ status: 503, json: { ok: false, reason: "A picture could not be read from storage." } });
    expect(await call("transcode", transcode(`${GET}offline`))).toEqual({ status: 503, json: { ok: false, reason: "A picture could not be read from storage." } });
  });

  it("answers 503 with a reason when storage cannot take the upload right now", async () => {
    const { call } = harness({ "picture.png": await encodePng(pagePicture(8, 8, 1)) });
    expect(await call("transcode", transcode(`${GET}picture.png`, `${PUT}busy`))).toEqual({ status: 503, json: { ok: false, reason: "A picture could not be stored." } });
  });

  it("answers with a reason when storage refuses the upload", async () => {
    const { call } = harness({ "picture.png": await encodePng(pagePicture(8, 8, 1)) });
    expect(await call("transcode", transcode(`${GET}picture.png`, `${PUT}refused`))).toEqual({ status: 200, json: { ok: false, reason: "A picture could not be stored." } });
  });

  it("rejects a body that is not well formed, naming the field", async () => {
    const { call, puts } = harness({ "picture.png": await encodePng(pagePicture(8, 8, 1)) });
    expect(await call("transcode", transcode("http://store.test/get/picture.png"))).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: picture" } });
    expect(await call("transcode", { ...transcode(`${GET}picture.png`), quality: 101 })).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: quality" } });
    expect(await call("transcode", { ...transcode(`${GET}picture.png`), extra: 1 })).toMatchObject({ status: 400 });
    expect(await call("transcode", "this is not json")).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: body" } });
    const read = { ...meta, picture: `${GET}picture.png`, page: { width: 4, height: 4 }, band: { x: -1, y: 0, width: 2, height: 2 }, out: { page: `${PUT}page.jpg` } };
    expect(await call("read", read)).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: out.band" } });
    expect(await call("read", { ...read, band: undefined, area: { x: 0, y: 0, width: 2, height: 2 } })).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: out.area" } });
    expect(await call("finish", { ...meta, picture: `${GET}picture.png`, logo: `${GET}picture.png`, rect: { x: 0, y: 0, width: -3, height: 2 }, frame: [8, 8], output: { width: 4, height: 4 }, out: `${PUT}f.png` })).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: rect.width" } });
    expect(Object.keys(puts)).toEqual([]);
  });

  it("refuses a link that is not in the product's storage, naming the field, before anything is fetched", async () => {
    const { call, fetched, puts } = harness({ "picture.png": await encodePng(pagePicture(8, 8, 1)) });
    const elsewhere = [
      "https://evil.example/a.png",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/x",
      "https://store.test.evil.example/get/picture.png",
      "https://store.test@evil.example/get/picture.png",
      "https://user:word@store.test/get/picture.png",
      "https://store.test:8443/get/picture.png",
      "http://store.test/get/picture.png",
      "//store.test/get/picture.png",
      "not a link",
    ];
    for (const link of elsewhere) {
      expect(await call("transcode", transcode(link)), link).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: picture" } });
      expect(await call("transcode", transcode(`${GET}picture.png`, link)), link).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: out" } });
    }
    expect(await call("read", { ...meta, picture: `${GET}picture.png`, page: { width: 4, height: 4 }, out: { page: "https://evil.example/page.jpg" } })).toEqual({ status: 400, json: { ok: false, reason: "The request is not well formed: out.page" } });
    expect(fetched).toEqual([]);
    expect(Object.keys(puts)).toEqual([]);
  });

  it("holds a link to the storage folder it was given: a path that climbs out of it is refused", async () => {
    const lines: Record<string, unknown>[] = [];
    const fetched: string[] = [];
    const fake = (async (input: string | URL | Request) => {
      fetched.push(String(input));
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const app = createApp({ claimCall: async () => true, fetchImpl: fake, log: (line) => lines.push(line), storage: "https://store.test/storage/v1/" });
    const ask = async (picture: string) => {
      const res = await app.request("/api/picture/transcode", { method: "POST", headers: { [PICTURE_CALL_HEADER]: CALL }, body: JSON.stringify(transcode(picture, "https://store.test/storage/v1/object/upload/sign/b/out.jpg?token=t")) });
      return res.status;
    };
    expect(await ask("https://store.test/storage/v1/../../functions/v1/x")).toBe(400);
    expect(await ask("https://store.test/storage/v1/%2e%2e/%2e%2e/functions/v1/x")).toBe(400);
    expect(await ask("https://store.test/functions/v1/x")).toBe(400);
    expect(await ask("https://store.test/storage/v10/x")).toBe(400);
    expect(fetched).toEqual([]);
    expect(await ask("https://store.test/storage/v1/object/sign/b/in.png?token=t")).toBe(200);
    expect(fetched).toEqual(["https://store.test/storage/v1/object/sign/b/in.png?token=t"]);
  });

  it("reads and writes only in the product's own storage when it is given no other address", async () => {
    const fetched: string[] = [];
    const fake = (async (input: string | URL | Request) => {
      fetched.push(String(input));
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const app = createApp({ claimCall: async () => true, fetchImpl: fake, log: () => {} });
    const product = `${PUBLIC_DEFAULTS.VITE_SUPABASE_URL}/storage/v1/`;
    const ask = async (picture: string, out: string) => (await app.request("/api/picture/transcode", { method: "POST", headers: { [PICTURE_CALL_HEADER]: CALL }, body: JSON.stringify(transcode(picture, out)) })).status;
    expect(await ask(`${GET}picture.png`, `${product}object/upload/sign/generated-media/a.jpg?token=t`)).toBe(400);
    expect(await ask(`${product}object/sign/generated-media/a.png?token=t`, `${PUT}a.jpg`)).toBe(400);
    expect(await ask(`${PUBLIC_DEFAULTS.VITE_SUPABASE_URL}/functions/v1/design-worker`, `${product}object/upload/sign/generated-media/a.jpg?token=t`)).toBe(400);
    expect(fetched).toEqual([]);
    expect(await ask(`${product}object/sign/generated-media/a.png?token=t`, `${product}object/upload/sign/generated-media/a.jpg?token=t`)).toBe(200);
    expect(fetched).toEqual([`${product}object/sign/generated-media/a.png?token=t`]);
  });

  it("answers 503 when storage does not answer within the call's time limit, so the worker hears a reason before its own limit", async () => {
    const { call, lines } = harness({ "picture.png": await encodePng(pagePicture(8, 8, 1)) }, { storageTimeoutMs: 30 });
    expect(await call("transcode", transcode(`${GET}stalled`))).toEqual({ status: 503, json: { ok: false, reason: "A picture could not be read from storage." } });
    expect(await call("transcode", transcode(`${GET}picture.png`, `${PUT}stalled`))).toEqual({ status: 503, json: { ok: false, reason: "A picture could not be stored." } });
    expect(lines).toHaveLength(2);
  });

  it("answers 500 for a failure it cannot name, and logs its message", async () => {
    const { call, lines } = harness({ "logo.png": await encodePng(wideLogo(70, 24)) });
    const body = { ...meta, logo: `${GET}logo.png`, page: { width: 0, height: 0 }, placement: { anchor: "center", width: 0.3, top: 0.1 }, background: [0, 0, 0], out: { canvas: `${PUT}c.png`, mask: `${PUT}m.png` } };
    expect(await call("canvas", body)).toEqual({ status: 500, json: { ok: false, reason: "The picture service could not finish this call." } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ route: "canvas", ok: false, reason: "The picture service could not finish this call." });
    expect(typeof lines[0].error).toBe("string");
  });

  it("logs one line per call, with the reason when there is one, and never the call's id or a link", async () => {
    const { call, lines } = harness({ "picture.png": await encodePng(pagePicture(8, 8, 1)) });
    await call("transcode", transcode(`${GET}picture.png`));
    await call("transcode", transcode(`${GET}missing.png`));
    await call("transcode", transcode("http://nope"));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ at: new Date(1_700_000_000_010).toISOString(), route: "transcode", job: "job-1", step: "design", ms: 5, ok: true, in: { picture: "8x8" }, out: { out: expect.stringMatching(/^8x8, \d+ B$/) } });
    expect(lines[0]).not.toHaveProperty("reason");
    expect(lines[1]).toMatchObject({ route: "transcode", job: "job-1", ok: false, reason: "A picture could not be read from storage." });
    expect(lines[2]).toMatchObject({ route: "transcode", ok: false, reason: "The request is not well formed: picture" });
    const text = JSON.stringify(lines);
    expect(text).not.toContain(CALL);
    expect(text).not.toContain("store.test");
    expect(text).not.toContain("http");
  });
});

describe("POST /api/picture/slot", () => {
  const W = 320, H = 240;
  const placement: Placement = { anchor: "left", left: 0.1875, width: 0.25, top: 0.125 };
  const scales: [number, number] = [0.45, 1.35];
  const shape = mark(40, 16, [24, 28, 40]);
  const usual = canvasLogoRect(placement, 40, 16, W, H);
  const drawn = { x: usual.x + 6, y: usual.y + 4, width: Math.round(usual.width * 0.8), height: Math.round((usual.width * 0.8 * 16) / 40) };
  const LIGHT: Rgb = [255, 255, 255], DARK: Rgb = [11, 14, 26];
  const base = { ...meta, design: `${GET}design.png`, placement, scales };
  async function store(design: Raster, logos: Record<string, Raster>) {
    const files: Record<string, Uint8Array> = { "design.png": await encodePng(design) };
    for (const [name, r] of Object.entries(logos)) files[`${name}.png`] = await encodePng(r);
    return harness(files);
  }
  const result = (json: Record<string, unknown>) => json.result as SlotResult;

  it("answers the found rectangle as the slot for a logo drawn in the file's tone or in the other one, with one template", async () => {
    const template = [{ file: "stored", logo: `${GET}stored.png`, ground: LIGHT }];
    const same = drawLogo(flat(W, H, [236, 240, 244]), shape, drawn);
    const a = await store(same, { stored: shape });
    const first = await a.call("slot", { ...base, templates: template });
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ ok: true, result: findSlot(same, [{ file: "stored", raster: shape, ground: LIGHT }], placement, scales), ms: 5 });
    const got = result(first.json);
    expect(got.from).toBe("drawn");
    // A found drawing is another rectangle than the canvas carried, and the worker computes that canvas rectangle itself for a carousel's slide.
    expect(got.slot).not.toEqual(got.canvas);
    expect(carouselSlot({ input: { placement, logo_size: [shape.width, shape.height] } }, { logo_frame: got.frame })).toEqual(got.canvas);
    expect(got.of).toBe("stored");
    expect(got.slot).toEqual(got.drawn);
    expect(got.canvas).toEqual(usual);
    expect(got.frame).toEqual([W, H]);
    expect(got.index).toBe(0);
    expect(got.score).toBeGreaterThanOrEqual(0.75);
    expect(Object.keys(a.puts)).toEqual([]);
    expect(a.lines[0]).toMatchObject({ route: "slot", ok: true, in: { design: "320x240", template0: "40x16" }, out: {} });
    expect(JSON.stringify(a.lines)).not.toContain("http");

    // The same logo in white on a deep color, against the same dark file over a light ground.
    const b = await store(drawLogo(flat(W, H, [98, 2, 73]), shape, drawn, [255, 255, 255]), { stored: shape });
    const other = result((await b.call("slot", { ...base, templates: template })).json);
    expect(other.from).toBe("drawn");
    expect(other.slot).toEqual(got.slot);
    expect(Math.abs(other.score - got.score)).toBeLessThan(0.01);
  });

  it("answers the rectangle the canvas carried when what was drawn is no close match, and when nothing was drawn", async () => {
    // Bars where the logo was, and a stray shape lower down: neither is the logo.
    const design = flat(W, H, [98, 2, 73]);
    for (let i = 0; i < 6; i++) box(design, drawn.x + i * 11, drawn.y, drawn.x + i * 11 + 4, drawn.y + drawn.height, [255, 255, 255]);
    box(design, 40, 150, 200, 170, [255, 255, 255]);
    const { call } = await store(design, { stored: shape, other: inked(shape, [255, 255, 255]) });
    const templates = [{ file: "stored", logo: `${GET}stored.png`, ground: LIGHT }, { file: "other", logo: `${GET}other.png`, ground: DARK }];
    const got = result((await call("slot", { ...base, templates })).json);
    expect(got.from).toBe("canvas");
    expect(got.slot).toEqual(usual);
    // The slot has the canvas file's shape, whichever template scored best.
    expect(got.of).toBe("stored");
    expect(got.score).toBeLessThan(0.75);
    expect(got.scores).toHaveLength(2);

    const empty = await store(flat(W, H, [98, 2, 73]), { stored: shape });
    const none = result((await empty.call("slot", { ...base, templates: [templates[0]] })).json);
    expect(none.from).toBe("canvas");
    expect(none.slot).toEqual(usual);
    // The rectangle the worker computes for a carousel's slide (carouselLogo.ts, carouselSlot) from the job's own placement, the
    // canvas file's size and the frame the slot was found in is this route's canvas rectangle, pixel for pixel, on every answer.
    for (const answer of [got, none]) expect(carouselSlot({ input: { placement, logo_size: [shape.width, shape.height] } }, { logo_frame: answer.frame })).toEqual(answer.canvas);
  });

  it("refuses a body with no template, three templates, or a field it does not know", async () => {
    const { call } = await store(flat(W, H, [0, 0, 0]), { stored: shape });
    const t = { file: "stored", logo: `${GET}stored.png`, ground: LIGHT };
    expect((await call("slot", { ...base, templates: [] })).status).toBe(400);
    expect((await call("slot", { ...base, templates: [t, { ...t, ground: DARK }, { ...t, file: "white" }] })).status).toBe(400);
    expect((await call("slot", { ...base, templates: [t], compare: [] })).status).toBe(400);
    expect((await call("slot", { ...base, templates: [t, t] })).json.reason).toBe("The request is not well formed: templates.1.file");
  });
});

describe("POST /api/picture/slot-file", () => {
  const W = 320, H = 240;
  const shape = mark(40, 16, [0, 0, 0]);
  const white = inked(shape, [255, 255, 255]);
  const rect = { x: 66, y: 34, width: 64, height: 26 };
  const base = { ...meta, picture: `${GET}picture.png`, rect, frame: [W, H] as [number, number], of: "stored" };
  const files = [{ file: "stored", logo: `${GET}stored.png` }, { file: "other", logo: `${GET}other.png` }];
  async function store(picture: Raster, logos: Record<string, Raster> = { stored: shape, other: white }) {
    const all: Record<string, Uint8Array> = { "picture.png": await encodePng(picture) };
    for (const [name, r] of Object.entries(logos)) all[`${name}.png`] = await encodePng(r);
    return harness(all);
  }
  const result = (json: Record<string, unknown>) => json.result as SlotFileResult;

  it("reads the ground under the slot and names the first file that shows whole on it", async () => {
    const plum = await store(flat(W, H, [98, 2, 73]));
    const { status, json } = await plum.call("slot-file", { ...base, files });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, result: slotFile(flat(W, H, [98, 2, 73]), rect, [W, H], "stored", [{ file: "stored", raster: shape }, { file: "other", raster: white }]), ms: 5 });
    const got = result(json);
    expect(got.ground).toEqual([98, 2, 73]);
    expect(got.flat).toBe(1);
    expect(got.file).toBe("other");
    expect(got.rect).toEqual(rect);
    expect(got.shows.stored).toBeCloseTo(1.62, 1);
    expect(got.shows.other).toBeGreaterThan(12);
    expect(got).not.toHaveProperty("drawn");
    expect(Object.keys(plum.puts)).toEqual([]);
    expect(plum.lines[0]).toMatchObject({ route: "slot-file", ok: true, in: { picture: "320x240", "file.stored": "40x16", "file.other": "40x16" }, out: {} });

    // A light ground: the stored file.
    const lavender = await store(flat(W, H, [215, 197, 247]));
    expect(result((await lavender.call("slot-file", { ...base, files })).json).file).toBe("stored");
    // A copy the client's posts never show waits behind a stored file that is only weak.
    const weak = await store(flat(W, H, [98, 2, 73]));
    expect(result((await weak.call("slot-file", { ...base, files: [files[0], { ...files[1], last: true }] })).json).file).toBe("stored");
  });

  it("names no file when none shows, and the slot scaled to the picture's own size", async () => {
    // The picture is twice the frame the slot was found in; only the slot's own area is near white.
    const picture = flat(W * 2, H * 2, [10, 10, 10]);
    box(picture, rect.x * 2, rect.y * 2, (rect.x + rect.width) * 2, (rect.y + rect.height) * 2, [250, 250, 250]);
    const { call } = await store(picture, { white });
    const got = result((await call("slot-file", { ...base, of: "white", files: [{ file: "white", logo: `${GET}white.png` }] })).json);
    expect(got.ground).toEqual([250, 250, 250]);
    expect(got.file).toBeNull();
    expect(got.shows.white).toBeLessThan(1.5);
  });

  it("says whether the drawing that was found is still there after cleaning", async () => {
    const left = drawLogo(flat(W, H, [98, 2, 73]), shape, rect, [255, 255, 255]);
    const drawn = { file: "stored", ground: [255, 255, 255] };
    const still = result((await (await store(left)).call("slot-file", { ...base, files, drawn })).json);
    expect(still.drawn?.found).toBe(true);
    expect(still.drawn?.score).toBeGreaterThanOrEqual(0.75);
    const clean = result((await (await store(flat(W, H, [98, 2, 73]))).call("slot-file", { ...base, files, drawn })).json);
    expect(clean.drawn).toEqual({ score: clean.drawn!.score, found: false });
    expect(clean.drawn!.score).toBeLessThan(0.75);
    expect(clean.file).toBe("other");
  });

  it("fits a file of another shape to the slot's width and center", async () => {
    const taller = mark(80, 34, [255, 255, 255]);
    const { call } = await store(flat(W, H, [20, 20, 20]), { stored: shape, other: taller });
    const got = result((await call("slot-file", { ...base, files })).json);
    expect(got.file).toBe("other");
    const height = Math.round((rect.width * 34) / 80);
    expect(got.rect).toEqual({ x: rect.x, y: Math.round(rect.y + rect.height / 2 - height / 2), width: rect.width, height });
  });

  it("answers every listed file's whole ink colors and its own rectangle in the slot, whichever file is named", async () => {
    // A two-color file, its white copy of the same shape, and a second file of another shape.
    const two = box(mark(40, 16, [11, 14, 26]), 24, 0, 40, 7, [0, 193, 213]);
    const taller = mark(80, 34, [250, 250, 250]);
    const logos = { stored: two, other: taller, white };
    const all = [...files, { file: "white", logo: `${GET}white.png`, last: true }];
    const height = Math.round((rect.width * 34) / 80);
    const fitted = { x: rect.x, y: Math.round(rect.y + rect.height / 2 - height / 2), width: rect.width, height };
    const facts = { inks: { stored: wholeInksOf(two), other: wholeInksOf(taller), white: wholeInksOf(white) }, fits: { stored: rect, other: fitted, white: rect } };
    expect(facts.inks).toEqual({ stored: [[11, 14, 26], [0, 193, 213]], other: [[250, 250, 250]], white: [[255, 255, 255]] });
    // On a dark ground the taller file is named, on a light one the stored file: the facts are the same on both.
    for (const [ground, named] of [[[38, 44, 52], "other"], [[244, 244, 244], "stored"]] as Array<[Rgb, string]>) {
      const { call } = await store(flat(W, H, ground), logos);
      const { json } = await call("slot-file", { ...base, files: all });
      const got = result(json);
      expect(got.file).toBe(named);
      expect(got.inks).toEqual(facts.inks);
      expect(got.fits).toEqual(facts.fits);
      expect(got.rect).toEqual(facts.fits[named as "stored" | "other"]);
      // The answer is the operation's own, as for every route.
      expect(json.result).toEqual(slotFile(flat(W, H, ground), rect, [W, H], "stored", [{ file: "stored", raster: two }, { file: "other", raster: taller }, { file: "white", raster: white, last: true }]));
    }
    // No file shows on the ground: none is named, and the facts are still answered.
    const { call } = await store(flat(W, H, [250, 250, 250]), { white });
    const none = result((await call("slot-file", { ...base, of: "white", files: [{ file: "white", logo: `${GET}white.png` }] })).json);
    expect(none.file).toBeNull();
    expect(none.inks).toEqual({ white: [[255, 255, 255]] });
    expect(none.fits).toEqual({ white: rect });
    // The same for a call whose slot has no pixel on the picture.
    const off = await store(flat(W, H, [38, 44, 52]), logos);
    const outside = result((await off.call("slot-file", { ...base, rect: { ...rect, x: W + 40 }, files: all })).json);
    expect(outside.ground).toBeNull();
    expect(outside.inks).toEqual(facts.inks);
    expect(Object.keys(outside.fits)).toEqual(["stored", "other", "white"]);
  });

  it("refuses a file named twice, no file, a drawing or a shape of a file that is not listed, and a field it does not know", async () => {
    const { call } = await store(flat(W, H, [0, 0, 0]));
    expect((await call("slot-file", { ...base, files: [] })).status).toBe(400);
    expect((await call("slot-file", { ...base, files: [files[0], files[0]] })).json.reason).toBe("The request is not well formed: files.1.file");
    expect((await call("slot-file", { ...base, files, drawn: { file: "white", ground: [0, 0, 0] } })).json.reason).toBe("The request is not well formed: drawn.file");
    expect((await call("slot-file", { ...base, of: "white", files })).json.reason).toBe("The request is not well formed: of");
    expect((await call("slot-file", { ...base, files, placement: { anchor: "center", width: 0.2, top: 0.1 } })).status).toBe(400);
  });
});
