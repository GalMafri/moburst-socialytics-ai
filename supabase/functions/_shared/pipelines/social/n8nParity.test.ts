// @vitest-environment node
// Each ported node next to the n8n code it came from, on the same inputs, and
// both against what n8n made. The n8n code is the live workflow as the repo
// mirrors it (n8n/social-workflow.json, version 5f8d3abc, and the n8n/code
// copies of its nodes); it runs in a sandbox with n8n's $(), $input and
// $runIndex. The inputs are what n8n read in two real runs (fixtures/social.ts):
// Moburst's September report (execution 574962) and a September trend
// research (execution 583953).
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { apidojoSearchFor, MOBURST, mirror, moburstPages, moburstRequest, nodeCode, nodeOf, TRENDS } from "../fixtures/social";
import { BRIEF_SYSTEM, PROMPT_EDITS, synthesisSystem, synthesisText } from "./prompt";
import { sproutRequests } from "./providers";
import {
  aggregateSprout, attachCompetitiveContext, attachPostThumbnails, buildNormalizedClient, buildPresentationContent, checkGammaState, combineBrief, DECK_EDITS,
  generateRunSummary, normalizeInstagram, normalizeTikTok, prepareBriefText, prepareTrendInputs, skipSproutAnalytics, sproutSetup, trendFailed, trendSkipped,
  workflowConfiguration,
} from "./nodes";

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
      expect(plain(prepareBriefText(cfg, { text: file || undefined }))).toEqual(n8n[0]);
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

describe("trends", () => {
  const client = TRENDS.client;

  it("Prepare Trend Inputs, with keywords, skipped, and without keywords; TikTok's search as n8n's, on apidojo", async () => {
    // Everything as n8n's node, except the TikTok actor's input: n8n's search on apidojo (social/nodes.ts says why).
    const cases: [Any, string | undefined][] = [
      [client, "US"], [combined, "US"], [{ ...client, social_keywords: [], trends_keywords: "" }, "US"],
      [{ ...client, geo: ["IL", "US"], social_keywords: ["שיווק דיגיטלי", "app growth"] }, "IL"],
      [{ ...client, geo: "UK,Global" }, "GB"], [{ ...client, geo: "Global" }, undefined],
    ];
    for (const [c, location] of cases) {
      const n8n = (await runNode(nodeCode("Prepare Trend Inputs"), {}, [c]))[0];
      const port = plain(prepareTrendInputs(c));
      expect({ ...port, trend_inputs: { ...port.trend_inputs, tiktok: null } }).toEqual({ ...n8n, trend_inputs: { ...n8n.trend_inputs, tiktok: null } });
      expect(port.trend_inputs.tiktok).toEqual(apidojoSearchFor(n8n.trend_inputs.tiktok, location));
    }
    const port = plain(prepareTrendInputs(client));
    expect(port.trend_status).toEqual(TRENDS.trend_inputs.trend_status);
    expect(port.trend_inputs).toEqual({ ...TRENDS.trend_inputs.trend_inputs, tiktok: apidojoSearchFor(TRENDS.trend_inputs.trend_inputs.tiktok, "US") });
    expect(port.trend_inputs.tiktok).toEqual({
      keywords: ["beer league", "adult rec hockey", "captain life", "stop chasing start playing", "hockey captain", "beer league US", "adult rec hockey US", "captain life US"],
      dateRange: "THIS_MONTH", sortType: "MOST_LIKED", location: "US", maxItems: 400, includeSearchKeywords: true,
    });
  });

  it("Normalize TikTok Trends, on apidojo's rows: its fields read, a post two searches found counted once", () => {
    // Rows as apidojo/tiktok-scraper returns them (28 Oct 2026), trimmed to what the normalizer reads.
    const row = (o: Any) => ({ id: "0", title: "", views: 0, likes: 0, comments: 0, shares: 0, hashtags: [], keyword: "content strategy", ...o });
    const machine = row({
      id: "7563", title: "This is how to use Claude as a viral content machine #marketing #socialmedia #contentcreator #contentstrategy #video",
      views: 26915, likes: 1746, comments: 170, shares: 473, uploadedAtFormatted: "2026-10-20T12:52:02.000Z",
      postPage: "https://www.tiktok.com/@kallaway.marketing/video/7563", channel: { username: "kallaway.marketing" },
      hashtags: ["marketing", "socialmedia", "contentcreator", "contentstrategy", "video"],
    });
    const better = row({
      id: "7561", title: "How to Use AI to Make Better Content, and help you create videos people actually want to watch #ContentStrategy",
      views: 1623, likes: 68, comments: 11, shares: 7, uploadedAtFormatted: "2026-10-14T04:27:03.000Z",
      // apidojo lists a hashtag it could not read as null (28 Oct 2026, run Sah0mdLXffUz4YgEV).
      postPage: "https://www.tiktok.com/@benkimball.ai/video/7561", channel: { username: "benkimball.ai" }, hashtags: [null, "aitools", null, "contentstrategy"],
    });
    const old = row({ ...better, id: "7400", uploadedAtFormatted: "2026-08-01T10:00:00.000Z", postPage: "https://www.tiktok.com/@benkimball.ai/video/7400" });
    const unrelated = row({ id: "7562", title: "This is my morning routine with you all", likes: 90000, uploadedAtFormatted: "2026-10-15T10:00:00.000Z", postPage: "https://www.tiktok.com/@someone/video/7562", channel: { username: "someone" } });
    const c = { ...client, social_keywords: ["content strategy"], trends_keywords: "", languages: ["en"], date_ranges: { current_month: { start: "2026-10-01", end: "2026-10-31" } } };
    // A row with every field it reads empty is passed over, not a failed step.
    const blank = { id: null, title: null, views: null, likes: null, comments: null, shares: null, postPage: null, uploadedAtFormatted: null, channel: null, hashtags: null, keyword: null };
    const out = plain(normalizeTikTok([machine, blank, better, machine, old, unrelated], c));
    expect(out.map((p: Any) => [p.rank, p.url, p.author, p.created])).toEqual([
      [1, "https://www.tiktok.com/@kallaway.marketing/video/7563", "kallaway.marketing", "2026-10-20T12:52:02.000Z"],
      [2, "https://www.tiktok.com/@benkimball.ai/video/7561", "benkimball.ai", "2026-10-14T04:27:03.000Z"],
    ]);
    expect(out[0]).toMatchObject({ caption: machine.title, views: 26915, likes: 1746, comments: 170, shares: 473, hashtags: machine.hashtags, is_ad: false });
    expect(out[1].hashtags).toEqual(["aitools", "contentstrategy"]);
  });

  it("Normalize TikTok Trends, on the 203 posts the scraper returned", async () => {
    const n8n = await runNode(nodeCode("Normalize TikTok Trends"), { "Combine Brief Context with Client Data": client }, TRENDS.tiktok_items);
    const port = plain(normalizeTikTok(TRENDS.tiktok_items, client));
    expect(port).toEqual(n8n);
    expect(port).toEqual(TRENDS.tiktok_normalized);
    // And with nothing relevant: n8n's placeholder.
    const none = { ...client, social_keywords: ["nothing matches this"], trends_keywords: "" };
    expect(plain(normalizeTikTok(TRENDS.tiktok_items, none))).toEqual(await runNode(nodeCode("Normalize TikTok Trends"), { "Combine Brief Context with Client Data": none }, TRENDS.tiktok_items));
  });

  it("Normalize Instagram Trends, on the 346 items the scraper returned (error items included)", async () => {
    const n8n = await runNode(nodeCode("Normalize Instagram Trends"), { "Combine Brief Context with Client Data": client }, TRENDS.instagram_items);
    const port = plain(normalizeInstagram(TRENDS.instagram_items, client));
    expect(port).toEqual(n8n);
    expect(port).toEqual(TRENDS.instagram_normalized);
    const hebrew = { ...client, languages: ["he"] };
    expect(plain(normalizeInstagram(TRENDS.instagram_items, hebrew))).toEqual(await runNode(nodeCode("Normalize Instagram Trends"), { "Combine Brief Context with Client Data": hebrew }, TRENDS.instagram_items));
  });

  it("the skip and failed items", async () => {
    const status = { trend_status: { tiktok: "skipped", instagram: "missing_keywords" } };
    expect(trendSkipped("tiktok", "skipped")).toEqual((await runNode(nodeCode("Skip TikTok Trends").replace(/\$json/g, "$input.first().json"), {}, [status]))[0]);
    expect(trendSkipped("instagram", "missing_keywords")).toEqual((await runNode(nodeCode("Skip Instagram Trends").replace(/\$json/g, "$input.first().json"), {}, [status]))[0]);
    const error = { error: { message: "Actor run failed: TIMED-OUT" } };
    expect(trendFailed("tiktok", error.error)).toEqual((await runNode(nodeCode("TikTok Trends Failed"), {}, [error]))[0]);
    expect(trendFailed("instagram", error.error)).toEqual((await runNode(nodeCode("Instagram Trends Failed"), {}, [error]))[0]);
  });
});

describe("the client object, the prompts and the deck", () => {
  const items = [MOBURST.thumbnails, trendSkipped("tiktok", "skipped"), trendSkipped("instagram", "skipped")];
  const at = Date.parse(MOBURST.normalized._meta.generated_at);

  it("Build Normalized Client Object and Attach Competitive Context", async () => {
    const nodes = { "Workflow Configuration": config, "Combine Brief Context with Client Data": combined };
    const n8n = await runNode(nodeCode("Build Normalized Client Object"), nodes, items, { now: at });
    const port = plain(buildNormalizedClient(items, config, combined, new Date(at)));
    expect(port).toEqual(n8n[0]);
    expect(port).toEqual(MOBURST.normalized);
    const withContext = (await runNode(nodeCode("Attach Competitive Context"), { "Workflow Configuration": config }, [port]))[0];
    expect(plain(attachCompetitiveContext(port, config))).toEqual(withContext);
    expect(withContext.competitive_context).toEqual(MOBURST.competitive_context);
  });

  it("the synthesis prompts are n8n's with the writing edits only, with and without trends, Sprout and competitors", () => {
    const agent = nodeOf("AI Synthesis Agent").parameters;
    const edit = (t: string) => PROMPT_EDITS.reduce((s, [from, to]) => s.split(from).join(to), t);
    const json = { ...MOBURST.normalized, competitive_context: MOBURST.competitive_context };
    const variants = [
      json,
      { ...json, competitive_context: null },
      { ...json, sprout: { ...json.sprout, profiles: [] }, skip_trends: false, trends: { tiktok: { posts: [{ url: "x" }], patterns: {} }, instagram: { posts: [], patterns: {} } } },
      { ...json, context: { ...json.context, brand_voice: "", design_style_synthesis: { mood: "calm" }, languages: "en,he", geo: "US" } },
    ];
    for (const v of variants) {
      expect(synthesisSystem(v)).toBe(edit(template(agent.options.systemMessage, v)));
      expect(synthesisText(v)).toBe(edit(template(agent.text, v)));
    }
    // The prompts' own words have no dash as punctuation (the client's data may).
    expect(edit(agent.options.systemMessage + agent.text)).not.toMatch(/[\u2013\u2014]|\w - \w/);
  });

  /** n8n's deck text with DECK_EDITS, and the three lines the port states only when true. */
  const asPort = (n8nText: string, normalized: Any, ai: Any) => {
    let t = DECK_EDITS.reduce((s, [re, to]) => s.replace(re, to), n8nText);
    const ch = normalized.sprout?.month_comparison?.changes ?? {};
    if (!(ch.impressions?.percent < 0)) t = t.replace("• Address performance decline with increased posting frequency\n", "");
    const under = (ai.output ?? ai).sprout_performance_analysis?.pillar_alignment?.underrepresented?.[0];
    if (!under) t = t.replace("• Focus on underrepresented pillar: Client Wins\n", "");
    return t;
  };

  it("Build Presentation Content: n8n's deck prompt with its edits, for Moburst and with trends", async () => {
    const ai = { output: { ...MOBURST.ai.output } };
    delete ai.output.content_calendar;
    const trendClient = {
      ...MOBURST.normalized,
      trends: {
        tiktok: { posts: TRENDS.tiktok_normalized, patterns: buildNormalizedClient([...TRENDS.tiktok_normalized], config, combined, NOW).trends.tiktok.patterns },
        instagram: { posts: TRENDS.instagram_normalized, patterns: buildNormalizedClient([...TRENDS.instagram_normalized], config, combined, NOW).trends.instagram.patterns },
      },
    };
    const trendAi = { output: { ...ai.output, ...TRENDS.ai_trends } };
    const noUnder = { output: { ...ai.output, sprout_performance_analysis: { ...ai.output.sprout_performance_analysis, pillar_alignment: { well_represented: [], underrepresented: [], recommendations: [] } } } };
    const rising = { ...MOBURST.normalized, sprout: { ...MOBURST.normalized.sprout, month_comparison: { ...MOBURST.normalized.sprout.month_comparison, changes: { ...MOBURST.normalized.sprout.month_comparison.changes, impressions: { current: 2, previous: 1, absolute: 1, percent: 100 } } } } };
    for (const [client, analysis] of [[MOBURST.normalized, ai], [trendClient, trendAi], [MOBURST.normalized, noUnder], [rising, ai]] as Array<[Any, Any]>) {
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
      prepared: MOBURST.prepared_brief, trendStatus: MOBURST.trend_inputs.trend_status, startedAt: started, now: new Date(at),
    }));
    // n8n's summary node takes its own finish time as the start; the port takes the run's.
    expect(n8n).toMatchObject({ started_at: MOBURST.summary.completed_at, duration_minutes: 0 });
    expect(port).toMatchObject({ started_at: started.toISOString(), completed_at: MOBURST.summary.completed_at, duration_minutes: 6 });
    expect({ ...port, started_at: null, duration_minutes: null }).toEqual({ ...n8n, started_at: null, duration_minutes: null });
    // And it is what n8n stored, but for the moment n8n took for collected_at (a millisecond later inside the same node).
    const at0 = (r: Any) => ({ ...r, started_at: null, duration_minutes: null, sprout_performance: { ...r.sprout_performance, collected_at: null } });
    expect(at0(port)).toEqual(at0(MOBURST.summary));
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
        prepared: MOBURST.prepared_brief, trendStatus: MOBURST.trend_inputs.trend_status, startedAt: new Date(at), now: new Date(at),
      }));
      expect(port).toEqual(n8n);
      expect(port.gamma_url).toBeNull();
    }
  });
});
