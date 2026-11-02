import { describe, it, expect } from "vitest";
import { ALERT, CLIENT, COMPETITIVE_REPORT, COMPETITOR, COMPETITOR_SET, DESIGN_SYSTEM, HANDLE, MEDIA_JOB, POST, REPORT, REPORT_DATA, SCHEDULE, SCHEDULED_POST, SPROUT_PROFILE } from "./fixtures";
import { alertOut, APP_URL, appUrl, clientOut, competitiveReportOut, competitorSetOut, designSystemOut, mediaJobOut, postOut, reportOut, scheduledPostOut, scheduleOut } from "./serializers";

describe("clientOut", () => {
  const out = clientOut(CLIENT, { sproutProfiles: [SPROUT_PROFILE], sets: [{ ...COMPETITOR_SET, competitors: [{ ...COMPETITOR, handles: [HANDLE] }] }], designSystems: [DESIGN_SYSTEM], counts: { reports: 4, competitive_reports: 2, posts: 9, schedules: 1 }, lastReport: REPORT });
  it("carries the brand, pillars, keywords, design, sprout and competitor summaries with links", () => {
    expect(out).toMatchObject({
      id: "c-bader", name: "Bader Law", website: "https://baderlaw.com", company_slug: "bader-law", platforms: ["Instagram", "TikTok", "Facebook", "LinkedIn", "YouTube"], geo: "US", language: "en", timezone: "America/New_York",
      pillars: [{ name: "Know your rights", description: "Plain explanations of legal situations." }], keywords: ["personal injury", "car accident lawyer"],
      brand_identity: { primary_color: "#1F3A5F", font_family: "Montserrat", tone_of_voice: "direct and reassuring" },
      design: { synthesis_at: "2026-09-20T10:00:00.000Z", references: 3, system: { version: 2, status: "approved", approved_at: "2026-09-21T10:00:00.000Z" } },
      sprout: { profiles: 1, networks: ["instagram"] }, competitors: { set_status: "confirmed", selected: ["Morgan & Morgan"], tracked: true },
      counts: { reports: 4, competitive_reports: 2, posts: 9, schedules: 1 }, last_report: { id: "rep-1", status: "completed", period: { start: "2026-08-01", end: "2026-08-31" } },
      setup: { ready: true, issues: [] }, links: { app: `${APP_URL}/clients/c-bader/setup`, api: "/v1/clients/c-bader" },
    });
    expect(JSON.stringify(out)).not.toContain("123456");
    expect(JSON.stringify(out)).not.toContain("L123");
  });
  it("lists setup issues for a bare client", () => {
    const bare = clientOut({ ...CLIENT, brand_identity: null, content_pillars: null, social_keywords: null, design_style_synthesis: null, harvested_design_references: null }, { sproutProfiles: [], sets: [], designSystems: [], counts: { reports: 0, competitive_reports: 0, posts: 0, schedules: 0 }, lastReport: null });
    expect(bare.setup.ready).toBe(false);
    expect(bare.setup.issues.map((i) => i.kind)).toEqual(["brand_identity_missing", "pillars_missing", "keywords_missing", "sprout_missing", "competitors_missing", "design_system_missing", "schedule_missing"]);
  });
  it("reads the competitor summary from the newest confirmed set even when a newer draft is in progress", () => {
    const draft = { ...COMPETITOR_SET, id: "set-2", status: "draft", rivaliq_landscape_id: null, confirmed_at: null, created_at: "2026-09-30T10:00:00.000Z", competitors: [] };
    const out = clientOut(CLIENT, { sproutProfiles: [{ ...SPROUT_PROFILE, native_link: "" }], sets: [draft, { ...COMPETITOR_SET, competitors: [{ ...COMPETITOR, handles: [HANDLE] }] }], designSystems: [DESIGN_SYSTEM], counts: { reports: 1, competitive_reports: 1, posts: 0, schedules: 1 }, lastReport: null, detail: true });
    expect(out.competitors).toEqual({ set_status: "confirmed", selected: ["Morgan & Morgan"], tracked: true });
    expect(out.setup.issues.map((i) => i.kind)).not.toContain("competitors_missing");
    expect(out.competitor_sets?.map((s) => s.id)).toEqual(["set-2", "set-1"]);
    expect(out.sprout_profiles?.[0].url).toBeNull();
  });
  it("adds detail blocks on request without Sprout ids", () => {
    const d = clientOut(CLIENT, { sproutProfiles: [SPROUT_PROFILE], sets: [{ ...COMPETITOR_SET, competitors: [{ ...COMPETITOR, handles: [HANDLE] }] }], designSystems: [DESIGN_SYSTEM], counts: { reports: 0, competitive_reports: 0, posts: 0, schedules: 0 }, lastReport: null, schedules: [SCHEDULE], detail: true });
    expect(d.sprout_profiles).toEqual([{ name: "Bader Law", handle: "baderlaw", network: "instagram", url: "https://instagram.com/baderlaw" }]);
    expect(d.competitor_sets?.[0].competitors[0].handles[0]).toMatchObject({ platform: "instagram", handle: "forthepeople", confidence: 0.95 });
    expect(d.schedules?.[0].kind).toBe("social");
  });
});

describe("reportOut", () => {
  it("summarises a social report and keeps the heavy blocks for the detail", () => {
    const s = reportOut(REPORT);
    expect(s).toMatchObject({ id: "rep-1", client_id: "c-bader", status: "completed", period: { start: "2026-08-01", end: "2026-08-31" }, previous_period: { start: "2026-07-01", end: "2026-07-31" }, duration_minutes: 38, deck: { url: "https://gamma.app/docs/bader-aug", status: "ok" }, counts: { total_recommendations: 12, content_calendar_days: 7 }, metrics_summary: { impressions_change: -20.1 }, warnings: ["TikTok trends thin"], trend_status: "ok", links: { app: `${APP_URL}/clients/c-bader/reports/rep-1`, api: "/v1/reports/rep-1" } });
    expect("analysis" in s).toBe(false);
    const d = reportOut(REPORT, { detail: true });
    expect(d.analysis?.competitive_takeaways).toEqual(["Post more Reels."]);
    expect(d.calendar?.[0].posts[0]).toMatchObject({ platform: "Instagram", copy: "Know your rights after a crash." });
    expect(d.performance?.overall_totals).toEqual({ impressions: 120000 });
    expect(JSON.stringify(d.performance)).not.toContain("sp-post-1");
    const withIds = reportOut({ ...REPORT, report_data: { ...REPORT_DATA, sprout_performance: { platform_metrics: { TikTok: { profile_ids: [123456], impressions: 5 } }, platform_breakdown: [{ network: "tiktok", profile_ids: [123456] }] } } }, { detail: true });
    expect(JSON.stringify(withIds.performance)).not.toMatch(/profile_ids|123456/);
    expect(withIds.performance).toEqual({ platform_metrics: { TikTok: { impressions: 5 } }, platform_breakdown: [{ network: "tiktok" }] });
    expect(d.trends?.tiktok.posts).toBe(1);
  });
  it("tolerates a failed report whose data is only an error", () => {
    const f = reportOut({ ...REPORT, status: "failed", report_data: { error: "n8n stopped" }, gamma_url: null });
    expect(f.counts).toBeNull();
    expect(f.error).toBe("n8n stopped");
    expect(f.deck).toEqual({ url: null, status: null });
  });
});

describe("competitiveReportOut", () => {
  it("summarises and details without RivalIQ identifiers", () => {
    const s = competitiveReportOut(COMPETITIVE_REPORT);
    expect(s).toMatchObject({ id: "crep-1", set_id: "set-1", status: "complete", period: { start: "2026-08-25", end: "2026-09-24", days: 31 }, totals: { posts_analyzed: 412 }, deck: { url: "https://gamma.app/docs/bader-comp" }, quality_check: null, links: { api: "/v1/competitive-reports/crep-1" } });
    // How many provider calls a report made is plumbing, not a finding.
    expect(s.totals).toEqual({ posts_analyzed: 412 });
    const d = competitiveReportOut(COMPETITIVE_REPORT, { detail: true });
    expect(d.analysis?.executive_summary).toBe("Competitors post daily.");
    expect(d.aggregates?.companies[0]).toMatchObject({ name: "Morgan & Morgan", is_client: false, post_count: 120 });
    expect(JSON.stringify(d)).not.toMatch(/RC1|RC0|L123|company_id|landscape/);
  });
});

describe("competitorSetOut, postOut, mediaJobOut", () => {
  it("lists competitors with their handles", () => {
    const out = competitorSetOut({ ...COMPETITOR_SET, competitors: [{ ...COMPETITOR, handles: [HANDLE] }] });
    expect(out).toMatchObject({ id: "set-1", status: "confirmed", source: "ai", tracked: true, competitors: [{ name: "Morgan & Morgan", website: "https://www.forthepeople.com", selected: true, rank: 1, similarity_score: 0.91, handles: [{ platform: "instagram", handle: "forthepeople", url: "https://instagram.com/forthepeople", confidence: 0.95, source: "auto" }] }] });
    expect(JSON.stringify(out)).not.toMatch(/rivaliq|RC1|L123/);
  });
  it("maps a post iteration", () => {
    expect(postOut(POST)).toMatchObject({ id: "post-1", report_id: "rep-1", source: "calendar", platform: "Instagram", format: "Reel/Video", copy: "Know your rights after a crash.", hashtags: ["#law"], cta: "Call us", media_urls: [expect.stringContaining("generated-media")], selected: true, approved: true, finishing: "done", links: { app: `${APP_URL}/clients/c-bader/reports/rep-1`, api: "/v1/posts/post-1" } });
  });
  it("maps a media job without provider internals", () => {
    const out = mediaJobOut(MEDIA_JOB);
    expect(out).toMatchObject({ id: "mj-1", post_id: "post-1", kind: "image", provider: "higgsfield", status: "completed", review: { dirty: false, reason: "clean" } });
    expect(JSON.stringify(out)).not.toMatch(/req-secret|model_path|request_id/);
  });
});

describe("scheduleOut, scheduledPostOut, alertOut, designSystemOut", () => {
  it("rename the fields", () => {
    expect(scheduleOut(SCHEDULE)).toMatchObject({ id: "rs-1", kind: "social", frequency: "monthly", run_day_of_month: 7, range_mode: "previous_month", active: true, last_result: "triggered" });
    expect(scheduledPostOut(SCHEDULED_POST)).toMatchObject({ id: "sch-post-1", platform: "instagram", status: "scheduled", content: "Know your rights." });
    expect(JSON.stringify(scheduledPostOut(SCHEDULED_POST))).not.toContain("9988");
    expect(alertOut(ALERT)).toMatchObject({ id: "al-1", topic: "Back to school safety", companies: ["Morgan & Morgan", "Cellino"], window: { start: "2026-09-15", end: "2026-09-21" }, status: "new" });
    expect(designSystemOut(DESIGN_SYSTEM)).toMatchObject({ id: "ds-1", version: 2, status: "approved", templates: [{ id: "t-quote", name: "Quote card", formats: ["square", "portrait"] }], tokens: { font_family: "Montserrat", colors: { accent: "#C8A951" } }, previews: [{ template_id: "t-quote", format: "square", url: "https://x/previews/v2-t-quote.png" }] });
  });
});

describe("appUrl", () => {
  it("uses the branded gOS host when PUBLIC_APP_URL is set, else the Lovable origin, and never keeps a trailing slash", () => {
    expect(appUrl(() => undefined)).toBe("https://moburst-socialytics-ai.lovable.app");
    expect(appUrl((k) => (k === "PUBLIC_APP_URL" ? "https://socialytics.moburst.ai/" : undefined))).toBe("https://socialytics.moburst.ai");
    expect(appUrl(() => "   ")).toBe("https://moburst-socialytics-ai.lovable.app");
  });
});
