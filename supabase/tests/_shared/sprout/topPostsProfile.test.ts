// P49: top posts never say which profile/network they came from.
// topPostsRequest asks Sprout for fields that do not include customer_profile_id
// (every other analytics/posts reader in the repo asks for it), so a row carrying
// exactly the fields asked for yields profile_id null, and sprout-analytics then
// gives every top post network_type null and profile_name null.
import { describe, expect, it } from "vitest";
import { readTopPosts, topPostsRequest } from "../../../../supabase/functions/_shared/sprout/topPosts";

describe("P49 top posts carry their profile", () => {
  it("asks Sprout for the post's customer_profile_id", () => {
    expect(topPostsRequest([1], "instagram", "2026-11-01", "2026-11-07").fields).toContain("customer_profile_id");
  });
  it("a row with exactly the requested fields still names its profile", async () => {
    const call = async (_path: string, body: any) => ({
      // Sprout returns the fields asked for (plus metrics), flat on the row.
      data: [Object.fromEntries([...body.fields.map((f: string) => [f, f === "customer_profile_id" ? 42 : f === "visual_media" ? [] : "x"]), ["metrics", { "lifetime.impressions": 5 }]])],
    });
    const { posts } = await readTopPosts(call, [{ sprout_profile_id: 42, network_type: "fb_instagram_account" }], "2026-11-01", "2026-11-07");
    expect(posts[0].profile_id).toBe(42);
  });
});
