// supabase/functions/_shared/lifecycle/names.ts
//
// The exact name rules the client lifecycle matches by: a company name as
// Sprout and the portal write it, and the portal's company slug. Exact
// equality only, never a fuzzy score. Free of Deno and network imports so it
// can be tested.

/**
 * A company name as matching compares it: lowercase, "&" read as "and",
 * punctuation removed, spaces collapsed, a trailing LLC, Inc or Co dropped.
 * Proven on 19 Oct 2026 against the 10 hand-made Sprout assignments
 * ("Pay The Pyper " and "Pay The Pyper" match; "Lega.bot" and "LegaBot" match).
 */
export function normName(s: string | null | undefined): string {
  let t = String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  while (/\s(llc|inc|co)$/.test(t)) t = t.replace(/\s(llc|inc|co)$/, "").trim();
  return t;
}

/** Two names for the same company, by the rule above. An empty name matches nothing. */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normName(a);
  return !!x && x === normName(b);
}

/**
 * The portal's company slug for a name: lowercase, accents removed, "&" read
 * as "and", every other run of characters a single dash. The hub writes its
 * slugs this way ("bader-law", "newday-usa", "gluvana-gluten-free").
 */
export function slugify(name: string): string {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "client";
}

/** A short stable hash of any text, for inputs keys that must not carry the text itself (FNV-1a, 32 bits). */
export function textHash(s: string | null | undefined): string {
  let h = 0x811c9dc5;
  const t = String(s ?? "");
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
