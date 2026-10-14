import { describe, expect, it } from "vitest";
import { sproutCandidates } from "./candidates";

const post = (guid: string, category = "PHOTO") => ({
  guid, perma_link: `https://example.com/${guid}`, customer_profile_id: "7", network: "INSTAGRAM", created_time: "2026-10-01T00:00:00Z",
  content_category: category, visual_media: [{ media_type: "PHOTO", media_url: `https://network-media.sproutsocial.com/${guid}.jpg` }],
});

describe("published posts that can teach a client's designs", () => {
  it("leaves out Instagram Stories, which are not feed designs", () => {
    const found = sproutCandidates([post("igst:1"), post("igmed:2"), post("igst:3", "ALBUM")], ["7"]);
    expect(found.map((c) => c.source_post_id)).toEqual(["igmed:2"]);
  });
  it("keeps only the client's own assigned accounts", () => {
    expect(sproutCandidates([post("igmed:2")], ["8"])).toEqual([]);
  });
});
