import { describe, expect, it } from "vitest";
import { scopeAll, scopeOf } from "../../../functions/_shared/api/keys";
import type { AuthContext, RouteContext } from "../../../functions/_shared/api/router";
import { PRICES } from "../../../functions/_shared/cost/pricing";
import type { CheckOptions, CheckResult } from "../../../functions/_shared/cost/audit";
import { costCheckRoute, costRoutes, type CostStore, type Filters, type Group, type OpenAlert } from "../../../functions/_shared/cost/routes";

const ALERT: OpenAlert = { kind: "unrecorded_calls", day: "2026-11-22", provider: "openai", message: "2 calls", count: 2, usd: null, details: {}, first_seen_at: "2026-11-23T09:00:00Z", last_seen_at: "2026-11-23T09:00:00Z" };
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
    alerts: async () => [ALERT],
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

  it("returns open alerts to a key that sees every client, and none to a key limited to some", async () => {
    const s = setup();
    const all = await s.call("/v1/costs", "");
    expect((all.body as { data: { alerts: OpenAlert[] } }).data.alerts).toEqual([ALERT]);
    const limited = await s.call("/v1/costs", "client_id=c1", { ...ALL, clients: scopeOf(["c1"]) });
    expect((limited.body as { data: { alerts: OpenAlert[] } }).data.alerts).toEqual([]);
  });
});

describe("the admin cost check", () => {
  const route = (seen: CheckOptions[]) => costCheckRoute({ run: async (o) => { seen.push(o); return { days: o.days } as unknown as CheckResult; }, now: () => new Date("2026-11-23T08:00:00Z") });
  const call = (r: ReturnType<typeof costCheckRoute>, query: string, body: unknown = null) =>
    r.handler({ params: {}, query: new URLSearchParams(query), body, auth: { ...ALL, kind: "admin" }, requestId: "r", url: new URL(`https://x/v1/admin/cost-check?${query}`) });

  it("needs an admin and is documented", () => {
    const r = route([]);
    expect(r).toMatchObject({ method: "POST", path: "/v1/admin/cost-check", auth: "admin" });
    expect(r.doc.response).toBe("CostCheckResult");
  });

  it("runs the checks over a range of past days, dry or for real, in check or history mode", async () => {
    const seen: CheckOptions[] = [];
    const r = route(seen);
    await call(r, "from=2026-11-01&to=2026-11-03&dry_run=1");
    await call(r, "", { from: "2026-11-22", mode: "history" });
    expect(seen).toEqual([
      { days: ["2026-11-01", "2026-11-02", "2026-11-03"], dryRun: true, mode: "check" },
      { days: ["2026-11-22"], dryRun: false, mode: "history" },
    ]);
  });

  it("refuses a missing, unfinished or too long range, and an unknown mode", async () => {
    const r = route([]);
    await expect(call(r, "")).rejects.toMatchObject({ status: 400 });
    await expect(call(r, "from=2026-11-20&to=2026-11-23")).rejects.toMatchObject({ status: 400 });
    await expect(call(r, "from=2026-06-01&to=2026-11-01")).rejects.toMatchObject({ status: 400 });
    await expect(call(r, "from=2026-11-01&mode=guess")).rejects.toMatchObject({ status: 400 });
  });
});
