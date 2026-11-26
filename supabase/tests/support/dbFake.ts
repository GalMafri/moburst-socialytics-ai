/**
 * A stand-in for a supabase-js client in tests: every call chain is recorded
 * (the table, then each method with its arguments) and answered by the test.
 * from(...).select(...).eq(...) resolves to whatever `answer` returns for the
 * recorded call; rpc(name, args) is recorded as table "rpc:<name>".
 */
export interface FakeCall {
  table: string;
  ops: Array<[string, unknown[]]>;
}
export type FakeAnswer = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };

/** The first op of a call with this name, or undefined. */
export const op = (call: FakeCall, name: string): unknown[] | undefined => call.ops.find(([n]) => n === name)?.[1];
/** Every eq filter of a call, as { column: value }. */
export const eqs = (call: FakeCall): Record<string, unknown> => Object.fromEntries(call.ops.filter(([n]) => n === "eq").map(([, a]) => [String(a[0]), a[1]]));

/**
 * The query builder methods supabase-js (postgrest-js) has. QA 22 Nov 2026
 * (P31-07): any other name is undefined here, as there, so calling one fails
 * with a TypeError instead of answering the test's rows.
 */
const BUILDER_METHODS = new Set([
  "select", "insert", "upsert", "update", "delete",
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "likeAllOf", "likeAnyOf", "ilike", "ilikeAllOf", "ilikeAnyOf",
  "is", "isDistinct", "in", "notIn", "contains", "containedBy", "rangeGt", "rangeGte", "rangeLt", "rangeLte", "rangeAdjacent",
  "overlaps", "textSearch", "match", "not", "or", "filter", "regexMatch", "regexIMatch",
  "order", "limit", "range", "abortSignal", "single", "maybeSingle", "csv", "geojson", "explain", "rollback",
  "returns", "overrideTypes", "maxAffected", "setHeader", "throwOnError", "rpc",
]);
const WRITES = new Set(["insert", "upsert", "update", "delete"]);

export function fakeDb(answer: (call: FakeCall) => FakeAnswer | Promise<FakeAnswer>) {
  const calls: FakeCall[] = [];
  const settle = async (call: FakeCall) => {
    const a = await answer(call);
    // A write sent without .select() asks for no rows back (return=minimal): its data is null, as from PostgREST.
    const names = call.ops.map(([n]) => n);
    const minimal = names.some((n) => WRITES.has(n)) && !names.includes("select");
    return { data: minimal ? null : a.data ?? null, error: a.error ?? null, count: a.count ?? null };
  };
  const chain = (call: FakeCall): unknown => {
    const builder: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => settle(call).then(ok, bad);
        if (typeof prop !== "string" || !BUILDER_METHODS.has(prop)) return undefined;
        return (...args: unknown[]) => {
          call.ops.push([String(prop), args]);
          return builder;
        };
      },
    });
    return builder;
  };
  const db = {
    from(table: string) {
      const call: FakeCall = { table, ops: [] };
      calls.push(call);
      return chain(call);
    },
    rpc(name: string, args?: unknown) {
      const call: FakeCall = { table: `rpc:${name}`, ops: [["rpc", [args]]] };
      calls.push(call);
      return chain(call);
    },
  };
  return { db, calls };
}
