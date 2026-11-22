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

/** A PostgREST filter list split at its top-level commas (none inside parentheses or quotes). */
function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "(") depth++;
    else if (!quoted && c === ")") depth--;
    else if (!quoted && depth === 0 && c === ",") { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** One PostgREST condition ("col.op.value", or an and(…)/or(…) group) as a row test; null when the form is not read here. */
function condition(s: string): ((r: Row) => boolean) | null {
  const group = /^(and|or)\((.*)\)$/.exec(s);
  if (group) {
    const parts = splitTop(group[2]).map(condition);
    if (parts.some((p) => !p)) return null;
    const fs = parts as Array<(r: Row) => boolean>;
    return group[1] === "and" ? (r) => fs.every((f) => f(r)) : (r) => fs.some((f) => f(r));
  }
  const m = /^([^.]+)\.(eq|neq|lt|lte|gt|gte|is|in)\.(.*)$/.exec(s);
  if (!m) return null;
  const [, col, op, raw] = m;
  const unquote = (v: string) => v.replace(/^"(.*)"$/, "$1");
  const value = unquote(raw);
  const cell = (r: Row) => field(r, col);
  switch (op) {
    case "eq": return (r) => same(cell(r), value);
    case "neq": return (r) => !same(cell(r), value);
    case "lt": return (r) => cell(r) != null && String(cell(r)) < value;
    case "lte": return (r) => cell(r) != null && String(cell(r)) <= value;
    case "gt": return (r) => cell(r) != null && String(cell(r)) > value;
    case "gte": return (r) => cell(r) != null && String(cell(r)) >= value;
    case "is": return (r) => (value === "null" ? (cell(r) ?? null) === null : String(cell(r)) === value);
    case "in": {
      const list = /^\((.*)\)$/.exec(raw)?.[1];
      if (list === undefined) return null;
      const vs = splitTop(list).map(unquote);
      return (r) => vs.some((v) => same(cell(r), v));
    }
  }
  return null;
}

/** A PostgREST or filter as one row test, or null when any part of it is not read here. */
function orFilter(expr: string): ((r: Row) => boolean) | null {
  return condition(`or(${expr})`);
}

/** A row as a caller holds it: a copy, as PostgREST answers, so a later write never changes what was read. */
const copy = (r: Row): Row => structuredClone(r);
/** A column, or a JSON field of one as PostgREST names it ("input->>kind"). */
const field = (r: Row, c: string) => {
  const [col, key] = c.split("->>");
  return key === undefined ? r[col] : r[col]?.[key];
};

/**
 * lifecycle_enqueue as 20261110210000_lifecycle_look_time.sql has it: a look
 * at p_at, unless a look not yet started is queued at p_at or less than a
 * minute after it or, for a request due now, is already due. Every fakeDb has
 * it unless a test gives its own.
 */
export function lookRpc(args: Row, db: FakeDb): null {
  const at = new Date(String(args.p_at ?? new Date().toISOString()));
  const minute = at.toISOString().slice(0, 16);
  const now = Date.now();
  const jobs = (db.tables.scheduled_jobs ??= []);
  const covered = jobs.some((j) => {
    if (j.kind !== "lifecycle" || !same(j.client_id, args.p_client) || (j.status ?? "queued") !== "queued") return false;
    const runs = Date.parse(String(j.available_at));
    return (runs >= at.getTime() && runs < at.getTime() + 60_000) || (at.getTime() <= now && runs <= now);
  });
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

let weekWriteRows = 0;

/**
 * trend_week_write as 20261117160000_trend_week_write.sql has it: the whole
 * week in one step. A post still in the week keeps its row, a new one is
 * added, one no longer in the week goes; a dismissed theme stays as it is
 * and a new theme with its title is left out; every other theme is replaced.
 * (supabase/tests/_shared/trends/weekWrite.migration.test.ts holds the SQL
 * itself to the same outcomes.)
 */
export function weekWriteRpc(args: Row, db: FakeDb): Row {
  const week = (db.tables.trend_weeks ?? []).find((w) => same(w.id, args.p_week) && same(w.client_id, args.p_client));
  if (!week) throw new Error("The week to write does not exist.");
  if (args.p_status !== "done" && args.p_status !== "partial") throw new Error("A written week is done or partial.");
  const posts = (db.tables.trend_posts ??= []);
  const incoming = new Map<string, Row>();
  for (const p of (args.p_posts ?? []) as Row[]) if (p.url != null && !incoming.has(p.url)) incoming.set(p.url, p);
  db.tables.trend_posts = posts.filter((p) => !same(p.week_id, args.p_week) || incoming.has(p.url));
  for (const [url, p] of incoming) {
    const row = db.tables.trend_posts.find((x) => same(x.week_id, args.p_week) && x.url === url);
    if (row) Object.assign(row, p);
    else db.tables.trend_posts.push({ id: `trend_posts-w${++weekWriteRows}`, created_at: new Date().toISOString(), week_id: args.p_week, client_id: args.p_client, ...p });
  }
  const stored = new Map(db.tables.trend_posts.filter((p) => same(p.week_id, args.p_week)).map((p) => [p.url as string, p.id as string]));
  const storedIds = new Set(stored.values());
  const themes = (db.tables.trend_themes ??= []);
  const dismissed = themes.filter((t) => same(t.week_id, args.p_week) && t.dismissed_at != null);
  for (const t of dismissed) t.post_ids = ((t.post_ids ?? []) as string[]).filter((id) => storedIds.has(id));
  const dismissedTitles = new Set(dismissed.map((t) => String(t.title).toLowerCase()));
  db.tables.trend_themes = themes.filter((t) => !same(t.week_id, args.p_week) || t.dismissed_at != null);
  ((args.p_themes ?? []) as Row[]).forEach((t, position) => {
    if (!String(t.title ?? "").trim() || dismissedTitles.has(String(t.title).toLowerCase())) return;
    db.tables.trend_themes.push({
      id: `trend_themes-w${++weekWriteRows}`, created_at: new Date().toISOString(), week_id: args.p_week, client_id: args.p_client, position, title: t.title,
      happening: t.happening ?? "", why_it_matters: t.why_it_matters ?? "", angle: t.angle ?? "", platforms: t.platforms ?? [],
      post_ids: ((t.post_urls ?? []) as string[]).map((u) => stored.get(u)).filter(Boolean), dismissed_at: null, dismissed_by: null,
    });
  });
  Object.assign(week, { status: args.p_status, platforms: args.p_platforms ?? {}, filter_status: args.p_filter_status ?? null, cost: args.p_cost ?? {}, finished_at: args.p_finished_at ?? new Date().toISOString() });
  const now = db.tables.trend_themes.filter((t) => same(t.week_id, args.p_week));
  return { posts: stored.size, themes: now.filter((t) => t.dismissed_at == null).length, dismissed_kept: now.filter((t) => t.dismissed_at != null).length };
}

/**
 * client_strategy_only: false unless the test says so. The rule itself (no
 * active row in sprout_profiles, not a demo copy) is the database's and is
 * tested there (supabase/tests/migrations/strategyOnlyClients.test.ts); a
 * test that needs a strategy-only client hands in `client_strategy_only: () => true`.
 */
const strategyOnlyRpc = () => false;

export function fakeDb(tables: Record<string, Row[]> = {}, given: Record<string, (args: Row, db: FakeDb) => unknown> = {}): FakeDb {
  const rpcs: Record<string, (args: Row, db: FakeDb) => unknown> = {
    client_strategy_only: strategyOnlyRpc, lifecycle_enqueue: lookRpc, trend_search_override_put: overridePutRpc, trend_hashtags_refreshed: hashtagsRefreshedRpc, trend_week_write: weekWriteRpc, ...given,
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
    // PostgREST's or filter ("status.neq.running,attempted_at.lt.\"…\"", and(…) groups), so a
    // claim's guard is tested (QA 22 Nov 2026, P38-3: it was ignored). A form not read here filters nothing, as before.
    or(expr: string) { const f = orFilter(expr); if (f) this.filters.push(f); return this; }
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
      // Copies, as PostgREST answers: a row a caller read never changes under it (QA 22 Nov 2026, P38-3).
      out = out.map(copy);
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
