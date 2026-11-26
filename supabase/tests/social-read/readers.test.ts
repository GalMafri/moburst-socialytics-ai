// @vitest-environment node
// The four public profile readers: the address each makes from a handle,
// the input its actor gets, and how it reads the actor's answer (fields as
// the actors' output schemas name them, read 26 Nov 2026).
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { READERS } from "../../functions/social-read/readers/index";

const here = dirname(fileURLToPath(import.meta.url));

describe("readers", () => {
  it("are small mapping files: nothing imported but their own types", () => {
    const dir = join(here, "..", "..", "functions", "social-read", "readers");
    for (const f of readdirSync(dir).filter((n) => !["index.ts", "types.ts"].includes(n))) {
      const imports = [...readFileSync(join(dir, f), "utf8").matchAll(/^import\s.+from\s+"([^"]+)"/gm)].map((m) => m[0]);
      expect(imports.every((l) => l.startsWith("import type") && l.includes('"./types.ts"')), f).toBe(true);
    }
  });

  it("make one address per profile and refuse what is not a profile", () => {
    expect(READERS.instagram.profileUrl("@Poliform_Official", null)).toBe("https://www.instagram.com/poliform_official/");
    expect(READERS.instagram.profileUrl("x", "https://www.instagram.com/p/ABC/")).toBe("");
    expect(READERS.facebook.profileUrl("", "https://www.facebook.com/PoliformSpa/")).toBe("https://www.facebook.com/poliformspa");
    expect(READERS.facebook.profileUrl("", "https://www.facebook.com/sharer.php?u=x")).toBe("");
    expect(READERS.tiktok.profileUrl("", "https://www.tiktok.com/@brand.co?lang=en")).toBe("https://www.tiktok.com/@brand.co");
    expect(READERS.linkedin.profileUrl("poliform", null)).toBe("https://www.linkedin.com/company/poliform");
    expect(READERS.linkedin.handleOf("https://www.linkedin.com/company/poliform")).toBe("poliform");
  });

  it("ask each actor for posts since the window's first day, at most the cap", () => {
    const since = "2026-08-28";
    expect(READERS.instagram.postsInput({ handle: "b", url: "https://www.instagram.com/b/" }, since, 150)).toMatchObject({ username: ["b"], resultsLimit: 150, onlyPostsNewerThan: since, dataDetailLevel: "basicData" });
    expect(READERS.facebook.postsInput({ handle: "b", url: "https://www.facebook.com/b" }, since, 150)).toMatchObject({ startUrls: [{ url: "https://www.facebook.com/b" }], resultsLimit: 150, onlyPostsNewerThan: since });
    expect(READERS.tiktok.postsInput({ handle: "b", url: "https://www.tiktok.com/@b" }, since, 150)).toMatchObject({ profiles: ["b"], resultsPerPage: 150, oldestPostDateUnified: since, shouldDownloadVideos: false });
    expect(READERS.tiktok.profileInput({ handle: "b", url: "https://www.tiktok.com/@b" })).toMatchObject({ profiles: ["b"], resultsPerPage: 1 });
    expect(READERS.linkedin.postsInput({ handle: "b", url: "https://www.linkedin.com/company/b" }, since, 150)).toMatchObject({ targetUrls: ["https://www.linkedin.com/company/b"], maxPosts: 150, postedLimitDate: since, includeReposts: false });
  });
});

describe("Instagram", () => {
  const p = { handle: "brand", url: "https://www.instagram.com/brand/" };
  it("reads the profile's name, links and followers", () => {
    const r = READERS.instagram.profile([{ username: "brand", fullName: "Brand Co", biography: "Shop at brand.com", externalUrl: "https://brand.com/", externalUrls: [{ url: "https://linktr.ee/brand" }], followersCount: 1200, private: false }], p);
    expect(r).toEqual({ found: true, private: false, page: true, name: "Brand Co", links: ["https://brand.com/", "https://linktr.ee/brand"], bio: "Shop at brand.com", followers: 1200 });
    expect(READERS.instagram.profile([{ username: "other" }], p)).toBeNull();
    expect(READERS.instagram.profile([{ error: "not_found" }], p)).toBeNull();
  });
  it("reads posts; hidden likes are unknown, never 0", () => {
    const posts = READERS.instagram.posts([
      { id: "1", type: "Sidecar", shortCode: "A", caption: "Hi #fall", hashtags: ["fall"], url: "https://www.instagram.com/p/A/", likesCount: -1, commentsCount: 3, timestamp: "2026-11-20T10:00:00.000Z", ownerUsername: "brand", paidPartnership: true },
      { id: "2", type: "Video", productType: "clips", likesCount: 50, commentsCount: 5, videoPlayCount: 900, timestamp: "2026-11-21T10:00:00.000Z", ownerUsername: "brand" },
      { id: "3", type: "Image", likesCount: 5, timestamp: "2026-11-21T10:00:00.000Z", ownerUsername: "someone_else" },
    ], p);
    expect(posts.map((x) => [x.key, x.format, x.likes, x.comments, x.views, x.paid])).toEqual([["1", "carousel", null, 3, null, true], ["2", "reel", 50, 5, 900, null]]);
    expect(posts[0].hashtags).toEqual(["fall"]);
  });
});

describe("Facebook", () => {
  const p = { handle: "brand", url: "https://www.facebook.com/brand" };
  it("reads a page; a personal profile is not a page", () => {
    expect(READERS.facebook.profile([{ facebookUrl: "https://www.facebook.com/brand", title: "Brand", website: "brand.com", intro: "We make things", followers: 5000 }], p))
      .toMatchObject({ found: true, page: true, name: "Brand", links: ["https://brand.com"], followers: 5000 });
    expect(READERS.facebook.profile([{ facebookUrl: "https://www.facebook.com/brand", personalProfile: { name: "A person" } }], p)).toMatchObject({ page: false });
  });
  it("reads posts with reactions, shares and video views", () => {
    const posts = READERS.facebook.posts([
      { postId: "10", url: "https://www.facebook.com/brand/posts/10", time: "2026-11-20T10:00:00.000Z", text: "New #launch", likes: 40, comments: 4, shares: 2, media: [{ __typename: "Photo", thumbnail: "https://x/1.jpg" }, { __typename: "Photo" }] },
      { postId: "11", time: "2026-11-21T10:00:00.000Z", text: "", likes: 10, comments: 0, shares: 0, isVideo: true, viewsCount: 300 },
      { error: "no posts" },
    ], p);
    expect(posts.map((x) => [x.key, x.format, x.likes, x.shares, x.views])).toEqual([["10", "carousel", 40, 2, null], ["11", "video", 10, 0, 300]]);
    expect(posts[0].hashtags).toEqual(["launch"]);
  });
});

describe("TikTok", () => {
  const p = { handle: "brand", url: "https://www.tiktok.com/@brand" };
  it("reads the profile from a post's author, and a private profile from its note", () => {
    expect(READERS.tiktok.profile([{ id: "1", authorMeta: { name: "brand", nickName: "Brand", signature: "hello", bioLink: "brand.com", fans: 777 } }], p))
      .toEqual({ found: true, private: false, page: true, name: "Brand", links: ["https://brand.com"], bio: "hello", followers: 777 });
    expect(READERS.tiktok.profile([{ note: "Profile is empty or private", input: "brand" }], p)).toMatchObject({ private: true });
    expect(READERS.tiktok.profile([], p)).toBeNull();
  });
  it("reads the profile's own videos, with the paid label and followers", () => {
    const posts = READERS.tiktok.posts([
      { id: "v1", createTimeISO: "2026-11-20T10:00:00.000Z", webVideoUrl: "https://www.tiktok.com/@brand/video/v1", text: "x", diggCount: 100, commentCount: 5, shareCount: 2, playCount: 4000, isAd: false, isSponsored: true, authorMeta: { name: "brand", fans: 800 } },
      { id: "v2", createTimeISO: "2026-11-20T10:00:00.000Z", authorMeta: { name: "brand" }, fromProfileSection: "reposts" },
      { id: "v3", createTimeISO: "2026-11-20T10:00:00.000Z", authorMeta: { name: "other" } },
    ], p);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ key: "v1", format: "short_video", likes: 100, comments: 5, shares: 2, views: 4000, paid: true, followers: 800 });
  });
});

describe("LinkedIn", () => {
  const p = { handle: "brand", url: "https://www.linkedin.com/company/brand" };
  it("reads the page's website and followers", () => {
    expect(READERS.linkedin.profile([{ universalName: "brand", name: "Brand Inc", website: "https://brand.com", followerCount: 9000 }], p)).toMatchObject({ name: "Brand Inc", links: ["https://brand.com"], followers: 9000 });
  });
  it("reads the page's own posts and collaborations, never reposts", () => {
    const own = { type: "post", id: "p1", linkedinUrl: "https://www.linkedin.com/posts/p1", content: "Hello #ai", postedAt: { date: "2026-11-20T10:00:00.000Z" }, author: { linkedinUrl: "https://www.linkedin.com/company/brand/" }, engagement: { likes: 10, comments: 2, shares: 1 } };
    const repost = { ...own, id: "p2", header: { imageLink: "https://www.linkedin.com/company/brand/", text: "Brand reposted this" }, author: { linkedinUrl: "https://www.linkedin.com/company/other/" } };
    const collab = { ...own, id: "p3", header: { imageLink: "https://www.linkedin.com/company/brand/", text: "Brand collaborated on this" }, author: { linkedinUrl: "https://www.linkedin.com/company/other/" } };
    const posts = READERS.linkedin.posts([own, repost, collab], p);
    expect(posts.map((x) => x.key)).toEqual(["p1", "p3"]);
    expect(posts[0]).toMatchObject({ likes: 10, comments: 2, shares: 1, views: null, paid: null, hashtags: ["ai"], format: "text" });
  });
});
