// supabase/functions/_shared/lifecycle/fakeDb.ts
//
// An in-memory stand-in for the supabase-js calls the lifecycle makes, for
// its tests: from(table) with select, eq (also on a JSON field such as
// "input->>kind"), neq, in, is, not, order, limit, range, maybeSingle, single,
// insert, upsert, update and delete; rpc with handlers the test gives;
// storage that keeps uploads in memory (upload, download, remove).

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Result = { data: unknown; error: { message: string } | null };

export interface FakeDb {
  tables: Record<string, Row[]>;
  rpcCalls: Array<{ name: string; args: Row }>;
  uploads: Map<string, Uint8Array | string>;
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  rpc(name: string, args: Row): Promise<Result>;
  // deno-lint-ignore no-explicit-any
  storage: any;
}

const same = (a: unknown, b: unknown) => a === b || (a != null && b != null && String(a) === String(b));
/** A column, or a JSON field of one as PostgREST names it ("input->>kind"). */
const field = (r: Row, c: string) => {
  const [col, key] = c.split("->>");
  return key === undefined ? r[col] : r[col]?.[key];
};

/**
 * lifecycle_enqueue as 20261110160000_lifecycle_looks.sql has it: a look at
 * p_at, unless a look not yet started is queued for that minute or, for a
 * request due now, is already due. Every fakeDb has it unless a test gives its own.
 */
export function lookRpc(args: Row, db: FakeDb): null {
  const at = new Date(String(args.p_at ?? new Date().toISOString()));
  const minute = at.toISOString().slice(0, 16);
  const now = Date.now();
  const jobs = (db.tables.scheduled_jobs ??= []);
  const covered = jobs.some((j) => j.kind === "lifecycle" && same(j.client_id, args.p_client) && (j.status ?? "queued") === "queued" &&
    (String(j.available_at ?? "").slice(0, 16) === minute || (at.getTime() <= now && Date.parse(String(j.available_at)) <= now)));
  if (!covered) {
    jobs.push({ kind: "lifecycle", client_id: args.p_client, dedupe_key: `lifecycle:${args.p_client}:${minute}:${jobs.length}`, priority: args.p_priority ?? 30, available_at: at.toISOString(), status: "queued" });
  }
  return null;
}

/** The same moment, or both empty: how the database compares two timestamptz values a run read and a row holds. */
const sameTime = (a: unknown, b: unknown) => (a == null || a === "") ? (b == null || b === "") : (b != null && b !== "" && Date.parse(String(a)) === Date.parse(String(b)));

/** trend_search_override_put as 20261110180000_trend_merges_and_share.sql has it: merged into the row as it is now. */
export function overridePutRpc(args: Row, db: FakeDb): boolean {
  const row = (db.tables.trend_profiles ?? []).find((r) => same(r.client_id, args.p_client));
  if (!row || !sameTime(row.written_at, args.p_written_at)) return false;
  if (args.p_check_hashtags && !sameTime(row.hashtags_at, args.p_hashtags_at)) return false;
  row.search_overrides = { ...(row.search_overrides ?? {}), [String(args.p_platform)]: args.p_searches };
  return true;
}

/** trend_hashtags_refreshed as the same migration has it: the refresh recorded and Instagram's rewrite dropped. */
export function hashtagsRefreshedRpc(args: Row, db: FakeDb): null {
  const row = (db.tables.trend_profiles ?? []).find((r) => same(r.client_id, args.p_client));
  if (row) {
    const { instagram: _dropped, ...rest } = (row.search_overrides ?? {}) as Row;
    Object.assign(row, { hashtags_at: args.p_at, search_overrides: rest });
  }
  return null;
}

export function fakeDb(tables: Record<string, Row[]> = {}, given: Record<string, (args: Row, db: FakeDb) => unknown> = {}): FakeDb {
  const rpcs: Record<string, (args: Row, db: FakeDb) => unknown> = {
    lifecycle_enqueue: lookRpc, trend_search_override_put: overridePutRpc, trend_hashtags_refreshed: hashtagsRefreshedRpc, ...given,
  };
  const db: FakeDb = {
    tables,
    rpcCalls: [],
    uploads: new Map(),
    from(table: string) {
      return new Query(table);
    },
    async rpc(name, args) {
      db.rpcCalls.push({ name, args });
      const h = rpcs[name];
      if (!h) return { data: null, error: { message: `no fake for ${name}` } };
      try {
        return { data: await h(args, db), error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, bytes: Uint8Array | string) { db.uploads.set(`${bucket}/${path}`, bytes); return { error: null }; },
          async remove(paths: string[]) { for (const p of paths) db.uploads.delete(`${bucket}/${p}`); return { data: [], error: null }; },
          getPublicUrl(path: string) { return { data: { publicUrl: `https://project.test/storage/v1/object/public/${bucket}/${path}` } }; },
          async download(path: string) {
            const b = db.uploads.get(`${bucket}/${path}`);
            if (b === undefined) return { data: null, error: { message: "missing" } };
            const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b;
            return { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null };
          },
        };
      },
    },
  };

  class Query {
    private filters: Array<(r: Row) => boolean> = [];
    private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    private payload: Row | Row[] | null = null;
    private opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    private one: "single" | "maybe" | null = null;
    private max: number | null = null;
    private skip = 0;
    private sorts: Array<[string, boolean]> = [];
    constructor(private table: string) {}
    private rows(): Row[] { return (db.tables[this.table] ??= []); }
    select() { return this; }
    eq(c: string, v: unknown) { this.filters.push((r) => same(field(r, c), v)); return this; }
    neq(c: string, v: unknown) { this.filters.push((r) => !same(r[c], v)); return this; }
    in(c: string, vs: unknown[]) { this.filters.push((r) => vs.some((v) => same(r[c], v))); return this; }
    is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    not(c: string, op: string, v: unknown) { if (op === "is") this.filters.push((r) => (r[c] ?? null) !== v); return this; }
    or() { return this; }
    lt(c: string, v: string) { this.filters.push((r) => String(r[c]) < v); return this; }
    gte(c: string, v: string) { this.filters.push((r) => String(r[c]) >= v); return this; }
    lte(c: string, v: string) { this.filters.push((r) => String(r[c]) <= v); return this; }
    gt(c: string, v: string) { this.filters.push((r) => String(r[c]) > v); return this; }
    order(c: string, o?: { ascending?: boolean }) { this.sorts.push([c, o?.ascending !== false]); return this; }
    limit(n: number) { this.max = n; return this; }
    range(from: number, to: number) { this.skip = from; this.max = to - from + 1; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    single() { this.one = "single"; return this; }
    insert(p: Row | Row[]) { this.op = "insert"; this.payload = p; return this; }
    upsert(p: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.op = "upsert"; this.payload = p; this.opts = o; return this; }
    update(p: Row) { this.op = "update"; this.payload = p; return this; }
    delete() { this.op = "delete"; return this; }
    then<T>(res: (r: Result) => T, rej?: (e: unknown) => T) { return Promise.resolve(this.exec()).then(res, rej); }
    private matching(): Row[] { return this.rows().filter((r) => this.filters.every((f) => f(r))); }
    private exec(): Result {
      let out: Row[] = [];
      if (this.op === "select") {
        out = [...this.matching()];
        for (const [c, asc] of [...this.sorts].reverse()) out.sort((a, b) => (a[c] === b[c] ? 0 : (a[c] ?? "") < (b[c] ?? "") ? (asc ? -1 : 1) : (asc ? 1 : -1)));
        if (this.max != null || this.skip) out = out.slice(this.skip, this.max != null ? this.skip + this.max : undefined);
      } else if (this.op === "insert") {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
        out = list.map((p, i) => ({ id: p.id ?? `${this.table}-${this.rows().length + i + 1}`, created_at: new Date().toISOString(), ...p }));
        this.rows().push(...out);
      } else if (this.op === "upsert") {
        const keys = (this.opts.onConflict ?? "id").split(",").map((k) => k.trim());
        for (const p of Array.isArray(this.payload) ? this.payload : [this.payload!]) {
          const hit = this.rows().find((r) => keys.every((k) => same(r[k], p[k])));
          if (hit) {
            if (!this.opts.ignoreDuplicates) { Object.assign(hit, p); out.push(hit); }
          } else {
            const row = { id: p.id ?? `${this.table}-${this.rows().length + 1}`, ...p };
            this.rows().push(row);
            out.push(row);
          }
        }
      } else if (this.op === "update") {
        out = this.matching();
        for (const r of out) Object.assign(r, this.payload);
      } else if (this.op === "delete") {
        out = this.matching();
        db.tables[this.table] = this.rows().filter((r) => !out.includes(r));
      }
      if (this.one) {
        if (this.one === "single" && out.length !== 1) return { data: null, error: { message: `expected one row from ${this.table}` } };
        return { data: out[0] ?? null, error: null };
      }
      return { data: out, error: null };
    }
  }
  return db;
}

/** A lifecycle_write_client stand-in with the database rule: a field a person set is skipped, and "_from" records where a value came from. */
export function writeClientRpc(args: Row, db: FakeDb) {
  const client = db.tables.clients.find((c) => c.id === args.p_client);
  const written: string[] = [], skipped: string[] = [];
  if (!client) return { written, skipped };
  const sources = { ...(client.field_sources ?? {}) };
  const { _from: from = {}, ...fields } = args.p_fields as Row;
  for (const [k, v] of Object.entries(fields)) {
    const gov = k === "pillars_source" || k === "pillars_derived_at" ? "content_pillars" : k;
    const by = sources[gov]?.by;
    if (k !== "location" && (by === "person" || (by === "portal" && args.p_by === "lifecycle"))) { skipped.push(k); continue; }
    client[k] = v;
    written.push(k);
    if (k === gov && k !== "location") sources[k] = { by: args.p_by, at: "now", ...(typeof from[k] === "string" && from[k] ? { from: from[k] } : {}) };
  }
  client.field_sources = sources;
  return { written, skipped };
}
