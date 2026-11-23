import { beforeEach, describe, expect, it } from "vitest";
import { actorListed, apifyRunStart, apifyWebhooks, classifyActor, clearActorCache, normActor, parseApifyWebhook, resolveActors, withApifyWebhook, type ApifyActors } from "../../../functions/_shared/cost/apify";
import type { CostContext } from "../../../functions/_shared/cost/context";
import { apifyActorRefs, unlistedApifyActors } from "../../../functions/_shared/cost/guard";
import { createMeter, type CostEventRow, type IntentRow } from "../../../functions/_shared/cost/meter";
import { PRICES } from "../../../functions/_shared/cost/pricing";

const ctx = (over: Partial<CostContext> = {}): CostContext => ({ tool: "advisor", clientId: "6f1c2a7e-1111-4222-8333-944455556666", feature: "weekly_report.scrape_meta", actor: "schedule", executionId: "run-1", ...over });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const claude = { id: "m1", model: "claude-sonnet-5-5", usage: { input_tokens: 10, output_tokens: 5 } };

function harness(opts: { failInserts?: number; intentFails?: boolean; intentDelayMs?: number; answer?: () => Response | Promise<Response>; webhook?: boolean } = {}) {
  const rows: CostEventRow[] = [];
  const logs: string[] = [];
  const calls: string[] = [];
  const order: string[] = [];
  const intents = new Map<string, IntentRow & { completed_at?: string; events?: number }>();
  const sleeps: number[] = [];
  let inserts = 0;
  let n = 0;
  const meter = createMeter({
    tool: "advisor", env: "test", prices: PRICES, sharedFeatures: new Set(),
    sink: { insert: async (r) => { inserts++; if (inserts <= (opts.failInserts ?? 0)) throw new Error("db down"); rows.push(...r); order.push("cost"); } },
    intents: {
      start: async (row) => {
        if (opts.intentDelayMs) await new Promise((r) => setTimeout(r, opts.intentDelayMs));
        if (opts.intentFails) throw new Error("intent table missing");
        intents.set(row.id, { ...row });
        order.push("intent");
      },
      complete: async (id, at, events) => { const i = intents.get(id); if (i) Object.assign(i, { completed_at: at, events }); order.push("complete"); },
    },
    intentWaitMs: 20,
    sleep: async (ms) => { sleeps.push(ms); },
    fetch: (async (url: string) => { calls.push(url); order.push("call"); return opts.answer ? opts.answer() : json(claude); }) as typeof fetch,
    now: () => new Date("2026-11-23T10:00:00Z"),
    log: (l) => logs.push(l),
    uuid: () => `u-${++n}`,
    apifyWebhook: () => (opts.webhook === false ? null : { url: "https://ref.supabase.co/functions/v1/cost-apify-webhook", secret: "s3cret" }),
  });
  return { meter, rows, logs, calls, order, intents, sleeps, inserts: () => inserts };
}

describe("no lost records: retries", () => {
  it("retries a failed insert with backoff and records the cost", async () => {
    const h = harness({ failInserts: 2 });
    await h.meter.fetch(ctx(), "anthropic", "/v1/messages", { method: "POST" });
    expect(h.inserts()).toBe(3);
    expect(h.sleeps).toEqual([200, 400]);
    expect(h.rows).toHaveLength(1);
    expect(h.logs.filter((l) => l.startsWith("COST_EVENT_DROPPED"))).toEqual([]);
  });

  it("logs COST_EVENT_DROPPED with the whole event only after the last attempt", async () => {
    const h = harness({ failInserts: 9 });
    const res = await h.meter.fetch(ctx(), "anthropic", "/v1/messages", { method: "POST" });
    expect(res.status).toBe(200);
    expect(h.inserts()).toBe(3);
    expect(h.logs.find((l) => l.startsWith("COST_EVENT_DROPPED"))).toMatch(/"attempts":3.*"idempotency_key":"anthropic:m1"/);
  });

  it("record says whether the row was written", async () => {
    expect(await harness().meter.record(ctx(), "apify", { resource: "a", quantities: { requests: 1 }, costUsd: 1 })).toBe(true);
    expect(await harness({ failInserts: 9 }).meter.record(ctx(), "apify", { resource: "a", quantities: { requests: 1 }, costUsd: 1 })).toBe(false);
  });
});

describe("no lost records: intents", () => {
  it("writes the intent before the call and completes it after the cost row", async () => {
    const h = harness();
    await h.meter.fetch(ctx(), "anthropic", "/v1/messages", { method: "POST" });
    expect(h.order).toEqual(["intent", "call", "cost", "complete"]);
    const [i] = [...h.intents.values()];
    expect(i).toMatchObject({ provider: "anthropic", feature: "weekly_report.scrape_meta", client_id: ctx().clientId, execution_id: "run-1", completed_at: "2026-11-23T10:00:00.000Z", events: 1 });
  });

  it("leaves the intent open when the cost row is dropped, so the daily check counts it", async () => {
    const h = harness({ failInserts: 9 });
    await h.meter.fetch(ctx(), "anthropic", "/v1/messages", { method: "POST" });
    expect([...h.intents.values()][0].completed_at).toBeUndefined();
  });

  it("fails open: an intent that cannot be written never stops the call, and is logged", async () => {
    const h = harness({ intentFails: true });
    const res = await h.meter.fetch(ctx(), "anthropic", "/v1/messages", { method: "POST" });
    expect(res.status).toBe(200);
    expect(h.rows).toHaveLength(1);
    expect(h.logs.find((l) => l.startsWith("COST_INTENT_FAILED"))).toMatch(/"stage":"start"/);
    expect(h.order).not.toContain("complete");
  });

  it("waits for a slow intent write only up to intentWaitMs", async () => {
    const h = harness({ intentDelayMs: 200 });
    const t = Date.now();
    await h.meter.fetch(ctx(), "anthropic", "/v1/messages", { method: "POST" });
    expect(h.order.indexOf("call")).toBeLessThan(h.order.indexOf("intent"));
    expect(Date.now() - t).toBeGreaterThanOrEqual(150); // completion waits for the write, the call did not
    expect([...h.intents.values()][0].completed_at).toBeTruthy();
  });

  it("closes the intent with no events when the call never got an answer", async () => {
    const h = harness({ answer: () => { throw new Error("network down"); } });
    await expect(h.meter.fetch(ctx(), "anthropic", "/v1/messages", { method: "POST" })).rejects.toThrow("network down");
    expect([...h.intents.values()][0]).toMatchObject({ events: 0 });
  });

  it("writes no intent for Apify (its webhook and the run audit cover it)", async () => {
    const h = harness({ answer: () => json({ data: { id: "HG7ML7M8z78YcAPEB", status: "SUCCEEDED", usageTotalUsd: 0.1 } }) });
    await h.meter.fetch(ctx(), "apify", "/v2/actor-runs/HG7ML7M8z78YcAPEB");
    await h.meter.fetch(ctx(), "apify", "/v2/datasets/d1/items");
    expect(h.intents.size).toBe(0);
    expect(h.rows).toHaveLength(1);
  });
});

describe("Apify runs always recorded: the ad-hoc webhook", () => {
  const decode = (url: string) => JSON.parse(atob(new URL(url).searchParams.get("webhooks")!));

  it("attaches a webhook for the run's terminal events, with the cost context and the secret", async () => {
    const h = harness({ answer: () => json({ data: { id: "r1", status: "READY" } }) });
    await h.meter.fetch(ctx(), "apify", "/v2/acts/apify~facebook-ads-scraper/runs?timeout=600", { method: "POST", body: "{}" });
    const url = h.calls[0];
    expect(new URL(url).searchParams.get("timeout")).toBe("600");
    const [hook] = decode(url);
    expect(hook.eventTypes).toEqual(["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.ABORTED", "ACTOR.RUN.TIMED_OUT"]);
    expect(hook.requestUrl).toBe("https://ref.supabase.co/functions/v1/cost-apify-webhook?secret=s3cret");
    expect(hook.payloadTemplate).toContain('"resource": {{resource}}');
    // What Apify would send once it fills the variables in:
    const sent = JSON.parse(hook.payloadTemplate.replace("{{eventType}}", '"ACTOR.RUN.SUCCEEDED"').replace("{{eventData}}", '{"actorRunId":"HG7ML7M8z78YcAPEB"}').replace("{{resource}}", '{"id":"HG7ML7M8z78YcAPEB","status":"SUCCEEDED"}'));
    expect(parseApifyWebhook(sent, "advisor")).toEqual({ runId: "HG7ML7M8z78YcAPEB", ctx: { ...ctx(), userId: null, apiKeyId: null, qa: false } });
  });

  it("attaches it to task runs too, but not to status reads, aborts, or when no target is set", async () => {
    expect(apifyRunStart("POST", "/v2/actor-tasks/abc/runs")).toBe(true);
    expect(apifyRunStart("GET", "/v2/acts/abc/runs")).toBe(false);
    expect(apifyRunStart("POST", "/v2/actor-runs/r1/abort")).toBe(false);
    const h = harness({ webhook: false, answer: () => json({ data: { id: "r1", status: "READY" } }) });
    await h.meter.fetch(ctx(), "apify", "/v2/acts/x~y/runs", { method: "POST" });
    expect(new URL(h.calls[0]).searchParams.has("webhooks")).toBe(false);
  });

  it("leaves a URL that already names webhooks alone", () => {
    const url = "https://api.apify.com/v2/acts/x~y/runs?webhooks=abc";
    expect(withApifyWebhook(url, ctx(), { url: "https://h/f", secret: "s" })).toBe(url);
    expect(apifyWebhooks(ctx({ clientId: null, qa: true }), { url: "https://h/f", secret: "s" })[0].payloadTemplate).toContain('"client_id":null');
  });

  it("refuses a payload the meter did not write", () => {
    const resource = { id: "HG7ML7M8z78YcAPEB" };
    expect(() => parseApifyWebhook({ resource }, "advisor")).toThrow(/cost context/);
    expect(() => parseApifyWebhook({ resource, cost: { tool: "socialytics", feature: "x" } }, "advisor")).toThrow(/socialytics/);
    expect(() => parseApifyWebhook({ resource, cost: { tool: "advisor", feature: "Bad Label", client_id: null } }, "advisor")).toThrow(/Feature label/);
    expect(() => parseApifyWebhook({ resource, cost: { tool: "advisor", feature: "x", client_id: "not-a-uuid" } }, "advisor")).toThrow(/uuid/);
    expect(() => parseApifyWebhook({ resource: { id: "../../../functions/x" }, cost: { tool: "advisor", feature: "x" } }, "advisor")).toThrow(/no Apify run/);
    expect(() => parseApifyWebhook({ cost: { tool: "advisor", feature: "x" } }, "advisor")).toThrow(/no Apify run/);
  });
});

describe("Apify actor ownership", () => {
  const actors: ApifyActors = {
    owned: [{ name: "apify/facebook-ads-scraper", id: "JJghSZmShuco4j9gJ" }, { name: "me/mine" }],
    shared: [{ name: "apify/website-content-crawler" }, { name: "me/both" }],
  };
  beforeEach(() => clearActorCache());

  it("matches apify/x, apify~x and the actor's id as one actor", () => {
    expect(normActor("apify/facebook-ads-scraper")).toBe(normActor("apify~facebook-ads-scraper"));
    expect(actorListed(actors, "apify~facebook-ads-scraper")).toBe(true);
    expect(actorListed(actors, "JJghSZmShuco4j9gJ")).toBe(true);
    expect(actorListed(actors, "apify~website-content-crawler")).toBe(true);
    expect(actorListed(actors, "someone~else")).toBe(false);
  });

  it("resolves names to ids once, treats an actor on both lists as shared, and leaves an unknown name unresolved", async () => {
    const asked: string[] = [];
    const ids: Record<string, string> = { "me~mine": "MINEid000000000aa", "apify~website-content-crawler": "WCCid000000000aaa", "me~both": "BOTHid00000000aaa" };
    const lookup = async (n: string) => { asked.push(n); return ids[n] ?? null; };
    const both = { ...actors, owned: [...actors.owned, { name: "me/both" }, { name: "me/gone" }] };
    const r = await resolveActors(both, lookup);
    expect(classifyActor(r, "JJghSZmShuco4j9gJ")).toBe("owned");
    expect(classifyActor(r, "MINEid000000000aa")).toBe("owned");
    expect(classifyActor(r, "WCCid000000000aaa")).toBe("shared");
    expect(classifyActor(r, "BOTHid00000000aaa")).toBe("shared");
    expect(classifyActor(r, "ZZZ")).toBe("unknown");
    expect(r.unresolved).toEqual(["me~gone"]);
    await resolveActors(both, lookup);
    expect(asked.filter((n) => n === "me~mine")).toHaveLength(1);
  });

  it("the guard finds an actor the code runs that is on neither list, and ignores comments", () => {
    const files = [
      { path: "supabase/functions/a/index.ts", text: 'const META_ACTOR = "JJghSZmShuco4j9gJ";\nawait paid.fetch(ctx, "apify", `/v2/acts/apify~website-content-crawler/runs`);' },
      { path: "supabase/functions/b/index.ts", text: '// /v2/acts/nobody~commented/runs\nconst NEW_ACTOR = "someone~new-scraper";\nawait paid.fetch(ctx, "apify", "/v2/actor-tasks/me~task1/runs");' },
    ];
    expect(apifyActorRefs(files[1].text).map((r) => r.ref)).toEqual(["nobody~commented", "me~task1", "someone~new-scraper"]);
    const problems = unlistedApifyActors(files, actors);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/b\/index.ts:3 runs the Apify actor me~task1/);
    expect(problems[1]).toMatch(/b\/index.ts:2 runs the Apify actor someone~new-scraper/);
  });

  it("the guard also finds actors described as { id, name } objects, and not other objects with a name", () => {
    const text = 'const SOURCES = [\n  { platform: "tiktok", actor: { id: "5K30i8aFccKNF5ICs", name: "apidojo/tiktok-scraper" } },\n];\nexport const PROFILE_ACTOR = { id: "apify~instagram-profile-scraper", name: "apify/instagram-profile-scraper", timeoutSecs: 120 };\nconst MODEL = { id: "x", name: "google/gemini-3-flash" };';
    expect(apifyActorRefs(text).map((r) => r.ref)).toEqual(["apidojo/tiktok-scraper", "apify/instagram-profile-scraper"]);
    const problems = unlistedApifyActors([{ path: "supabase/functions/c/index.ts", text }], actors);
    expect(problems.map((p) => p.split(" runs")[0])).toEqual(["supabase/functions/c/index.ts:2", "supabase/functions/c/index.ts:4"]);
  });
});
