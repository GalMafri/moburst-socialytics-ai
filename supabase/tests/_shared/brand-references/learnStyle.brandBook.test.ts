// @vitest-environment node
// The brand book a person may upload (brandBookLimits.ts) is the brand book a
// design reads: a file the upload accepted is never skipped for being over a
// smaller number written in the function. (learnBrandStyle, which read the book
// the same way, was never called and was removed on 26 Nov 2026.)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { base64Bytes, brandBookFitsRequest, MODEL_REQUEST_MAX_BYTES } from "../../../functions/_shared/brand/brandBookLimits";

describe("the brand book size is written once", () => {
  it.each(["supabase/functions/generate-post-image/index.ts"])("%s asks brandBookLimits whether the book goes in", (file) => {
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
