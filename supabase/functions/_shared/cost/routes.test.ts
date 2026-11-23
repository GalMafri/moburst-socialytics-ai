import { describe, expect, it } from "vitest";
import { scopeAll, scopeOf } from "../api/keys";
import type { AuthContext, RouteContext } from "../api/router";
import { PRICES } from "./pricing";
import { costRoutes, type CostStore, type Filters, type Group } from "./routes";

const ALL: AuthContext = { kind: "key", keyId: "k", keyHash: "h", scopes: ["costs"], clients: scopeAll() };

function setup() {
  const calls: Array<{ group: Group[]; filters: Filters; from: string; to: string }> = [];
  const store: CostStore = {
    summary: async (from, to, group, filters) => {
      calls.push({ group, filters, from, to });
      return group.length
        ? [{ client: { id: "c1", name: "Acme", company_slug: "acme", bucket: "client" }, cost_usd: 1.5, events: 3, unattributed_usd: 0, unattributed_events: 0, estimated_usd: 0, unpriced_events: 0, quantities: { input_tokens: 10 } }]
        : [{ cost_usd: 2, events: 4, unattributed_usd: 0.1, unattributed_events: 1, estimated_usd: 0.2, unpriced_events: 1, quantities: {} }];
    },
    events: async (_from, _to, _f, limit) =>
      Array.from({ length: Math.min(limit, 3) }, (_, i) => ({ id: `e${i}`, occurred_at: `2026-11-2${i}T00:00:00.000Z` } as never)),
  };
  const routes = costRoutes({ tool: "advisor", store, prices: PRICES, now: () => new Date("2026-11-23T00:00:00Z") });
  const call = (path: string, query: string, auth: AuthContext = ALL) => {
    const r = routes.find((x) => x.path === path)!;
    const ctx: RouteContext = { params: {}, query: new URLSearchParams(query), body: null, auth, requestId: "r", url: new URL(`https://x${path}?${query}`) };
    return r.handler(ctx);
  };
  return { calls, call, routes };
}

describe("cost routes", () => {
  it("every route needs the costs scope and is documented", () => {
    for (const r of setup().routes) {
      expect(r.scope).toBe("costs");
      expect(r.doc.summary).toBeTruthy();
    }
  });

  it("answers totals and grouped rows for a window, 30 days by default", async () => {
    const s = setup();
    const res = await s.call("/v1/costs", "group_by=client,provider&provider=openai");
    const d = (res.body as { data: Record<string, unknown> }).data;
    expect(d.totals).toMatchObject({ cost_usd: 2, events: 4, unattributed_events: 1, unpriced_events: 1 });
    expect(d.rows).toHaveLength(1);
    expect(d.group_by).toEqual(["client", "provider"]);
    expect(s.calls[0]).toMatchObject({ group: ["client", "provider"], filters: { provider: "openai" }, from: "2026-10-24T00:00:00.000Z", to: "2026-11-23T00:00:00.000Z" });
  });

  it("refuses unknown groups, providers and buckets, and a window the wrong way round", async () => {
    const s = setup();
    await expect(s.call("/v1/costs", "group_by=client_id")).rejects.toMatchObject({ status: 400 });
    await expect(s.call("/v1/costs", "provider=stripe")).rejects.toMatchObject({ status: 400 });
    await expect(s.call("/v1/costs", "bucket=other")).rejects.toMatchObject({ status: 400 });
    await expect(s.call("/v1/costs", "from=2026-11-20&to=2026-11-01")).rejects.toMatchObject({ status: 400 });
  });

  it("a key limited to some clients reads only their costs", async () => {
    const s = setup();
    const limited: AuthContext = { ...ALL, clients: scopeOf(["c1"]) };
    await expect(s.call("/v1/costs", "", limited)).rejects.toMatchObject({ status: 403 });
    await expect(s.call("/v1/costs", "client_id=c2", limited)).rejects.toMatchObject({ status: 403 });
    await expect(s.call("/v1/costs", "client_id=c1", limited)).resolves.toMatchObject({ status: 200 });
  });

  it("pages the individual charges with a cursor", async () => {
    const s = setup();
    const res = await s.call("/v1/cost-events", "limit=2");
    const b = res.body as { data: unknown[]; next_cursor: string | null };
    expect(b.data).toHaveLength(2);
    expect(b.next_cursor).toBeTruthy();
  });

  it("lists the prices in force on a date, one row per model", async () => {
    const s = setup();
    const res = await s.call("/v1/cost-pricing", "at=2026-11-23");
    const d = (res.body as { data: { prices: Array<{ provider: string; resource: string }> } }).data;
    const keys = d.prices.map((p) => `${p.provider}:${p.resource}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("anthropic:claude-sonnet-5-5");
  });
});
