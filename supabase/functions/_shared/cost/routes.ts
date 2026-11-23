/**
 * The cost routes every Moburst tool serves, identical in each so the
 * moburst.ai costs page integrates once:
 *
 *   GET /v1/costs          totals, grouped by any of day, week, month, client,
 *                          provider, resource, feature, bucket, env
 *   GET /v1/cost-events    the individual charges, newest first, paginated
 *   GET /v1/cost-pricing   the price list in force on a date
 *
 * They need a key with the "costs" scope. A key limited to some clients sees
 * only those clients' costs.
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */
import { decodeCursor, encodeCursor, parseLimit } from "../api/cursor.ts";
import { forbidden, invalid } from "../api/errors.ts";
import type { Route, RouteContext } from "../api/router.ts";
import type { Tool } from "./context.ts";
import { findPrice, type PriceRow } from "./price.ts";
import { PROVIDER_IDS, PROVIDERS } from "./registry.ts";

export const GROUPS = ["day", "week", "month", "client", "provider", "resource", "feature", "bucket", "env"] as const;
export const FILTERS = ["client_id", "company_slug", "provider", "resource", "feature", "bucket", "env", "execution_id"] as const;
export type Group = (typeof GROUPS)[number];
export type Filters = Partial<Record<(typeof FILTERS)[number], string>>;

export interface SummaryRow {
  cost_usd: number;
  events: number;
  unattributed_usd: number;
  unattributed_events: number;
  estimated_usd: number;
  unpriced_events: number;
  quantities: Record<string, number>;
  [group: string]: unknown;
}

export interface LedgerRow {
  id: string;
  occurred_at: string;
  client_id: string | null;
  client_name: string | null;
  company_slug: string | null;
  bucket: string;
  unattributed: boolean;
  feature: string;
  execution_id: string | null;
  actor_kind: string;
  provider: string;
  resource: string;
  quantities: Record<string, number>;
  cost_usd: number | null;
  cost_source: string;
  price_ref: string | null;
  provider_ref: string | null;
  env: string;
}

export interface CostStore {
  summary(from: string, to: string, group: Group[], filters: Filters): Promise<SummaryRow[]>;
  events(from: string, to: string, filters: Filters, limit: number, after: { at: string; id: string } | null): Promise<LedgerRow[]>;
  /** The latest reconciliation per provider (from the daily job), if any. */
  reconciliation?(): Promise<Array<{ provider: string; day: string; status: string; ours_usd: number; theirs_usd: number | null }>>;
}

export interface CostRouteDeps {
  tool: Tool;
  store: CostStore;
  prices: readonly PriceRow[];
  now?(): Date;
}

const DAY = 86_400_000;

function iso(raw: string | null, name: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw invalid(`${name} must be an ISO date or date-time`, { field: name });
  return d.toISOString();
}

function window(ctx: RouteContext, now: Date): { from: string; to: string } {
  const to = iso(ctx.query.get("to"), "to") ?? now.toISOString();
  const from = iso(ctx.query.get("from"), "from") ?? new Date(new Date(to).getTime() - 30 * DAY).toISOString();
  if (from >= to) throw invalid("from must be before to", { field: "from" });
  if (new Date(to).getTime() - new Date(from).getTime() > 400 * DAY) throw invalid("The window can be at most 400 days", { field: "from" });
  return { from, to };
}

function filters(ctx: RouteContext): Filters {
  const out: Filters = {};
  for (const f of FILTERS) {
    const v = ctx.query.get(f)?.trim();
    if (v) out[f] = v;
  }
  if (out.provider && !(PROVIDER_IDS as string[]).includes(out.provider)) throw invalid(`provider must be one of ${PROVIDER_IDS.join(", ")}`, { field: "provider" });
  if (out.bucket && !["client", "shared", "dev_qa"].includes(out.bucket)) throw invalid("bucket must be client, shared or dev_qa", { field: "bucket" });
  // A key limited to some clients reads only those clients' costs.
  if (!ctx.auth.clients.all) {
    if (!out.client_id) throw forbidden("This key is limited to some clients: pass client_id");
    if (!ctx.auth.clients.allows(out.client_id)) throw forbidden("This key cannot read that client");
  }
  return out;
}

function groups(ctx: RouteContext): Group[] {
  const raw = ctx.query.get("group_by")?.trim();
  if (!raw) return [];
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const g of list) if (!(GROUPS as readonly string[]).includes(g)) throw invalid(`group_by takes ${GROUPS.join(", ")}`, { field: "group_by" });
  return [...new Set(list)] as Group[];
}

const totalsOf = (rows: SummaryRow[]) => {
  const t = rows[0];
  return {
    cost_usd: t?.cost_usd ?? 0,
    events: t?.events ?? 0,
    unattributed_usd: t?.unattributed_usd ?? 0,
    unattributed_events: t?.unattributed_events ?? 0,
    estimated_usd: t?.estimated_usd ?? 0,
    unpriced_events: t?.unpriced_events ?? 0,
  };
};

export function costRoutes(deps: CostRouteDeps): Route[] {
  const now = deps.now ?? (() => new Date());
  return [
    {
      method: "GET", path: "/v1/costs", auth: "key", scope: "costs",
      doc: {
        summary: "What this tool's paid providers cost, per client, service and period", tag: "Costs",
        query: {
          from: { type: "string", description: "Start, inclusive (ISO date or date-time). Default: 30 days before to." },
          to: { type: "string", description: "End, exclusive. Default: now." },
          group_by: { type: "string", description: `Comma list of ${GROUPS.join(", ")}. Empty: one total.` },
          client_id: { type: "string" }, company_slug: { type: "string" },
          provider: { type: "string", enum: [...PROVIDER_IDS] }, resource: { type: "string", description: "A model or actor id." },
          feature: { type: "string" }, bucket: { type: "string", enum: ["client", "shared", "dev_qa"] }, env: { type: "string" },
          execution_id: { type: "string" },
        },
        response: "CostSummary",
      },
      handler: async (ctx) => {
        const { from, to } = window(ctx, now());
        const f = filters(ctx);
        const g = groups(ctx);
        const [rows, total, recon] = await Promise.all([
          g.length ? deps.store.summary(from, to, g, f) : Promise.resolve([] as SummaryRow[]),
          deps.store.summary(from, to, [], f),
          deps.store.reconciliation ? deps.store.reconciliation().catch(() => []) : Promise.resolve([]),
        ]);
        return {
          status: 200,
          body: {
            data: {
              tool: deps.tool,
              currency: "USD",
              from, to,
              group_by: g,
              filters: f,
              totals: totalsOf(total),
              rows: g.length ? rows : [],
              reconciliation: recon,
              notes: "cost_usd sums known costs. unpriced_events have no price yet and are not in cost_usd. estimated_usd is the part of cost_usd that is estimated.",
            },
          },
        };
      },
    },
    {
      method: "GET", path: "/v1/cost-events", auth: "key", scope: "costs",
      doc: {
        summary: "Individual charges, newest first", tag: "Costs",
        query: {
          from: { type: "string" }, to: { type: "string" },
          client_id: { type: "string" }, company_slug: { type: "string" },
          provider: { type: "string", enum: [...PROVIDER_IDS] }, resource: { type: "string" },
          feature: { type: "string" }, bucket: { type: "string", enum: ["client", "shared", "dev_qa"] }, env: { type: "string" }, execution_id: { type: "string" },
        },
        response: "CostEventList", list: true,
      },
      handler: async (ctx) => {
        const { from, to } = window(ctx, now());
        const f = filters(ctx);
        const limit = parseLimit(ctx.query.get("limit"), 100, 1000);
        const cur = decodeCursor(ctx.query.get("cursor"));
        const rows = await deps.store.events(from, to, f, limit + 1, cur ? { at: cur.c, id: cur.i } : null);
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        return {
          status: 200,
          body: { data: page, next_cursor: rows.length > limit && last ? encodeCursor({ c: last.occurred_at, i: last.id }) : null },
        };
      },
    },
    {
      method: "GET", path: "/v1/cost-pricing", auth: "key", scope: "costs",
      doc: {
        summary: "The price list in force on a date", tag: "Costs",
        query: { at: { type: "string", description: "ISO date. Default: today." } },
        response: "CostPricing",
      },
      handler: async (ctx) => {
        const at = new Date(iso(ctx.query.get("at"), "at") ?? now().toISOString());
        const seen = new Set<string>();
        const rows = [];
        for (const r of deps.prices) {
          const k = `${r.provider}:${r.resource}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const live = findPrice(deps.prices, r.provider, r.resource.replace(/\*$/, ""), at);
          if (live && live.resource === r.resource) rows.push({ ...live, provider_label: PROVIDERS[live.provider].label });
        }
        return {
          status: 200,
          body: {
            data: {
              at: at.toISOString().slice(0, 10),
              prices: rows,
              providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, cost_source: p.costSource, reconcile: p.reconcile })),
            },
          },
        };
      },
    },
  ];
}

const money = { type: "number", description: "US dollars" };
const counts = {
  cost_usd: money, events: { type: "integer" },
  unattributed_usd: money, unattributed_events: { type: "integer" },
  estimated_usd: money, unpriced_events: { type: "integer" },
};

/** OpenAPI schemas for the cost routes; each tool merges them into its own. */
export const COST_SCHEMAS: Record<string, unknown> = {
  CostSummary: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          tool: { type: "string", enum: ["advisor", "socialytics"] },
          currency: { type: "string", enum: ["USD"] },
          from: { type: "string", format: "date-time" },
          to: { type: "string", format: "date-time" },
          group_by: { type: "array", items: { type: "string", enum: [...GROUPS] } },
          filters: { type: "object", additionalProperties: { type: "string" } },
          totals: { type: "object", properties: counts },
          rows: {
            type: "array",
            items: {
              type: "object",
              description: "One row per group. Holds the group_by keys (client is an object with id, name, company_slug, bucket; resource also carries provider), then the totals.",
              properties: {
                ...counts,
                day: { type: "string" }, week: { type: "string" }, month: { type: "string" },
                client: { type: "object", properties: { id: { type: ["string", "null"] }, name: { type: ["string", "null"] }, company_slug: { type: ["string", "null"] }, bucket: { type: "string" } } },
                provider: { type: "string" }, resource: { type: "string" }, feature: { type: "string" }, bucket: { type: "string" }, env: { type: "string" },
                quantities: { type: "object", additionalProperties: { type: "number" } },
              },
            },
          },
          reconciliation: { type: "array", items: { type: "object" } },
          notes: { type: "string" },
        },
        required: ["tool", "currency", "from", "to", "totals", "rows"],
      },
    },
    required: ["data"],
  },
  CostEventList: {
    type: "object",
    properties: {
      data: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" }, occurred_at: { type: "string", format: "date-time" },
            client_id: { type: ["string", "null"] }, client_name: { type: ["string", "null"] }, company_slug: { type: ["string", "null"] },
            bucket: { type: "string" }, unattributed: { type: "boolean" }, feature: { type: "string" }, execution_id: { type: ["string", "null"] },
            actor_kind: { type: "string" }, provider: { type: "string" }, resource: { type: "string" },
            quantities: { type: "object", additionalProperties: { type: "number" } },
            cost_usd: { type: ["number", "null"] }, cost_source: { type: "string" }, price_ref: { type: ["string", "null"] }, provider_ref: { type: ["string", "null"] }, env: { type: "string" },
          },
        },
      },
      next_cursor: { type: ["string", "null"] },
    },
    required: ["data", "next_cursor"],
  },
  CostPricing: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          at: { type: "string" },
          prices: { type: "array", items: { type: "object" } },
          providers: { type: "array", items: { type: "object" } },
        },
      },
    },
    required: ["data"],
  },
};
