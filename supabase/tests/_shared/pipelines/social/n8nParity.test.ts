// @vitest-environment node
// Each ported node next to the n8n code it came from, on the same inputs, and
// both against what n8n made. The n8n code is the live workflow as the repo
// mirrors it (n8n/social-workflow.json, version 5f8d3abc, and the n8n/code
// copies of its nodes); it runs in a sandbox with n8n's $(), $input and
// $runIndex. The inputs are what n8n read in two real runs (fixtures/social.ts):
// Moburst's September report (execution 574962) and a September trend
// research (execution 583953).
//
// The trend nodes (Prepare Trend Inputs, the two scrapers, their normalizers,
// skip and failed items) are not ported any more: the report reads the
// weeks the trend collection stored (Trends plan, Task 16). The nodes that
// carried their posts are compared with n8n's on a report without trends,
// with each trend difference named (TREND_EDITS, DECK_TREND_EDITS, and the
// trend keys of the client object and the run summary).
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { MOBURST, mirror, moburstPages, moburstRequest, nodeCode, nodeOf, TRENDS } from "../../../../fixtures/pipelines/social";
import { BRIEF_SYSTEM, PROMPT_EDITS, synthesisSystem, synthesisText, TREND_EDITS } from "../../../../functions/_shared/pipelines/social/prompt";
import { sproutRequests } from "../../../../functions/_shared/pipelines/social/providers";
import {
  aggregateSprout, attachCompetitiveContext, attachPostThumbnails, buildNormalizedClient, buildPresentationContent, checkGammaState, combineBrief, DECK_EDITS,
  DECK_TREND_EDITS, generateRunSummary, prepareBriefText, skipSproutAnalytics, sproutSetup, workflowConfiguration,
} from "../../../../functions/_shared/pipelines/social/nodes";

// deno-lint-ignore no-explicit-any
type Any = any;

const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

/**
 * Runs an n8n Code node: $("Node").first().json / .all() / .item, $input,
 * $runIndex; returns its items' json. Every node's output reaches the code as
 * its own copy, as in n8n (a node that edits its input in place, as Attach
 * Post Thumbnails does, never changes another node's output).
 */
async function runNode(code: string, nodesIn: Record<string, Any>, inputIn: Any[] = [], o: { runIndex?: number; now?: number } = {}): Promise<Any[]> {
  const nodes = plain(nodesIn);
  const input = plain(inputIn);
  const items = (v: Any) => (Array.isArray(v) ? v : [v]).map((json: Any) => ({ json }));
  const $ = (name: string) => {
    if (!(name in nodes)) throw new Error(`Node '${name}' hasn't been executed`);
    const list = items(nodes[name]);
    return { first: () => list[0], all: () => list, item: list[0] };
  };
  const NOW = o.now ?? Date.parse("2026-10-19T12:00:00.000Z");
  class FixedDate extends Date {
    // deno-lint-ignore no-explicit-any
    constructor(...args: any[]) { if (args.length) super(...(args as [])); else super(NOW); }
    static now() { return NOW; }
  }
  const out = await vm.runInNewContext(`(async function(){\n${code}\n}).call({ helpers: {} })`, {
    $, $input: { first: () => ({ json: input[0] }), all: () => input.map((json) => ({ json })) }, $runIndex: o.runIndex ?? 0, Date: FixedDate, console: { log() {} },
  });
  return plain(out.map((i: Any) => i.json));
}

/** An n8n "={{ ... }}" template (static text with {{ expressions }}), evaluated with $json and $(). */
function template(text: string, json: Any, nodes: Record<string, Any> = {}): string {
  const body = text.startsWith("=") ? text.slice(1) : text;
  const $ = (name: string) => ({ first: () => ({ json: nodes[name] }), item: { json: nodes[name] } });
  return body.replace(/\{\{([\s\S]*?)\}\}(?!\})/g, (_m, expr) => {
    const v = vm.runInNewContext(`(${expr})`, { $json: json, $, JSON });
    return v == null ? "" : String(v);
  });
}

const request = moburstRequest({ withFile: true });
const NOW = new Date("2026-10-16T20:59:30.000Z");
const config = workflowConfiguration(request, NOW);
const combined = MOBURST.combine;

describe("the repo's copies of the n8n code are the live workflow's", () => {
  it("n8n/code matches n8n/social-workflow.json for every node it copies", () => {
    const copies: Record<string, string> = {
      "social-aggregate": "Aggregate Sprout Social Data", "social-summary": "Generate Run Summary", "prepare-brief": "Prepare Brief Text",
      "combine-brief": "Combine Brief Context with Client Data", "prepare-trends": "Prepare Trend Inputs", "check-gamma": "Check Gamma State",
      "social-presentation": "Build Presentation Content",
    };
    for (const [file, node] of Object.entries(copies)) expect(mirror(file), file).toBe(nodeCode(node));
  });
});

describe("Workflow Configuration (Luxon's calendar arithmetic, checked by hand)", () => {
  it("keeps the period and makes the previous one the same length, ending the day before", () => {
    expect(config).toMatchObject({
      current_month_start: "2026-09-01", current_month_end: "2026-09-30", previous_month_start: "2026-08-02", previous_month_end: "2026-08-31",
      client_name: "Moburst", report_id: "fd501cba-a2fe-4df8-b025-7ed4b204a4c3", date_range_start: "2026-09-01", date_range_end: "2026-09-30",
    });
    expect(config.body).toBe(request);
    // Across Israel's daylight-saving change (25 Oct 2026) the days stay calendar days.
    expect(workflowConfiguration({ date_range_start: "2026-11-01", date_range_end: "2026-11-30" }, NOW)).toMatchObject({ previous_month_start: "2026-10-02", previous_month_end: "2026-10-31" });
    expect(workflowConfiguration({ date_range_start: "2026-09-30", date_range_end: "2026-09-30" }, NOW)).toMatchObject({ previous_month_start: "2026-09-29", previous_month_end: "2026-09-29" });
  });

  it("falls back to this month and the last in Israel time when the request has no period", () => {
    // 23:30 UTC on 31 Oct is 1 Nov in Israel.
    const c = workflowConfiguration({ client_name: "X" }, new Date("2026-10-31T23:30:00.000Z"));
    expect(c).toMatchObject({ current_month_start: "2026-11-01", current_month_end: "2026-11-01", previous_month_start: "2026-10-01", previous_month_end: "2026-10-31", trends_start_date: "2026-10-24", trends_end_date: "2026-10-31", date_range_start: "" });
  });
});

describe("the brief", () => {
  it("Prepare Brief Text: a read file's text, the saved brief, or a warning", async () => {
    const fileText = MOBURST.prepared_brief.brief_text;
    for (const [req, file] of [[request, fileText], [request, ""], [{ ...request, brief_file_id: "" }, ""], [{ ...request, brief_text: "" }, ""]] as Array<[Any, string]>) {
      const cfg = workflowConfiguration(req, NOW);
      const n8n = await runNode(nodeCode("Prepare Brief Text"), { "Workflow Configuration": cfg }, [{ ...cfg, ...(file ? { text: file } : {}) }]);
      // The app's unreadable-brief warning drops n8n's instruction to staff on purpose (reports never instruct people).
      const instructed = "The linked brief could not be read. Use a Google Doc, text file or text-based PDF, or paste the brief into client setup.";
      const expected = { ...n8n[0], brief_warning: String(n8n[0].brief_warning).replace(instructed, "The linked brief could not be read.") };
      expect(plain(prepareBriefText(cfg, { text: file || undefined }))).toEqual(expected);
    }
    expect(plain(prepareBriefText(config, { text: fileText }))).toEqual(MOBURST.prepared_brief);
  });

  it("Combine Brief Context with Client Data: as n8n made it, with an analysis, with none, and with no brief", async () => {
    const nodes = { "Workflow Configuration": config, Webhook: { body: request }, "Prepare Brief Text": MOBURST.prepared_brief };
    const n8n = await runNode(nodeCode("Combine Brief Context with Client Data"), nodes, [MOBURST.brief_analysis]);
    const port = plain(combineBrief(MOBURST.brief_analysis, config, MOBURST.prepared_brief));
    expect(port).toEqual(n8n[0]);
    expect(port).toEqual(MOBURST.combine);
    for (const analysis of [{ error: "The brief analysis did not answer." }, { brief_text: "", brief_source: "none", brief_warning: "" }]) {
      const prepared = { brief_text: analysis.error ? "Some brief." : "", brief_source: "client_setup", brief_warning: "" };
      const n = { ...nodes, "Prepare Brief Text": prepared };
      expect(plain(combineBrief(analysis, config, prepared))).toEqual((await runNode(nodeCode("Combine Brief Context with Client Data"), n, [analysis]))[0]);
    }
  });

  it("the analysts' prompts are n8n's with the writing edits only", () => {
    const agent = nodeOf("Analyze Client Brief Context").parameters;
    let n8nSystem: string = agent.options.systemMessage;
    for (const [from, to] of PROMPT_EDITS) n8nSystem = n8nSystem.split(from).join(to);
    expect(BRIEF_SYSTEM).toBe(n8nSystem);
    // List bullets stay; no dash as punctuation.
    expect(BRIEF_SYSTEM).not.toMatch(/[\u2013\u2014]|\w - \w/);
  });
});

describe("Sprout", () => {
  const pages = moburstPages();

  it("Code in JavaScript: the profiles and periods", async () => {
    const n8n = await runNode(nodeCode("Code in JavaScript"), { "Combine Brief Context with Client Data": combined, "Workflow Configuration": config, Webhook: { body: request } });
    expect(plain(sproutSetup(combined, config, "1676448"))).toEqual(n8n[0]);
    expect(n8n[0]).toEqual(MOBURST.sprout_setup);
  });

  it("the four requests are the bodies n8n's HTTP nodes send, under the account n8n names", () => {
    const setup = MOBURST.sprout_setup;
    const nodes = { "Code in JavaScript": setup, "Combine Brief Context with Client Data": combined };
    const ports = sproutRequests(setup, combined);
    const pairs: Array<[string, keyof typeof ports]> = [
      ["Get Sprout Social Analytics Data", "current"], ["Get Sprout Social Post Analytics", "posts"],
      ["Get Previous Month Sprout Analytics", "previous"], ["Get Previous Month Post Analytics", "previous_posts"],
    ];
    for (const [node, read] of pairs) {
      const p = nodeOf(node).parameters;
      expect(p.url).toBe(`=https://api.sproutsocial.com/v1/1676448/analytics/${ports[read].path}`);
      expect(JSON.parse(template(p.jsonBody, setup, nodes)), node).toEqual(ports[read].body);
      // Pages: page 1, 2, ... in the body until the answer says it is the last.
      expect(p.options.pagination.pagination.parameters.parameters).toEqual([{ type: "body", name: "page", value: "={{ $pageCount + 1 }}" }]);
    }
  });

  it("Aggregate Sprout Social Data, on the pages Sprout answered", async () => {
    const nodes = {
      "Combine Brief Context with Client Data": combined, "Workflow Configuration": config, "Code in JavaScript": MOBURST.sprout_setup,
      "Get Sprout Social Analytics Data": pages.current, "Get Previous Month Sprout Analytics": pages.previous,
      "Get Sprout Social Post Analytics": pages.posts, "Get Previous Month Post Analytics": pages.previous_posts,
    };
    const n8n = await runNode(mirror("social-aggregate"), nodes, []);
    const port = plain(aggregateSprout({ pages, combined, config, setup: MOBURST.sprout_setup }));
    expect(port).toEqual(n8n[0]);
    expect(port).toEqual(MOBURST.aggregate);
  });

  it("Aggregate Sprout Social Data refuses what n8n refuses: a missing page, a day outside the period, an error answer", async () => {
    const base = { combined, config, setup: MOBURST.sprout_setup };
    const cases: Array<[string, Any]> = [
      ["not all API pages were retrieved", { ...pages, current: [{ ...pages.current[0], paging: { current_page: 1, total_pages: 2 } }] }],
      ["outside the requested reporting period", { ...pages, previous: [{ ...pages.previous[0], data: [{ dimensions: { customer_profile_id: 1, "reporting_period.by(day)": "2026-07-01" }, metrics: {} }] }] }],
      ["no valid analytics response", { ...pages, posts: [{ error: "rate limited" }] }],
    ];
    for (const [message, p] of cases) {
      expect(() => aggregateSprout({ ...base, pages: p })).toThrow(message);
      const nodes = {
        "Combine Brief Context with Client Data": combined, "Workflow Configuration": config, "Code in JavaScript": MOBURST.sprout_setup,
        "Get Sprout Social Analytics Data": p.current, "Get Previous Month Sprout Analytics": p.previous, "Get Sprout Social Post Analytics": p.posts, "Get Previous Month Post Analytics": p.previous_posts,
      };
      await expect(runNode(mirror("social-aggregate"), nodes, [])).rejects.toThrow(message);
    }
  });

  it("Attach Post Thumbnails", async () => {
    const nodes = { "Get Sprout Social Post Analytics": pages.posts, "Get Previous Month Post Analytics": pages.previous_posts };
    const n8n = await runNode(nodeCode("Attach Post Thumbnails"), nodes, [MOBURST.aggregate]);
    const port = plain(attachPostThumbnails(MOBURST.aggregate, [...pages.posts, ...pages.previous_posts]));
    expect(port).toEqual(n8n[0]);
    expect(port).toEqual(MOBURST.thumbnails);
    expect(port.top_posts.some((p: Any) => p.thumbnail_url)).toBe(true);
  });

  it("Skip Sprout Analytics, for a brand with no profile", async () => {
    const setup = { ...MOBURST.sprout_setup, profile_ids: [], profiles: [] };
    expect(plain(skipSproutAnalytics(setup))).toEqual((await runNode(nodeCode("Skip Sprout Analytics"), {}, [setup]))[0]);
  });
});

/** The client object without its trends: n8n's scrapers' posts and counts, or the port's stored industry trends and counts. */
function withoutTrends(o: Any): Any {
  const { trends: _t, industry_trends: _i, _meta, ...rest } = o;
  const { tiktok_count: _a, instagram_count: _b, industry_themes: _c, industry_posts: _d, ...meta } = _meta ?? {};
  return { ...rest, _meta: meta };
}

/** The run summary without its trends (generateRunSummary says what the port keeps in their place). */
function summaryWithoutTrends(r: Any): Any {
  const { tiktok_trends: _a, instagram_trends: _b, industry_trends: _c, trend_status: _d, data_counts, ai_analysis, ...rest } = r;
  const { tiktok_trends: _e, instagram_trends: _f, industry_trend_themes: _g, industry_trend_posts: _h, ...counts } = data_counts ?? {};
  const { tiktok_trends_analysis: _i, instagram_trends_analysis: _j, industry_trends_analysis: _k, ...ai } = ai_analysis ?? {};
  return { ...rest, data_counts: counts, ai_analysis: ai };
}

describe("the client object, the prompts and the deck", () => {
  // n8n's items: the Sprout item, then its Skip TikTok Trends and Skip Instagram Trends items (the request skipped trends).
  const n8nItems = [MOBURST.thumbnails, { source: "tiktok", _empty: true, _skipped: true, reason: "skipped" }, { source: "instagram", _empty: true, _skipped: true, reason: "skipped" }];
  const at = Date.parse(MOBURST.normalized._meta.generated_at);

  it("Build Normalized Client Object and Attach Competitive Context, with the stored trends where n8n put its scrapers' posts", async () => {
    const nodes = { "Workflow Configuration": config, "Combine Brief Context with Client Data": combined };
    const n8n = await runNode(nodeCode("Build Normalized Client Object"), nodes, n8nItems, { now: at });
    const port = plain(buildNormalizedClient([MOBURST.thumbnails], config, combined, new Date(at)));
    expect(withoutTrends(port)).toEqual(withoutTrends(n8n[0]));
    expect(withoutTrends(port)).toEqual(withoutTrends(MOBURST.normalized));
    expect(port.industry_trends).toBeNull();
    expect(port._meta).toMatchObject({ industry_themes: 0, industry_posts: 0 });
    const withContext = (await runNode(nodeCode("Attach Competitive Context"), { "Workflow Configuration": config }, [port]))[0];
    expect(plain(attachCompetitiveContext(port, config))).toEqual(withContext);
    expect(withContext.competitive_context).toEqual(MOBURST.competitive_context);
  });

  it("the synthesis prompts are n8n's with the writing edits and the industry trends only, with and without trends, Sprout and competitors", () => {
    const agent = nodeOf("AI Synthesis Agent").parameters;
    const edit = (t: string) => [...PROMPT_EDITS, ...TREND_EDITS].reduce((s, [from, to]) => s.split(from).join(to), t);
    const json = { ...MOBURST.normalized, competitive_context: MOBURST.competitive_context };
    const industry = { themes: [{ week_start: "2026-09-07", title: "AI planning", happening: "h", why_it_matters: "w", angle: "a", platforms: ["tiktok"], examples: [{ platform: "tiktok", format: "short_video", author: "x", text: "t", likes: 1, comments: 0, shares: 0, views: 9 }] }] };
    // Each variant holds what both read: n8n's condition reads its scrapers' posts, the port's the stored themes, and they agree.
    const variants = [
      json,
      { ...json, competitive_context: null },
      { ...json, sprout: { ...json.sprout, profiles: [] }, skip_trends: false, industry_trends: industry, trends: { tiktok: { posts: [{ url: "x" }], patterns: {} }, instagram: { posts: [], patterns: {} } } },
      { ...json, skip_trends: false, industry_trends: null },
      { ...json, context: { ...json.context, brand_voice: "", design_style_synthesis: { mood: "calm" }, languages: "en,he", geo: "US" } },
    ];
    for (const v of variants) {
      expect(synthesisSystem(v)).toBe(edit(template(agent.options.systemMessage, v)));
      expect(synthesisText(v)).toBe(edit(template(agent.text, v)));
    }
    // The prompts' own words have no dash as punctuation (the client's data may), and every trend edit applied.
    expect(edit(agent.options.systemMessage + agent.text)).not.toMatch(/[\u2013\u2014]|\w - \w/);
    const writingOnly = PROMPT_EDITS.reduce((t, [from, to]) => t.split(from).join(to), agent.options.systemMessage + agent.text);
    for (const [from] of TREND_EDITS) expect(writingOnly).toContain(from);
    for (const v of variants) expect(synthesisSystem(v) + synthesisText(v)).not.toMatch(/tiktok_trends_analysis|instagram_trends_analysis|trends\.tiktok/);
  });

  /** n8n's deck text with DECK_EDITS, the three lines the port states only when true, and DECK_TREND_EDITS (n8n had no trends, none are stored). */
  const asPort = (n8nText: string, normalized: Any, ai: Any) => {
    let t = [...DECK_EDITS, ...DECK_TREND_EDITS].reduce((s, [re, to]) => s.replace(re, to), n8nText);
    const ch = normalized.sprout?.month_comparison?.changes ?? {};
    if (!(ch.impressions?.percent < 0)) t = t.replace("• Address performance decline with increased posting frequency\n", "");
    const under = (ai.output ?? ai).sprout_performance_analysis?.pillar_alignment?.underrepresented?.[0];
    if (!under) t = t.replace("• Focus on underrepresented pillar: Client Wins\n", "");
    return t;
  };

  it("Build Presentation Content: n8n's deck prompt with its edits, for Moburst", async () => {
    const ai = { output: { ...MOBURST.ai.output } };
    delete ai.output.content_calendar;
    const noUnder = { output: { ...ai.output, sprout_performance_analysis: { ...ai.output.sprout_performance_analysis, pillar_alignment: { well_represented: [], underrepresented: [], recommendations: [] } } } };
    const rising = { ...MOBURST.normalized, sprout: { ...MOBURST.normalized.sprout, month_comparison: { ...MOBURST.normalized.sprout.month_comparison, changes: { ...MOBURST.normalized.sprout.month_comparison.changes, impressions: { current: 2, previous: 1, absolute: 1, percent: 100 } } } } };
    for (const [client, analysis] of [[MOBURST.normalized, ai], [MOBURST.normalized, noUnder], [rising, ai]] as Array<[Any, Any]>) {
      const n8n = (await runNode(nodeCode("Build Presentation Content"), { "Format Report Content": {}, "Build Normalized Client Object": client, "AI Synthesis Agent": analysis }, [], { now: NOW.getTime() }))[0];
      const port = plain(buildPresentationContent(client, analysis, NOW));
      expect(port.presentation_content).toBe(asPort(n8n.presentation_content, client, analysis));
      // The deck's own words have no dash as punctuation (captions and the analysis may).
      const clean = (v: Any): Any => JSON.parse(JSON.stringify(v).replace(/[\u2013\u2014]| - /g, ", "));
      expect(buildPresentationContent(clean(client), clean(analysis), NOW).presentation_content).not.toMatch(/[\u2013\u2014]|\w - \w/);
      expect({ ...port, presentation_content: null }).toEqual({ ...n8n, presentation_content: null });
    }
  });

  it("a fall in reach is said with the real post counts behind it", () => {
    const falling = { ...MOBURST.normalized, sprout: { ...MOBURST.normalized.sprout, month_comparison: { ...MOBURST.normalized.sprout.month_comparison, changes: { impressions: { current: 1, previous: 4, absolute: -3, percent: -75 } } } } };
    const text = buildPresentationContent(falling, MOBURST.ai, NOW).presentation_content;
    const now = MOBURST.normalized.sprout.platform_breakdown.reduce((s: number, p: Any) => s + p.post_count, 0);
    const before = MOBURST.normalized.sprout.platform_breakdown.reduce((s: number, p: Any) => s + p.previous_post_count, 0);
    expect(before).toBeGreaterThan(now);
    expect(text).toContain(`Content volume dropped from ${before} to ${now} posts, directly impacting reach.`);
    expect(text).not.toContain("from higher to fewer");
  });

  it("Check Gamma State, for every look n8n took", async () => {
    for (const [i, check] of [...MOBURST.gamma_checks.entries(), ...TRENDS.gamma_checks.entries()]) {
      const raw = { ...check };
      for (const k of ["_gamma_attempt", "_gamma_poll_again", "_gamma_timeout"]) delete raw[k];
      expect(plain(checkGammaState(raw, i + 1))).toEqual(check);
    }
    for (const run of [0, 18, 19, 25]) {
      const pending = { generationId: "g", status: "pending" };
      expect(plain(checkGammaState(pending, run + 1))).toEqual((await runNode(nodeCode("Check Gamma State"), {}, [pending], { runIndex: run }))[0]);
    }
  });
});

describe("Generate Run Summary", () => {
  it("is n8n's report, with the run's own start time and duration", async () => {
    const gamma = MOBURST.gamma_checks[MOBURST.gamma_checks.length - 1];
    const at = Date.parse(MOBURST.summary.completed_at);
    const nodes = {
      "Build Presentation Content": MOBURST.presentation, "Build Normalized Client Object": MOBURST.normalized, "Combine Brief Context with Client Data": combined,
      "Workflow Configuration": config, Webhook: { body: request }, "Aggregate Sprout Social Data": MOBURST.aggregate, "AI Synthesis Agent": MOBURST.ai,
      "Prepare Brief Text": MOBURST.prepared_brief, "Prepare Trend Inputs": MOBURST.trend_inputs,
    };
    const n8n = (await runNode(nodeCode("Generate Run Summary"), nodes, [gamma], { now: at }))[0];
    const started = new Date(at - 6 * 60_000);
    const port = plain(generateRunSummary({
      gamma, presentation: MOBURST.presentation, clientData: MOBURST.normalized, combined, config, sprout: MOBURST.aggregate, ai: MOBURST.ai,
      prepared: MOBURST.prepared_brief, industryTrends: null, startedAt: started, now: new Date(at),
    }));
    // n8n's summary node takes its own finish time as the start; the port takes the run's.
    expect(n8n).toMatchObject({ started_at: MOBURST.summary.completed_at, duration_minutes: 0 });
    expect(port).toMatchObject({ started_at: started.toISOString(), completed_at: MOBURST.summary.completed_at, duration_minutes: 6 });
    expect(summaryWithoutTrends({ ...port, started_at: null, duration_minutes: null })).toEqual(summaryWithoutTrends({ ...n8n, started_at: null, duration_minutes: null }));
    // And it is what n8n stored, but for the moment n8n took for collected_at (a millisecond later inside the same node).
    const at0 = (r: Any) => summaryWithoutTrends({ ...r, started_at: null, duration_minutes: null, sprout_performance: { ...r.sprout_performance, collected_at: null } });
    expect(at0(port)).toEqual(at0(MOBURST.summary));
    // In place of n8n's trend keys: the request skipped trends, so none were read.
    expect(port).toMatchObject({ industry_trends: null, trend_status: "skipped", data_counts: { tiktok_trends: 0, instagram_trends: 0, industry_trend_themes: 0, industry_trend_posts: 0 } });
    expect(port.ai_analysis.industry_trends_analysis).toBeNull();
    expect(port).not.toHaveProperty("tiktok_trends");
  });

  it("says when the deck did not complete or timed out, and when Sprout did not run", async () => {
    for (const gamma of [{ error: { message: "Gamma answered 500" } }, { generationId: "g", status: "pending", _gamma_timeout: true }]) {
      const nodes = {
        "Build Presentation Content": MOBURST.presentation, "Build Normalized Client Object": MOBURST.normalized, "Combine Brief Context with Client Data": combined,
        "Workflow Configuration": config, Webhook: { body: request }, "AI Synthesis Agent": MOBURST.ai, "Prepare Brief Text": MOBURST.prepared_brief, "Prepare Trend Inputs": MOBURST.trend_inputs,
      };
      const at = Date.parse(MOBURST.summary.completed_at);
      const n8n = (await runNode(nodeCode("Generate Run Summary"), nodes, [gamma], { now: at }))[0];
      const port = plain(generateRunSummary({
        gamma, presentation: MOBURST.presentation, clientData: MOBURST.normalized, combined, config, sprout: null, ai: MOBURST.ai,
        prepared: MOBURST.prepared_brief, industryTrends: null, startedAt: new Date(at), now: new Date(at),
      }));
      expect(summaryWithoutTrends(port)).toEqual(summaryWithoutTrends(n8n));
      expect(port.gamma_url).toBeNull();
    }
  });
});
