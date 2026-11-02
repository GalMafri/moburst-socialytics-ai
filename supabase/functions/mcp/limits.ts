/**
 * How much one tool result may carry. Claude takes about 150,000 characters
 * per tool result on claude.ai and Desktop; the connector stops at 100,000
 * so a result is never cut by the client. Lists end at the last whole item
 * with a cursor for the rest; a report keeps its header and the whole
 * sections that fit, and names the others for a second call. Pure: values
 * in, values out.
 */
import { encodeCursor } from "../_shared/api/cursor.ts";

export const RESULT_CAP = 100_000;
const LIST_DEFAULT = 20;
const LIST_MAX = 50;

const size = (v: unknown): number => JSON.stringify(v).length;

/** The page size a list tool asks the API for: 20 by default, 1 to 50. */
export function listLimit(n: number | undefined): number {
  if (n == null || !Number.isFinite(n)) return LIST_DEFAULT;
  return Math.min(LIST_MAX, Math.max(1, Math.floor(n)));
}

/** The most leading whole items whose body fits the cap, at least one. */
export function capItems<T, B>(items: T[], body: (kept: T[]) => B, cap = RESULT_CAP): { kept: T[]; omitted: number } {
  let k = items.length;
  while (k > 1 && size(body(items.slice(0, k))) > cap) k -= 1;
  return { kept: items.slice(0, k), omitted: items.length - k };
}

/** A list page as the API answered it, or cut at the last whole item that fits, with a cursor from that item. */
export function capPage<T extends { id: string; created_at: string }>(page: { data: T[]; next_cursor: string | null }, cap = RESULT_CAP): { data: T[]; next_cursor: string | null } {
  if (size(page) <= cap) return page;
  const cursorAfter = (kept: T[]) => encodeCursor({ c: kept[kept.length - 1].created_at, i: kept[kept.length - 1].id });
  const { kept } = capItems(page.data, (k) => ({ data: k, next_cursor: cursorAfter(k) }), cap);
  return { data: kept, next_cursor: cursorAfter(kept) };
}

/**
 * One item with its header (every key that is not a section) and its
 * sections, in `order`. `wanted` narrows the sections; by default every one
 * is returned. Sections are added in order while the whole stays under the
 * cap, and the ones that did not fit are named in `omitted_sections`. One
 * section asked for on its own comes back whole whatever its size, so every
 * section can be read.
 */
export function pickSections(item: Record<string, unknown>, order: readonly string[], wanted?: readonly string[], cap = RESULT_CAP): { data: Record<string, unknown>; omitted_sections?: string[] } {
  const asked = order.filter((s) => (wanted?.length ? wanted.includes(s) : true) && s in item);
  const header: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) if (!order.includes(k)) header[k] = v;
  const whole = { ...header };
  for (const s of asked) whole[s] = item[s];
  if (size({ data: whole }) <= cap) return { data: whole };

  const reserve = size({ omitted_sections: asked }); // room for the names of what is left out
  const data = { ...header };
  const omitted: string[] = [];
  for (const s of asked) {
    if (size({ data: { ...data, [s]: item[s] } }) + reserve <= cap) data[s] = item[s];
    else omitted.push(s);
  }
  if (wanted?.length && omitted.length === asked.length && asked.length) {
    data[asked[0]] = item[asked[0]];
    omitted.shift();
  }
  return omitted.length ? { data, omitted_sections: omitted } : { data };
}
