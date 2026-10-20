// @vitest-environment node
// Each ported node next to the n8n code it came from, on the same inputs.
// The n8n code is the repo's mirror (n8n/code/*.js and
// n8n/linkedin-source-workflow.json), which holds the live versions'
// code (EBiAwSay3H2R8krv 079ef9fd, xm3ZFPjysyQCkWsc 29ba2340), except where
// the repo is newer (the aggregation, see aggregate.ts). It runs in a sandbox
// with n8n's $() and $input, after the shared helpers it is published with
// (n8n/competitive-metric-coverage.mjs), on Moburst's September 2026 inputs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { fakeDb } from "../../lifecycle/fakeDb";
import { buildCompetitivePayload } from "../../reports/payloads";
import { FX, linkedInRows, owned, POSTS, snap } from "../fixtures/moburst";
import { linkedInActorInput, mergeLinkedInPosts, prepareCompetitiveLinkedInSources, prepareSourceRequest, verifyLinkedInRows, linkedInSourceAnswer } from "../linkedin/sources";
import { aggregateCompetitive } from "./aggregate";
import { assembleReportData, buildPostWindows, checkReadiness, mergeOwnedPosts, mergePostPages, previousPeriodOf, resolveLandscape, runConfig } from "./nodes";

// deno-lint-ignore no-explicit-any
type Any = any;
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const mirror = (name: string) => readFileSync(join(root, "n8n", "code", `${name}.js`), "utf8");
const helper = (rel: string) => ts.transpileModule(readFileSync(join(root, rel), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } })
  .outputText.replace(/^import .*$/gm, "").replace(/^export \{[^}]*\} from .*$/gm, "").replace(/^export /gm, "");
const METRIC_HELPERS = helper("supabase/functions/_shared/competitive/reportMetrics.ts") + "\n" + helper("supabase/functions/_shared/competitive/postSample.ts");
const OWNED_HELPERS = helper("supabase/functions/_shared/competitive/ownedMerge.ts");
const liWorkflow = JSON.parse(readFileSync(join(root, "n8n", "linkedin-source-workflow.json"), "utf8"));
const liNode = (name: string) => liWorkflow.nodes.find((n: Any) => n.name === name).parameters.jsCode as string;

const NOW = Date.parse("2026-10-07T07:28:00.000Z");
/** A Date whose "now" is NOW, so code that reads the clock gives one answer. */
class FixedDate extends Date {
  // deno-lint-ignore no-explicit-any
  constructor(...args: any[]) { if (args.length) super(...(args as [])); else super(NOW); }
  static now() { return NOW; }
}

/** Runs an n8n Code node: $("Node").first().json, $input, $runIndex; returns its items' json. */
function runNode(code: string, nodes: Record<string, Any>, input: Any[] = [], o: { prefix?: string; runIndex?: number } = {}): Any[] {
  const $ = (name: string) => {
    const v = nodes[name];
    const items = (Array.isArray(v) ? v : [v]).map((json: Any) => ({ json }));
    return { first: () => items[0], all: () => items };
  };
  const out = vm.runInNewContext(`(function(){${o.prefix ?? ""}\n${code}\n})()`, {
    $, $input: { first: () => ({ json: input[0] }), all: () => input.map((json) => ({ json })) }, $runIndex: o.runIndex ?? 0, Date: FixedDate, console,
  });
  return JSON.parse(JSON.stringify(out.map((i: Any) => i.json)));
}
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
/** The two throw the same failure: the same code word, or the same sentence (the port writes a colon where n8n wrote a dash). */
function sameFailure(n8n: () => unknown, port: () => unknown) {
  let a = ""; let b = "";
  try { n8n(); } catch (e) { a = (e as Error).message; }
  try { port(); } catch (e) { b = (e as Error).message; }
  expect(a, "n8n threw").not.toBe("");
  expect(b.replace(/: /, " ").split(/\s+/)[0]).toBe(a.split(/\s+/)[0]);
}

// The request n8n got for this report, built as the dispatch builds it.
async function request(): Promise<Any> {
  const db = fakeDb({ competitors: FX.competitors, sprout_profiles: FX.sprout_profiles, competitive_insight_feedback: [], competitive_learnings: [] });
  return await buildCompetitivePayload({ supabase: db, client: FX.client, reportId: FX.report.id, attemptStartedAt: FX.report.created_at, set: FX.set, range: { start: "2026-09-01", end: "2026-09-30" } });
}
const landscapes = () => [
  { id: 1, name: "Other", focusCompanyId: 9, companies: [{ id: 9, name: "Someone", url: "https://someone.com" }] },
  { id: Number(FX.real_landscape.id), name: FX.real_landscape.name, focusCompanyId: FX.real_landscape.focus_company_id, companies: snap("companies").companies },
];

describe("ported competitive nodes next to their n8n code", () => {
  it("Run Config and Resolve Landscape, matched by id and by verification", async () => {
    const body = await request();
    for (const hint of [body.rivaliq_landscape_id, ""]) {
      const b = { ...body, rivaliq_landscape_id: hint || undefined };
      const cfg = runConfig(b, new Date(NOW));
      expect(cfg).toMatchObject({ report_id: FX.report.id, client_name: "Moburst", range_start: "2026-09-01", range_end: "2026-09-30", landscape_hint: hint || "" });
      const n8n = runNode(mirror("competitive-resolve"), { "Run Config": cfg, "Competitive Webhook": { body: b } }, [landscapes()]);
      expect(plain([resolveLandscape(cfg, b, landscapes())])).toEqual(n8n);
    }
    const cfg = runConfig({ ...body, rivaliq_landscape_id: "77" }, new Date(NOW));
    sameFailure(() => runNode(mirror("competitive-resolve"), { "Run Config": cfg, "Competitive Webhook": { body } }, [landscapes()]), () => resolveLandscape(cfg, body, landscapes()));
    const wrongClient = runConfig({ ...body, website_url: "https://elsewhere.com", rivaliq_landscape_id: undefined }, new Date(NOW));
    sameFailure(() => runNode(mirror("competitive-resolve"), { "Run Config": wrongClient, "Competitive Webhook": { body: { ...body, website_url: "https://elsewhere.com" } } }, [landscapes()]), () => resolveLandscape(wrongClient, { ...body, website_url: "https://elsewhere.com" }, landscapes()));
    sameFailure(() => runNode(mirror("competitive-resolve"), { "Run Config": cfg, "Competitive Webhook": { body } }, [[]]), () => resolveLandscape(cfg, body, []));
  });

  it("Check RivalIQ Readiness", () => {
    for (const [status, run] of [[1, 0], [2, 0], [2, 29], [1, 31]] as Array<[number, number]>) {
      expect(plain([checkReadiness(status, run)])).toEqual(runNode(mirror("check-rivaliq-readiness"), {}, [{ status }], { runIndex: run }));
    }
    for (const [status, run] of [[2, 30], [0, 0], ["1", 0]] as Array<[Any, number]>) {
      sameFailure(() => runNode(mirror("check-rivaliq-readiness"), {}, [{ status }], { runIndex: run }), () => checkReadiness(status, run));
    }
  });

  it("Build Post Windows and Merge Post Pages, with a missing window and a full page", () => {
    for (const [start, end] of [["2026-09-01", "2026-09-30"], ["2026-09-30", "2026-09-30"], ["2026-02-01", "2026-03-15"]]) {
      expect(plain(buildPostWindows({ range_start: start, range_end: end }, 652500))).toEqual(runNode(mirror("build-post-windows"), { "Run Config": { range_start: start, range_end: end }, "Resolve Landscape": { landscape_id: 652500 } }));
    }
    for (const [start, end] of [["2026-09-30", "2026-09-01"], ["2026-01-01", "2027-03-01"]]) {
      sameFailure(() => runNode(mirror("build-post-windows"), { "Run Config": { range_start: start, range_end: end }, "Resolve Landscape": { landscape_id: 1 } }), () => buildPostWindows({ range_start: start, range_end: end }, 1));
    }
    const rival = POSTS.socialPosts.filter((p: Any) => !p.source);
    const pages = [{ socialPosts: rival.slice(0, 10) }, { socialPosts: [...rival.slice(5, 20)] }, { socialPosts: Array.from({ length: 500 }, (_, i) => ({ postId: `x${i}` })) }];
    expect(plain(mergePostPages(pages, 4))).toEqual(runNode(mirror("merge-post-pages"), { "Build Post Windows": [{}, {}, {}, {}] }, pages)[0]);
  });

  it("Prepare LinkedIn Sources and Merge LinkedIn Posts, with the previous period and follower snapshots", async () => {
    const body = await request();
    const cfg = runConfig(body, new Date(NOW));
    const landscape = resolveLandscape(cfg, body, landscapes());
    const plan = prepareCompetitiveLinkedInSources(cfg, body, landscape);
    const n8nPlan = runNode(mirror("prepare-linkedin-sources"), { "Run Config": cfg, "Competitive Webhook": { body }, "Resolve Landscape": landscape }, [{}])[0];
    // The port's plan also carries the range, which n8n's Merge LinkedIn Posts reads from Run Config.
    const { range_start, range_end, ...asN8n } = plan;
    expect([range_start, range_end]).toEqual(["2026-09-01", "2026-09-30"]);
    expect(plain(asN8n)).toEqual(n8nPlan);
    expect(plan.input).toEqual(linkedInActorInput(plan.sources, "2026-08-02"));
    const rival = { socialPosts: POSTS.socialPosts.filter((p: Any) => !p.source), pages: 5, expected_windows: 5, failed_windows: 0, truncated_pages: 0, page_limit: 500 };
    const rows = linkedInRows();
    const n8n = runNode(mirror("merge-linkedin-posts"), { "Run Config": cfg, "Prepare LinkedIn Sources": n8nPlan, "Merge Post Pages": rival }, rows);
    const port = mergeLinkedInPosts(rival, plan, verifyLinkedInRows(rows, plan, { previous: plan.previous_period, audience: true, today: new Date(NOW).toISOString().slice(0, 10) }));
    expect(plain([port])).toEqual(n8n);
    // The same LinkedIn figures n8n saved for the report.
    expect(port.additional_metrics).toEqual(POSTS.additional_metrics);
    // No sources: n8n's false branch still runs Merge LinkedIn Posts on nothing.
    const none = { ...plan, sources: [], has_sources: false };
    expect(plain([mergeLinkedInPosts(rival, none, verifyLinkedInRows([], none, { previous: none.previous_period, audience: true, today: "2026-10-07" }))]))
      .toEqual(runNode(mirror("merge-linkedin-posts"), { "Run Config": cfg, "Prepare LinkedIn Sources": none, "Merge Post Pages": rival }, [{}]));
  });

  it("Merge LinkedIn Posts refuses what n8n refuses", async () => {
    const body = await request();
    const cfg = runConfig(body, new Date(NOW));
    const plan = prepareCompetitiveLinkedInSources(cfg, body, resolveLandscape(cfg, body, landscapes()));
    const good = linkedInRows()[0];
    const bad: Array<[string, Any]> = [
      ["error row", { ...good, type: "error", error: "blocked" }],
      ["unknown page", { ...good, query: { targetUrl: "https://www.linkedin.com/company/nobody" } }],
      ["other author", { ...good, author: { type: "company", linkedinUrl: "https://www.linkedin.com/company/impostor" } }],
      ["no date", { ...good, postedAt: {} }],
      ["no shares count", { ...good, engagement: { likes: 1, comments: 0 } }],
      ["limit reached", null],
    ];
    for (const [what, row] of bad) {
      const rows = row ? [row] : Array.from({ length: 150 }, (_, i) => ({ ...good, id: `n${i}`, linkedinUrl: `https://www.linkedin.com/posts/n${i}` }));
      sameFailure(
        () => runNode(mirror("merge-linkedin-posts"), { "Run Config": cfg, "Prepare LinkedIn Sources": plain(plan), "Merge Post Pages": { socialPosts: [] } }, rows),
        () => verifyLinkedInRows(rows, plan, { previous: plan.previous_period, audience: true, today: "2026-10-07" }),
      );
      expect(what).toBeTruthy();
    }
  });

  it("Merge Owned Posts, with the client's Sprout collection, none connected, and a mismatched period", async () => {
    const body = await request();
    const cfg = runConfig(body, new Date(NOW));
    const landscape = resolveLandscape(cfg, body, landscapes());
    const input = { socialPosts: POSTS.socialPosts.filter((p: Any) => p.source !== "sprout"), pages: 5 };
    const cases = [
      { client_id: cfg.client_id, ...(await owned()) },
      { client_id: cfg.client_id, provider: "sprout", coverage: "not_connected", profiles: [], posts: [], metrics: null, period: { start: "2026-09-01", end: "2026-09-30" } },
    ];
    for (const collected of cases) {
      expect(plain([mergeOwnedPosts(cfg, landscape, collected, input)])).toEqual(runNode(mirror("merge-owned-posts"), { "Run Config": cfg, "Resolve Landscape": landscape, "Collect Owned Client Data": collected, "Merge LinkedIn Posts": input }, [], { prefix: OWNED_HELPERS }));
    }
    const shifted = { ...cases[0], period: { start: "2026-09-02", end: "2026-09-30" } };
    sameFailure(() => runNode(mirror("merge-owned-posts"), { "Run Config": cfg, "Resolve Landscape": landscape, "Collect Owned Client Data": shifted, "Merge LinkedIn Posts": input }, [], { prefix: OWNED_HELPERS }), () => mergeOwnedPosts(cfg, landscape, shifted, input));
  });

  it("Aggregate Competitive Data (the repo's code, newer than the live node) and Assemble Report Data", async () => {
    const body = await request();
    const cfg = runConfig(body, new Date(Date.parse(FX.report.created_at)));
    const landscape = resolveLandscape(cfg, body, landscapes());
    const metrics = snap("metrics");
    const nodes = {
      "Run Config": cfg, "Resolve Landscape": landscape, "Landscape Companies": snap("companies"), "Merge Owned Posts": POSTS,
      "Landscape Metrics Summary": metrics.summary, "Landscape Metrics Summary Previous": metrics.summary_previous,
      "Landscape Metrics Timeseries": metrics.timeseries, "Landscape Audience Snapshot": metrics.audience_snapshot, "Competitive Webhook": { body },
    };
    const n8n = runNode(mirror("competitive-aggregate"), nodes, [], { prefix: METRIC_HELPERS })[0];
    const port = aggregateCompetitive({ cfg, landscape, companiesResp: snap("companies"), postsResp: POSTS, metricsResp: metrics.summary, metricsPrevResp: metrics.summary_previous, seriesResp: metrics.timeseries, audienceResp: metrics.audience_snapshot, body });
    expect(plain(port)).toEqual(n8n);
    // An error answer from a period read (n8n continues with it) reads as no metrics.
    const failed = { ...nodes, "Landscape Metrics Summary": { error: { message: "500" } } };
    expect(plain(aggregateCompetitive({ cfg, landscape, companiesResp: snap("companies"), postsResp: POSTS, metricsResp: { error: { message: "500" } }, metricsPrevResp: metrics.summary_previous, seriesResp: metrics.timeseries, audienceResp: metrics.audience_snapshot, body })))
      .toEqual(runNode(mirror("competitive-aggregate"), failed, [], { prefix: METRIC_HELPERS })[0]);
    sameFailure(
      () => runNode(mirror("competitive-aggregate"), { ...nodes, "Merge Owned Posts": { ...POSTS, failed_windows: 1 } }, [], { prefix: METRIC_HELPERS }),
      () => aggregateCompetitive({ cfg, landscape, companiesResp: snap("companies"), postsResp: { ...POSTS, failed_windows: 1 }, metricsResp: metrics.summary, metricsPrevResp: metrics.summary_previous, seriesResp: metrics.timeseries, audienceResp: metrics.audience_snapshot, body }),
    );

    const assembleNodes = { "Run Config": cfg, "Resolve Landscape": landscape, "Aggregate Competitive Data": n8n, "Merge Post Pages": { pages: 5 } };
    const n8nBody = JSON.parse(runNode(mirror("competitive-report"), assembleNodes, [{ output: FX.real_analysis }], { prefix: METRIC_HELPERS })[0].body_string);
    const assembled = assembleReportData({ landscape, aggregates: port, pages: 5, analysis: FX.real_analysis, startedAt: cfg.started_at, now: new Date(NOW) });
    expect(assembled.report_data).toEqual(n8nBody.report_data);
    expect(assembled.duration_minutes).toBe(n8nBody.duration_minutes);
    expect(previousPeriodOf(cfg)).toEqual({ start: "2026-08-02", end: "2026-08-31" });
  });
});

describe("ported LinkedIn source nodes next to xm3ZFPjysyQCkWsc", () => {
  const sources = POSTS.linkedin_sources;
  const period = { start: "2026-09-01", end: "2026-09-30" };

  it("Prepare Source Request and Verify Source Posts give the webhook's answer", () => {
    const n8nPlan = runNode(liNode("Prepare Source Request"), {}, [{ body: { sources, period } }])[0];
    const plan = prepareSourceRequest({ sources, period });
    expect(plain(plan)).toEqual(n8nPlan);
    const rows = linkedInRows();
    const n8n = runNode(liNode("Verify Source Posts"), { "Prepare Source Request": n8nPlan }, rows)[0];
    expect(plain(linkedInSourceAnswer(plan, verifyLinkedInRows(rows, plan, { today: "2026-10-07" })))).toEqual(n8n);
  });

  it("refuses the requests n8n refuses", () => {
    const bad: Array<Record<string, unknown>> = [
      { sources, period: { start: "2026-09-30", end: "2026-09-01" } },
      { sources: [], period },
      { sources: [{ company_id: "1", name: "X", profile_url: "https://linkedin.com/company/x" }], period },
      { sources: [...sources, sources[0]], period },
    ];
    for (const body of bad) sameFailure(() => runNode(liNode("Prepare Source Request"), {}, [{ body }]), () => prepareSourceRequest(body as Any));
  });
});
