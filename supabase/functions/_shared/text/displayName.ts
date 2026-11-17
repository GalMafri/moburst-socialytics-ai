// supabase/functions/_shared/text/displayName.ts
//
// A display name written plainly (copy sources, 17 Nov 2026). A social
// network shows a person or a company under whatever name it typed: stars,
// emoji, a tagline after a dash. A mention in a post arrives inline as that
// display name, with no "@", so a name with decorations was learned as the
// client's own wording and written back into its copy. The agency's Sprout
// account lists the exact display names (the accounts step stores the
// decorated ones); wherever the app learns from text or writes copy, each is
// replaced by its plain form. Exact replacement of listed names only: a name
// Sprout does not list is left as it is. Only decoration goes: stars, emoji,
// dingbats, box and arrow characters, trademark marks. A symbol that is part
// of a name stays ("A+ Tutoring", "Dollar$ave", a degree sign). A name is
// shortened at a tagline separator only when the short form is known to be
// the name by an exact fact ("Smith - Jones Law" is a name; "Harbor Wax -
// Smooth Skin Studio" is "Harbor Wax" when the client it belongs to is
// called Harbor Wax). Pure: its one import is the name rule, which has none.

import { sameName } from "../lifecycle/names.ts";

/** A tagline after a name: a bar, a hyphen, an en dash or an em dash, set off by spaces. Parentheses are part of the name. */
export const NAME_TAGLINE = /\s+\|\s*|\s*\|\s+|\s+[-\u2013\u2014]\s+/;
/**
 * The decoration a display name may carry: symbols that are neither
 * mathematical nor currency (\p{So}: stars, dingbats, box and block drawing,
 * trademark marks), emoji with what they are built from (skin tones, the
 * variation selector, the joiner, flag tags), and arrows. Mathematical,
 * currency and modifier symbols (plus, equals, less than, a dollar or euro
 * sign, a caret) are part of a name and stay.
 */
const DECORATION = /[\p{So}\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D\u{E0020}-\u{E007F}\u2190-\u21FF\u27F0-\u27FF\u2900-\u297F]/gu;
/** Symbols of that kind that are part of a name all the same: the degree sign and the numero sign. */
const KEPT = new Set(["\u00B0", "\u2116"]);
/** A plain name shorter than this is not a name to search text for. */
export const NAME_MIN_CHARS = 3;
/** The most decorated names kept for one account list. */
const NAMES_MAX = 200;

const tidy = (s: string) => s.replace(DECORATION, (ch) => (KEPT.has(ch) ? ch : "")).replace(/\s+/g, " ").trim().replace(/[\s,;:\u00B7\u2022]+$/, "");

/**
 * A display name without its decoration; parentheses and the symbols a name
 * is written with stay. The part after a tagline separator is cut only when
 * the part before it is itself a known name: equal, by the name rule
 * (names.ts sameName), to one of `known` (the name of the client the profile
 * belongs to, its Sprout group's name, another profile of the same owner).
 * With no such fact the whole display name is the name.
 */
export function plainDisplayName(name: string | null | undefined, known: Array<string | null | undefined> = []): string {
  const whole = String(name ?? "");
  const cut = whole.search(NAME_TAGLINE);
  if (cut > 0) {
    const short = tidy(whole.slice(0, cut));
    if (short && known.some((k) => sameName(short, k))) return short;
  }
  return tidy(whole);
}

/** A display name Sprout lists with decoration, and how it is written plainly. */
export interface ListedName { name: string; plain: string }

const longestFirst = (a: ListedName, b: ListedName) => b.name.length - a.name.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The names that carry a decoration, each with its plain form: distinct,
 * trimmed, the plain form different from the name and NAME_MIN_CHARS or
 * longer, longest name first, at most 200. `known` are the names that make a
 * short form the name (plainDisplayName). A plain name is not listed, and
 * neither is one made only of symbols. A name listed twice keeps the shorter
 * plain form: one owner knowing the short name is enough.
 */
export function listedNames(entries: Array<{ name: string | null | undefined; known?: Array<string | null | undefined> }>): ListedName[] {
  const out = new Map<string, string>();
  for (const e of entries) {
    const name = String(e.name ?? "").trim();
    if (!name) continue;
    const plain = plainDisplayName(name, e.known ?? []);
    if (plain === name || plain.length < NAME_MIN_CHARS) continue;
    const had = out.get(name);
    if (had === undefined || plain.length < had.length) out.set(name, plain);
  }
  return [...out].map(([name, plain]) => ({ name, plain })).sort(longestFirst).slice(0, NAMES_MAX);
}

/** Listed names as they come back from storage: only pairs of two texts are kept. */
export function storedNames(value: unknown): ListedName[] {
  return (Array.isArray(value) ? value : [])
    .filter((x): x is ListedName => !!x && typeof x === "object" && typeof (x as ListedName).name === "string" && typeof (x as ListedName).plain === "string" && !!(x as ListedName).name)
    .map((x) => ({ name: x.name, plain: x.plain }));
}

/**
 * Text with each listed name written plainly, longest name first. Exact and
 * case-sensitive. Text that holds none of them is returned as it was (the
 * same string).
 */
export function plainNames(text: string, listed: ListedName[]): string {
  let out = text;
  for (const { name, plain } of [...listed].sort(longestFirst)) {
    if (!name || !out.includes(name)) continue;
    out = out.split(name).join(plain);
  }
  return out;
}
