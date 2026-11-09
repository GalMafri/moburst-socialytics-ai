// @vitest-environment node
// Brand new or set up, decided from data (spec: docs/superpowers/specs/2026-
// 11-02-content-strategy-tab-design.md): each platform's state from the
// client's own posts, its chosen platforms, its Sprout accounts and the trend
// profile; cadence from the calendar's own rhythm and its fallbacks; and the
// baselines a strategy's targets are stated against.
import { describe, expect, it } from "vitest";
import { baselineOf, platformKey, platformSectionKey, platformStates, type PlatformInput } from "../../../functions/_shared/strategy/platforms";
import type { OwnPost, RhythmLine } from "../../../functions/_shared/calendar/evidence";

const NOW = new Date("2026-11-02T10:00:00.000Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const post = (platform: string, days: number, over: Partial<OwnPost> = {}): OwnPost => ({
  id: `${platform}-${days}-${Math.random()}`, platform, format: "image", publishedAt: ago(days), text: "A post", link: null, impressions: null, engagement: 10, ...over,
});
const line = (platform: string, average: number, source: RhythmLine["source"] = "published_8w", perWeek = Math.round(average)): RhythmLine =>
  ({ platform, perWeek, days: [], time: null, average, source });

const input = (over: Partial<PlatformInput> = {}): PlatformInput => ({
  own: [], now: NOW, primary: [], primarySet: true, accounts: [], profile: [], rhythm: [],
  rates: { competitors: {}, allTracked: {} }, ...over,
});

describe("each platform's state, from data", () => {
  it("is posting now where the client published in the last 90 days, by its own posts", () => {
    const { platforms } = platformStates(input({ own: [post("Instagram", 3), post("Instagram", 40), post("Facebook", 80)], primary: ["Instagram", "Facebook"] }));
    expect(platforms.map((p) => [p.platform, p.state])).toEqual([["Instagram", "posting"], ["Facebook", "posting"]]);
  });

  it("is new for a chosen platform or an active Sprout account with no posts in 90 days, and names a quiet account's handle", () => {
    const { platforms } = platformStates(input({
      own: [post("Instagram", 5)],
      primary: ["Instagram", "TikTok"],
      accounts: [{ network_type: "linkedin_company", native_name: "moburst" }, { network_type: "fb_instagram_account", native_name: "moburst.agency" }],
    }));
    expect(platforms.map((p) => [p.platform, p.state, p.handle])).toEqual([
      ["Instagram", "posting", "moburst.agency"],
      ["TikTok", "new", null],
      ["LinkedIn", "new", "moburst"],
    ]);
    // A post older than 90 days does not make a platform posting now.
    const quiet = platformStates(input({ own: [post("TikTok", 120)], primary: ["TikTok"] })).platforms;
    expect(quiet.map((p) => p.state)).toEqual(["new"]);
  });

  it("offers the trend profile's other platforms as candidates, with the profile's reason", () => {
    const { platforms } = platformStates(input({
      own: [post("Instagram", 5)], primary: ["Instagram"],
      profile: [{ platform: "instagram", reason: "primary" }, { platform: "pinterest", reason: "Recipe searches start there." }],
    }));
    expect(platforms.map((p) => [p.platform, p.state, p.profile_reason])).toEqual([["Instagram", "posting", "primary"], ["Pinterest", "candidate", "Recipe searches start there."]]);
  });

  it("gives a client with nothing the profile's whole list, since platforms nobody chose are no choice", () => {
    const { platforms } = platformStates(input({
      primary: ["Instagram", "TikTok", "Facebook", "LinkedIn"], primarySet: false,
      profile: [{ platform: "tiktok", reason: "a" }, { platform: "instagram", reason: "b" }, { platform: "youtube", reason: "c" }],
    }));
    expect(platforms.map((p) => [p.platform, p.state])).toEqual([["TikTok", "candidate"], ["Instagram", "candidate"], ["YouTube", "candidate"]]);
  });

  it("names platforms one way whatever the source wrote", () => {
    const { platforms } = platformStates(input({ primary: ["Twitter/X"], accounts: [{ network_type: "twitter", native_name: "brand" }] }));
    expect(platforms).toHaveLength(1);
    expect(platforms[0]).toMatchObject({ platform: "X", key: "x", state: "new", handle: "brand" });
    expect(platformKey("YouTube")).toBe("youtube");
    expect(platformSectionKey("Twitter/X", "posting")).toBe("platform:x:posting");
  });
});

describe("cadence", () => {
  it("is the calendar's own rhythm wherever the calendar has a line, a setting as set", () => {
    const { platforms } = platformStates(input({
      own: [post("Instagram", 5), post("Facebook", 6)], primary: ["Instagram", "Facebook"],
      rhythm: [line("Instagram", 2.4), line("Facebook", 1, "setting", 3)],
    }));
    expect(platforms.map((p) => [p.platform, p.cadence])).toEqual([
      ["Instagram", { per_week: 2.4, source: "published_8w" }],
      ["Facebook", { per_week: 3, source: "setting" }],
    ]);
  });

  it("is a new platform's tracked competitors' median, else every tracked company's, else none", () => {
    const rates = { competitors: { TikTok: 3.5 }, allTracked: { TikTok: 2, LinkedIn: 1.25 } };
    const { platforms } = platformStates(input({ primary: ["TikTok", "LinkedIn", "Threads"], rates }));
    expect(platforms.map((p) => [p.platform, p.cadence])).toEqual([
      ["TikTok", { per_week: 3.5, source: "competitors" }],
      ["LinkedIn", { per_week: 1.25, source: "all_tracked" }],
      ["Threads", null],
    ]);
  });

  it("asks for every tracked company's rates only when a platform needs them", () => {
    expect(platformStates(input({ primary: ["TikTok"], rates: { competitors: { TikTok: 2 }, allTracked: null } })).needsAllTracked).toBe(false);
    expect(platformStates(input({ primary: ["TikTok"], rates: { competitors: {}, allTracked: null } })).needsAllTracked).toBe(true);
  });
});

describe("baselines", () => {
  it("counts posts per week over 90 days, and median engagement and engagement per impression over settled organic posts", () => {
    const posts = [
      post("Instagram", 1, { engagement: 900, impressions: 1000 }), // not settled: counts toward posts per week only
      post("Instagram", 5, { engagement: 10, impressions: 200 }),
      post("Instagram", 10, { engagement: 30, impressions: 600 }),
      post("Instagram", 20, { engagement: 50, impressions: null }),
      post("Instagram", 30, { engagement: 5000, impressions: 90000, boosted: true }), // paid: left out of the measures
      post("Instagram", 100, { engagement: 1 }), // older than 90 days
      post("Facebook", 5, { engagement: 2 }),
    ];
    expect(baselineOf(posts, "Instagram", NOW)).toEqual({ posts: 5, posts_per_week: 0.39, median_engagement: 30, engagement_rate: 0.05 });
    expect(baselineOf([post("TikTok", 1, { engagement: 4 })], "TikTok", NOW)).toEqual({ posts: 1, posts_per_week: 0.08, median_engagement: null, engagement_rate: null });
  });

  it("is on every posting platform and on no other", () => {
    const { platforms } = platformStates(input({ own: [post("Instagram", 5)], primary: ["Instagram", "TikTok"] }));
    expect(platforms.find((p) => p.platform === "Instagram")?.baseline).toMatchObject({ posts: 1 });
    expect(platforms.find((p) => p.platform === "TikTok")?.baseline).toBeNull();
  });
});
