// The planner and ad-hoc posts (competitive/brief.ts) and the monthly
// report's competitive context (payloads.ts) read a competitive report as
// every screen does (shownFields.ts): its insights where it has them,
// through the evidence limits, with the team's verdicts keyed by a gap's
// own words.

import { describe, expect, it, vi } from "vitest";
import { competitiveBrief } from "../../../functions/_shared/competitive/brief";
import { buildSocialPayload, competitiveContext, insightKey } from "../../../functions/_shared/reports/payloads";
import type { ShownInsightsRow } from "../../../functions/_shared/reports/shownFields";

const company = (name: string, is_client: boolean, posts: number) => ({
  name, is_client, post_count: posts, observed_post_count: posts,
  rivaliq_metrics: { period: { start: "2026-10-01", end: "2026-10-31" }, posts: { current: posts, previous: 5 }, by_network: { instagram: { posts: { current: posts, previous: 5 } } } },
  by_channel: { instagram: { post_count: posts, observed_post_count: posts, top_posts: [] } },
});
const REPORT = {
  id: "c1", created_at: "2026-11-09T10:00:00Z",
  report_data: {
    period: { start: "2026-10-01", end: "2026-10-31" },
    aggregates: { metric_semantics_version: 4, period: { start: "2026-10-01", end: "2026-10-31", days: 31 }, companies: [company("Moburst", true, 6), company("Rival Co", false, 9)] },
    ai_analysis: { executive_summary: "The model's summary.", gaps_for_client: [{ gap: "The model's gap", platform: "instagram", why_it_matters: "w", suggested_play: "s" }] },
  },
};
const INSIGHTS: ShownInsightsRow = {
  report_id: "c1", confirmed_at: "2026-11-09T11:00:00Z",
  facts: [{ id: "F1", key: "ranking|all|followers|Moburst", kind: "ranking", platform: "all", metric: "followers", company: "Moburst", unit: "count", value: 14900, score: 2, numbers: [14900], sentence: "", basis: "Followers: Moburst 14,900", sources: ["sprout", "rivaliq"] }],
  fields: {
    kind: "competitive",
    summary: [{ text: "Moburst ranks 2nd of 2 on followers.", facts: ["F1"] }],
    gaps: [
      { gap: "Followers trail the field", platform: "instagram", why_it_matters: "Rival Co leads.", suggested_play: "Test weekly Reels.", facts: ["F1"] },
      { gap: "No TikTok yet", platform: "tiktok", why_it_matters: "Rival Co leads.", suggested_play: "Test TikTok.", facts: ["F1"] },
    ],
  },
};
const FEEDBACK = [{ insight_key: insightKey("Followers trail the field"), verdict: "up", gap_text: "Followers trail the field", edited: null }];

/** The tables a brief reads, each answering with its rows; a single read answers with the first. */
function db(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      // deno-lint-ignore no-explicit-any
      const q: any = {};
      for (const op of ["select", "eq", "neq", "in", "order", "limit"]) q[op] = () => q;
      q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok);
      return q;
    },
  };
}

describe("the competitive brief (planner and ad-hoc posts)", () => {
  it("reads the report's insights through the evidence limits, with the team's verdict keyed by the gap's words", async () => {
    const brief = await competitiveBrief(db({ competitive_reports: [REPORT], competitive_insight_feedback: FEEDBACK, report_insights: [INSIGHTS] }), "mob");
    expect(brief).toContain("Summary: Moburst ranks 2nd of 2 on followers.");
    expect(brief).toContain("Gaps the account team has decided to act on (address at least one of these directly):\n- [instagram] Followers trail the field. Play: Test weekly Reels.");
    expect(brief).not.toMatch(/The model's|No TikTok yet/);
  });

  it("reads the report's own fields without insights", async () => {
    const brief = await competitiveBrief(db({ competitive_reports: [REPORT], competitive_insight_feedback: [] }), "mob");
    expect(brief).toContain("- [instagram] The model's gap");
  });
});

describe("the monthly report's competitive context", () => {
  it("carries the insights' summary and gaps, through the evidence limits, with the team's verdict keyed by the gap's words", () => {
    const ctx = competitiveContext(REPORT, FEEDBACK, [], INSIGHTS)!;
    expect(ctx.executive_summary).toBe("Moburst ranks 2nd of 2 on followers.");
    expect(ctx.gaps).toEqual([{ gap: "Followers trail the field", platform: "instagram", suggested_play: "Test weekly Reels.", endorsed: true }]);
    expect((competitiveContext(REPORT, [], [])!.gaps as Array<{ gap: string }>).map((g) => g.gap)).toEqual(["The model's gap"]);
  });
});

describe("a monthly report run's payload", () => {
  it("carries the competitive context with the report's own fields when its insights can't be read, and never fails for them", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = db({ competitive_reports: [REPORT], competitive_insight_feedback: [], competitive_learnings: [], sprout_profiles: [] });
    const supabase = { from: (table: string) => (table === "report_insights" ? (() => { throw new Error("relation report_insights does not exist"); })() : base.from(table)) };
    const payload = await buildSocialPayload({ supabase, client: { id: "mob", name: "Moburst" }, reportId: "r1", range: { start: "2026-10-01", end: "2026-10-31" } });
    expect((payload.competitive_context as { gaps: Array<{ gap: string }> }).gaps.map((g) => g.gap)).toEqual(["The model's gap"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
