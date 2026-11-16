// @vitest-environment node
// server/test/routes.test.ts
//
// The six picture routes end to end (12 Nov 2026): each call goes through
// createApp and app.request, reads its inputs from a fake store keyed by
// URL, and the bytes it writes back are checked against the operation's own
// output on the same decoded inputs. The canvas and finish cases run once at
// real sizes; the others use small pictures.

import { describe, expect, it } from "vitest";
import { canvasLogoRect } from "../../supabase/functions/_shared/canva/brief.ts";
import { PUBLIC_DEFAULTS } from "../../public-env.ts";
import { PICTURE_CALL_HEADER, READ_JPEG_QUALITY, type Placement } from "../../supabase/functions/_shared/picture/contract.ts";
import { createApp } from "../src/app.ts";
import { generationCanvas } from "../src/picture/canvas.ts";
import { finishPicture } from "../src/picture/finish.ts";
import { locateLogo } from "../src/picture/locate.ts";
import { readPictures } from "../src/picture/read.ts";
import { decodeRaster, encodeJpeg, encodePng, raster, type Raster } from "../src/picture/raster.ts";
import { titleRead } from "../src/picture/title.ts";
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
