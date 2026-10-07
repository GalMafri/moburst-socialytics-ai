import { describe, it, expect } from "vitest";
import { CLIENT, COMPETITIVE_REPORT, COMPETITOR, COMPETITOR_SET, DESIGN_SYSTEM, HANDLE, POST, REPORT } from "../fixtures";
import { buildOutputs } from "./collect";
import { APP_URL } from "../serializers";

describe("buildOutputs", () => {
  it("assembles the client, the set, both reports, the post, analytics, design and gaps with links", () => {
    const out = buildOutputs({
      client: CLIENT, set: { ...COMPETITOR_SET, competitors: [{ ...COMPETITOR, handles: [HANDLE] }] }, unplaced: [{ name: "Cellino", reason: "no_verified_profile" }],
      reports: [REPORT], competitive: [COMPETITIVE_REPORT], posts: [POST], designs: [DESIGN_SYSTEM], analytics: { totals: { impressions: 10 } }, gaps: [{ step: "analytics", code: "x", message: "m" }],
    });
    expect(out.client).toMatchObject({ id: "c-bader", name: "Bader Law", pillars: [{ name: "Know your rights" }], keywords: ["personal injury", "car accident lawyer"], api_link: "/v1/clients/c-bader" });
    // A rep following the client link should land on what the demo produced, not on the Setup screen.
    expect(out.client.app_link).toBe(`${APP_URL}/clients/c-bader/reports`);
    expect(out.competitors).toEqual({ set_id: "set-1", set_status: "confirmed", selected: [{ name: "Morgan & Morgan", website: "https://www.forthepeople.com", handles: ["instagram:forthepeople"] }], unplaced: [{ name: "Cellino", reason: "no_verified_profile" }], tracked: true });
    expect(out.reports.map((r) => r.kind)).toEqual(["social", "competitive"]);
    expect(out.social_report).toMatchObject({ id: "rep-1", highlights: ["Reels outperformed."], calendar_days: 1, deck: { url: "https://gamma.app/docs/bader-aug" }, api_link: "/v1/reports/rep-1" });
    expect(out.competitive_report).toMatchObject({ id: "crep-1", executive_summary: "Competitors post daily.", scorecard: { client_score: 42 }, gaps: [{ gap: "Cadence" }] });
    expect(out.post).toMatchObject({ id: "post-1", copy: "Know your rights after a crash.", api_link: "/v1/posts/post-1" });
    expect(out.design).toMatchObject({ status: "approved", version: 2, previews: [{ template_id: "t-quote" }] });
    expect(out.analytics).toEqual({ totals: { impressions: 10 } });
    expect(out.gaps).toHaveLength(1);
    expect(JSON.stringify(out)).not.toMatch(/L123|RC1|123456/);
  });
  it("copes with a bare client and nothing produced", () => {
    const out = buildOutputs({ client: { ...CLIENT, content_pillars: null, social_keywords: null }, set: null, unplaced: [], reports: [], competitive: [], posts: [], designs: [], analytics: null, gaps: [] });
    expect(out.competitors).toEqual({ set_id: null, set_status: null, selected: [], unplaced: [], tracked: false });
    expect(out.social_report).toBeNull();
    expect(out.competitive_report).toBeNull();
    expect(out.post).toBeNull();
    expect(out.design).toEqual({ status: "none", version: null, previews: [] });
  });
});
