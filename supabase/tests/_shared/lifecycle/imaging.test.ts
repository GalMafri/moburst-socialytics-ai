import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../support/lifecycleFakeDb";

// logoPng stores every logo as its ink alone, 1,200 pixels at most on the long
// side. The image library (a URL import under Deno) is a fake that holds an
// RGBA canvas, so the real trimming rules run.

vi.mock("https://deno.land/x/imagescript@1.3.0/mod.ts", () => {
  class Image {
    bitmap: Uint8ClampedArray;
    constructor(public width: number, public height: number, bitmap?: Uint8ClampedArray) { this.bitmap = bitmap ?? new Uint8ClampedArray(width * height * 4); }
    // The test PNGs carry their canvas after the 24-byte header: [w, h as in the header] then RGBA.
    static async decode(bytes: Uint8Array): Promise<Image> {
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const w = v.getUint32(16), h = v.getUint32(20);
      return new Image(w, h, new Uint8ClampedArray(bytes.slice(24)));
    }
    crop(x: number, y: number, w: number, h: number): Image {
      const out = new Uint8ClampedArray(w * h * 4);
      for (let j = 0; j < h; j++) out.set(this.bitmap.subarray(((y + j) * this.width + x) * 4, ((y + j) * this.width + x + w) * 4), j * w * 4);
      this.bitmap = out; this.width = w; this.height = h;
      return this;
    }
    resize(w: number, h: number): Image { this.bitmap = new Uint8ClampedArray(w * h * 4).fill(255); this.width = w; this.height = h; return this; }
    async encode(): Promise<Uint8Array> { return png(this.width, this.height, this.bitmap); }
  }
  return { Image };
});
vi.mock("../../../functions/_shared/render/resvg.ts", () => ({ svgToPng: vi.fn() }));
vi.mock("../../../functions/_shared/design-system/logoAsset.ts", () => ({ cutLogo: vi.fn() }));
vi.mock("../../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: vi.fn() }));

import { createHash } from "node:crypto";
import { anthropicMessages } from "../../../functions/_shared/anthropic";
import { roomFor } from "../../../functions/_shared/anthropicReply";
import { fileHash, logoPng, readLogoSpot, refitStoredLogo } from "../../../functions/_shared/lifecycle/imaging";

/** A PNG as these tests carry it: the real signature and header size, then the RGBA canvas. */
function png(w: number, h: number, rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(24 + rgba.length);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(out.buffer);
  v.setUint32(16, w); v.setUint32(20, h);
  out.set(rgba as ArrayLike<number>, 24);
  return out;
}
const withInk = (w: number, h: number, x0: number, y0: number, iw: number, ih: number) => {
  const px = new Uint8Array(w * h * 4);
  for (let y = y0; y < y0 + ih; y++) for (let x = x0; x < x0 + iw; x++) px.set([20, 20, 20, 255], (y * w + x) * 4);
  return png(w, h, px);
};
const URL_OF = "https://x.supabase.co/storage/v1/object/public/generated-media/c1/logo.png";

async function run(file: Uint8Array) {
  const db = fakeDb();
  db.uploads.set("generated-media/c1/logo.png", file);
  vi.stubGlobal("Deno", { env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://x.supabase.co" : undefined) } });
  const logo = await logoPng(db, "c1", URL_OF);
  vi.unstubAllGlobals();
  return { logo, db };
}

describe("logoPng", () => {
  it("stores a 400 by 400 logo whose ink fills 80 by 32 percent as the ink alone, 320 by 128, beside the original", async () => {
    const { logo, db } = await run(withInk(400, 400, 40, 134, 320, 128));
    expect(logo).toMatchObject({ width: 320, height: 128, converted: "kept" });
    expect(logo!.path).not.toBe("c1/logo.png");
    expect(db.uploads.has(`generated-media/${logo!.path}`)).toBe(true);
    expect(db.uploads.has("generated-media/c1/logo.png")).toBe(true);
  });

  it("keeps the file it was given when it is already its ink alone and small enough", async () => {
    const { logo, db } = await run(withInk(300, 100, 0, 0, 300, 100));
    expect(logo).toMatchObject({ path: "c1/logo.png", width: 300, height: 100 });
    expect([...db.uploads.keys()]).toEqual(["generated-media/c1/logo.png"]);
  });

  it("caps a large mark at 1,200 pixels on its long side", async () => {
    const { logo } = await run(withInk(1500, 1500, 0, 100, 1500, 500));
    expect(logo).toMatchObject({ width: 1200, height: 400 });
  });
});

describe("refitStoredLogo", () => {
  const put = (file: Uint8Array) => {
    const db = fakeDb();
    db.uploads.set("generated-media/c1/logo.png", file);
    return db;
  };

  it("stores a padded logo trimmed beside the original and names the new file, calling no model", async () => {
    const db = put(withInk(400, 400, 40, 134, 320, 128));
    const fit = await refitStoredLogo(db, "c1", "c1/logo.png");
    expect(fit).toMatchObject({ width: 320, height: 128 });
    expect(fit!.path).toMatch(/^c1\/design-settings\/logo-site-[0-9a-f]{16}\.png$/);
    expect(db.uploads.has(`generated-media/${fit!.path}`)).toBe(true);
    expect(db.uploads.has("generated-media/c1/logo.png")).toBe(true);
  });

  it("answers null for a logo already trimmed and small, and for a file that is not a PNG, and throws for a file storage cannot give", async () => {
    expect(await refitStoredLogo(put(withInk(300, 100, 0, 0, 300, 100)), "c1", "c1/logo.png")).toBeNull();
    expect(await refitStoredLogo(put(new Uint8Array(40)), "c1", "c1/logo.png")).toBeNull();
    await expect(refitStoredLogo(fakeDb(), "c1", "c1/missing.png")).rejects.toThrow("could not be read");
  });
});

describe("fileHash", () => {
  it("names a stored logo by the first 16 characters of its hash, and throws for a file storage cannot give", async () => {
    const db = fakeDb();
    const file = withInk(40, 16, 0, 0, 40, 16);
    db.uploads.set("generated-media/c1/design-settings/logo-site-a.png", file);
    const hash = await fileHash(db, "c1/design-settings/logo-site-a.png");
    expect(hash).toBe(createHash("sha256").update(file).digest("hex").slice(0, 16));
    // The same bytes give the same name, so a set made again writes its copies over the same files.
    expect(await fileHash(db, "c1/design-settings/logo-site-a.png")).toBe(hash);
    await expect(fileHash(db, "c1/missing.png")).rejects.toThrow("The logo file could not be read");
  });
});

// The read of where the client's posts put the logo. A reply that was cut off
// at its limit used to be stored as "no place found", and the client's logo
// then sat at the default place in every design (18 Nov 2026).
const COST = { tool: "socialytics" as const, clientId: "c1", feature: "lifecycle.logo_spot", actor: "system" as const };

describe("readLogoSpot", () => {
  const model = vi.mocked(anthropicMessages);
  const withPosts = (n = 2) => {
    const db = fakeDb();
    for (let i = 0; i < n; i++) db.uploads.set(`design-references/c1/social-${i}.jpg`, new Uint8Array([1, 2, 3]));
    return { db, paths: Array.from({ length: n }, (_, i) => `c1/social-${i}.jpg`) };
  };
  const answers = (text: string, stopReason = "end_turn") => { model.mockReset(); model.mockResolvedValue({ text, stopReason, raw: {} }); };

  it("asks with room for the model to think before its short answer", async () => {
    const { db, paths } = withPosts(2);
    answers('{"logo":"shown","logo_at":"bottom-right","logo_width":0.18,"posts_with_logo":2}');
    expect(await readLogoSpot(db, "the brand", paths, COST)).toEqual({ shown: true, at: "bottom-right", width: 0.18 });
    expect(model).toHaveBeenCalledTimes(1);
    const body = model.mock.calls[0][0].body as { model: string; max_tokens: number; messages: Array<{ content: Array<{ type: string }> }> };
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.max_tokens).toBe(roomFor(400));
    expect(body.max_tokens).toBe(16_400);
    // The read may take 150 seconds at most: the job that runs it holds a lease of 300, and a read that outlived it would be paid for twice.
    expect(model.mock.calls[0][0].waitMs).toBe(150_000);
    // Nothing that could be refused is sent to bound the thinking.
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("output_config");
    expect(body.messages[0].content.map((b) => b.type)).toEqual(["image", "image", "text"]);
  });

  it("gives the answer that the posts do not show the logo as an answer", async () => {
    const { db, paths } = withPosts();
    answers('{"logo":"none","logo_at":"","logo_width":0,"posts_with_logo":0}');
    expect(await readLogoSpot(db, "the brand", paths, COST)).toEqual({ shown: false, at: null, width: null });
  });

  it("throws for a reply that was cut off, with or without the start of an answer, so nothing is kept as the read", async () => {
    const { db, paths } = withPosts();
    answers("", "max_tokens");
    await expect(readLogoSpot(db, "the brand", paths, COST)).rejects.toThrow("The logo's place on the client's posts could not be read: the reply was cut off at its limit");
    // Half an answer that happens to hold a whole object is still half an answer.
    answers('{"logo":"none"}', "max_tokens");
    await expect(readLogoSpot(db, "the brand", paths, COST)).rejects.toThrow("the reply was cut off at its limit");
  });

  it("throws for a reply that was declined or too long in coming, and for one that is not the JSON asked for", async () => {
    const { db, paths } = withPosts();
    answers("", "refusal");
    await expect(readLogoSpot(db, "the brand", paths, COST)).rejects.toThrow("the reply was declined");
    answers("", "timed_out");
    await expect(readLogoSpot(db, "the brand", paths, COST)).rejects.toThrow("The logo's place on the client's posts could not be read: the reply did not arrive in time");
    answers("The logo sits in the top left corner of most posts.");
    await expect(readLogoSpot(db, "the brand", paths, COST)).rejects.toThrow("could not be read: The logo sits in the top left");
  });

  it("answers null, and asks nothing, when none of the posts can be loaded", async () => {
    model.mockReset();
    expect(await readLogoSpot(fakeDb(), "the brand", ["c1/missing.jpg"], COST)).toBeNull();
    expect(model).not.toHaveBeenCalled();
  });
});
