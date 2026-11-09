// Report insights from the data (Lital, 3 Nov 2026): what a report says is
// decided in code from the figures it shows, the same every time.

import { describe, expect, it } from "vitest";
import { competitiveChanges, competitiveFacts, keepChanges, periodWords, socialChanges, socialFacts } from "../../../functions/_shared/reports/facts";
import { competitiveFigures } from "../../../functions/_shared/reports/reportText";

const platform = (network: string, current: Record<string, number>, previous: Record<string, number>, posts: number, previousPosts: number) => ({
  network, current, previous, post_count: posts, previous_post_count: previousPosts, has_previous: true,
});

/** A monthly report as both engines store it: Sprout's totals, per platform and overall, and its top posts. */
function social(over: { impressions?: number; previousImpressions?: number; shuffle?: boolean; extra?: Record<string, unknown> } = {}) {
  const li = platform("LinkedIn", { engagements: 521, impressions: 5476, video_views: 198 }, { engagements: 649, impressions: 7725, video_views: 442 }, 11, 12);
  const ig = platform("Instagram", { engagements: 20, impressions: over.impressions ?? 1800, video_views: 90 }, { engagements: 12, impressions: over.previousImpressions ?? 1500, video_views: 120 }, 2, 3);
  const fb = platform("Facebook", { engagements: 1, impressions: 74, video_views: 4 }, { engagements: 12, impressions: 199, video_views: 13 }, 1, 2);
  const breakdown = over.shuffle ? [fb, ig, li] : [li, ig, fb];
  const posts = [
    { permalink: "https://linkedin.com/p/1", network_type: "LINKEDIN", content_category: "DOCUMENT", engagements: 210, impressions: 463 },
    { permalink: "https://instagram.com/p/2", network_type: "FB_INSTAGRAM_ACCOUNT", content_category: "VIDEO", engagements: 9, impressions: 400 },
    { permalink: "https://linkedin.com/p/3", network_type: "LINKEDIN", content_category: "TEXT", engagements: 30, impressions: 300 },
  ];
  return [{
    ...(over.extra ?? {}),
    sprout_performance: {
      month_comparison: {
        current_month: { engagements: 542, impressions: 5476 + (over.impressions ?? 1800) + 74, video_views: 292 },
        previous_month: { engagements: 673, impressions: 7725 + (over.previousImpressions ?? 1500) + 199, video_views: 575 },
      },
      platform_breakdown: breakdown,
      top_posts: over.shuffle ? [...posts].reverse() : posts,
    },
  }];
}

describe("socialFacts", () => {
  it("gives the same facts and ids for the same report, read twice or with its arrays in another order", () => {
    const a = socialFacts(social(), { period: { start: "2026-09-01", end: "2026-09-30" } });
    expect(a.length).toBeGreaterThan(4);
    expect(socialFacts(social(), { period: { start: "2026-09-01", end: "2026-09-30" } })).toEqual(a);
    expect(socialFacts(social({ shuffle: true }), { period: { start: "2026-09-01", end: "2026-09-30" } })).toEqual(a);
  });

  it("matches for an n8n report and an in-app report with the same figures", () => {
    const n8n = social({ extra: { warnings: [], gamma_url: "https://gamma.app/x", report_sections: ["a"] } });
    const app = social({ extra: { data_counts: { posts: 14 }, engine: "social_v1" } });
    expect(socialFacts(app)).toEqual(socialFacts(n8n));
  });

  it("writes each change with its numbers from the report, overall and per platform", () => {
    const views = socialChanges(social(), { start: "2026-09-01", end: "2026-09-30" }).find((f) => f.key === "change|all|views|")!;
    expect(views).toMatchObject({ kind: "change", value: 292, previous: 575, change: -283, percent: -49.2 });
    expect(views.sentence).toBe("Video views fell 49.2% to 292.");
    expect(views.basis).toBe("Video views 292 in September against 575 in August, -49.2%");
    expect(views.sources).toEqual(["sprout"]);
    expect(views.numbers).toEqual(expect.arrayContaining([292, 575, 283, 49.2]));
  });

  it("keeps the five largest changes without three earlier reports", () => {
    const changes = socialFacts(social()).filter((f) => f.kind === "change");
    expect(changes).toHaveLength(5);
    const all = socialChanges(social()).map((c) => Math.abs(c.percent!)).sort((a, b) => b - a);
    expect(changes.map((c) => Math.abs(c.percent!)).sort((a, b) => b - a)).toEqual(all.slice(0, 5));
  });

  it("keeps a change only when it is bigger than the client's usual swing in that metric once it has three earlier reports", () => {
    // Instagram impressions usually move about 20%; this month's 20% is no finding, 60% is.
    const history = [10, 20, 30].map((p) => [{ key: "change|Instagram|impressions|", percent: p }, { key: "change|all|views|", percent: -80 }]);
    const usual = socialFacts(social({ impressions: 1800, previousImpressions: 1500 }), { history });
    expect(usual.find((f) => f.key === "change|Instagram|impressions|")).toBeUndefined();
    const big = socialFacts(social({ impressions: 2400, previousImpressions: 1500 }), { history });
    expect(big.find((f) => f.key === "change|Instagram|impressions|")).toMatchObject({ percent: 60, usual: 20 });
    // Views fell 49%, inside their usual 80% swing.
    expect(big.find((f) => f.key === "change|all|views|")).toBeUndefined();
  });

  it("finds the platforms' shares and a post far above its platform's usual per post", () => {
    const facts = socialFacts(social());
    expect(facts.find((f) => f.key === "share|LinkedIn|engagements|")).toMatchObject({ value: 96.1, total: 542 });
    const outlier = facts.find((f) => f.kind === "outlier")!;
    expect(outlier).toMatchObject({ platform: "LinkedIn", value: 210, usual: 47.4, multiple: 4.4, link: "https://linkedin.com/p/1", format: "document" });
    expect(outlier.sentence).toBe("A LinkedIn document post got 210 engagements, 4.4x the platform's usual per post.");
    expect(facts.filter((f) => f.kind === "outlier")).toHaveLength(1);
  });

  it("names a post's type as the screens label it, with the right article, when its category is empty", () => {
    const posts = [
      { permalink: "https://www.instagram.com/reel/9", network_type: "FB_INSTAGRAM_ACCOUNT", post_type: "INSTAGRAM_MEDIA", content_category: "", engagements: 90, impressions: 900 },
      { permalink: "https://linkedin.com/p/8", network_type: "LINKEDIN", post_type: "LINKEDIN_COMPANY_UPDATE", engagements: 400, impressions: 900 },
    ];
    const rd = social();
    rd[0].sprout_performance.top_posts = posts as never;
    const outliers = socialFacts(rd).filter((f) => f.kind === "outlier");
    expect(outliers.map((f) => f.sentence).sort()).toEqual([
      "A LinkedIn image post got 400 engagements, 8.3x the platform's usual per post.",
      "An Instagram video post got 90 engagements, 8.3x the platform's usual per post.",
    ]);
    for (const f of outliers) expect(f.sentence + f.basis).not.toMatch(/instagram media|company update|_/i);
  });

  it("keeps data vendors out of every fact's words and carries them as data", () => {
    const facts = [...socialChanges(social(), { start: "2026-09-01", end: "2026-09-30" }), ...socialFacts(social())];
    expect(facts.some((f) => f.metric === "engagement_rate")).toBe(true);
    for (const f of facts) {
      expect(`${f.sentence} ${f.basis}`).not.toMatch(/Sprout|Rival ?IQ|Apify|Gamma/i);
      expect(f.sources).toEqual(["sprout"]);
    }
    expect(facts.find((f) => f.metric === "engagement_rate")!.sentence).toMatch(/^Engagement rate (rose|fell) /);
  });

  it("numbers facts by score, then by a fixed key, and never past twenty", () => {
    const facts = socialFacts(social());
    expect(facts.map((f) => f.id)).toEqual(facts.map((_, i) => `F${i + 1}`));
    for (let i = 1; i < facts.length; i++) expect(facts[i - 1].score).toBeGreaterThanOrEqual(facts[i].score);
    expect(facts.length).toBeLessThanOrEqual(20);
  });
});

/** A competitive report: three companies, the client among them, with RivalIQ's period totals as the screens read them. */
function competitive(order: "a" | "b" = "a") {
  const pair = (current: number, previous: number) => ({ current, previous });
  const company = (name: string, is_client: boolean, posts: number, engagement: [number, number], impressions: number, audience: [number, number], top: number) => ({
    name, is_client, post_count: posts,
    rivaliq_metrics: {
      period: { start: "2026-09-01", end: "2026-09-30" },
      posts: pair(posts, posts - 2), engagement: pair(...engagement), audience: pair(...audience), estimated_impressions: pair(impressions, impressions),
      by_network: { instagram: { posts: pair(posts, posts - 2), engagement: pair(...engagement), impressions: pair(impressions, impressions), followers: pair(...audience) } },
    },
    by_channel: { instagram: { post_count: posts, top_posts: [{ url: `https://ig/${name}`, engagement: top, media_type: "REEL", text: "A reel", channel: "instagram" }] } },
  });
  const companies = [
    company("Moburst", true, 14, [620, 673], 200000, [14900, 14700], 60),
    company("Rival Co", false, 30, [21000, 18000], 1000000, [680000, 650000], 7000),
    company("Other App", false, 20, [1200, 1100], 200000, [32000, 31000], 70),
  ];
  return { period: { start: "2026-09-01", end: "2026-09-30" }, aggregates: { metric_semantics_version: 4, period: { start: "2026-09-01", end: "2026-09-30", days: 30 }, companies: order === "a" ? companies : [...companies].reverse() } };
}

describe("competitiveFacts", () => {
  it("ranks the client on each comparison metric with the leader and the set's median, the same in any order", () => {
    const facts = competitiveFacts(competitive());
    expect(competitiveFacts(competitive("b"))).toEqual(facts);
    // The figures the screens show (competitiveFigures "shown"): the facts carry exactly those.
    const shown = new Map(competitiveFigures(competitive(), "shown").map((f) => [f.key, f.value]));
    const rateOf = (c: string) => shown.get(`${c}|all|engagement_rate|current`)!;
    expect(rateOf("Moburst")).toBeLessThan(rateOf("Other App"));
    const rate = facts.find((f) => f.key === "ranking|all|compared_rate|Moburst")!;
    expect(rate).toMatchObject({ rank: 3, of: 3, leader: "Rival Co", value: rateOf("Moburst"), leaderValue: rateOf("Rival Co"), median: rateOf("Other App") });
    expect(rate.sentence).toMatch(/^Moburst ranks 3rd of 3 on engagement rate compared on likes, comments and shares with [\d.]+%, against Rival Co's [\d.]+%\.$/);
    expect(rate.basis).not.toMatch(/Sprout|Rival ?IQ/);
    expect(rate.sources).toEqual(["sprout", "rivaliq"]);
    expect(facts.find((f) => f.key === "ranking|all|followers|Moburst")).toMatchObject({ rank: 3, leader: "Rival Co", value: 14900, leaderValue: 680000, median: 32000 });
  });

  it("finds a competitor's post far above its usual per post", () => {
    const facts = competitiveFacts(competitive());
    const outlier = facts.find((f) => f.kind === "outlier" && f.company === "Rival Co")!;
    expect(outlier).toMatchObject({ platform: "instagram", value: 7000, usual: 700, multiple: 10, format: "video", sources: ["rivaliq"] });
    expect(outlier.sentence).toBe("An Instagram video post by Rival Co got 7,000 engagements, 10x its usual per post.");
    for (const f of facts) expect(`${f.sentence} ${f.basis}`).not.toMatch(/Sprout|Rival ?IQ|Apify|Gamma/i);
  });

  it("gives the client's changes, filtered like the monthly report's", () => {
    expect(competitiveChanges(competitive()).map((c) => c.key).sort()).toEqual(["change|all|engagements|Moburst", "change|all|followers|Moburst", "change|all|posts|Moburst"]);
    expect(competitiveFacts({ aggregates: { companies: [] } })).toEqual([]);
  });
});

describe("keepChanges and periodWords", () => {
  it("scores a kept change by how far past the usual it is", () => {
    const d = { key: "change|all|views|", kind: "change" as const, platform: "all", metric: "views", unit: "count" as const, value: 1, percent: -40, score: 0, numbers: [], sentence: "", basis: "" };
    const history = [[{ key: d.key, percent: 10 }], [{ key: d.key, percent: -20 }], [{ key: d.key, percent: 30 }]];
    expect(keepChanges([d], history)).toEqual([expect.objectContaining({ usual: 20, score: 2 })]);
  });

  it("names a calendar month and the one before, and otherwise the period", () => {
    expect(periodWords({ start: "2026-09-01", end: "2026-09-30" })).toEqual({ now: "September", before: "August" });
    expect(periodWords({ start: "2026-01-01", end: "2026-01-31" })).toEqual({ now: "January", before: "December" });
    expect(periodWords({ start: "2026-09-05", end: "2026-10-04" })).toEqual({ now: "this period", before: "the period before" });
  });
});
