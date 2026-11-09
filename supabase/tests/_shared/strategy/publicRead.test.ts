// @vitest-environment node
// The 90-day public read (spec: docs/superpowers/specs/2026-11-03-strategy-v2-
// design.md, section 3, with Lital's answer of 3 Nov 2026): RivalIQ is never
// called. What RivalIQ already tracks comes from the stored weekly feed; a
// profile the feed does not cover is read with the app's own Apify actors
// (LinkedIn company pages, TikTok profiles); the client's posts on a Sprout
// platform are never read in public; client and competitors are kept apart;
// the read waits across runs and is reused for 7 days.
import { describe, expect, it } from "vitest";
import { feedPosts, figures, INSTAGRAM_LATEST, planTargets, PUBLIC_READERS, readInputs, stepRead, targetsKey, TIKTOK_MAX_PER_PROFILE, type PublicPost, type PublicReadState } from "../../../functions/_shared/strategy/publicRead";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import type { ApifyClient, ApifyRun } from "../../../functions/_shared/apify/client";

const NOW = new Date("2026-11-03T10:00:00.000Z");

const snapshot = (posts: Record<string, unknown>[], client_company_id = "1") => ({ payload: { client_company_id, window: { start: "2026-10-26", end: "2026-11-01" }, socialPosts: posts } });
const rq = (over: Record<string, unknown>) => ({ postId: "x", companyId: "2", companyName: "BenchApp", channel: "instagram", publishedAt: "2026-10-20T10:00:00Z", message: "hi", postLink: "https://instagram.com/p/1", engagementTotal: 10, type: "image", ...over });

describe("the stored feed", () => {
  it("keeps the 90 days, each post once, the client's own marked, with views and followers where RivalIQ gives them", () => {
    const posts = feedPosts([
      snapshot([rq({ postId: "a" }), rq({ postId: "b", companyId: "1", companyName: "Acme", channel: "tiktok", tiktokViews: 5000, presenceReach: 900 })]),
      snapshot([rq({ postId: "a" }), rq({ postId: "old", publishedAt: "2026-07-01T00:00:00Z" })]),
    ], "Acme", "2026-08-05");
    expect(posts.map((p) => [p.id, p.company, p.client, p.platform, p.views, p.followers])).toEqual([
      ["a", "BenchApp", false, "Instagram", null, null], ["b", "Acme", true, "TikTok", 5000, 900],
    ]);
  });
});

describe("what is read with Apify", () => {
  const profiles = [
    { company: "Acme", client: true, platform: "tiktok", handle: "acme", url: null },
    { company: "Acme", client: true, platform: "instagram", handle: "acme", url: null },
    { company: "Acme", client: true, platform: "linkedin", handle: "acme-co", url: "https://www.linkedin.com/company/acme-co/" },
    { company: "BenchApp", client: false, platform: "tiktok", handle: "@benchapp", url: "https://www.tiktok.com/@benchapp" },
    { company: "TeamSnap", client: false, platform: "linkedin", handle: "teamsnap", url: null },
  ];

  it("reads only profiles the feed does not cover, on platforms the app has a public reader for, and never the client's Sprout platforms", () => {
    const targets = planTargets({ profiles, feed: [], tracked: new Set(["teamsnap|LinkedIn"]), sprout: new Set(["LinkedIn"]) });
    expect(targets).toEqual([
      { company: "Acme", client: true, platform: "TikTok", url: "https://www.tiktok.com/@acme" },
      { company: "Acme", client: true, platform: "Instagram", url: "https://www.instagram.com/acme/" },
      { company: "BenchApp", client: false, platform: "TikTok", url: "https://www.tiktok.com/@benchapp" },
    ]);
    // LinkedIn is on Sprout for the client and tracked by RivalIQ for TeamSnap. Facebook, YouTube and X have no profile reader in the app.
    expect(Object.keys(PUBLIC_READERS).sort()).toEqual(["Instagram", "LinkedIn", "TikTok"]);
    expect(planTargets({ profiles: [{ company: "Acme", client: true, platform: "facebook", handle: "acme", url: null }], feed: [], tracked: new Set(), sprout: new Set() })).toEqual([]);
    const fed = planTargets({ profiles, feed: [{ company: "BenchApp", platform: "TikTok" } as PublicPost], tracked: new Set(), sprout: new Set() });
    expect(fed.map((t) => `${t.company} ${t.platform}`)).toEqual(["Acme TikTok", "Acme Instagram", "Acme LinkedIn", "TeamSnap LinkedIn"]);
  });

  it("asks the actors the way the app already runs them: LinkedIn pages in one run, a TikTok profile a run", () => {
    const li = PUBLIC_READERS.LinkedIn.runs([{ company: "A", client: true, platform: "LinkedIn", url: "https://www.linkedin.com/company/a" }, { company: "B", client: false, platform: "LinkedIn", url: "https://www.linkedin.com/company/b" }], "2026-08-05");
    expect(li).toHaveLength(1);
    expect(li[0].input).toMatchObject({ targetUrls: ["https://www.linkedin.com/company/a", "https://www.linkedin.com/company/b"], maxPosts: 150, postedLimitDate: "2026-08-05", includeReposts: false });
    expect(PUBLIC_READERS.LinkedIn.actor.name).toBe("harvestapi/linkedin-company-posts");
    const tt = PUBLIC_READERS.TikTok.runs([{ company: "A", client: true, platform: "TikTok", url: "https://www.tiktok.com/@a" }, { company: "B", client: false, platform: "TikTok", url: "https://www.tiktok.com/@b" }], "2026-08-05");
    expect(tt.map((r) => r.input)).toEqual([{ startUrls: ["https://www.tiktok.com/@a"], maxItems: TIKTOK_MAX_PER_PROFILE }, { startUrls: ["https://www.tiktok.com/@b"], maxItems: TIKTOK_MAX_PER_PROFILE }]);
    expect(PUBLIC_READERS.TikTok.actor.name).toBe("apidojo/tiktok-scraper");
    const ig = PUBLIC_READERS.Instagram.runs([{ company: "A", client: true, platform: "Instagram", url: "https://www.instagram.com/a/" }, { company: "B", client: false, platform: "Instagram", url: "https://www.instagram.com/b/" }], "2026-08-05");
    expect(ig.map((r) => r.input)).toEqual([{ usernames: ["a", "b"] }]);
    expect(PUBLIC_READERS.Instagram.actor.name).toBe("apify/instagram-profile-scraper");
  });

  it("keeps a LinkedIn page's own posts and a TikTok profile's posts, and drops reposts and rows of another profile", () => {
    const li = [{ company: "Acme", client: true, platform: "LinkedIn", url: "https://www.linkedin.com/company/acme" }];
    const row = (over: Record<string, unknown>) => ({ type: "post", id: "1", query: { targetUrl: "https://www.linkedin.com/company/acme" }, author: { linkedinUrl: "https://www.linkedin.com/company/acme" }, postedAt: { date: "2026-10-10T00:00:00Z" }, linkedinUrl: "https://www.linkedin.com/posts/acme_1", engagement: { likes: 5, comments: 2, shares: 1 }, content: "Hello", ...over });
    expect(PUBLIC_READERS.LinkedIn.normalize(row({}), li)).toEqual([expect.objectContaining({ company: "Acme", client: true, platform: "LinkedIn", engagement: 8, followers: null, source: "apify" })]);
    expect(PUBLIC_READERS.LinkedIn.normalize(row({ header: { imageLink: "https://www.linkedin.com/company/acme", text: "Acme reposted this" } }), li)).toEqual([]);
    expect(PUBLIC_READERS.LinkedIn.normalize(row({ author: { linkedinUrl: "https://www.linkedin.com/company/other" } }), li)).toEqual([]);
    const tt = [{ company: "BenchApp", client: false, platform: "TikTok", url: "https://www.tiktok.com/@benchapp" }];
    const t = { id: "9", postPage: "https://www.tiktok.com/@benchapp/video/9", uploadedAtFormatted: "2026-10-30T10:00:00.000Z", views: 2000, likes: 100, comments: 10, shares: 5, title: "Captain POV", channel: { username: "BenchApp", followers: 5600 } };
    expect(PUBLIC_READERS.TikTok.normalize(t, tt)).toEqual([expect.objectContaining({ company: "BenchApp", client: false, platform: "TikTok", engagement: 115, views: 2000, followers: 5600 })]);
    expect(PUBLIC_READERS.TikTok.normalize({ ...t, channel: { username: "someoneelse" } }, tt)).toEqual([]);
    // An Instagram profile's answer carries its 12 latest posts and its followers.
    const ig = [{ company: "Acme", client: true, platform: "Instagram", url: "https://www.instagram.com/acme/" }];
    const profile = { username: "acme", followersCount: 3400, latestPosts: [
      { id: "1", type: "Sidecar", url: "https://www.instagram.com/p/A/", caption: "Checklist", likesCount: 120, commentsCount: 8, timestamp: "2026-10-30T10:00:00.000Z" },
      { id: "2", type: "Video", url: "https://www.instagram.com/p/B/", caption: "Reel", likesCount: 50, commentsCount: 2, videoViewCount: 900, timestamp: "2026-10-20T10:00:00.000Z" },
    ] };
    expect(PUBLIC_READERS.Instagram.normalize(profile, ig).map((p) => [p.format, p.engagement, p.views, p.followers, p.capped])).toEqual([["carousel", 128, null, 3400, INSTAGRAM_LATEST], ["video", 52, 900, 3400, INSTAGRAM_LATEST]]);
    expect(PUBLIC_READERS.Instagram.normalize({ ...profile, username: "other" }, ig)).toEqual([]);
  });
});

describe("the figures", () => {
  it("gives posts a week over 90 days, median engagement of settled organic posts, rate per view on TikTok, and the newest follower count, client and competitors apart", () => {
    const p = (over: Partial<PublicPost>): PublicPost => ({ company: "BenchApp", client: false, platform: "TikTok", id: Math.random().toString(), publishedAt: "2026-10-20T00:00:00Z", text: "", link: null, format: "short_video", engagement: 10, views: 1000, followers: null, boosted: false, source: "feed", ...over });
    const out = figures([
      p({ engagement: 10, followers: 500, publishedAt: "2026-10-01T00:00:00Z" }), p({ engagement: 30, followers: 600 }), p({ engagement: 1000, boosted: true }),
      p({ company: "Acme", client: true, platform: "LinkedIn", views: null, engagement: 7 }),
      p({ publishedAt: "2026-07-01T00:00:00Z" }),
    ], NOW);
    const bench = out.find((f) => f.company === "BenchApp")!;
    expect(bench).toMatchObject({ posts: 3, posts_per_week: 0.23, median_engagement: 20, rate_per_view: 0.02, followers: 600 });
    expect(out.find((f) => f.client)).toMatchObject({ platform: "LinkedIn", posts: 1, rate_per_view: null, followers: null });
  });

  it("counts a read that reached its cap over the days it covers, not the whole 90", () => {
    const ig = (i: number): PublicPost => ({ company: "Acme", client: true, platform: "Instagram", id: `i${i}`, publishedAt: new Date(NOW.getTime() - (2 + i * 2) * 86_400_000).toISOString(), text: "", link: null, format: "image", engagement: 10, views: null, followers: 3400, boosted: false, source: "apify", capped: 12 });
    // 12 posts over 24 days: 3.5 a week, not 0.93.
    expect(figures(Array.from({ length: 12 }, (_, i) => ig(i)), NOW)[0].posts_per_week).toBe(3.5);
    expect(figures(Array.from({ length: 11 }, (_, i) => ig(i)), NOW)[0].posts_per_week).toBe(0.86);
  });
});

describe("a read across runs", () => {
  const run = (id: string, status: ApifyRun["status"]): ApifyRun => ({ id, status, defaultDatasetId: `ds-${id}`, usageTotalUsd: 0.04 });
  function apify(states: Record<string, ApifyRun["status"]>, rows: Record<string, unknown[]>) {
    const started: Array<{ actor: string; input: unknown }> = [];
    let n = 0;
    const client: ApifyClient = {
      startRun: async (actor, input) => { started.push({ actor, input }); return run(`r${++n}`, "RUNNING"); },
      getRun: async (id) => run(id, states[id] ?? "RUNNING"),
      datasetPage: async () => [],
      datasetItems: async (ds) => rows[ds] ?? [],
    };
    return { client, started };
  }
  const targets = [{ company: "Acme", client: true, platform: "TikTok", url: "https://www.tiktok.com/@acme" }];
  const row = { id: "1", postPage: "https://www.tiktok.com/@acme/video/1", uploadedAtFormatted: "2026-10-30T10:00:00.000Z", views: 100, likes: 5, comments: 1, shares: 0, channel: { username: "acme", followers: 50 } };

  it("starts the runs, waits while they run, then keeps their posts", async () => {
    const a = apify({}, { "ds-r1": [row] });
    let s = await stepRead(null, targets, () => a.client, NOW);
    expect(s.status).toBe("reading");
    expect(a.started).toHaveLength(1);
    s = await stepRead(JSON.parse(JSON.stringify(s)), targets, () => a.client, new Date(NOW.getTime() + 60_000));
    expect(s.status).toBe("reading");
    const done = apify({ r1: "SUCCEEDED" }, { "ds-r1": [row] });
    s = await stepRead(s, targets, () => done.client, new Date(NOW.getTime() + 300_000));
    expect(s).toMatchObject({ status: "done", key: targetsKey(targets) });
    expect(s.posts.map((p) => [p.company, p.client, p.engagement])).toEqual([["Acme", true, 6]]);
    expect(s.runs[0]).toMatchObject({ status: "SUCCEEDED", usd: 0.04 });
    expect(done.started).toHaveLength(0);
  });

  it("is reused for 7 days for the same profiles, and read again after, or when the profiles change", async () => {
    const done: PublicReadState = { key: targetsKey(targets), status: "done", started_at: NOW.toISOString(), read_at: NOW.toISOString(), window: { start: "2026-08-05", end: "2026-11-03" }, runs: [], posts: [] };
    const a = apify({}, {});
    expect(await stepRead(done, targets, () => a.client, new Date(NOW.getTime() + 6 * 86_400_000))).toBe(done);
    expect(a.started).toHaveLength(0);
    expect((await stepRead(done, targets, () => a.client, new Date(NOW.getTime() + 8 * 86_400_000))).status).toBe("reading");
    expect((await stepRead(done, [...targets, { ...targets[0], company: "BenchApp", client: false, url: "https://www.tiktok.com/@benchapp" }], () => a.client, NOW)).status).toBe("reading");
  });

  it("needs no run with nothing to read, and goes on without public posts when Apify cannot run", async () => {
    expect(await stepRead(null, [], () => null, NOW)).toMatchObject({ status: "done", runs: [], posts: [] });
    expect(await stepRead(null, targets, () => null, NOW)).toMatchObject({ status: "done", posts: [], skipped: "no_token" });
  });

  it("leaves out a run that failed, and one that has not ended after an hour", async () => {
    const a = apify({}, {});
    const s = await stepRead(null, targets, () => a.client, NOW);
    const failed = apify({ r1: "FAILED" }, {});
    expect(await stepRead(s, targets, () => failed.client, new Date(NOW.getTime() + 300_000))).toMatchObject({ status: "done", posts: [] });
    const stuck = apify({ r1: "RUNNING" }, {});
    expect((await stepRead(s, targets, () => stuck.client, new Date(NOW.getTime() + 2 * 3_600_000))).status).toBe("done");
  });
});

describe("what the read is made from", () => {
  it("takes the client's profiles but the removed ones, the competitors' active profiles, RivalIQ's records and the Sprout platforms", async () => {
    const db = fakeDb({
      client_public_profiles: [
        { client_id: "c1", platform: "tiktok", handle: "acme", url: null, source: "website" },
        { client_id: "c1", platform: "instagram", handle: "acme", url: null, source: "removed" },
      ],
      sprout_profiles: [{ client_id: "c1", network_type: "linkedin_company", is_active: true }],
      competitor_sets: [{ id: "s1", client_id: "c1", status: "confirmed", confirmed_at: "2026-10-01", created_at: "2026-10-01" }],
      competitors: [{ id: "k1", set_id: "s1", name: "BenchApp", is_selected: true }],
      competitor_handles: [
        { competitor_id: "k1", platform: "tiktok", handle: "benchapp", profile_url: null, is_active: true, source: "rivaliq" },
        { competitor_id: "k1", platform: "linkedin", handle: "benchapp", profile_url: null, is_active: true, source: "website" },
        { competitor_id: "k1", platform: "x", handle: "benchapp", profile_url: null, is_active: true, source: "rejected" },
      ],
    });
    const got = await readInputs(db, { id: "c1", name: "Acme" }, { client_company: { handles: [{ platform: "instagram", handle: "acme" }] } });
    expect(got.profiles.map((p) => `${p.company} ${p.platform}`)).toEqual(["Acme tiktok", "BenchApp tiktok", "BenchApp linkedin"]);
    expect([...got.tracked].sort()).toEqual(["acme|Instagram", "benchapp|TikTok"]);
    expect([...got.sprout]).toEqual(["LinkedIn"]);
  });
});
