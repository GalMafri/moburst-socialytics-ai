/**
 * The database side of cost tracking, over a Supabase client with the
 * service role: the meter's sink (cost_events, duplicates ignored) and the
 * reads behind the cost routes (cost_summary and the cost_ledger view, from
 * migration 20261123130000_cost_events.sql).
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */
import type { AlertKind, AuditStore, CostAlert, UnclaimedRun } from "./audit.ts";
import type { CostEventRow, CostSink, IntentRow, IntentSink } from "./meter.ts";
import { oursForDay, saveRows } from "./reconcile.ts";
import type { CostStore, Filters, Group, LedgerRow, OpenAlert, SummaryRow } from "./routes.ts";

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

    async alerts() {
      const { data, error } = await db.from("cost_alerts").select("kind, day, provider, message, count, usd, details, first_seen_at, last_seen_at")
        .is("resolved_at", null).order("day", { ascending: false }).order("kind").limit(200);
      if (error) return [];
      return (data ?? []) as OpenAlert[];
    },
  };
}

/** The meter's intents (cost_intents, migration 20261123190000_cost_safeguards.sql). */
export function intentSink(db: Db): IntentSink {
  return {
    async start(row: IntentRow) {
      const { error } = await db.from("cost_intents").insert(row);
      if (error) throw new Error(`cost_intents insert failed: ${error.message}`);
    },
    async complete(id: string, completedAt: string, events: number) {
      const { error } = await db.from("cost_intents").update({ completed_at: completedAt, events }).eq("id", id);
      if (error) throw new Error(`cost_intents update failed: ${error.message}`);
    },
  };
}

/** What the cost checks read and write (audit.ts). */
export function auditStore(db: Db): AuditStore {
  return {
    ours: (day) => oursForDay(db, day),
    saveReconciliation: (rows) => saveRows(db, rows),

    async openIntents(from, to, staleBefore) {
      const out: Array<{ provider: string; started_at: string }> = [];
      for (let page = 0; page < 50; page++) {
        const { data, error } = await db.from("cost_intents").select("provider, started_at").is("completed_at", null)
          .gte("started_at", from).lt("started_at", to).lt("started_at", staleBefore)
          .order("started_at").range(page * 1000, page * 1000 + 999);
        if (error) throw new Error(`cost_intents read failed: ${error.message}`);
        out.push(...((data ?? []) as typeof out));
        if (!data || data.length < 1000) break;
      }
      return out;
    },

    async recordedApifyRuns(ids) {
      if (!ids.length) return new Set<string>();
      const { data, error } = await db.from("cost_events").select("provider_ref").eq("provider", "apify").in("provider_ref", ids);
      if (error) throw new Error(`cost_events read failed: ${error.message}`);
      return new Set(((data ?? []) as Array<{ provider_ref: string }>).map((r) => r.provider_ref));
    },

    async saveUnclaimed(rows: UnclaimedRun[]) {
      const at = new Date().toISOString();
      const { error } = await db.from("cost_unclaimed_runs").upsert(rows.map((r) => ({ ...r, last_seen_at: at })), { onConflict: "run_id" });
      if (error) throw new Error(`cost_unclaimed_runs write failed: ${error.message}`);
    },

    async saveAlerts(alerts: CostAlert[], days: string[], kinds: AlertKind[]) {
      const at = new Date().toISOString();
      // Open alerts of the kinds this run judged, on the days it checked, are resolved; the upsert below reopens those raised again.
      if (kinds.length && days.length) {
        const { error } = await db.from("cost_alerts").update({ resolved_at: at }).is("resolved_at", null).in("day", days).in("kind", kinds);
        if (error) throw new Error(`cost_alerts resolve failed: ${error.message}`);
      }
      for (let i = 0; i < alerts.length; i += 500) {
        const { error } = await db.from("cost_alerts").upsert(alerts.slice(i, i + 500).map((a) => ({ ...a, last_seen_at: at, resolved_at: null })), { onConflict: "dedupe_key" });
        if (error) throw new Error(`cost_alerts write failed: ${error.message}`);
      }
    },

    async pruneIntents(before) {
      const { error } = await db.from("cost_intents").delete().not("completed_at", "is", null).lt("started_at", before);
      if (error) throw new Error(`cost_intents prune failed: ${error.message}`);
    },
  };
}
