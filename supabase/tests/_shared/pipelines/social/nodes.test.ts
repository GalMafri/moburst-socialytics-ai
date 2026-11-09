// @vitest-environment node
// The report is client-facing: what it says about a missing brief states the
// fact and never tells anyone what to do; with no stored trends it says
// nothing about trends at all.
import { describe, expect, it } from "vitest";
import { buildPresentationContent, generateRunSummary, prepareBriefText } from "../../../../functions/_shared/pipelines/social/nodes";

// deno-lint-ignore no-explicit-any
type Any = any;

const INSTRUCTION = /client setup|\bAdd\b|\bpaste\b|\bUse a\b/i;

describe("Prepare Brief Text", () => {
  it("says the linked brief could not be read, with what was used instead, and no instruction", () => {
    const withSaved = prepareBriefText({ brief_file_id: "f1", brief_text: "Saved brief." }, { text: "" });
    expect(withSaved.brief_warning).toBe("The linked brief could not be read. The saved brief text was used instead.");
    const withNone = prepareBriefText({ brief_file_id: "f1", brief_text: "" }, { text: "" });
    expect(withNone.brief_warning).toBe("The linked brief could not be read. This analysis has no text from that brief.");
    for (const r of [withSaved, withNone]) expect(r.brief_warning).not.toMatch(INSTRUCTION);
  });
});

describe("Generate Run Summary on stored trends", () => {
  const trends = {
    themes: [{ week_start: "2026-10-05", title: "T", happening: "h", why_it_matters: "w", angle: "a", platforms: ["tiktok", "instagram"], post_urls: ["u1", "u2"] }],
    posts: [post("u1", "tiktok"), post("u2", "instagram")],
  };
  const summary = (o: { industryTrends?: Any; clientData?: Any; ai?: Any }): Any => generateRunSummary({
    gamma: {}, presentation: {}, clientData: o.clientData ?? {}, combined: {}, config: {}, sprout: null, ai: o.ai ?? { sprout_performance_analysis: {} }, prepared: {},
    industryTrends: o.industryTrends ?? null, startedAt: new Date("2026-11-01T00:00:00.000Z"), now: new Date("2026-11-01T00:05:00.000Z"),
  });

  it("keeps the trends it read and says whether it read any, with no warning", () => {
    const stored = summary({ industryTrends: trends, ai: { sprout_performance_analysis: {}, industry_trends_analysis: { overview: "o" } } });
    expect(stored).toMatchObject({ industry_trends: trends, trend_status: "stored", data_counts: { tiktok_trends: 1, instagram_trends: 1, industry_trend_themes: 1, industry_trend_posts: 2 } });
    expect(stored.ai_analysis.industry_trends_analysis).toEqual({ overview: "o" });
    const none = summary({ ai: { sprout_performance_analysis: {}, industry_trends_analysis: { overview: "o" } } });
    expect(none).toMatchObject({ industry_trends: null, trend_status: "none" });
    expect(none.ai_analysis.industry_trends_analysis).toBeNull();
    expect(summary({ clientData: { skip_trends: true } }).trend_status).toBe("skipped");
    for (const r of [stored, none]) {
      expect(r.warnings.filter((w: string) => /trend/i.test(w))).toEqual([]);
      expect(r).not.toHaveProperty("tiktok_trends");
    }
  });
});

describe("Build Presentation Content on stored trends", () => {
  const titles = ["Budget cuts", "AI planning", "Day in the life"];
  const trends = {
    themes: titles.map((title, i) => ({ week_start: "2026-10-05", title, happening: `What happens ${i}.`, why_it_matters: "w", angle: "a", platforms: ["tiktok", "linkedin"], post_urls: [0, 1, 2, 3].map((j) => `https://x.example/${i}-${j}`) })),
    posts: titles.flatMap((_, i) => [0, 1, 2, 3].map((j) => post(`https://x.example/${i}-${j}`, j % 2 ? "linkedin" : "tiktok"))),
  };
  const client = { client_name: "Acme", report_window: { current_month: { start: "2026-10-01", end: "2026-10-31" } }, context: {}, sprout: {} };

  it("makes one Industry trends slide group from the themes, with seven example posts from other accounts at most, each theme in turn", () => {
    const deck: string = buildPresentationContent(client, { sprout_performance_analysis: {} }, new Date("2026-11-01T00:00:00Z"), trends).presentation_content;
    expect(deck).toContain("SLIDE 7: INDUSTRY TRENDS THIS PERIOD");
    expect(deck).toContain("The themes that ran through your industry's social posts in October.");
    expect(deck.split("SLIDE 7: INDUSTRY TRENDS THIS PERIOD")[1].split("SLIDE 9:")[0]).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(deck).toContain("• Budget cuts (TikTok, LinkedIn): What happens 0.");
    expect(deck).toContain("SLIDE 8: TRENDING CONTENT IN YOUR INDUSTRY (EXTERNAL ACCOUNTS, NOT Acme'S POSTS)");
    const examples = [...deck.matchAll(/EXAMPLE #(\d+) \(EXTERNAL ACCOUNT\)/g)];
    expect(examples).toHaveLength(7);
    expect([...deck.matchAll(/^🔗 (.+)$/gm)].map((m) => m[1])).toEqual(["0-0", "1-0", "2-0", "0-1", "1-1", "2-1", "0-2"].map((k) => `https://x.example/${k}`));
    expect(deck).toContain("SLIDE 9: ACTION ITEMS & NEXT STEPS");
    expect(deck).toContain("• Test hooks inspired by this period's industry trends");
    expect(deck).toContain("• Industry trends: 3 themes and 12 example posts from the weekly trend research in the report dates");
    // The deck's own words have no dash as punctuation, and the team's own scores never leave.
    expect(deck).not.toMatch(/[\u2013\u2014]|\w - \w/);
    expect(deck).not.toMatch(/ENGAGEMENT SCORE|engagement_score|fit/i);
  });

  it("shows the strongest five themes at most, a theme that recurs across weeks once, and names no unknown author", () => {
    const weekly = ["AI planning", "Budget cuts", "AI Planning", "Late launches", "Day in the life", "AI planning", "Client wins", "Budget cuts", "Hiring"];
    const many = {
      themes: weekly.map((title, i) => ({ week_start: `2026-10-${String(26 - 7 * Math.floor(i / 3)).padStart(2, "0")}`, title, happening: `What happens in ${title}.`, why_it_matters: "w", angle: "a", platforms: [i % 2 ? "instagram" : "tiktok"], post_urls: [`https://x.example/m-${i}`] })),
      posts: weekly.map((_, i) => ({ ...post(`https://x.example/m-${i}`, i % 2 ? "instagram" : "tiktok"), author: "" })),
    };
    const deck: string = buildPresentationContent(client, { sprout_performance_analysis: {} }, new Date("2026-11-01T00:00:00Z"), many).presentation_content;
    const bullets = deck.split("🔥 THEMES:\n")[1].split("\n---")[0].trim().split("\n");
    expect(bullets).toHaveLength(5);
    expect(bullets[0]).toBe("• AI planning (TikTok, Instagram): What happens in AI planning.");
    expect(bullets[1]).toMatch(/^• Budget cuts \(/);
    expect(bullets.filter((b) => /ai planning/i.test(b))).toHaveLength(1);
    expect(deck).not.toContain("unknown");
    expect(deck).toMatch(/EXAMPLE #1 \(EXTERNAL ACCOUNT\)\n/);
    // The analysis's themes are capped and merged the same way.
    const noted = { sprout_performance_analysis: {}, industry_trends_analysis: { overview: "o", themes: [...weekly, "AI planning"].map((title) => ({ title, platforms: ["TikTok"], note: `Note on ${title}.` })) } };
    const fromAnalysis = buildPresentationContent(client, noted, new Date("2026-11-01T00:00:00Z"), many).presentation_content.split("🔥 THEMES:\n")[1].split("\n---")[0].trim().split("\n");
    expect(fromAnalysis).toHaveLength(5);
    expect(fromAnalysis.filter((b: string) => /ai planning/i.test(b))).toHaveLength(1);
  });

  it("with no stored trends, makes no trend slide and names no trend", () => {
    const deck: string = buildPresentationContent(client, { sprout_performance_analysis: {} }, new Date("2026-11-01T00:00:00Z"), null).presentation_content;
    expect(deck).not.toMatch(/^SLIDE \d+: .*TREND|Trend analysis was not included|Trend Scraper|industry trends|TikTok/m);
    expect(deck).toContain("SLIDE 7: ACTION ITEMS & NEXT STEPS");
  });
});

function post(url: string, platform: string): Any {
  return { platform, url, author: `creator ${url.slice(-3)}`, text: "A caption about planning.", posted_at: null, format: "short_video", views: 100, likes: 10, comments: 2, shares: 1, saves: 0 };
}
