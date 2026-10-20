// @vitest-environment node
// The social analyses' requests and checks, and the two provider clients.
import { describe, expect, it } from "vitest";
import { MOBURST, TRENDS } from "../fixtures/social";
import { BRIEF_SCHEMA, briefAnswer, briefRequest, repairRequest, SYNTHESIS_SCHEMA, synthesisProblems, synthesisRequest } from "./analysis";
import { gammaClient, GAMMA_TEMPLATE_ID, sproutReader } from "./providers";

// deno-lint-ignore no-explicit-any
type Any = any;

describe("the brief analysis", () => {
  it("asks Opus 5.5 at low effort, with the brief and its schema", () => {
    const r: Any = briefRequest("A brief.");
    expect(r).toMatchObject({ model: "claude-opus-5-5", max_tokens: 8000, output_config: { effort: "low" } });
    expect(r.messages[0].content).toContain("A brief.");
    expect(r.messages[0].content).toContain(JSON.stringify(BRIEF_SCHEMA));
  });

  it("gives Combine its { output }, or { error } as n8n's agent does", () => {
    expect(briefAnswer(JSON.stringify(MOBURST.brief_analysis.output))).toEqual(MOBURST.brief_analysis);
    // The prompt asks for null where the brief says nothing.
    expect(briefAnswer('{"brand_voice": null, "content_themes": ["AI"]}')).toEqual({ output: { brand_voice: null, content_themes: ["AI"] } });
    expect(briefAnswer("not json")).toHaveProperty("error");
    expect(briefAnswer('{"content_themes": "AI"}')).toEqual({ error: "content_themes must be a list of text" });
    expect(briefAnswer(null)).toHaveProperty("error");
  });
});

describe("the synthesis", () => {
  const json = { ...MOBURST.normalized, competitive_context: MOBURST.competitive_context };

  it("asks Opus 5.5 at high effort, with n8n's prompts and the parser's schema", () => {
    const r: Any = synthesisRequest(json);
    expect(r).toMatchObject({ model: "claude-opus-5-5", max_tokens: 32000, output_config: { effort: "high" } });
    expect(r.messages[0].content).toContain(JSON.stringify(json));
    expect(r.messages[0].content).toContain(JSON.stringify(SYNTHESIS_SCHEMA));
    expect(r.messages[0].content).toContain("Where you write in English, write American English. Never use an em dash or an en dash.");
  });

  it("accepts what n8n's parser accepted, and names what does not match", () => {
    expect(synthesisProblems(MOBURST.ai.output)).toEqual([]);
    expect(synthesisProblems({ ...MOBURST.ai.output, ...TRENDS.ai_trends })).toEqual([]);
    expect(synthesisProblems({ sprout_performance_analysis: {}, tiktok_trends_analysis: null, instagram_trends_analysis: null })).toEqual([]);
    expect(synthesisProblems({})).toEqual(["sprout_performance_analysis must be an object"]);
    expect(synthesisProblems({ sprout_performance_analysis: { key_insights: "one" }, tiktok_trends_analysis: [], competitive_takeaways: [1] })).toEqual([
      "sprout_performance_analysis.key_insights must be a list of strings", "tiktok_trends_analysis must be an object or null", "competitive_takeaways must be a list of strings",
    ]);
    expect(synthesisProblems({ sprout_performance_analysis: { platform_breakdown: [{ platform: "LinkedIn", insights: "x" }] } })).toEqual(["sprout_performance_analysis.platform_breakdown[0].insights must be a list of strings"]);
  });

  it("repairs with the autofix prompt n8n's parser uses, at low effort", () => {
    const r: Any = repairRequest("{bad", "Unexpected token");
    expect(r.output_config).toEqual({ effort: "low" });
    expect(r.messages[0].content).toMatch(/^Instructions:\n--------------\n/);
    expect(r.messages[0].content).toContain("Completion:\n--------------\n{bad\n--------------");
    expect(r.messages[0].content).toContain("Error:\n--------------\nUnexpected token\n--------------");
  });
});

describe("Sprout", () => {
  it("pages as n8n's HTTP node pages, under the account, and tries a refused page three times, 5 s apart", async () => {
    const sent: Any[] = [];
    const waits: number[] = [];
    let refusals = 1;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      sent.push({ url, page: body.page, auth: (init!.headers as Record<string, string>).Authorization });
      if (body.page === 2 && refusals-- > 0) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify({ data: [{ n: body.page }], paging: { current_page: body.page, total_pages: 3 } }));
    };
    const reader = sproutReader({ customerId: "1676448", fetchImpl, sleep: async (ms) => { waits.push(ms); }, token: async () => "tok" });
    const pages = await reader.pages("profiles", { filters: ["x"], metrics: ["impressions"] });
    expect(pages.map((p) => p.data[0].n)).toEqual([1, 2, 3]);
    expect(sent.map((s) => s.page)).toEqual([1, 2, 2, 3]);
    expect(sent[0]).toMatchObject({ url: "https://api.sproutsocial.com/v1/1676448/analytics/profiles", auth: "Bearer tok" });
    expect(waits).toEqual([200, 5000, 200]);
  });

  it("stops after three refusals, without the token in what it says", async () => {
    const reader = sproutReader({ customerId: "1", fetchImpl: async () => new Response("Bearer tok is invalid", { status: 401 }), sleep: async () => {}, token: async () => "tok" });
    await expect(reader.pages("posts", {})).rejects.toThrow("Sprout posts answered 401: [redacted] is invalid");
  });
});

describe("Gamma", () => {
  it("makes the deck from the template, once, and reads it, with the key never in what it says", async () => {
    const sent: Any[] = [];
    let reads = 0;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      sent.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null, key: (init?.headers as Record<string, string>)["X-API-KEY"] });
      if (init?.method === "POST") return new Response(JSON.stringify({ generationId: "g1" }));
      return ++reads < 3 ? new Response("gk-secret down", { status: 502 }) : new Response(JSON.stringify({ status: "completed", gammaUrl: "https://gamma.app/docs/x" }));
    };
    const g = gammaClient({ apiKey: "gk-secret", fetchImpl, sleep: async () => {} });
    expect(await g.create("the prompt")).toEqual({ generationId: "g1" });
    expect(sent[0]).toEqual({ url: "https://public-api.gamma.app/v1.0/generations/from-template", method: "POST", body: { gammaId: GAMMA_TEMPLATE_ID, prompt: "the prompt", sharingOptions: { workspaceAccess: "view" } }, key: "gk-secret" });
    expect(GAMMA_TEMPLATE_ID).toBe("g_ix9srva6gx7iiso");
    expect(await g.read("g1")).toEqual({ status: "completed", gammaUrl: "https://gamma.app/docs/x" });
    reads = -10;
    expect(await g.read("g1")).toEqual({ error: { message: "Gamma answered 502: [redacted] down" } });
    const refused = gammaClient({ apiKey: "gk-secret", fetchImpl: async () => new Response("bad key gk-secret", { status: 401 }) });
    await expect(refused.create("p")).rejects.toThrow("Gamma answered 401: bad key [redacted]");
  });
});
