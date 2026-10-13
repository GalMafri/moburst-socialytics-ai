import { describe, it, expect } from "vitest";
import { sproutVideoCandidates } from "./videos";

const row = (over: Record<string, unknown>) => ({
  guid: "g1", customer_profile_id: "p1", network: "INSTAGRAM", created_time: "2026-10-01T10:00:00Z", perma_link: "https://www.instagram.com/reel/x/",
  content_category: "VIDEO", visual_media: [{ media_type: "VIDEO", media_url: "https://scontent.cdninstagram.com/v/a.mp4" }],
  metrics: { "lifetime.impressions": 100 }, ...over,
});

describe("sproutVideoCandidates", () => {
  it("keeps the assigned profiles' video posts, most seen first", () => {
    const out = sproutVideoCandidates([
      row({ guid: "a", metrics: { "lifetime.impressions": 10 }, visual_media: [{ media_type: "VIDEO", media_url: "https://scontent.cdninstagram.com/v/a.mp4" }] }),
      row({ guid: "b", metrics: { "lifetime.impressions": 900 }, visual_media: [{ media_type: "VIDEO", media_url: "https://scontent.cdninstagram.com/v/b.mp4" }] }),
    ], ["p1"]);
    expect(out.map((c) => c.source_post_id)).toEqual(["b", "a"]);
  });
  it("skips photos, other profiles, unknown hosts and repeats", () => {
    const out = sproutVideoCandidates([
      row({ guid: "photo", visual_media: [{ media_type: "PHOTO", media_url: "https://scontent.cdninstagram.com/v/p.jpg" }] }),
      row({ guid: "other", customer_profile_id: "p9" }),
      row({ guid: "host", visual_media: [{ media_type: "VIDEO", media_url: "https://example.com/v.mp4" }] }),
      row({ guid: "keep" }),
      row({ guid: "repeat" }),
    ], ["p1"]);
    expect(out.map((c) => c.source_post_id)).toEqual(["keep"]);
  });
});
