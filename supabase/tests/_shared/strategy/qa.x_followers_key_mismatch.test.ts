// @vitest-environment node
// P50-02: the strategy reads the Sprout followers of each platform by
// platformKey ("x" for X), but the followers reader keys its answer by
// ownedNetwork ("twitter" for a twitter or x account). A client measured on
// X by Sprout gets no follower count on X in its strategy.
import { describe, expect, it } from "vitest";
import { strategyEvidence } from "../../../functions/_shared/strategy/write";
import { newestFollowers } from "../../../functions/_shared/competitive/ownedSource";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const row = (id: number, date: string, followers: number) => ({ dimensions: { customer_profile_id: id, "reporting_period.by(day)": date }, metrics: { "lifetime_snapshot.followers_count": followers } });

describe("Sprout followers on X in the strategy's evidence", () => {
  it("gives X the follower count the Sprout reader answers for it", async () => {
    const owned = newestFollowers([{ sprout_profile_id: 7, network_type: "twitter" }], [row(7, "2026-11-02", 4100)]);
    const e = (await strategyEvidence(fakeDb({
      trend_profiles: [{ client_id: "c1", audience: "A", fit_rubric: "F", platforms: [], written_at: "2026-11-01T00:00:00Z" }],
      sprout_profiles: [{ client_id: "c1", network_type: "twitter", native_name: "pyper", is_active: true }],
      clients: [{ id: "c1" }], calendar_posts: [], content_strategy_edits: [],
    }), { id: "c1", name: "Pay The Pyper", content_pillars: [], primary_platforms: ["X"], field_sources: { primary_platforms: { by: "person" } }, posting_rhythm: null }, NOW, {
      gather: async () => ({
        own: [{ id: "1", platform: "X", format: "text", publishedAt: "2026-10-20T12:00:00Z", text: "x", link: null, impressions: 100, engagement: 5 }],
        learnedRhythm: [], evidence: [], avoid: [], thin: [], examples: {}, fallbackRates: { competitors: { X: 1 }, allTracked: {} },
      }),
      trackedRates: async () => ({}), voiceBlock: async () => "", competitiveBrief: async () => "", competitorSet: async () => [], siteText: async () => "", feedSnapshots: async () => [],
      ownedFollowers: async () => owned,
    }))!;
    expect(owned).toEqual({ twitter: 4100 });
    expect(e.platforms.find((p) => p.platform === "X")!.figures).toMatchObject({ basis: "measured", followers: 4100 });
  });
});
