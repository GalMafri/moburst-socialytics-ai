// An in-memory Supabase fake and mount helper for the Competitors page (src/pages/CompetitorReview.tsx), from the QA 22 Nov 2026 repros.
import React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export type Row = Record<string, any>;
export const db: { tables: Record<string, Row[]>; calls: any[]; writes: any[]; invoke: (name: string, body: any) => Promise<any>; gate: (table: string) => Promise<void> | null; fail: Record<string, any> } = {
  tables: {}, calls: [], writes: [], invoke: async () => ({ data: null, error: null }), gate: () => null, fail: {},
};

export function resetDb(tables: Record<string, Row[]>) {
  db.tables = JSON.parse(JSON.stringify(tables));
  db.calls = []; db.writes = [];
  db.invoke = async () => ({ data: null, error: null });
  db.gate = () => null;
  db.fail = {};
}

export const fakeSupabase = {
  functions: { invoke: async (name: string, args: any) => { db.calls.push({ name, ...args.body }); return db.invoke(name, args.body); } },
  from(table: string) {
    const preds: Array<(r: Row) => boolean> = [];
    let op: { kind: "select" | "update" | "insert" | "delete" | "upsert"; value?: any } = { kind: "select" };
    let error: any = null;
    const run = async () => {
      const g = op.kind === "select" ? db.gate(table) : null;
      if (g) await g;
      const rows = (db.tables[table] ||= []);
      if (error) return { data: null, error };
      if (op.kind === "select" && db.fail[table]) return { data: null, error: db.fail[table] };
      if (op.kind === "update") { const hit = rows.filter((r) => preds.every((p) => p(r))); hit.forEach((r) => Object.assign(r, op.value)); db.writes.push({ table, value: op.value, ids: hit.map((r) => r.id) }); return { data: hit, error: null }; }
      if (op.kind === "insert") { const v = { id: `new-${rows.length}`, ...op.value }; rows.push(v); db.writes.push({ table, value: v }); return { data: [v], error: null }; }
      if (op.kind === "delete") { db.tables[table] = rows.filter((r) => !preds.every((p) => p(r))); return { data: null, error: null }; }
      return { data: rows.filter((r) => preds.every((p) => p(r))).map((r) => ({ ...r })), error: null };
    };
    const q: any = {
      select: () => q, order: () => q,
      eq: (c: string, v: any) => { preds.push((r) => r[c] === v); return q; },
      neq: (c: string, v: any) => { preds.push((r) => r[c] !== v); return q; },
      in: (c: string, v: any[]) => { preds.push((r) => v.includes(r[c])); return q; },
      update: (value: any) => { op = { kind: "update", value }; return q; },
      insert: (value: any) => { op = { kind: "insert", value }; return q; },
      delete: () => { op = { kind: "delete" }; return q; },
      failWith: (e: any) => { error = e; return q; },
      maybeSingle: async () => { const r = await run(); return { data: (r.data as any)?.[0] ?? null, error: r.error }; },
      single: async () => { const r = await run(); return { data: (r.data as any)?.[0] ?? null, error: r.error }; },
      then: (res: any, rej: any) => run().then(res, rej),
    };
    return q;
  },
};

export function mountAt(Page: React.ComponentType, url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="/clients/:id/competitive" element={<Page />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

/** A competitor row whose profile lookup is done, so the page starts no lookup of its own. */
export const comp = (id: string, set_id: string, extra: Row = {}): Row => ({
  id, set_id, client_id: "client", name: `Company ${id}`, website_url: `https://${id}.example`, rationale: null,
  similarity_score: 0.9, source: "ai", is_selected: false, selected_rank: null,
  profile_detection: { status: "found", discovery_version: 2, checked_at: new Date().toISOString() }, ...extra,
});
export const handle = (competitor_id: string): Row => ({ id: `h-${competitor_id}`, competitor_id, platform: "instagram", handle: competitor_id, profile_url: null, is_active: true, source: "auto" });
