// @vitest-environment node
// The social comparison while baselines change (Trends plan, Phase 3 point
// 3): a report made before stored trends is compared without its trend
// keys; once a report made on stored trends is the baseline, they count.
import { describe, expect, it } from "vitest";
import { MOBURST } from "../../../../fixtures/pipelines/social";
import { compareSocial } from "../../../../functions/_shared/pipelines/social/harness";

// deno-lint-ignore no-explicit-any
type Any = any;

const OLD = MOBURST.stored_report.report_data;
const industry = { themes: [{ week_start: "2026-09-07", title: "AI planning", happening: "h", why_it_matters: "w", angle: "a", platforms: ["tiktok"], post_urls: ["https://x.example/1"] }], posts: [{ platform: "tiktok", url: "https://x.example/1", author: "a", text: "t", posted_at: null, format: "short_video", views: 1, likes: 1, comments: 0, shares: 0, saves: 0 }] };
/** The same report made on stored trends. */
function onStoredTrends(rd: Any, trends: Any = industry): Any {
  const { tiktok_trends: _t, instagram_trends: _i, ...rest } = rd;
  return {
    ...rest, industry_trends: trends, trend_status: trends ? "stored" : "none",
    ai_analysis: { ...rd.ai_analysis, industry_trends_analysis: trends ? { overview: "o", themes: [], opportunities_for_client: [], key_takeaways: [] } : null },
    data_counts: { ...rd.data_counts, tiktok_trends: trends ? 1 : 0, instagram_trends: 0, industry_trend_themes: trends ? 1 : 0, industry_trend_posts: trends ? 1 : 0 },
  };
}
const differences = (c: ReturnType<typeof compareSocial>["comparison"]) => [
  ...c.onlyReal, ...c.onlyShadow, ...c.otherDifferences.map((d) => d.path), ...c.typeMismatches.map((d) => d.path),
  ...c.numbers.differences.map((d) => d.path), ...c.text.filter((t) => !t.same).map((t) => t.path),
];

describe("compareSocial", () => {
  it("leaves the trend keys out against a baseline made before stored trends, and its missing-keywords trend warnings count for nothing", () => {
    const old = { ...OLD, warnings: [...(OLD.warnings ?? []), "TikTok trends were not available this month.", "Instagram trends were not available this month."] };
    expect(differences(compareSocial(old, onStoredTrends(OLD)).comparison)).toEqual([]);
  });

  it("compares the trend keys once the baseline was made on stored trends, a period with none included", () => {
    const base = onStoredTrends(OLD);
    expect(differences(compareSocial(base, onStoredTrends(OLD)).comparison)).toEqual([]);
    const without = differences(compareSocial(base, onStoredTrends(OLD, null)).comparison);
    expect(without).toEqual(expect.arrayContaining(["trend_status", "data_counts.industry_trend_themes"]));
    expect(without.some((p) => p.startsWith("industry_trends"))).toBe(true);
    const none = onStoredTrends(OLD, null);
    expect(differences(compareSocial(none, onStoredTrends(OLD)).comparison).some((p) => p.startsWith("industry_trends"))).toBe(true);
    // A stored-trends baseline keeps every warning it has.
    expect(differences(compareSocial({ ...base, warnings: ["TikTok trends were not available this month."] }, base).comparison)).not.toEqual([]);
  });
});
