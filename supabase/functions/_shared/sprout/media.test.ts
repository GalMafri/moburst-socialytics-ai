// @vitest-environment node
// Each image fitted to what its network takes through Sprout (media.ts),
// against HEAD answers shaped like Supabase Storage's: the 3 Nov 2026 slide
// was a 6,000,772-byte PNG, 3,575,179 bytes saved again, 2,606,155 at 1080 wide.
import { describe, expect, it } from "vitest";
import { fitImage, ImageTooLarge, SPROUT_IMAGE_LIMITS } from "./media";

const SLIDE = "https://db.supabase.co/storage/v1/object/public/generated-media/moburst/canva-finish/run/final.png";
const SAVED_AGAIN = "https://db.supabase.co/storage/v1/render/image/public/generated-media/moburst/canva-finish/run/final.png?format=origin";
const NARROWER = "https://db.supabase.co/storage/v1/render/image/public/generated-media/moburst/canva-finish/run/final.png?width=1080&format=origin";

function storage(sizes: Record<string, number | null>, type = "image/png") {
  const asked: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${url}`);
    const bytes = sizes[url];
    if (bytes === undefined) return new Response(null, { status: 404 });
    return new Response(null, { status: 200, headers: bytes === null ? { "content-type": type } : { "content-length": String(bytes), "content-type": type } });
  }) as unknown as typeof fetch;
  return { asked, fetchImpl };
}

describe("fitImage", () => {
  it("hands Sprout the image itself when it fits the network", async () => {
    const { fetchImpl } = storage({ [SLIDE]: 3_956_296 });
    expect(await fitImage(fetchImpl, SLIDE, "linkedin_company")).toBe(SLIDE);
  });

  it("hands Sprout the same pixels saved again when the image is over the limit", async () => {
    const { asked, fetchImpl } = storage({ [SLIDE]: 6_000_772, [SAVED_AGAIN]: 3_575_179, [NARROWER]: 2_606_155 });
    expect(await fitImage(fetchImpl, SLIDE, "linkedin_company")).toBe(SAVED_AGAIN);
    expect(asked).toEqual([`HEAD ${SLIDE}`, `HEAD ${SAVED_AGAIN}`]);
  });

  it("goes 1080 wide when saving again is not enough", async () => {
    const { fetchImpl } = storage({ [SLIDE]: 9_000_000, [SAVED_AGAIN]: 5_400_000, [NARROWER]: 3_100_000 });
    expect(await fitImage(fetchImpl, SLIDE, "LinkedIn")).toBe(NARROWER);
  });

  it("refuses an image no version brings under the limit, and one outside the app's storage", async () => {
    const tooBig = storage({ [SLIDE]: 9_000_000, [SAVED_AGAIN]: 7_000_000, [NARROWER]: 5_100_000 });
    await expect(fitImage(tooBig.fetchImpl, SLIDE, "linkedin_company")).rejects.toThrow(ImageTooLarge);
    await expect(fitImage(tooBig.fetchImpl, SLIDE, "linkedin_company")).rejects.toThrow("An image is larger than LinkedIn takes through Sprout (5 MB), even made smaller, so nothing was sent.");
    const elsewhere = "https://cdn.example.com/brand/hero.png";
    await expect(fitImage(storage({ [elsewhere]: 6_000_000 }).fetchImpl, elsewhere, "twitter")).rejects.toThrow("X takes through Sprout (5 MB)");
  });

  it("uses each network's own limit: the 6 MB slide fits Instagram and Facebook as it is", async () => {
    const { fetchImpl } = storage({ [SLIDE]: 6_000_772 });
    expect(await fitImage(fetchImpl, SLIDE, "fb_instagram_account")).toBe(SLIDE);
    expect(await fitImage(fetchImpl, SLIDE, "facebook")).toBe(SLIDE);
    expect(SPROUT_IMAGE_LIMITS.linkedin.maxBytes).toBe(5_000_000);
  });

  it("leaves videos, documents, unknown sizes and networks with no image limit alone", async () => {
    const video = "https://db.supabase.co/storage/v1/object/public/generated-media/moburst/reel.mp4";
    const pdf = "https://db.supabase.co/storage/v1/object/public/generated-media/moburst/deck.pdf";
    const v = storage({});
    expect(await fitImage(v.fetchImpl, video, "linkedin_company")).toBe(video);
    expect(v.asked).toEqual([]);
    expect(await fitImage(storage({ [pdf]: 6_000_000 }, "application/pdf").fetchImpl, pdf, "linkedin_company")).toBe(pdf);
    expect(await fitImage(storage({ [SLIDE]: null }).fetchImpl, SLIDE, "linkedin_company")).toBe(SLIDE);
    expect(await fitImage(storage({}).fetchImpl, SLIDE, "linkedin_company")).toBe(SLIDE);
    expect(await fitImage(storage({ [SLIDE]: 60_000_000 }).fetchImpl, SLIDE, "youtube")).toBe(SLIDE);
  });
});
