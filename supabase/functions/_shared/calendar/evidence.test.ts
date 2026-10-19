import { describe, it, expect } from "vitest";
import { applyRhythmSetting, bestExamples, isBoosted, median, numberEvidence, platformName, rhythmFromPosts, scoreCompetitorPosts, scoreOwnPosts, type CompetitorPost, type OwnPost } from "./evidence";

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
    expect(r[0]).toMatchObject({ platform: "LinkedIn", perWeek: 2, days: ["Tuesday", "Thursday"], time: "09:00", source: "published" });
  });

  it("lets the staff setting raise, add or remove a platform", () => {
    const learned = [{ platform: "LinkedIn", perWeek: 2, days: ["Tuesday"], time: "09:00", average: 2, source: "published" as const }];
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
