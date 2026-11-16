// @vitest-environment node
import { describe, expect, it } from "vitest";
import { postCreative, rankTopPosts, readTopPosts, topPostFromRow, topPostsRequest, TOP_POSTS } from "../../../functions/_shared/sprout/topPosts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Sprout answers untyped JSON.
type Any = any;

const row = (id: number, o: { impressions?: number | null; views?: number; profile?: number; media?: Any[]; at?: string } = {}): Any => ({
  perma_link: `https://example.com/p/${id}`, text: `post ${id}`, created_time: o.at ?? "2026-09-10T10:00:00Z", post_type: "POST",
  dimensions: { customer_profile_id: o.profile ?? 1 },
  metrics: { ...(o.impressions === null ? {} : { "lifetime.impressions": o.impressions ?? 0 }), "lifetime.video_views": o.views ?? 0 },
  ...(o.media ? { visual_media: o.media } : {}),
});

describe("top posts", () => {
  it("a row with visual_media returns its image and media type", () => {
    const p = topPostFromRow(row(1, { impressions: 50, media: [{ media_type: "PHOTO", thumbnail_url: "https://cdn.example.com/a.jpg", media_url: "https://cdn.example.com/full.jpg" }] }), "linkedin");
    expect(p).toMatchObject({ thumbnail_url: "https://cdn.example.com/a.jpg", media_type: "PHOTO", impressions: 50, reach: 50 });
  });

  it("a row with no visual_media has no image, and a video file is never used as one", () => {
    expect(topPostFromRow(row(1, { impressions: 5 }), "facebook")).toMatchObject({ thumbnail_url: null, media_type: null });
    expect(postCreative({ visual_media: [{ media_type: "VIDEO", media_url: "https://cdn.example.com/v.mp4" }] })).toEqual({ thumbnail_url: null, media_type: "VIDEO" });
    expect(postCreative({ visual_media: [{ media_type: "PHOTO", media_url: "https://cdn.example.com/p.jpg" }] }).thumbnail_url).toBe("https://cdn.example.com/p.jpg");
  });

  it("asks Sprout for each post's visual_media, and sorts a YouTube read on views", () => {
    const li = topPostsRequest([1], "linkedin", "2026-09-01", "2026-09-30");
    const yt = topPostsRequest([2], "youtube", "2026-09-01", "2026-09-30");
    expect(li.fields).toContain("visual_media");
    expect(li.sort).toEqual(["lifetime.impressions:desc"]);
    expect(yt.sort).toEqual(["lifetime.video_views:desc"]);
  });

  it("a YouTube post with 0 impressions and more views than the tenth post's impressions is ranked in", async () => {
    const calls: Array<{ path: string; body: Any }> = [];
    const call = async (path: string, body: Any) => {
      calls.push({ path, body });
      const isYoutube = String(body.filters[0]).includes("(9)");
      if (isYoutube) return { data: [row(100, { impressions: 0, views: 600, profile: 9 })] };
      return { data: Array.from({ length: 12 }, (_, i) => row(i, { impressions: 1000 - i * 50, profile: 1 })) };
    };
    const { posts, failed } = await readTopPosts(call, [{ sprout_profile_id: 1, network_type: "linkedin_company" }, { sprout_profile_id: 9, network_type: "youtube_channel" }], "2026-09-01", "2026-09-30");
    expect(failed).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(posts).toHaveLength(TOP_POSTS);
    const yt = posts.find((p) => p.permalink === "https://example.com/p/100");
    expect(yt).toMatchObject({ impressions: 0, video_views: 600, reach: 600 });
    expect(posts.map((p) => p.reach)).toEqual([...posts.map((p) => p.reach)].sort((a, b) => b - a));
  });

  it("keeps the other networks' posts when one network's read fails, and names the one that failed", async () => {
    const call = async (_p: string, body: Any) => {
      if (String(body.filters[0]).includes("(9)")) throw new Error("Sprout analytics/posts failed [500]");
      return { data: [row(1, { impressions: 10 })] };
    };
    const { posts, failed } = await readTopPosts(call, [{ sprout_profile_id: 1, network_type: "fb_page" }, { sprout_profile_id: 9, network_type: "youtube_channel" }], "2026-09-01", "2026-09-30");
    expect(posts.map((p) => p.permalink)).toEqual(["https://example.com/p/1"]);
    expect(failed).toEqual(["youtube"]);
  });

  it("ranks equal reach newest first", () => {
    const ranked = rankTopPosts([{ reach: 5, posted_at: "2026-09-01" }, { reach: 5, posted_at: "2026-09-09" }, { reach: 7, posted_at: "2026-08-01" }]);
    expect(ranked.map((p) => p.posted_at)).toEqual(["2026-08-01", "2026-09-09", "2026-09-01"]);
  });
});
