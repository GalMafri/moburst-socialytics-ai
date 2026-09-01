import { describe, it, expect, vi } from "vitest";
import {
  isHiggsfieldImagePath,
  MAX_REFERENCE_IMAGES,
  resolveContextImageUrls,
  toHiggsfieldAspectRatio,
  toInputImages,
} from "../../../supabase/functions/_shared/higgsfield/context";

/** Fake storage client whose signed URL embeds bucket+path, for assertions. */
function fakeSupabase(failFor: string[] = []) {
  const createSignedUrl = vi.fn(async (path: string) => {
    if (failFor.includes(path)) return { data: null, error: { message: "denied" } };
    return { data: { signedUrl: `https://signed/${path}` }, error: null };
  });
  return {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (path: string, ttl: number) =>
          createSignedUrl(`${bucket}/${path}?ttl=${ttl}`),
      }),
    },
    _spy: createSignedUrl,
  };
}

describe("isHiggsfieldImagePath", () => {
  it("accepts the formats Higgsfield takes and rejects PDF", () => {
    expect(isHiggsfieldImagePath("a/b.png")).toBe(true);
    expect(isHiggsfieldImagePath("a/b.JPG")).toBe(true);
    expect(isHiggsfieldImagePath("a/b.webp")).toBe(true);
    expect(isHiggsfieldImagePath("brand.pdf")).toBe(false);
    expect(isHiggsfieldImagePath("noextension")).toBe(false);
  });
});

describe("resolveContextImageUrls", () => {
  it("signs design references and a PNG brand book, in order", async () => {
    const sb = fakeSupabase();
    const out = await resolveContextImageUrls(
      {
        design_references: ["r1.png", "r2.jpg"],
        brand_book_file_path: "book.png",
        design_style_synthesis: null,
      },
      sb,
    );
    expect(out.referenceUrls).toHaveLength(3);
    expect(out.referenceUrls[0]).toContain("design-references/r1.png");
    expect(out.referenceUrls[2]).toContain("brand-books/book.png");
    expect(out.brandBookSkipped).toBe(false);
    expect(out.brandGroundingMissing).toBe(false);
  });

  it("caps design references at the shared maximum", async () => {
    const sb = fakeSupabase();
    const refs = ["a.png", "b.png", "c.png", "d.png", "e.png"];
    const out = await resolveContextImageUrls({ design_references: refs }, sb);
    expect(out.referenceUrls).toHaveLength(MAX_REFERENCE_IMAGES);
  });

  it("skips a PDF brand book and flags missing grounding when no synthesis exists", async () => {
    const sb = fakeSupabase();
    const out = await resolveContextImageUrls(
      { design_references: [], brand_book_file_path: "book.pdf", design_style_synthesis: null },
      sb,
    );
    expect(out.referenceUrls).toHaveLength(0);
    expect(out.brandBookSkipped).toBe(true);
    expect(out.brandGroundingMissing).toBe(true);
  });

  it("a PDF brand book with synthesis present is skipped but grounded", async () => {
    const sb = fakeSupabase();
    const out = await resolveContextImageUrls(
      {
        brand_book_file_path: "book.pdf",
        design_style_synthesis: { color_usage: "lime on charcoal" },
      },
      sb,
    );
    expect(out.brandBookSkipped).toBe(true);
    expect(out.brandGroundingMissing).toBe(false);
  });

  it("continues past signing failures instead of failing the generation", async () => {
    const sb = fakeSupabase(["design-references/bad.png?ttl=3600"]);
    const out = await resolveContextImageUrls(
      { design_references: ["bad.png", "good.png"] },
      sb,
    );
    expect(out.referenceUrls).toHaveLength(1);
    expect(out.referenceUrls[0]).toContain("good.png");
  });

  it("handles a null context", async () => {
    const sb = fakeSupabase();
    const out = await resolveContextImageUrls(null, sb);
    expect(out.referenceUrls).toEqual([]);
    expect(out.brandGroundingMissing).toBe(false);
  });
});

describe("toHiggsfieldAspectRatio", () => {
  it("passes known ratios through and defaults garbage to square", () => {
    expect(toHiggsfieldAspectRatio("9:16")).toBe("9:16");
    expect(toHiggsfieldAspectRatio("2:3")).toBe("2:3");
    expect(toHiggsfieldAspectRatio("banana")).toBe("1:1");
  });

  it("nano-banana renders 4:5 and 5:4 natively", () => {
    expect(toHiggsfieldAspectRatio("4:5")).toBe("4:5");
    expect(toHiggsfieldAspectRatio("5:4")).toBe("5:4");
    expect(toHiggsfieldAspectRatio("9:16")).toBe("9:16");
    expect(toHiggsfieldAspectRatio("auto")).toBe("auto");
  });
});

describe("toInputImages", () => {
  it("wraps URLs in nano-banana's typed shape and caps at 8", () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://x/${i}.png`);
    const out = toInputImages(urls);
    expect(out).toHaveLength(8);
    expect(out[0]).toEqual({ type: "image_url", image_url: "https://x/0.png" });
  });
});
