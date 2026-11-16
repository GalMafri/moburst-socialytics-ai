// @vitest-environment node
// The brand book a person may upload (brandBookLimits.ts) is the brand book the
// style is learned from: a file the upload accepted is never skipped for being
// over a smaller number written in this function.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { base64Bytes, BRAND_BOOK_MAX_BYTES, brandBookFitsRequest, MODEL_REQUEST_MAX_BYTES } from "../../../functions/_shared/brand/brandBookLimits";

const sent: Array<{ content: Array<{ type: string }> }> = [];
vi.mock("../../../functions/_shared/anthropic.ts", () => ({
  anthropicFetch: async (_path: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body).messages[0]);
    const text = JSON.stringify(Object.fromEntries(["composition_patterns", "typography_treatment", "imagery_style", "color_usage", "surface_and_texture", "logo_and_marks_treatment", "mood_and_voice_visual", "anti_patterns", "platform_adaptations"].map((f) => [f, "x"])));
    return new Response(JSON.stringify({ content: [{ text }] }));
  },
}));

import { learnBrandStyle } from "../../../functions/_shared/brand-references/learnStyle";

function fakeDb(bookBytes: number, path = "c1/book.pdf", refs: string[] = []) {
  // deno-lint-ignore no-explicit-any
  const chain: any = { select: () => chain, eq: () => chain, update: () => chain, maybeSingle: async () => ({ data: { id: "c1", name: "Bader", design_references: refs, harvested_design_references: refs, brand_book_file_path: path, design_style_synthesis: null }, error: null }), then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok) };
  return {
    from: (table: string) => (table === "app_settings" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "key" } }) }) }) } : chain),
    storage: { from: (bucket: string) => ({ download: async () => ({ data: new Blob([new Uint8Array(bucket === "brand-books" ? bookBytes : 1000)]) }) }) },
  };
}

describe("learning a style from the brand book", () => {
  beforeEach(() => { sent.length = 0; });

  it("reads a brand book between 4 MB and the upload limit", async () => {
    const out = await learnBrandStyle(fakeDb(6 * 1024 * 1024) as never, "c1", { discover: false });
    expect(out.synthesis.source_count).toBe(1);
    expect(sent[0].content.map((p) => p.type)).toEqual(["text", "document"]);
  });

  it("learns from the references alone when an image book is over the model's image limit", async () => {
    // Accepted by the upload (6 MB, under 10), refused by the model (over 5 MB per image): the request still succeeds on the reference.
    const out = await learnBrandStyle(fakeDb(6 * 1024 * 1024, "c1/book.png", ["c1/ref.png"]) as never, "c1", { discover: false });
    expect(out.synthesis.source_count).toBe(1);
    expect(sent[0].content.map((p) => p.type)).toEqual(["text", "image"]);
  });

  it("skips a brand book over the upload limit", async () => {
    await expect(learnBrandStyle(fakeDb(BRAND_BOOK_MAX_BYTES + 1) as never, "c1", { discover: false })).rejects.toThrow(/could not be loaded/);
  });
});

describe("the brand book size is written once", () => {
  it.each(["supabase/functions/generate-post-image/index.ts", "supabase/functions/_shared/brand-references/learnStyle.ts"])("%s asks brandBookLimits whether the book goes in", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain("brandBookFitsRequest");
    // No byte count of its own for the book.
    expect(src).not.toMatch(/byteLength\s*<=\s*\d/);
  });
});

describe("the brand book beside the other files of one request", () => {
  const MB = 1024 * 1024;
  it("goes in a 10 MB pdf beside no references, and stays under the request limit", () => {
    expect(brandBookFitsRequest({ bytes: 10 * MB, imageLimited: false }, 0)).toBe(true);
    expect(base64Bytes(10 * MB)).toBeLessThan(MODEL_REQUEST_MAX_BYTES);
  });
  it("is left out when it does not fit beside four 2 MB references", () => {
    const refs = 4 * base64Bytes(2 * MB);
    expect(brandBookFitsRequest({ bytes: 10 * MB, imageLimited: false }, refs)).toBe(false);
    expect(brandBookFitsRequest({ bytes: 3 * MB, imageLimited: false }, refs)).toBe(true);
  });
  it("is left out as an image over the model's image limit only where that limit applies", () => {
    expect(brandBookFitsRequest({ bytes: 6 * MB, imageLimited: true }, 0)).toBe(false);
    expect(brandBookFitsRequest({ bytes: 6 * MB, imageLimited: false }, 0)).toBe(true);
  });
});
