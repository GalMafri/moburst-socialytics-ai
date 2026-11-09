import { describe, it, expect } from "vitest";
import { ALERT, CLIENT, COMPETITIVE_REPORT, COMPETITOR, COMPETITOR_SET, DESIGN_SETTINGS, DESIGN_SYSTEM, HANDLE, MEDIA_JOB, POST, REPORT, REPORT_DATA, SCHEDULE, SCHEDULED_POST, SPROUT_PROFILE, TREND_POSTS, TREND_THEMES, TREND_WEEKS } from "../../../functions/_shared/socialytics-api/fixtures";
import { alertOut, APP_URL, appUrl, clientOut, competitiveReportOut, competitorSetOut, designSystemOut, industryTrendsOut, mediaJobOut, postOut, reportOut, scheduledPostOut, scheduleOut, type TrendRows } from "../../../functions/_shared/socialytics-api/serializers";
import { SCHEMAS } from "../../../functions/api/schemas";

describe("clientOut", () => {
  const out = clientOut(CLIENT, { sproutProfiles: [SPROUT_PROFILE], sets: [{ ...COMPETITOR_SET, competitors: [{ ...COMPETITOR, handles: [HANDLE] }] }], designSystems: [DESIGN_SYSTEM], designSettings: DESIGN_SETTINGS, designSteps: [], counts: { reports: 4, competitive_reports: 2, posts: 9, schedules: 1 }, lastReport: REPORT });
  it("carries the brand, pillars, keywords, design, sprout and competitor summaries with links", () => {
    expect(out).toMatchObject({
      id: "c-bader", name: "Bader Law", website: "https://baderlaw.com", company_slug: "bader-law", platforms: ["Instagram", "TikTok", "Facebook", "LinkedIn", "YouTube"], geo: "US", language: "en", timezone: "America/New_York",
      pillars: [{ name: "Know your rights", description: "Plain explanations of legal situations." }], keywords: ["personal injury", "car accident lawyer"],
      brand_identity: { primary_color: "#1F3A5F", font_family: "Montserrat", tone_of_voice: "direct and reassuring" },
      design: { synthesis_at: "2026-09-20T10:00:00.000Z", references: 3, system: { version: 2, status: "approved", approved_at: "2026-09-21T10:00:00.000Z" }, ready: true, waiting_for: null },
      sprout: { profiles: 1, networks: ["instagram"] }, competitors: { set_status: "confirmed", selected: ["Morgan & Morgan"], tracked: true },
      counts: { reports: 4, competitive_reports: 2, posts: 9, schedules: 1 }, last_report: { id: "rep-1", status: "completed", period: { start: "2026-08-01", end: "2026-08-31" } },
      setup: { ready: true, issues: [] }, links: { app: `${APP_URL}/clients/c-bader/setup`, api: "/v1/clients/c-bader" },
    });
    expect(JSON.stringify(out)).not.toContain("123456");
    expect(JSON.stringify(out)).not.toContain("L123");
  });
  it("counts each design reference once, an upload the library keeps included", () => {
    const withUpload = clientOut({ ...CLIENT, design_references: ["c-bader/upload.png"], harvested_design_references: [{ path: "c-bader/upload.png", upload: true, kept: true }, { path: "c-bader/social-1.jpg", quality_checked: true }] },
      { sproutProfiles: [], sets: [], designSystems: [], designSettings: null, designSteps: [], counts: { reports: 0, competitive_reports: 0, posts: 0, schedules: 0 }, lastReport: null });
    expect(withUpload.design.references).toBe(2);
  });
  it("lists setup issues for a bare client", () => {
    const bare = clientOut({ ...CLIENT, brand_identity: null, content_pillars: null, social_keywords: null, design_style_synthesis: null, harvested_design_references: null }, { sproutProfiles: [], sets: [], designSystems: [], designSettings: null, designSteps: [], counts: { reports: 0, competitive_reports: 0, posts: 0, schedules: 0 }, lastReport: null });
    expect(bare.setup.ready).toBe(false);
    expect(bare.setup.issues.map((i) => i.kind)).toEqual(["brand_identity_missing", "pillars_missing", "keywords_missing", "sprout_missing", "competitors_missing", "design_style_missing", "schedule_missing"]);
    expect(bare.setup.issues.find((i) => i.kind === "design_style_missing")).toEqual({ kind: "design_style_missing", text: "Designs start once Bader Law's look is learned from its own posts.", fix: "setup" });
    expect(bare.design).toEqual({ synthesis_at: null, references: 0, system: null, ready: false, waiting_for: "look" });
  });

  // Design systems were retired (Lital, 23 Sep 2026): designs start once the
  // client's design settings are confirmed, and the lifecycle says what they wait for.
  it("reads design readiness from the confirmed design settings, never from a design system", () => {
    const base = { sproutProfiles: [SPROUT_PROFILE], sets: [{ ...COMPETITOR_SET, competitors: [{ ...COMPETITOR, handles: [HANDLE] }] }], counts: { reports: 1, competitive_reports: 1, posts: 1, schedules: 1 }, lastReport: null };
    const kinds = (o: ReturnType<typeof clientOut>) => o.setup.issues.map((i) => i.kind);
    const noSystem = clientOut(CLIENT, { ...base, designSystems: [], designSettings: DESIGN_SETTINGS, designSteps: [] });
    expect(noSystem.setup).toEqual({ ready: true, issues: [] });
    expect(noSystem.design).toMatchObject({ system: null, ready: true, waiting_for: null });
    const unconfirmed = clientOut(CLIENT, { ...base, designSystems: [DESIGN_SYSTEM], designSettings: { ...DESIGN_SETTINGS, confirmed_at: null }, designSteps: [] });
    expect(kinds(unconfirmed)).toEqual(["design_style_missing"]);
    expect(unconfirmed.design).toMatchObject({ system: { status: "approved" }, ready: false, waiting_for: "look" });
    const pyper = { ...CLIENT, id: "c-pyper", name: "Pay The Pyper" };
    const waiting = clientOut(pyper, { ...base, designSystems: [], designSettings: null, designSteps: [{ step: "design_refs", status: "waiting", result: { waiting_for: "designed_posts" } }] });
    expect(waiting.setup.issues).toEqual([{ kind: "design_style_missing", text: "Designs start once Pay The Pyper has published enough designed posts to learn its look from.", fix: "setup" }]);
    expect(waiting.design.waiting_for).toBe("designed_posts");
    const logo = clientOut(pyper, { ...base, designSystems: [], designSettings: null, designSteps: [{ step: "design_refs", status: "done", result: {} }, { step: "design_settings", status: "waiting", result: { waiting_for: "logo_file" } }] });
    expect(logo.setup.issues[0].text).toBe("Designs start once Pay The Pyper's logo file is found on its website.");
  });
  it("reads the competitor summary from the newest confirmed set even when a newer draft is in progress", () => {
    const draft = { ...COMPETITOR_SET, id: "set-2", status: "draft", rivaliq_landscape_id: null, confirmed_at: null, created_at: "2026-09-30T10:00:00.000Z", competitors: [] };
    const out = clientOut(CLIENT, { sproutProfiles: [{ ...SPROUT_PROFILE, native_link: "" }], sets: [draft, { ...COMPETITOR_SET, competitors: [{ ...COMPETITOR, handles: [HANDLE] }] }], designSystems: [DESIGN_SYSTEM], designSettings: DESIGN_SETTINGS, designSteps: [], counts: { reports: 1, competitive_reports: 1, posts: 0, schedules: 1 }, lastReport: null, detail: true });
    expect(out.competitors).toEqual({ set_status: "confirmed", selected: ["Morgan & Morgan"], tracked: true });
    expect(out.setup.issues.map((i) => i.kind)).not.toContain("competitors_missing");
    expect(out.competitor_sets?.map((s) => s.id)).toEqual(["set-2", "set-1"]);
    expect(out.sprout_profiles?.[0].url).toBeNull();
  });
  it("adds detail blocks on request without Sprout ids", () => {
    const d = clientOut(CLIENT, { sproutProfiles: [SPROUT_PROFILE], sets: [{ ...COMPETITOR_SET, competitors: [{ ...COMPETITOR, handles: [HANDLE] }] }], designSystems: [DESIGN_SYSTEM], designSettings: DESIGN_SETTINGS, designSteps: [], counts: { reports: 0, competitive_reports: 0, posts: 0, schedules: 0 }, lastReport: null, schedules: [SCHEDULE], detail: true });
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

describe("a report's insights through the connector (shownFields.ts)", () => {
  const facts = [{ id: "F1", key: "ranking|all|followers|Bader Law", kind: "ranking", platform: "all", metric: "followers", unit: "count", value: 1, score: 1, numbers: [1], sentence: "", basis: "Followers: Bader Law 1, Morgan & Morgan 9 (highest), median 5 across 2 companies", sources: ["sprout", "rivaliq"] }];
  it("gives the insights' fields in place of the report's own, field by field, naming no vendor", () => {
    const social = reportOut({ ...REPORT, insights: { report_id: "rep-1", confirmed_at: "x", facts, fields: { kind: "social", summary: { text: "Reach fell.", facts: ["F1"] }, insights: [{ text: "Bader Law trails on followers.", facts: ["F1"] }], recommendations: null } } } as never, { detail: true });
    expect(social.analysis?.sprout_performance_analysis).toMatchObject({ month_over_month_summary: "Reach fell.", key_insights: ["Bader Law trails on followers."] });
    expect(social.analysis?.competitive_takeaways).toEqual(["Post more Reels."]);
    const comp = competitiveReportOut({ ...COMPETITIVE_REPORT, insights: { report_id: "crep-1", confirmed_at: "x", facts, fields: { kind: "competitive", summary: [{ text: "Bader Law trails on followers.", facts: ["F1"] }], gaps: [{ gap: "Followers trail", platform: "instagram", why_it_matters: "w", suggested_play: "s", facts: ["F1"] }] } } } as never, { detail: true });
    expect(comp.analysis?.executive_summary).toBe("Bader Law trails on followers.");
    expect(comp.analysis?.gaps_for_client).toEqual([{ gap: "Followers trail", platform: "instagram", why_it_matters: "w", suggested_play: "s", based_on: facts[0].basis }]);
    expect(JSON.stringify(comp.analysis)).not.toMatch(/Sprout|Rival ?IQ|"F1"/);
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

describe("industryTrendsOut", () => {
  const rows: TrendRows = { weeks: TREND_WEEKS, themes: TREND_THEMES, posts: TREND_POSTS };
  const august = { client_id: "c-bader", date_range_start: "2026-08-01", date_range_end: "2026-08-31" };
  const titles = (o: ReturnType<typeof industryTrendsOut>) => o?.themes.map((t) => t.title);

  it("takes the finished weeks that start from the first day of the period to the last, both included", () => {
    // Aug 3 and Aug 31 are Mondays; Aug 10 is still running; Jul 27 and Sep 7 are outside.
    expect(titles(industryTrendsOut(rows, august))).toEqual(["Reaction videos to new rulings", "Plain-English legal explainers", "Client stories in the first person", "Inside the courtroom"]);
    expect(titles(industryTrendsOut(rows, { ...august, date_range_start: "2026-08-03", date_range_end: "2026-08-03" }))).toEqual(["Inside the courtroom"]);
    expect(titles(industryTrendsOut(rows, { ...august, date_range_start: "2026-08-04", date_range_end: "2026-08-30" }))).toEqual(["Client stories in the first person"]);
  });
  it("counts a partial week and not a running one", () => {
    const only = (status: string) => industryTrendsOut({ ...rows, weeks: TREND_WEEKS.map((w) => (w.id === "tw-aug-17" ? { ...w, status } : w)) }, { ...august, date_range_start: "2026-08-17", date_range_end: "2026-08-17" });
    expect(titles(only("partial"))).toEqual(["Client stories in the first person"]);
    expect(only("running")).toBeNull();
  });
  it("leaves a dismissed theme out and lists a theme whose posts were all dropped with none", () => {
    const dropped = TREND_POSTS.map((p) => (p.id === "tp-7" ? { ...p, kept: false } : p));
    const out = industryTrendsOut({ ...rows, posts: dropped }, { ...august, date_range_start: "2026-08-03", date_range_end: "2026-08-03" });
    expect(out?.themes).toHaveLength(1);
    expect(out?.themes[0].posts).toEqual([]);
    expect(industryTrendsOut(rows, { ...august, date_range_start: "2026-08-17", date_range_end: "2026-08-17" })?.themes).toHaveLength(1);
  });
  it("lists a theme's kept posts in the order the theme lists them, each once", () => {
    const out = industryTrendsOut(rows, august);
    expect(out?.themes[0].posts.map((p) => p.url)).toEqual(["https://instagram.example/tp-2", "https://tiktok.example/tp-1"]);
    expect(out?.themes[3].posts.map((p) => p.url)).toEqual(["https://tiktok.example/tp-7"]);
  });
  it("never shows another client's week, theme or post", () => {
    const foreign = { ...TREND_THEMES[0], id: "th-x", position: 9, title: "A theme row of another client", client_id: "c-calm" };
    const reaches = { ...TREND_THEMES[3], id: "th-y", title: "Lists another client's post", post_ids: ["tp-6", "tp-calm"] };
    const out = industryTrendsOut({ ...rows, themes: [...TREND_THEMES, foreign, reaches] }, august);
    expect(titles(out)).not.toContain("A theme row of another client");
    expect(titles(out)).not.toContain("Another client's theme");
    expect(out?.themes.find((t) => t.title === "Lists another client's post")?.posts.map((p) => p.author)).toEqual(["@clientstories"]);
    expect(titles(industryTrendsOut(rows, { ...august, client_id: "c-calm" }))).toEqual(["Another client's theme"]);
  });
  it("is null with no theme in the period, no stored rows, or no period", () => {
    expect(industryTrendsOut(rows, { ...august, date_range_start: "2026-09-08", date_range_end: "2026-09-13" })).toBeNull();
    expect(industryTrendsOut({ weeks: [], themes: [], posts: [] }, august)).toBeNull();
    expect(industryTrendsOut(null, august)).toBeNull();
    expect(industryTrendsOut(rows, { ...august, date_range_start: null })).toBeNull();
    expect(industryTrendsOut(rows, { ...august, date_range_end: null })).toBeNull();
  });
  it("leaves the rows it was given as they were", () => {
    const frozen: TrendRows = { weeks: Object.freeze([...TREND_WEEKS]) as never, themes: Object.freeze([...TREND_THEMES]) as never, posts: Object.freeze([...TREND_POSTS]) as never };
    expect(() => industryTrendsOut(frozen, august)).not.toThrow();
    expect(frozen.themes.map((t) => t.id)).toEqual(TREND_THEMES.map((t) => t.id));
  });
  it("serves exactly the fields the OpenAPI schema documents", () => {
    const out = industryTrendsOut(rows, august)!;
    const schema = (SCHEMAS.ReportObject.properties as Record<string, { oneOf: Array<{ properties?: Record<string, { items: { properties: Record<string, { items?: { properties: Record<string, unknown> } }> } }> }> }>).industry_trends.oneOf[0].properties!.themes.items;
    expect(Object.keys(out.themes[0]).sort()).toEqual(Object.keys(schema.properties).sort());
    expect(Object.keys(out.themes[0].posts[0]).sort()).toEqual(Object.keys(schema.properties.posts.items!.properties).sort());
  });
  it("is part of the report detail only when the detail is given the stored rows", () => {
    expect(reportOut(REPORT, { detail: true, trendRows: rows }).industry_trends?.themes).toHaveLength(4);
    expect(reportOut(REPORT, { detail: true, trendRows: null }).industry_trends).toBeNull();
    // A caller that reads no stored rows (the demo's output builder) gets no field at all, and a list row never has it.
    expect("industry_trends" in reportOut(REPORT, { detail: true })).toBe(false);
    expect("industry_trends" in reportOut(REPORT, { trendRows: rows })).toBe(false);
    // The report's own trends stay as the report holds them.
    expect(reportOut(REPORT, { detail: true, trendRows: rows }).trends).toEqual({ tiktok: { posts: 1, patterns: { top_hashtags: ["#law"] } }, instagram: { posts: 0, patterns: {} } });
  });
  it("counts a report made on stored trends by its example posts on each platform, and keeps every field", () => {
    const { tiktok_trends: _t, instagram_trends: _i, ...rest } = REPORT_DATA as Record<string, unknown>;
    const industry_trends = {
      themes: [{ week_start: "2026-08-03", title: "T", happening: "", why_it_matters: "", angle: "", platforms: ["tiktok", "linkedin"], post_urls: ["a", "b", "c"] }],
      posts: [{ platform: "tiktok", url: "a" }, { platform: "linkedin", url: "b" }, { platform: "tiktok", url: "c" }],
    };
    const fresh = { ...REPORT, report_data: { ...rest, industry_trends, data_counts: { tiktok_trends: 2, instagram_trends: 0, industry_trend_themes: 1, industry_trend_posts: 3 } } };
    const out = reportOut(fresh as never, { detail: true });
    expect(out.trends).toEqual({ tiktok: { posts: 2, patterns: null }, instagram: { posts: 0, patterns: null } });
    expect(out.counts).toMatchObject({ tiktok_trends: 2, instagram_trends: 0 });
    // A report with neither keeps no summary.
    expect(reportOut({ ...REPORT, report_data: rest } as never, { detail: true }).trends).toBeNull();
  });
});
