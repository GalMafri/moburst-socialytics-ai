/**
 * Shorten text to at most `max` characters without splitting a character.
 *
 * String.slice counts UTF-16 units, so it can cut an emoji in half. The half
 * left behind is not valid text, and the database rejects any row carrying
 * it ("Empty or invalid json"): drafting from a competitor post failed this
 * way whenever an emoji sat at the cut (13 Oct), and Uproar's strategy did on
 * 3 Nov. A half already in the source text (a post a network cut) is dropped
 * the same way, so whatever this returns can always be stored or sent.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function clipText(text: unknown, max: number): string {
  const chars = Array.from(String(text ?? "").replace(LONE_SURROGATE, ""));
  return chars.length <= max ? chars.join("") : chars.slice(0, max).join("");
}

/** The same cut, ending in "…" when it shortened the text; at most `max` characters in all. */
export function clipWithEllipsis(text: unknown, max: number): string {
  const whole = clipText(text, Number.MAX_SAFE_INTEGER);
  return Array.from(whole).length <= max ? whole : `${clipText(whole, max - 1)}…`;
}

/** Any JSON value with every string's half emoji dropped: a request body the Messages API and the database will take. */
export function wellFormedDeep<T>(value: T): T {
  if (typeof value === "string") return value.replace(LONE_SURROGATE, "") as T;
  if (Array.isArray(value)) return value.map(wellFormedDeep) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wellFormedDeep(v)])) as T;
  }
  return value;
}
