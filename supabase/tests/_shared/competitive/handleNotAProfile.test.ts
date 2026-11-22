// @vitest-environment node
// QA 22 Nov 2026 (P30): links that are not a brand's profile are saved as one.
import { describe, expect, it } from "vitest";
import { classifyUrl, extractSocialHandles } from "../../../functions/_shared/competitive/extractSocialHandles";

describe("P30 handle detection: non-profile links", () => {
  it("a youtu.be video link is not a YouTube channel", () => {
    expect(classifyUrl("https://youtu.be/dQw4w9WgXcQ")).toBeNull();
  });
  it("the YouTube iframe API script is not a YouTube channel", () => {
    expect(classifyUrl("https://www.youtube.com/iframe_api")).toBeNull();
  });
  it("the old xmlns:fb namespace is not a Facebook page", () => {
    expect(classifyUrl("http://www.facebook.com/2008/fbml")).toBeNull();
  });
  it("a footer video link near 'social' is not saved as the brand's channel at review-ready confidence", () => {
    const html = `<html xmlns:fb="http://www.facebook.com/2008/fbml"><head><script src="https://www.youtube.com/iframe_api"></script></head><body>${"x".repeat(3000)}<footer><div class="social"><a href="https://youtu.be/dQw4w9WgXcQ">Watch our story</a><a href="https://www.instagram.com/acme/">IG</a></div></footer></body></html>`;
    const found = extractSocialHandles(html, "Acme");
    expect(found.filter((h) => h.platform === "youtube" || h.platform === "facebook")).toEqual([]);
  });
});
