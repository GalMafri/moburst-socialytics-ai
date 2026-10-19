import { describe, it, expect } from "vitest";
import {
  applyRhythmSetting, bestExamples, compactFeedRow, competitorPosts, feedHistories, isBoosted, median, medianRates, numberEvidence, platformName, postsInWeek,
  resolveRhythm, rhythmFromPosts, scoreCompetitorPosts, scoreOwnPosts, type CompetitorPost, type OwnPost, type RhythmInput, type TrackedPost,
} from "./evidence";

const NOW = new Date("2026-10-19T07:15:00Z");
const own = (id: string, platform: string, format: string, publishedAt: string, impressions: number | null, engagement = 10, text = `Post ${id} with enough words to count as an example`): OwnPost =>
  ({ id, platform, format, publishedAt, text, link: `https://x/${id}`, impressions, engagement });
const comp = (id: string, company: string, publishedAt: string, engagement: number, followers: number | null = 1000, boosted = false, platform = "Instagram"): CompetitorPost =>
  ({ id, company, platform, format: "video", publishedAt, text: `Competitor post ${id}`, link: `https://c/${id}`, engagement, followers, boosted });

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("isBoosted", () => {
  it("reads RivalIQ's text labels", () => {
    expect(isBoosted("Likely Boosted")).toBe(true);
    expect(isBoosted("Not Likely Boosted")).toBe(false);
    expect(isBoosted("No Prediction")).toBe(false);
    expect(isBoosted(undefined)).toBe(false);
    expect(isBoosted(true)).toBe(true);
  });
});

describe("platformName", () => {
  it("maps Sprout and RivalIQ network names to the calendar's names", () => {
    expect(platformName("fb_instagram_account")).toBe("Instagram");
    expect(platformName("linkedin_company")).toBe("LinkedIn");
    expect(platformName("twitter")).toBe("X");
    expect(platformName("Twitter/X")).toBe("X");
    expect(platformName("tiktok")).toBe("TikTok");
  });
});

describe("scoreOwnPosts", () => {
  const posts = [
    own("a", "LinkedIn", "carousel", "2026-10-01T10:00:00Z", 1000, 10),
    own("b", "LinkedIn", "carousel", "2026-10-03T10:00:00Z", 1200, 12),
    own("c", "LinkedIn", "carousel", "2026-10-05T10:00:00Z", 3000, 40),
    own("d", "LinkedIn", "carousel", "2026-10-07T10:00:00Z", 800, 8),
    own("e", "LinkedIn", "carousel", "2026-10-09T10:00:00Z", 1100, 11),
    // Not settled yet: posted 12 hours ago.
    own("f", "LinkedIn", "carousel", "2026-10-18T19:00:00Z", 9000, 90),
    // Too old: more than 90 days.
    own("g", "LinkedIn", "carousel", "2026-06-01T10:00:00Z", 9000, 90),
  ];

  it("ranks settled posts against the client's own median, by the lower of reach and engagement", () => {
    const { top, low, platforms } = scoreOwnPosts(posts, NOW);
    expect(top[0].post.id).toBe("c");
    // Impressions 3001/1101 = 2.7x is lower than engagement 41/12 = 3.4x, so impressions is the figure shown.
    expect(top[0]).toMatchObject({ metric: "impressions", median: 1100, multiple: 2.7 });
    expect(top.map((s) => s.post.id)).not.toContain("f");
    expect(top.map((s) => s.post.id)).not.toContain("g");
    expect(low[0].post.id).toBe("d");
    expect(platforms.LinkedIn).toEqual({ posts: 5, thin: false });
  });

  it("can't be topped by paid reach: an ad's views don't lift it above its engagement", () => {
    const ad = own("ad", "LinkedIn", "carousel", "2026-10-06T10:00:00Z", 596000, 12);
    const boosted = { ...own("boost", "LinkedIn", "carousel", "2026-10-08T10:00:00Z", 50000, 400), boosted: true };
    const { top } = scoreOwnPosts([...posts, ad, boosted], NOW);
    expect(top[0].post.id).toBe("c");
    // 596,000 impressions, but engagement at its usual level: it doesn't beat the client's usual at all.
    expect(top.map((s) => s.post.id)).not.toContain("ad");
    expect(top.map((s) => s.post.id)).not.toContain("boost");
  });

  it("uses engagement where the platform does not report impressions, and flags thin history", () => {
    const { top, platforms } = scoreOwnPosts([
      own("t1", "TikTok", "video", "2026-10-01T10:00:00Z", null, 4),
      own("t2", "TikTok", "video", "2026-10-02T10:00:00Z", null, 20),
      own("t3", "TikTok", "video", "2026-10-03T10:00:00Z", null, 5),
    ], NOW);
    expect(top[0]).toMatchObject({ metric: "engagement", multiple: 3.5, thin: true });
    expect(platforms.TikTok.thin).toBe(true);
  });

  it("keeps a near-zero usual from producing an absurd multiple", () => {
    const { top } = scoreOwnPosts([0, 0, 0, 1, 30].map((eng, i) => own(`z${i}`, "Instagram", "image", `2026-10-0${i + 1}T10:00:00Z`, null, eng)), NOW);
    expect(top[0].multiple).toBe(31);
  });
});

describe("scoreCompetitorPosts", () => {
  const history = [
    comp("h1", "BenchApp", "2026-09-20T10:00:00Z", 10),
    comp("h2", "BenchApp", "2026-09-27T10:00:00Z", 12),
    comp("h3", "BenchApp", "2026-10-04T10:00:00Z", 8),
    comp("h4", "BenchApp", "2026-10-08T10:00:00Z", 10),
    comp("n1", "BenchApp", "2026-10-14T10:00:00Z", 40),
    comp("n2", "BenchApp", "2026-10-15T10:00:00Z", 900, 1000, true),
    comp("n3", "BenchApp", "2026-10-16T10:00:00Z", 9),
  ];

  it("keeps the newest week's posts that beat the competitor's own median per follower, without boosted posts", () => {
    const out = scoreCompetitorPosts(history, "2026-10-12", 5);
    expect(out.map((s) => s.post.id)).toEqual(["n1"]);
    expect(out[0].metric).toBe("engagement per follower");
    expect(out[0].multiple).toBe(4);
    expect(out[0].thin).toBe(false);
  });

  it("calls a competitor with under four stored weeks an early signal", () => {
    expect(scoreCompetitorPosts(history, "2026-10-12", 1)[0].thin).toBe(true);
  });

  it("leaves out posts with no date or no text", () => {
    const out = scoreCompetitorPosts([...history, { ...comp("x1", "BenchApp", "null", 400), publishedAt: "null" }, { ...comp("x2", "BenchApp", "2026-10-15T10:00:00Z", 400), text: "" }], "2026-10-12", 5);
    expect(out.map((s) => s.post.id)).toEqual(["n1"]);
  });

  it("falls back to raw engagement when followers are missing", () => {
    const out = scoreCompetitorPosts(history.map((p) => ({ ...p, followers: null })), "2026-10-12", 5);
    expect(out[0].metric).toBe("engagement");
  });
});

describe("rhythmFromPosts", () => {
  it("counts posts per week over the last eight full weeks, with usual days and hour", () => {
    const posts: OwnPost[] = [];
    // LinkedIn twice a week (Tuesday and Thursday 09:00 New York) for 8 weeks; Facebook three times in total.
    for (let w = 0; w < 8; w++) {
      const tue = new Date(Date.parse("2026-08-25T13:00:00Z") + w * 7 * 86400_000).toISOString();
      const thu = new Date(Date.parse("2026-08-27T13:00:00Z") + w * 7 * 86400_000).toISOString();
      posts.push(own(`l${w}a`, "LinkedIn", "image", tue, 100), own(`l${w}b`, "LinkedIn", "image", thu, 100));
    }
    posts.push(own("f1", "Facebook", "image", "2026-09-01T13:00:00Z", 10), own("f2", "Facebook", "image", "2026-09-15T13:00:00Z", 10), own("f3", "Facebook", "image", "2026-10-06T13:00:00Z", 10));
    // This week's post doesn't count.
    posts.push(own("now", "LinkedIn", "image", "2026-10-19T05:00:00Z", 100));
    const r = rhythmFromPosts(posts, NOW, "America/New_York");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ platform: "LinkedIn", perWeek: 2, days: ["Tuesday", "Thursday"], time: "09:00", source: "published_8w" });
  });

  it("lets the staff setting raise, add or remove a platform", () => {
    const learned = [{ platform: "LinkedIn", perWeek: 2, days: ["Tuesday"], time: "09:00", average: 2, source: "published_8w" as const }];
    const out = applyRhythmSetting(learned, { linkedin: 4, instagram: 3, facebook: 0 });
    expect(out.find((l) => l.platform === "LinkedIn")).toMatchObject({ perWeek: 4, days: ["Tuesday"], source: "setting" });
    expect(out.find((l) => l.platform === "Instagram")).toMatchObject({ perWeek: 3, days: [], source: "setting" });
    expect(applyRhythmSetting(learned, { LinkedIn: 0 })).toEqual([]);
    expect(applyRhythmSetting(learned, null)).toBe(learned);
  });
});

describe("numberEvidence and bestExamples", () => {
  it("numbers each kind of evidence and keeps the real figures", () => {
    const { top } = scoreOwnPosts([
      own("a", "LinkedIn", "carousel", "2026-10-01T10:00:00Z", 1000, 10), own("b", "LinkedIn", "carousel", "2026-10-03T10:00:00Z", 1200, 12),
      own("c", "LinkedIn", "carousel", "2026-10-05T10:00:00Z", 3000, 40), own("d", "LinkedIn", "carousel", "2026-10-07T10:00:00Z", 800, 8),
      own("e", "LinkedIn", "carousel", "2026-10-09T10:00:00Z", 1100, 11),
    ], NOW);
    const items = numberEvidence({
      ownTop: top,
      competitors: scoreCompetitorPosts([comp("h1", "BenchApp", "2026-10-01T10:00:00Z", 10), comp("n1", "BenchApp", "2026-10-14T10:00:00Z", 40)], "2026-10-12", 4),
      topics: [{ topic: "Playoff scheduling", summary: "Two apps posted playoff reminders", companies: ["BenchApp", "TeamSnap"], post_urls: ["https://c/1"] }],
      trends: ["Captain-POV skits"],
      findings: ["LinkedIn drove most clicks"],
    });
    expect(items.map((i) => i.id)).toEqual(["P1", "P2", "C1", "T1", "N1", "R1"]);
    expect(items[0]).toMatchObject({ kind: "own", multiple: 2.7, median: 1100, metric: "impressions", date: "2026-10-05" });
    expect(items.find((i) => i.id === "T1")).toMatchObject({ companies: 2, link: "https://c/1" });
    expect(bestExamples(top).LinkedIn.map((x) => x.date)).toEqual(["2026-10-05", "2026-10-03"]);
  });
});

// ── The rhythm always resolves ──────────────────────────────────────────────

const DAY = 86400_000;
/** n posts on a platform spread over the days from one date, at 14:00 UTC (10:00 in New York in summer). */
const spread = (platform: string, n: number, from = "2026-08-24", days = 56): OwnPost[] =>
  Array.from({ length: n }, (_, i) => own(`${platform}-${from}-${i}`, platform, "image", new Date(Date.parse(`${from}T14:00:00Z`) + Math.floor((i * days) / n) * DAY).toISOString(), 100));
const tracked = (company: string, platform: string, n: number, from = "2026-08-03", days = 70, hourUtc = "21"): TrackedPost[] =>
  Array.from({ length: n }, (_, i) => ({ company, platform, publishedAt: new Date(Date.parse(`${from}T${hourUtc}:00:00Z`) + Math.floor((i * days) / n) * DAY).toISOString() }));
/** The medians across every company the app tracked on 19 Oct 2026. */
const ALL_TRACKED = { Facebook: 2.47, Instagram: 2.95, LinkedIn: 2.33, TikTok: 1.53, YouTube: 2.24 };

const input = (over: Partial<RhythmInput>): RhythmInput => ({
  own: [], primaryPlatforms: ["Instagram", "TikTok", "Facebook", "LinkedIn"], competitors: { weeks: 1, posts: [] }, allTracked: ALL_TRACKED,
  setting: null, monday: "2026-10-26", now: NOW, timeZone: "America/New_York", ...over,
});
const perWeek = (lines: Array<{ platform: string; perWeek: number }>) => Object.fromEntries(lines.map((l) => [l.platform, l.perWeek]));
const sources = (lines: Array<{ platform: string; source: string }>) => Object.fromEntries(lines.map((l) => [l.platform, l.source]));

describe("postsInWeek", () => {
  it("rounds a rate of one a week or more, at most 7", () => {
    expect(postsInWeek(2.875, "2026-10-26")).toBe(3);
    expect(postsInWeek(2.13, "2026-10-26")).toBe(2);
    expect(postsInWeek(21.88, "2026-10-26")).toBe(7);
    expect(postsInWeek(0, "2026-10-26")).toBe(0);
  });

  it("spreads a rate under one a week over the weeks by a fixed rule", () => {
    const weeks = (rate: number, n: number) => Array.from({ length: n }, (_, i) => postsInWeek(rate, new Date(Date.parse("2026-10-26T00:00:00Z") + i * 7 * DAY).toISOString().slice(0, 10)));
    // Week 42 since 5 Jan 2026 is 26 Oct.
    expect(weeks(0.5, 6)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(weeks(0.25, 8)).toEqual([0, 1, 0, 0, 0, 1, 0, 0]);
    expect(weeks(0.33, 12).reduce((a, b) => a + b, 0)).toBe(4);
    expect(weeks(0.23, 13).reduce((a, b) => a + b, 0)).toBe(3);
    // Stateless: the same week always gets the same answer, before the start date too.
    expect(postsInWeek(0.5, "2026-11-02")).toBe(postsInWeek(0.5, "2026-11-02"));
    expect([postsInWeek(0.5, "2025-12-29"), postsInWeek(0.5, "2026-01-05")]).toEqual([1, 0]);
  });
});

describe("resolveRhythm", () => {
  it("keeps Bader's learned rhythm from its last 8 weeks exactly (Facebook 7, YouTube 4, Instagram 3, LinkedIn 2, TikTok 2)", () => {
    const posts = [...spread("Facebook", 175), ...spread("YouTube", 32), ...spread("Instagram", 23), ...spread("LinkedIn", 17), ...spread("TikTok", 14)];
    for (const monday of ["2026-10-26", "2026-11-02", "2026-11-09"]) {
      const r = resolveRhythm(input({ own: posts, monday }));
      expect(perWeek(r.applied)).toEqual({ Facebook: 7, YouTube: 4, Instagram: 3, LinkedIn: 2, TikTok: 2 });
      expect(new Set(Object.values(sources(r.applied)))).toEqual(new Set(["published_8w"]));
      expect(perWeek(r.applied)).toEqual(perWeek(rhythmFromPosts(posts, NOW, "America/New_York")));
      expect(r.needsAllTracked).toBe(false);
      expect(r.sources.platforms).toBe("published_90d");
    }
  });

  it("keeps Moburst's LinkedIn 3 and Instagram 1, and posts its Facebook (0.25 a week) every fourth week", () => {
    const posts = [...spread("LinkedIn", 24), ...spread("Instagram", 8), ...spread("Facebook", 2)];
    const weeks = ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14"]
      .map((monday) => resolveRhythm(input({ own: posts, monday })));
    for (const r of weeks) expect(perWeek(r.applied)).toMatchObject({ LinkedIn: 3, Instagram: 1 });
    expect(weeks.map((r) => perWeek(r.applied).Facebook ?? 0)).toEqual([0, 1, 0, 0, 0, 1, 0, 0]);
    expect(weeks[0].learned.find((l) => l.platform === "Facebook")).toMatchObject({ average: 0.25, perWeek: 0, source: "published_8w" });
  });

  it("takes the 90-day rate for a platform with no posts in the last 8 weeks (Pay The Pyper's Facebook)", () => {
    const r = resolveRhythm(input({ own: [...spread("Facebook", 3, "2026-07-25", 25), ...spread("Instagram", 2)] }));
    expect(r.learned.find((l) => l.platform === "Facebook")).toMatchObject({ source: "published_90d", average: 0.23 });
    expect(r.learned.find((l) => l.platform === "Instagram")).toMatchObject({ source: "published_8w", average: 0.25 });
    // Only the platforms it posted on: its primary platforms are not added.
    expect(r.learned.map((l) => l.platform).sort()).toEqual(["Facebook", "Instagram"]);
  });

  it("uses the median of its competitors when it has no posts, with their usual days and hour in its time zone", () => {
    const competitors = { weeks: 10, posts: [...tracked("benchapp", "Instagram", 20), ...tracked("teamsnap", "Instagram", 10), ...tracked("teamsnap", "Facebook", 30)] };
    const r = resolveRhythm(input({ own: [], primaryPlatforms: ["instagram", "facebook"], competitors, allTracked: null }));
    expect(r.needsAllTracked).toBe(false);
    // BenchApp 2 a week, TeamSnap 1 a week: the median is 1.5, planned as 2.
    expect(r.learned.find((l) => l.platform === "Instagram")).toMatchObject({ source: "competitors", average: 1.5, perWeek: 2, time: "17:00" });
    expect(r.learned.find((l) => l.platform === "Facebook")).toMatchObject({ source: "competitors", average: 3 });
    expect(r.learned.find((l) => l.platform === "Instagram")?.days.length).toBeGreaterThan(0);
    expect(r.sources).toMatchObject({ platforms: "primary_platforms", competitor_weeks: 10, competitor_companies: 2 });
  });

  it("asks for every tracked company's rates only when a platform needs them, then uses them", () => {
    const competitors = { weeks: 10, posts: tracked("benchapp", "Instagram", 20) };
    const first = resolveRhythm(input({ primaryPlatforms: ["Instagram", "TikTok"], competitors, allTracked: null }));
    expect(first.needsAllTracked).toBe(true);
    const second = resolveRhythm(input({ primaryPlatforms: ["Instagram", "TikTok"], competitors }));
    expect(sources(second.learned)).toEqual({ Instagram: "competitors", TikTok: "all_tracked" });
    expect(perWeek(second.applied)).toEqual({ Instagram: 2, TikTok: 2 });
  });

  it("leaves out a platform no source has a rate for, and plans every tracked platform when nothing resolves", () => {
    const some = resolveRhythm(input({ primaryPlatforms: ["X", "Instagram"] }));
    expect(some.learned.map((l) => l.platform)).toEqual(["Instagram"]);
    expect(some.sources.unrated).toEqual(["X"]);
    const none = resolveRhythm(input({ primaryPlatforms: ["X"] }));
    expect(none.sources.platforms).toBe("all_tracked");
    expect(perWeek(none.applied)).toEqual({ Instagram: 3, Facebook: 2, LinkedIn: 2, TikTok: 2, YouTube: 2 });
    expect(resolveRhythm(input({ primaryPlatforms: [] })).applied).toHaveLength(5);
    expect(resolveRhythm(input({ primaryPlatforms: null, allTracked: null })).needsAllTracked).toBe(true);
  });

  it("lets staff's setting override a platform, add one or remove one, and leaves it optional", () => {
    const posts = [...spread("LinkedIn", 24), ...spread("Instagram", 8), ...spread("Facebook", 2)];
    const competitors = { weeks: 10, posts: tracked("benchapp", "TikTok", 20) };
    const r = resolveRhythm(input({ own: posts, competitors, setting: { linkedin: 5, instagram: 0, tiktok: 2, facebook: null } }));
    expect(perWeek(r.applied)).toEqual({ LinkedIn: 5, TikTok: 2 });
    expect(r.applied.find((l) => l.platform === "LinkedIn")).toMatchObject({ source: "setting", days: expect.any(Array) });
    // TikTok isn't one of its platforms; its usual days and hour come from the competitors.
    expect(r.applied.find((l) => l.platform === "TikTok")).toMatchObject({ source: "setting", time: "17:00" });
    // The learned rhythm is what the plan would follow without the setting.
    expect(perWeek(r.learned)).toMatchObject({ LinkedIn: 3, Instagram: 1 });
    expect(perWeek(resolveRhythm(input({ own: posts, setting: {} })).applied)).toEqual({ LinkedIn: 3, Instagram: 1 });
  });
});

describe("posting rates from the competitor feeds", () => {
  const post = (id: string, companyId: string, companyName: string, channel: string, publishedAt: string | null, extra: Record<string, unknown> = {}) =>
    ({ postId: id, companyId, companyName, channel, publishedAt, message: "Long text the rates never need", ...extra });
  const rows = [
    compactFeedRow({ client_id: "ptp", feed_window: { start: "2026-10-06", end: "2026-10-12" }, client_company_id: "1", posts: [
      post("a", "1", "Pay The Pyper", "instagram", "2026-10-07T15:00:00Z"),
      post("b", "2", "BenchApp", "instagram", "2026-10-08T15:00:00Z"),
      post("c", "3", "TeamSnap, Inc.", "facebook", "2026-10-09T15:00:00Z"),
      post("x", "3", "TeamSnap, Inc.", "twitter", null),
    ] }),
    // Overlaps the first window by three days; post b again.
    compactFeedRow({ client_id: "ptp", feed_window: { start: "2026-10-10", end: "2026-10-16" }, client_company_id: "1", posts: [
      post("b", "2", "BenchApp", "instagram", "2026-10-08T15:00:00Z"),
      post("d", "2", "BenchApp", "instagram", "2026-10-14T15:00:00Z"),
      post("e", "99", "Another Client's Rival", "instagram", "2026-10-14T15:00:00Z"),
    ] }),
    compactFeedRow({ client_id: "bader", feed_window: { start: "2026-10-06", end: "2026-10-19" }, client_company_id: "7", posts: [
      post("f", "8", "TeamSnap", "facebook", "2026-10-09T15:00:00Z"),
    ] }),
  ];

  it("keeps each post once, only with a date, and counts overlapping windows once", () => {
    expect(rows[0].posts[0]).not.toHaveProperty("message");
    const h = feedHistories(rows, { ptp: "Pay The Pyper" }).get("ptp")!;
    expect(h.weeks).toBeCloseTo(11 / 7);
    expect(h.posts).toHaveLength(5);
    expect(h.posts.find((p) => p.companyName === "Pay The Pyper")?.own).toBe(true);
    expect(h.posts.some((p) => p.platform === "X")).toBe(false);
  });

  it("counts only the companies in the client's competitor set, by RivalIQ id when stored and by name otherwise", () => {
    const h = feedHistories(rows, { ptp: "Pay The Pyper" }).get("ptp");
    const c = competitorPosts(h, [{ name: "Bench App LLC", rivaliq_company_id: "2" }, { name: "TeamSnap", rivaliq_company_id: null }]);
    expect(c.posts.map((p) => p.company).sort()).toEqual(["benchapp", "benchapp", "teamsnap"]);
    expect(competitorPosts(h, []).posts).toEqual([]);
  });

  it("takes the median across companies, each company once from the feed covering the most weeks", () => {
    const rates = medianRates([...feedHistories(rows).values()]);
    // TeamSnap is in both clients' feeds: counted once, from Bader's two weeks (1 post, 0.5 a week).
    expect(rates.Facebook).toBe(0.5);
    expect(rates.Instagram).toBeGreaterThan(0);
    expect(medianRates([{ weeks: 2, posts: [...tracked("a", "LinkedIn", 2), ...tracked("b", "LinkedIn", 6), ...tracked("c", "LinkedIn", 10)] }])).toEqual({ LinkedIn: 3 });
  });
});
