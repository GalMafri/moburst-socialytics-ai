/**
 * The database side of cost tracking, over a Supabase client with the
 * service role: the meter's sink (cost_events, duplicates ignored) and the
 * reads behind the cost routes (cost_summary and the cost_ledger view, from
 * migration 20261123130000_cost_events.sql).
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */
import type { CostEventRow, CostSink } from "./meter.ts";
import type { CostStore, Filters, Group, LedgerRow, SummaryRow } from "./routes.ts";

/** The part of a supabase-js client this module uses. */
export interface Db {
  from(table: string): any;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function costSink(db: Db): CostSink {
  return {
    async insert(rows: CostEventRow[]) {
      const { error } = await db.from("cost_events").upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true });
      if (error) throw new Error(`cost_events insert failed: ${error.message}`);
    },
  };
}

const LEDGER_COLUMNS = "id, occurred_at, client_id, client_name, company_slug, bucket, unattributed, feature, execution_id, actor_kind, provider, resource, quantities, cost_usd, cost_source, price_ref, provider_ref, env";

export function costStore(db: Db): CostStore {
  return {
    async summary(from: string, to: string, group: Group[], filters: Filters): Promise<SummaryRow[]> {
      const { data, error } = await db.rpc("cost_summary", { p_from: from, p_to: to, p_group: group, p_filters: filters });
      if (error) throw new Error(`cost_summary failed: ${error.message}`);
      return ((data ?? []) as unknown[]).map((r) => (typeof r === "object" && r && "cost_summary" in r ? (r as { cost_summary: SummaryRow }).cost_summary : (r as SummaryRow)));
    },

    async events(from: string, to: string, filters: Filters, limit: number, after: { at: string; id: string } | null): Promise<LedgerRow[]> {
      let q = db.from("cost_ledger").select(LEDGER_COLUMNS).gte("occurred_at", from).lt("occurred_at", to);
      for (const [k, v] of Object.entries(filters)) if (v) q = q.eq(k, v);
      if (after) q = q.or(`occurred_at.lt.${after.at},and(occurred_at.eq.${after.at},id.lt.${after.id})`);
      const { data, error } = await q.order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
      if (error) throw new Error(`cost_ledger read failed: ${error.message}`);
      return (data ?? []) as LedgerRow[];
    },

    async reconciliation() {
      const { data, error } = await db.from("cost_reconciliation_latest").select("provider, day, status, ours_usd, theirs_usd");
      if (error) return [];
      return (data ?? []) as Array<{ provider: string; day: string; status: string; ours_usd: number; theirs_usd: number | null }>;
    },
  };
}
