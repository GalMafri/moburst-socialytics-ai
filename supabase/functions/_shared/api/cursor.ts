/**
 * Keyset pagination. Every list is ordered by created_at desc, id desc and
 * the cursor names the last row of the page, so a page never shifts when
 * rows are added in front of it.
 */
import { invalid } from "./errors.ts";

export interface Cursor {
  c: string;
  i: string;
}

const enc = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dec = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export function encodeCursor(c: Cursor): string {
  return enc(JSON.stringify({ c: c.c, i: c.i }));
}

export function decodeCursor(s: string | null | undefined): Cursor | null {
  if (!s) return null;
  try {
    const o = JSON.parse(dec(s)) as { c?: unknown; i?: unknown };
    if (typeof o?.c === "string" && typeof o?.i === "string") return { c: o.c, i: o.i };
    return null;
  } catch {
    return null;
  }
}

export function parseLimit(raw: string | null | undefined, def = 50, max = 200): number {
  if (raw == null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw invalid("limit must be a number");
  return Math.min(max, Math.max(1, Math.floor(n)));
}

/** Rows were fetched with limit + 1; the extra one only says a next page exists. */
export function pageOf<T extends { created_at: string; id: string }>(rows: T[], limit: number): { data: T[]; next_cursor: string | null } {
  const data = rows.slice(0, limit);
  const more = rows.length > limit;
  const last = data[data.length - 1];
  return { data, next_cursor: more && last ? encodeCursor({ c: last.created_at, i: last.id }) : null };
}
