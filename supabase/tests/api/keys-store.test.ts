import { describe, it, expect } from "vitest";
import { KEY_COLUMNS, makeKeyStore } from "../../functions/api/keys-store";
import { TABLE_COLUMNS } from "../../functions/api/schema-check";

type Row = Record<string, unknown>;
type Filter = [op: "eq" | "is" | "in" | "or", col: string, val: unknown];

/** One PostgREST logic-tree condition, as supabase-js .or() writes it: col.op.value, the value optionally in double quotes. */
function orHit(r: Row, expr: string): boolean {
  const parts = expr.match(/(?:[^,"]|"[^"]*")+/g) ?? [];
  return parts.some((part) => {
    const m = /^(\w+)\.(is|eq|gt)\.(.*)$/.exec(part.trim());
    if (!m) throw new Error(`unparsed or() condition: ${part}`);
    const [, col, op, raw] = m;
    const val = raw.replace(/^"(.*)"$/, "$1");
    if (op === "is") return val === "null" ? r[col] == null : String(r[col]) === val;
    if (op === "eq") return String(r[col]) === val;
    return r[col] != null && new Date(String(r[col])).getTime() > new Date(val).getTime();
  });
}

/**
 * A supabase-js stand-in over in-memory tables: applies eq, is, in and or, orders, counts, inserts and updates, and records
 * each query. A table named in `failing` answers every query with an error, as a database outage would.
 */
function memoryDb(tables: Record<string, Row[]>, failing: string[] = []) {
  const queries: Array<{ table: string; op: string; select: string; filters: Filter[]; head: boolean }> = [];
  let n = 0;
  const db = {
    from(table: string) {
      const q = { table, op: "select", select: "", filters: [] as Filter[], head: false, count: "", patch: null as Row | null, row: null as Row | null, order: null as [string, boolean] | null, one: "" };
      queries.push(q);
      const rowsOf = () => (tables[table] ??= []);
      const hit = (r: Row) => q.filters.every(([op, col, val]) => (op === "in" ? (val as unknown[]).includes(r[col]) : op === "or" ? orHit(r, col) : r[col] === val));
      const pick = (r: Row) => (q.select ? Object.fromEntries(q.select.split(",").map((c) => c.trim()).map((c) => [c, r[c]])) : r);
      const run = () => {
        if (failing.includes(table)) return { data: null, count: null, error: { message: `${table} is unavailable` } };
        let out: Row[];
        if (q.op === "insert") {
          n += 1;
          const row = { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, created_at: "2026-11-10T09:00:00.000Z", last_used_at: null, revoked_at: null, ...q.row };
          rowsOf().push(row);
          out = [row];
        } else if (q.op === "update") {
          out = rowsOf().filter(hit);
          for (const r of out) Object.assign(r, q.patch);
        } else {
          out = rowsOf().filter(hit);
          if (q.order) { const [col, asc] = q.order; out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1)); }
        }
        if (q.head) return { data: null, count: q.count ? out.length : null, error: null };
        const data = out.map(pick);
        if (q.one === "single") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
        if (q.one === "maybe") return { data: data[0] ?? null, error: null };
        return { data, error: null };
      };
      const b = {
        select: (cols: string, opts?: { count?: string; head?: boolean }) => { q.select = cols; q.count = opts?.count ?? ""; q.head = !!opts?.head; return b; },
        insert: (row: Row) => { q.op = "insert"; q.row = row; return b; },
        update: (patch: Row) => { q.op = "update"; q.patch = patch; return b; },
        eq: (col: string, val: unknown) => { q.filters.push(["eq", col, val]); return b; },
        is: (col: string, val: unknown) => { q.filters.push(["is", col, val]); return b; },
        in: (col: string, val: unknown[]) => { q.filters.push(["in", col, val]); return b; },
        or: (expr: string) => { q.filters.push(["or", expr, null]); return b; },
        order: (col: string, o: { ascending: boolean }) => { q.order = [col, o.ascending]; return b; },
        single: () => { q.one = "single"; return b; },
        maybeSingle: () => { q.one = "maybe"; return b; },
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
      };
      return b;
    },
  };
  // deno-lint-ignore no-explicit-any
  return { db: db as any, queries };
}

const LITAL = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-10T09:00:00.000Z");
const key = (id: string, over: Row = {}): Row => ({
  id, name: id, key_prefix: "soc_abcdefgh", key_hash: "f".repeat(64), scopes: ["read"], company_slugs: null, client_ids: null, rate_limit_per_minute: 120, created_by: null,
  created_at: "2026-11-01T00:00:00.000Z", expires_at: null, last_used_at: null, revoked_at: null, note: null, owner_user_id: null, ...over,
});
const K1 = "00000000-0000-4000-8000-0000000000a1";
const K2 = "00000000-0000-4000-8000-0000000000a2";
const K3 = "00000000-0000-4000-8000-0000000000a3";
const K4 = "00000000-0000-4000-8000-0000000000a4";
const K5 = "00000000-0000-4000-8000-0000000000a5";
const K6 = "00000000-0000-4000-8000-0000000000a6";
const personalRow = { name: "laptop", key_prefix: "soc_abcdefgh", key_hash: "a".repeat(64), scopes: ["read"], company_slugs: null, client_ids: null, rate_limit_per_minute: 120, created_by: LITAL, owner_user_id: LITAL, expires_at: "2027-02-08T09:00:00.000Z", note: null };

describe("the key store", () => {
  it("lists every key newest first, with the owner's email read from profiles in one query and null for a tool key", async () => {
    const { db, queries } = memoryDb({
      api_keys: [key(K1, { name: "gOS" }), key(K2, { owner_user_id: LITAL, created_at: "2026-11-03T00:00:00.000Z" }), key(K3, { owner_user_id: ADMIN, created_at: "2026-11-02T00:00:00.000Z" }), key(K4, { owner_user_id: LITAL, created_at: "2026-11-04T00:00:00.000Z" })],
      profiles: [{ user_id: LITAL, email: "lital@moburst.com" }],
    });
    const rows = await makeKeyStore(db).list();
    expect(rows.map((r) => [r.id, r.owner_email])).toEqual([[K4, "lital@moburst.com"], [K2, "lital@moburst.com"], [K3, null], [K1, null]]);
    const profiles = queries.filter((q) => q.table === "profiles");
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ select: "user_id, email", filters: [["in", "user_id", [LITAL, ADMIN]]] });
    expect(queries.find((q) => q.table === "api_keys")?.select).toBe(KEY_COLUMNS);
  });

  it("skips the profiles query when no key has an owner", async () => {
    const { db, queries } = memoryDb({ api_keys: [key(K1)] });
    expect((await makeKeyStore(db).list())[0].owner_email).toBeNull();
    expect(queries.map((q) => q.table)).toEqual(["api_keys"]);
  });

  it("lists one person's keys only, newest first, without reading profiles", async () => {
    const { db, queries } = memoryDb({
      api_keys: [key(K1), key(K2, { owner_user_id: LITAL, created_at: "2026-11-02T00:00:00.000Z" }), key(K3, { owner_user_id: ADMIN }), key(K4, { owner_user_id: LITAL, created_at: "2026-11-05T00:00:00.000Z" })],
      profiles: [{ user_id: LITAL, email: "lital@moburst.com" }],
    });
    const rows = await makeKeyStore(db).listByOwner(LITAL);
    expect(rows.map((r) => r.id)).toEqual([K4, K2]);
    expect(rows.every((r) => r.owner_email === null)).toBe(true);
    expect(queries.map((q) => q.table)).toEqual(["api_keys"]);
    expect(queries[0].filters).toEqual([["eq", "owner_user_id", LITAL]]);
  });

  it("inserts with the owner and answers the stored row, without reading profiles", async () => {
    const tables: Record<string, Row[]> = { api_keys: [], profiles: [{ user_id: LITAL, email: "lital@moburst.com" }] };
    const { db, queries } = memoryDb(tables);
    const row = await makeKeyStore(db).insert(personalRow);
    expect(tables.api_keys[0]).toMatchObject({ owner_user_id: LITAL, created_by: LITAL, scopes: ["read"] });
    expect(tables.api_keys[0]).not.toHaveProperty("owner_email");
    expect(row).toMatchObject({ name: "laptop", owner_user_id: LITAL, owner_email: null, revoked_at: null });
    expect(queries.map((q) => q.table)).toEqual(["api_keys"]);
  });

  it("never lets a failing profiles lookup fail a create or a person's list (only the admin list reads profiles)", async () => {
    const tables: Record<string, Row[]> = { api_keys: [key(K1, { owner_user_id: LITAL })] };
    const { db } = memoryDb(tables, ["profiles"]);
    const store = makeKeyStore(db);
    const made = await store.insert(personalRow);
    expect(made.owner_user_id).toBe(LITAL);
    expect(tables.api_keys).toHaveLength(2);
    expect((await store.listByOwner(LITAL)).map((r) => r.id)).toHaveLength(2);
    expect(await store.countLive(LITAL, NOW)).toBe(2);
    // The outage is real: the admin list, which does read profiles, fails on it.
    await expect(store.list()).rejects.toThrow(/profiles is unavailable/);
  });

  it("counts a person's live keys with one filtered count, ignoring revoked, expired and anyone else's keys", async () => {
    const { db, queries } = memoryDb({
      api_keys: [
        key(K1, { owner_user_id: LITAL, expires_at: "2027-01-01T00:00:00.000Z" }),
        key(K2, { owner_user_id: LITAL, expires_at: null }),
        key(K3, { owner_user_id: LITAL, revoked_at: "2026-11-01T00:00:00.000Z", expires_at: "2027-01-01T00:00:00.000Z" }),
        key(K4, { owner_user_id: LITAL, expires_at: NOW.toISOString() }),
        key(K5, { owner_user_id: LITAL, expires_at: "2026-10-01T00:00:00.000Z" }),
        key(K6, { owner_user_id: ADMIN, expires_at: null }),
      ],
    });
    expect(await makeKeyStore(db).countLive(LITAL, NOW)).toBe(2);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ table: "api_keys", head: true });
    expect(queries[0].filters).toEqual(expect.arrayContaining([["eq", "owner_user_id", LITAL], ["is", "revoked_at", null]]));
    expect(queries[0].filters.find(([op]) => op === "or")?.[1]).toBe(`expires_at.is.null,expires_at.gt."${NOW.toISOString()}"`);
  });

  it("revokes a person's own key once, answers the stored time after that, and never touches anyone else's", async () => {
    const tables: Record<string, Row[]> = { api_keys: [key(K1, { owner_user_id: LITAL }), key(K2, { owner_user_id: ADMIN }), key(K3), key(K4, { owner_user_id: LITAL, revoked_at: "2026-11-01T08:00:00.000Z" })] };
    const { db, queries } = memoryDb(tables);
    const store = makeKeyStore(db);
    const first = await store.revokeOwned(K1, LITAL);
    expect(first?.id).toBe(K1);
    expect(first?.revoked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await store.revokeOwned(K1, LITAL)).toEqual(first);
    expect(await store.revokeOwned(K4, LITAL)).toEqual({ id: K4, revoked_at: "2026-11-01T08:00:00.000Z" });
    expect(await store.revokeOwned(K2, LITAL)).toBeNull();
    expect(await store.revokeOwned(K3, LITAL)).toBeNull();
    expect(await store.revokeOwned("00000000-0000-4000-8000-999999999999", LITAL)).toBeNull();
    expect(tables.api_keys.find((r) => r.id === K2)?.revoked_at).toBeNull();
    expect(tables.api_keys.find((r) => r.id === K3)?.revoked_at).toBeNull();
    for (const q of queries) expect(q.filters, `${q.op} ${JSON.stringify(q.filters)}`).toContainEqual(["eq", "owner_user_id", LITAL]);
    // A malformed id is no key at all: answered without a query (the column is a uuid, so the database would refuse it).
    const before = queries.length;
    expect(await store.revokeOwned("not-a-uuid", LITAL)).toBeNull();
    expect(queries.length).toBe(before);
  });

  it("is checked against the live database by the schema check, owner included", () => {
    expect(KEY_COLUMNS.split(", ")).toContain("owner_user_id");
    expect(TABLE_COLUMNS).toContainEqual(["api_keys", KEY_COLUMNS]);
  });
});
