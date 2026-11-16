// @vitest-environment node
// The stored social report keeps each top post's own picture (QA AT-05, LIVE-08,
// REPORTS-02). Sprout carries the creative of a post as visual_media; the
// Attach Post Thumbnails step stamps it onto the posts, and the report the run
// writes is made from that stamped item, so every top post whose read carried
// a creative stores its thumbnail_url and media_type.
import { describe, expect, it } from "vitest";
import { MOBURST, moburstPages, moburstRequest } from "../../../fixtures/pipelines/social";
import { makeRegistry } from "../../../functions/_shared/pipelines/registry";
import { startReportPipeline } from "../../../functions/_shared/pipelines/shadow";
import { drivePipeline, pipelineDb, testClock } from "../../../functions/_shared/pipelines/testDriver";
import type { GammaClient, SproutReader } from "../../../functions/_shared/pipelines/social/providers";
import { socialPipeline, type SocialDeps } from "../../../functions/_shared/pipelines/definitions/social";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Sprout answers untyped JSON.
type Any = any;

const REPORT = MOBURST.stored_report;
const CLIENT = REPORT.client_id;
const PERIOD = { start: "2026-09-01", end: "2026-09-30" };
const ENV = (n: string) => ({ ANTHROPIC_API_KEY: "ak", SPROUT_CLIENT_ID: "si", SPROUT_CLIENT_SECRET: "ss", GAMMA_API_KEY: "gk" } as Record<string, string>)[n];

function deps(): SocialDeps {
  const pages = moburstPages();
  const requests: Any[] = [];
  const looks = MOBURST.gamma_checks.map((c: Any) => { const r = { ...c }; for (const k of ["_gamma_attempt", "_gamma_poll_again", "_gamma_timeout"]) delete r[k]; return r; });
  let i = 0;
  return {
    sprout: () => ({
      async pages(path, body) {
        const filter = String((body.filters as string[])[1]);
        const read = path === "profiles" ? (filter.includes("2026-09-01") ? "current" : "previous") : (filter.includes("2026-09-01") ? "posts" : "previous_posts");
        return pages[read as keyof typeof pages];
      },
    } satisfies SproutReader),
    gamma: () => ({ async create() { return MOBURST.gamma_create; }, async read() { return looks[Math.min(i++, looks.length - 1)]; } } satisfies GammaClient),
    claudeFetch: async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const req = JSON.parse(String(init.body)).requests[0];
        requests.push(req);
        return new Response(JSON.stringify({ id: `batch-${requests.length}` }));
      }
      const n = Number(url.match(/batch-(\d+)/)?.[1] ?? 0);
      const req = requests[n - 1];
      if (url.endsWith("/results")) {
        const brief = String(req.custom_id).endsWith("source_brief");
        const text = JSON.stringify(brief ? MOBURST.brief_analysis.output : MOBURST.ai.output);
        return new Response(JSON.stringify({ custom_id: req.custom_id, result: { type: "succeeded", message: { content: [{ type: "text", text }], stop_reason: "end_turn" } } }) + "\n");
      }
      return new Response(JSON.stringify({ processing_status: "ended", results_url: `https://api.anthropic.com/v1/messages/batches/batch-${n}/results` }));
    },
    insights: () => async (body) => {
      const content = String((body.messages as Any[])[0].content);
      const facts = [...content.matchAll(/^(F\d+) \([a-z]+\): (.+?) \((.+)\)$/gm)].map((m) => ({ id: m[1], sentence: m[2] }));
      const answer = { summary: { text: facts[0].sentence, facts: [facts[0].id] }, insights: facts.slice(0, 3).map((f) => ({ text: f.sentence, facts: [f.id] })), recommendations: [{ text: "Plan next month.", facts: [facts[0].id] }] };
      return { text: JSON.stringify(answer), stopReason: "end_turn", raw: { usage: { input_tokens: 1, output_tokens: 1 } } };
    },
  };
}

describe("the social report stores each top post's thumbnail", () => {
  it("a run whose Sprout posts read carries visual_media stores thumbnail_url on every top post it matches", async () => {
    const clock = testClock("2026-10-16T20:59:24.047Z");
    const db = pipelineDb({
      reports: [{ id: REPORT.id, client_id: CLIENT, status: "completed", created_at: REPORT.created_at, date_range_start: PERIOD.start, date_range_end: PERIOD.end, report_data: REPORT.report_data, gamma_url: REPORT.gamma_url, clients: { name: "Moburst", archived_at: null } }],
    }, () => clock.now());
    const rpc = db.rpc.bind(db);
    db.rpc = async (name, args) => (name === "report_insights_live_from" ? { data: "2026-10-01T00:00:00.000Z", error: null } : rpc(name, args));
    const pipeline = socialPipeline(deps());
    const registry = makeRegistry([pipeline], () => true);
    const { run_id } = await startReportPipeline(db, { mode: "shadow", kind: "social", pipeline, clientId: CLIENT, reportId: REPORT.id, range: PERIOD, request: moburstRequest() });
    const driven = await drivePipeline(db, registry, run_id, { clock, env: ENV });
    expect(driven.outcome.status).toBe("done");

    // The posts the Sprout read gave a creative for.
    const withCreative = new Set<string>();
    for (const page of [...moburstPages().posts, ...moburstPages().previous_posts]) {
      for (const p of page.data) if (p.perma_link && p.visual_media?.[0]?.thumbnail_url) withCreative.add(String(p.perma_link));
    }
    const stored = db.tables.shadow_social_reports[0].report_data.sprout_performance;
    const matching = stored.top_posts.filter((p: Any) => withCreative.has(String(p.permalink)));
    expect(matching.length).toBeGreaterThan(0);
    for (const p of matching) expect(typeof p.thumbnail_url).toBe("string");
    for (const posts of Object.values<Any[]>(stored.top_posts_by_platform)) {
      for (const p of posts.filter((x) => withCreative.has(String(x.permalink)))) expect(typeof p.thumbnail_url).toBe("string");
    }
  });
});
