// A small in-memory stand-in for the supabase-js client, with the builder
// methods the public profile reads use and their answers' shapes: a write
// read back only with .select(), single() refusing anything but one row,
// upsert on the named conflict columns, and one inner join
// (competitor_sets with clients!inner). Every write is kept in `writes`.

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

let seq = 0;
const newId = () => `id-${++seq}`;

const field = (r: Row, key: string): unknown => key.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Row)[k] : undefined), r);

export function memDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [t, rows] of Object.entries(seed)) tables[t] = rows.map((r) => ({ ...r }));
  const writes: Array<{ table: string; op: string; rows: Row[] }> = [];
  const table = (t: string) => (tables[t] ??= []);

  function from(name: string) {
    let op: "select" | "insert" | "update" | "upsert" = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    let conflict: string[] = [];
    let ignoreDuplicates = false;
    let returning = false;
    let columns = "*";
    let single: "one" | "maybe" | null = null;
    let limit: number | null = null;
    const filters: Filter[] = [];

    const run = (): { data: unknown; error: { message: string } | null } => {
      const rows = table(name);
      let out: Row[] = [];
      if (op === "insert") {
        out = payload.map((r) => ({ id: newId(), ...r }));
        rows.push(...out);
      } else if (op === "upsert") {
        for (const r of payload) {
          const hit = rows.find((x) => conflict.every((c) => x[c] === r[c]));
          if (hit) {
            if (ignoreDuplicates) continue;
            Object.assign(hit, r);
            out.push(hit);
          } else {
            const row = { id: newId(), ...r };
            rows.push(row);
            out.push(row);
          }
        }
      } else if (op === "update") {
        out = rows.filter((r) => filters.every((f) => f(r)));
        for (const r of out) Object.assign(r, patch);
      } else {
        const joined = /clients!inner\(/.test(columns)
          ? rows.map((r) => ({ ...r, clients: table("clients").find((c) => c.id === r.client_id) })).filter((r) => r.clients)
          : rows;
        out = joined.filter((r) => filters.every((f) => f(r)));
        if (limit !== null) out = out.slice(0, limit);
      }
      if (op !== "select") writes.push({ table: name, op, rows: out.map((r) => ({ ...r })) });
      const data = op === "select" || returning ? out.map((r) => ({ ...r })) : null;
      if (single) {
        if (single === "one" && (!data || data.length !== 1)) return { data: null, error: { message: `expected one row, got ${data?.length ?? 0}` } };
        return { data: data?.[0] ?? null, error: null };
      }
      return { data, error: null };
    };

    const b = {
      select(cols = "*") {
        columns = cols;
        if (op !== "select") returning = true;
        return b;
      },
      insert(rows: Row | Row[]) {
        op = "insert";
        payload = Array.isArray(rows) ? rows : [rows];
        return b;
      },
      upsert(rows: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
        op = "upsert";
        payload = Array.isArray(rows) ? rows : [rows];
        conflict = (o.onConflict ?? "id").split(",").map((s) => s.trim());
        ignoreDuplicates = !!o.ignoreDuplicates;
        return b;
      },
      update(p: Row) {
        op = "update";
        patch = p;
        return b;
      },
      eq(k: string, v: unknown) {
        filters.push((r) => field(r, k) === v);
        return b;
      },
      in(k: string, vs: unknown[]) {
        filters.push((r) => vs.includes(field(r, k)));
        return b;
      },
      is(k: string, v: unknown) {
        filters.push((r) => (field(r, k) ?? null) === v);
        return b;
      },
      order() {
        return b;
      },
      limit(n: number) {
        limit = n;
        return b;
      },
      single() {
        single = "one";
        return b;
      },
      maybeSingle() {
        single = "maybe";
        return b;
      },
      then<T>(resolve: (v: { data: unknown; error: { message: string } | null }) => T, reject?: (e: unknown) => T) {
        try {
          return Promise.resolve(resolve(run()));
        } catch (e) {
          return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
        }
      },
    };
    return b;
  }

  return { db: { from }, tables, writes, rows: (t: string) => table(t) };
}
