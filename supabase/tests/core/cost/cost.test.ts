import { describe, expect, it } from "vitest";
import { bucketOf, type CostContext } from "../../../functions/_shared/cost/context";
import { paidKeysOutside, providerHostsOutside, unclassifiedSecrets, unexplainedNullClients, unpricedModels, type GuardConfig } from "../../../functions/_shared/cost/guard";
import { createMeter, type CostEventRow } from "../../../functions/_shared/cost/meter";
import { findPrice, lintPrices, priceUsage, QUANTITIES, type PriceRow } from "../../../functions/_shared/cost/price";
import { PRICES } from "../../../functions/_shared/cost/pricing";
import { PRICES } from "../../../functions/_shared/cost/pricing";
import { PROVIDERS, providerUrl } from "../../../functions/_shared/cost/registry";
import { READERS, readAnswer } from "../../../functions/_shared/cost/usage";

const ctx = (over: Partial<CostContext> = {}): CostContext => ({ tool: "advisor", clientId: "c1", feature: "weekly_report.vision", actor: "schedule", executionId: "run-1", ...over });
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

function harness(prices: readonly PriceRow[] = PRICES, answer: () => Response = () => json({})) {
  const rows: CostEventRow[] = [];
  const logs: string[] = [];
  const calls: string[] = [];
  let fail = false;
  const meter = createMeter({
    tool: "advisor", env: "test", prices, sharedFeatures: new Set(["industry_patterns.*", "snowflake_sync"]),
    sink: { insert: async (r) => { if (fail) throw new Error("db down"); rows.push(...r); } },
    fetch: (async (url: string) => { calls.push(url); return answer(); }) as typeof fetch,
    now: () => new Date("2026-11-23T10:00:00Z"),
    log: (l) => logs.push(l),
    uuid: () => "u-1",
  });
  return { meter, rows, logs, calls, breakSink: () => { fail = true; } };
}

describe("attribution", () => {
  it("charges a call to its client, a shared feature to shared, and anything else without a client to dev/QA, flagged", () => {
    const shared = new Set(["snowflake_sync", "industry_patterns.*"]);
    expect(bucketOf(ctx(), shared)).toEqual({ hint: "client", unattributed: false });
    expect(bucketOf(ctx({ clientId: null, feature: "snowflake_sync" }), shared)).toEqual({ hint: "shared", unattributed: false });
    expect(bucketOf(ctx({ clientId: null, feature: "industry_patterns.summary" }), shared)).toEqual({ hint: "shared", unattributed: false });
    expect(bucketOf(ctx({ clientId: null, feature: "draft_brief" }), shared)).toEqual({ hint: "dev_qa", unattributed: true });
    expect(bucketOf(ctx({ qa: true }), shared)).toEqual({ hint: "dev_qa", unattributed: false });
  });

  it("refuses to send a paid call without a usable context, before anything leaves the app", async () => {
    const h = harness();
    await expect(h.meter.fetch(undefined as unknown as CostContext, "anthropic", "/v1/messages", { method: "POST" })).rejects.toThrow(/CostContext/);
    await expect(h.meter.fetch(ctx({ feature: "Weekly Report" }), "anthropic", "/v1/messages", { method: "POST" })).rejects.toThrow(/Feature label/);
    expect(h.calls).toEqual([]);
  });
});

describe("the meter", () => {
  it("records a Claude call with its tokens priced from the table, and hands the answer back untouched", async () => {
    const body = { id: "msg_1", model: "claude-sonnet-5-5", usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, server_tool_use: { web_search_requests: 2 } }, content: [{ type: "text", text: "hi" }] };
    const h = harness(PRICES, () => json(body));
    const res = await h.meter.fetch(ctx(), "anthropic", "/v1/messages", { method: "POST", body: JSON.stringify({ model: "claude-sonnet-5-5" }) });
    expect((await res.json()).content[0].text).toBe("hi");
    expect(h.calls).toEqual(["https://api.anthropic.com/v1/messages"]);
    expect(h.rows).toHaveLength(1);
    const r = h.rows[0];
    expect(r).toMatchObject({ client_id: "c1", bucket_hint: "client", provider: "anthropic", resource: "claude-sonnet-5-5", cost_source: "priced", idempotency_key: "anthropic:msg_1", execution_id: "run-1" });
    // 1000 x $2/M + 500 x $10/M + 2000 x $0.10/M + 2 x $10/1000
    expect(r.cost_usd).toBeCloseTo(0.002 + 0.005 + 0.0002 + 0.02, 6);
  });

  it("reads the usage of a streamed Claude reply once the stream ends", async () => {
    const sse = [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_2", model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 1 } } })}`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { text: "x" } })}`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 300 } })}`,
    ].join("\n\n");
    const pending: Promise<unknown>[] = [];
    const rows: CostEventRow[] = [];
    const meter = createMeter({
      tool: "socialytics", env: "test", prices: PRICES, sharedFeatures: new Set(),
      sink: { insert: async (r) => { rows.push(...r); } },
      fetch: (async () => new Response(sse, { headers: { "content-type": "text/event-stream" } })) as typeof fetch,
      waitUntil: (p) => pending.push(p),
    });
    const res = await meter.fetch(ctx({ tool: "socialytics" }), "anthropic", "/v1/messages", { method: "POST" });
    expect(await res.text()).toContain("message_start");
    await Promise.all(pending);
    expect(rows[0]).toMatchObject({ resource: "claude-opus-5-5", quantities: { input_tokens: 100, output_tokens: 300 } });
    expect(rows[0].cost_usd).toBeCloseTo(100 * 4e-6 + 300 * 20e-6, 6);
  });

  it("prices Message Batches results at half, one event per request, keyed so a re-read never counts twice", async () => {
    const jsonl = [
      { custom_id: "a", result: { type: "succeeded", message: { id: "m1", model: "claude-sonnet-5-5", usage: { input_tokens: 1_000_000, output_tokens: 0 } } } },
      { custom_id: "b", result: { type: "errored" } },
    ].map((l) => JSON.stringify(l)).join("\n");
    const h = harness(PRICES, () => new Response(jsonl, { headers: { "content-type": "application/binary" } }));
    await h.meter.fetch(ctx(), "anthropic", "/v1/messages/batches/msgbatch_9/results");
    expect(h.rows.map((r) => [r.idempotency_key, r.cost_usd])).toEqual([["anthropic-batch:msgbatch_9:a", 1]]);
  });

  it("reads a one-request batch, whose results are a single line that parses as plain JSON", async () => {
    const one = JSON.stringify({ custom_id: "only", result: { type: "succeeded", message: { id: "m9", model: "claude-opus-5-5", usage: { input_tokens: 1_000_000, output_tokens: 0 } } } });
    const h = harness(PRICES, () => new Response(one, { headers: { "content-type": "application/json" } }));
    await h.meter.fetch(ctx(), "anthropic", "/v1/messages/batches/msgbatch_1/results");
    expect(h.rows.map((r) => [r.idempotency_key, r.cost_usd])).toEqual([["anthropic-batch:msgbatch_1:only", 2]]);
  });

  it("records an Apify run once, when it is seen finished, with the dollars Apify reports", async () => {
    let status = "RUNNING";
    const h = harness(PRICES, () => json({ data: { id: "run_7", actId: "JJghSZmShuco4j9gJ", status, usageTotalUsd: 0.4321 } }));
    await h.meter.fetch(ctx(), "apify", "/v2/actor-runs/run_7");
    expect(h.rows).toHaveLength(0);
    status = "SUCCEEDED";
    await h.meter.fetch(ctx(), "apify", "/v2/actor-runs/run_7");
    expect(h.rows[0]).toMatchObject({ provider: "apify", resource: "JJghSZmShuco4j9gJ", cost_usd: 0.4321, cost_source: "provider", idempotency_key: "apify:run_7" });
  });

  it("splits OpenAI cached input from uncached, and prices a dated snapshot with the model's row", async () => {
    const h = harness(PRICES, () => json({ id: "cmpl_1", model: "gpt-4o-2024-08-06", usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 400 } } }));
    await h.meter.fetch(ctx(), "openai", "/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "gpt-4o" }) });
    expect(h.rows[0].quantities).toEqual({ input_tokens: 600, cache_read_tokens: 400, output_tokens: 100 });
    expect(h.rows[0].cost_usd).toBeCloseTo(600 * 2.5e-6 + 400 * 1.25e-6 + 100 * 10e-6, 6);
  });

  it("records a model with no price as unpriced, never as free", async () => {
    const h = harness(PRICES, () => json({ id: "m", model: "claude-imaginary-9", usage: { input_tokens: 10, output_tokens: 10 } }));
    await h.meter.fetch(ctx(), "anthropic", "/v1/messages", { method: "POST" });
    expect(h.rows[0]).toMatchObject({ cost_usd: null, cost_source: "unpriced" });
  });

  it("never fails the feature when the cost cannot be written; it logs the whole event to replay", async () => {
    const h = harness(PRICES, () => json({ id: "m3", model: "claude-sonnet-5-5", usage: { input_tokens: 1, output_tokens: 1 } }));
    h.breakSink();
    const res = await h.meter.fetch(ctx(), "anthropic", "/v1/messages", { method: "POST" });
    expect(res.status).toBe(200);
    expect(h.logs[0]).toMatch(/^COST_EVENT_DROPPED .*"idempotency_key":"anthropic:m3"/);
  });

  it("does not read a copy of answers that never carry usage (Apify datasets)", async () => {
    let read = 0;
    const big = { clone: () => { read++; return new Response("[]"); }, headers: new Headers({ "content-type": "application/json" }), status: 200 } as unknown as Response;
    const h = harness(PRICES, () => big);
    await h.meter.fetch(ctx(), "apify", "/v2/datasets/ds_1/items?format=json");
    expect(read).toBe(0);
    expect(h.rows).toEqual([]);
  });

  it("records no event for a failed call", async () => {
    const h = harness(PRICES, () => new Response('{"error":{}}', { status: 529, headers: { "content-type": "application/json" } }));
    await h.meter.fetch(ctx(), "anthropic", "/v1/messages", { method: "POST" });
    expect(h.rows).toEqual([]);
  });

  it("builds every URL from the registry and refuses a full URL on another host", () => {
    expect(providerUrl("apify", "https://api.apify.com/v2/datasets/x/items", () => undefined)).toBe("https://api.apify.com/v2/datasets/x/items");
    expect(() => providerUrl("apify", "https://evil.example/v2", () => undefined)).toThrow(/not a Apify address/);
    expect(providerUrl("tribe", "/analyze", (n) => (n === "TRIBE_API_URL" ? "https://moburst-tribe.hf.space" : undefined))).toBe("https://moburst-tribe.hf.space/analyze");
  });
});

describe("pricing", () => {
  it("the table is well formed", () => {
    expect(lintPrices(PRICES, QUANTITIES)).toEqual([]);
  });

  it("a new price applies from its date and leaves earlier usage at the old price", () => {
    const table: PriceRow[] = [
      { provider: "openai", resource: "gpt-4o*", effectiveFrom: "2026-01-01", rates: { input_tokens: { usd: 2.5, per: 1e6 } }, source: "x", verified: true },
      { provider: "openai", resource: "gpt-4o*", effectiveFrom: "2026-12-01", rates: { input_tokens: { usd: 1, per: 1e6 } }, source: "x", verified: true },
    ];
    const u = { resource: "gpt-4o", quantities: { input_tokens: 1e6 } };
    expect(priceUsage(table, "openai", u, new Date("2026-11-30"), false).costUsd).toBe(2.5);
    expect(priceUsage(table, "openai", u, new Date("2026-12-01"), false)).toEqual({ costUsd: 1, costSource: "priced", priceRef: "openai:gpt-4o*@2026-12-01" });
  });

  it("an exact model row beats a prefix row", () => {
    const table: PriceRow[] = [
      { provider: "openai", resource: "gpt-4*", effectiveFrom: "2026-01-01", rates: {}, source: "x", verified: true },
      { provider: "openai", resource: "gpt-4.1", effectiveFrom: "2026-01-01", rates: {}, source: "x", verified: true },
    ];
    expect(findPrice(table, "openai", "gpt-4.1", new Date("2026-06-01"))?.resource).toBe("gpt-4.1");
  });

  it("every provider in the registry has a reader", () => {
    for (const id of Object.keys(PROVIDERS)) expect(typeof READERS[id as keyof typeof READERS]).toBe("function");
  });
});

describe("readAnswer", () => {
  it("parses JSON, SSE and JSONL without throwing on garbage", async () => {
    expect((await readAnswer(json({ a: 1 }))).kind).toBe("json");
    expect((await readAnswer(new Response("event: x\ndata: {}\n\n", { headers: { "content-type": "text/event-stream" } }))).kind).toBe("sse");
    expect((await readAnswer(new Response("not json", { headers: { "content-type": "text/plain" } }))).kind).toBe("other");
  });
});

describe("the guardrail checks", () => {
  const cfg: GuardConfig = {
    chokepoint: ["supabase/functions/_shared/cost/", "supabase/functions/_shared/paid/"],
    notPaidSecrets: { SUPABASE_SERVICE_ROLE_KEY: "our own database" },
    sharedFeatures: new Set(["snowflake_sync"]),
    qaPaths: ["scripts/qa/"],
  };
  const f = (path: string, text: string) => ({ path, text });

  it("finds a provider called directly outside the chokepoint, and ignores comments and the chokepoint itself", () => {
    const files = [
      f("supabase/functions/x/index.ts", 'await fetch("https://api.openai.com/v1/chat/completions")'),
      f("supabase/functions/y/index.ts", "// we used to call https://api.openai.com here"),
      f("src/z.tsx", 'const isGemini = url.includes("generativelanguage.googleapis.com"); // cost-guard: not a call (a URL check)'),
      f("supabase/functions/_shared/cost/registry.ts", '"https://api.openai.com"'),
    ];
    const out = providerHostsOutside(files, cfg);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/x\/index\.ts:1 calls OpenAI/);
  });

  it("finds a secret nobody classified, and a paid key read outside the chokepoint", () => {
    const files = [
      f("supabase/functions/x/index.ts", 'Deno.env.get("NEWVENDOR_API_KEY"); Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); Deno.env.get("OPENAI_API_KEY")'),
      f("supabase/functions/_shared/paid/keys.ts", 'Deno.env.get("ANTHROPIC_API_KEY")'),
    ];
    expect(unclassifiedSecrets(files, cfg)).toEqual([expect.stringMatching(/NEWVENDOR_API_KEY/)]);
    expect(paidKeysOutside(files, cfg)).toEqual([expect.stringMatching(/x\/index\.ts:1 reads OPENAI_API_KEY/)]);
  });

  it("finds a model in code that has no price", () => {
    const files = [f("supabase/functions/x/index.ts", 'const M = "claude-sonnet-5-5"; const N = "claude-future-6";')];
    expect(unpricedModels(files, PRICES, new Date("2026-11-23"))).toEqual([expect.stringMatching(/claude-future-6/)]);
  });

  it("allows clientId: null only for shared features and QA scripts", () => {
    const files = [
      f("supabase/functions/x/index.ts", '{ clientId: null, feature: "snowflake_sync" }\n{ clientId: null, feature: "draft_brief" }'),
      f("scripts/qa/smoke.ts", '{ clientId: null, feature: "smoke" }'),
    ];
    expect(unexplainedNullClients(files, cfg)).toEqual([expect.stringMatching(/"draft_brief"/)]);
  });
});

describe("shared tools are priced per unit, at what Moburst pays", () => {
  const at = new Date("2026-11-25");
  const usd = (provider: Parameters<typeof priceUsage>[1], resource: string, quantities: Record<string, number>) => priceUsage(PRICES, provider, { resource, quantities } as never, at, false).costUsd;
  it("Higgsfield: $0.08 a credit, and a 2k image at its quoted credits", () => {
    expect(usd("higgsfield", "seedance_2_5", { credits: 128 })).toBe(10.24);
    expect(usd("higgsfield", "nano_banana_pro", { images: 1 })).toBe(0.16);
    expect(usd("higgsfield", "gpt_image_2_5", { images: 1 })).toBe(0.18);
  });
  it("TRIBE: $0.40 per GPU hour of run time; Gamma: $0.004 a credit", () => {
    expect(usd("tribe", "tribe-space", { gpu_seconds: 3600 })).toBe(0.4);
    expect(usd("tribe", "tribe-space-estimate", { gpu_seconds: 473 })).toBeCloseTo(0.052556, 6);
    expect(usd("gamma", "generation", { credits: 63 })).toBe(0.252);
  });
});
