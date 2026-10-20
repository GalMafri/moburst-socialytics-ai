// Comparing a real report with its shadow: every number at the same place in
// both, compared exactly; every text field side by side; and what only one
// of them has. For a developer deciding whether an in-app pipeline matches
// n8n before its switch goes to app. Pure: the caller loads the two results
// (loadShadowPair in store.ts).

export interface CompareOptions {
  /** Paths left out, dotted, with * for any one key or index: "generated_at", "posts.*.fetched_at". */
  ignore?: string[];
  /**
   * Arrays matched by a field instead of by position, so the same post is
   * compared with itself whatever order each engine listed it in:
   * { "sprout_performance.top_posts": "post_id" }. A path may use *.
   */
  keyBy?: Record<string, string>;
}

export interface NumericDifference { path: string; real: number; shadow: number; delta: number }
export interface TextField { path: string; real: string; shadow: string; same: boolean }
export interface OtherDifference { path: string; real: unknown; shadow: unknown }

export interface Comparison {
  numbers: { compared: number; differences: NumericDifference[] };
  /** Every text field both have, side by side. */
  text: TextField[];
  /** Places where one has a number and the other text, or another kind of value. */
  typeMismatches: OtherDifference[];
  /** True/false and empty values that differ. */
  otherDifferences: OtherDifference[];
  onlyReal: string[];
  onlyShadow: string[];
}

/** A value with no parts; an empty array or object is kept as { empty }. */
type Leaf = number | string | boolean | null | { empty: "[]" | "{}" };

function matches(pattern: string, path: string): boolean {
  const p = pattern.split(".");
  const s = path.split(".");
  return p.length === s.length && p.every((seg, i) => seg === "*" || seg === s[i]);
}

/** Flattens a JSON value to path → leaf. Empty arrays and objects are leaves, so an empty list still shows. */
export function flatten(value: unknown, opts: CompareOptions = {}): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  const keyFor = (path: string) => Object.entries(opts.keyBy ?? {}).find(([pattern]) => matches(pattern, path))?.[1];
  const ignored = (path: string) => (opts.ignore ?? []).some((pattern) => matches(pattern, path));
  const walk = (v: unknown, path: string) => {
    if (path && ignored(path)) return;
    if (Array.isArray(v)) {
      if (!v.length) { out.set(path, { empty: "[]" }); return; }
      const field = keyFor(path);
      v.forEach((item, i) => {
        const key = field && item && typeof item === "object" && (item as Record<string, unknown>)[field] != null
          ? `${field}=${String((item as Record<string, unknown>)[field])}`
          : String(i);
        walk(item, path ? `${path}.${key}` : key);
      });
      return;
    }
    if (v && typeof v === "object") {
      const keys = Object.keys(v as Record<string, unknown>);
      if (!keys.length) { out.set(path, { empty: "{}" }); return; }
      for (const k of keys) walk((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
      return;
    }
    if (v === undefined) return;
    out.set(path, v as Leaf);
  };
  walk(value, "");
  return out;
}

const kindOf = (v: unknown) => (v === null ? "null" : typeof v === "object" ? "empty" : typeof v);

export function compareResults(real: unknown, shadow: unknown, opts: CompareOptions = {}): Comparison {
  const a = flatten(real, opts);
  const b = flatten(shadow, opts);
  const out: Comparison = { numbers: { compared: 0, differences: [] }, text: [], typeMismatches: [], otherDifferences: [], onlyReal: [], onlyShadow: [] };
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  for (const path of paths) {
    const inReal = a.has(path);
    const inShadow = b.has(path);
    if (!inShadow) { out.onlyReal.push(path); continue; }
    if (!inReal) { out.onlyShadow.push(path); continue; }
    const r = a.get(path);
    const s = b.get(path);
    if (typeof r === "number" && typeof s === "number") {
      out.numbers.compared += 1;
      // Exact: 0.1 + 0.2 and 0.3 are different numbers, and that is reported.
      if (!(r === s || (Number.isNaN(r) && Number.isNaN(s)))) out.numbers.differences.push({ path, real: r, shadow: s, delta: s - r });
      continue;
    }
    if (typeof r === "string" && typeof s === "string") {
      out.text.push({ path, real: r, shadow: s, same: r === s });
      continue;
    }
    if (kindOf(r) !== kindOf(s)) {
      out.typeMismatches.push({ path, real: r, shadow: s });
      continue;
    }
    if (JSON.stringify(r) !== JSON.stringify(s)) out.otherDifferences.push({ path, real: r, shadow: s });
  }
  return out;
}

/** The comparison as plain lines for a log or a terminal. */
export function formatComparison(c: Comparison, opts: { textWidth?: number; sameText?: boolean } = {}): string {
  const w = opts.textWidth ?? 80;
  const cut = (t: string) => (t.length > w ? `${t.slice(0, w - 1)}…` : t).replace(/\s+/g, " ");
  const lines: string[] = [];
  lines.push(`Numbers: ${c.numbers.compared} compared, ${c.numbers.differences.length} different.`);
  for (const d of c.numbers.differences) lines.push(`  ${d.path}: real ${d.real}, shadow ${d.shadow} (${d.delta >= 0 ? "+" : ""}${d.delta})`);
  const differing = c.text.filter((t) => !t.same);
  lines.push(`Text: ${c.text.length} fields, ${differing.length} different.`);
  for (const t of opts.sameText ? c.text : differing) {
    lines.push(`  ${t.path}${t.same ? " (same)" : ""}`);
    lines.push(`    real:   ${cut(t.real)}`);
    lines.push(`    shadow: ${cut(t.shadow)}`);
  }
  if (c.typeMismatches.length) {
    lines.push(`Different kinds of value: ${c.typeMismatches.length}.`);
    for (const m of c.typeMismatches) lines.push(`  ${m.path}: real ${JSON.stringify(m.real)}, shadow ${JSON.stringify(m.shadow)}`);
  }
  if (c.otherDifferences.length) {
    lines.push(`Other differences: ${c.otherDifferences.length}.`);
    for (const m of c.otherDifferences) lines.push(`  ${m.path}: real ${JSON.stringify(m.real)}, shadow ${JSON.stringify(m.shadow)}`);
  }
  if (c.onlyReal.length) lines.push(`Only in the real report: ${c.onlyReal.join(", ")}`);
  if (c.onlyShadow.length) lines.push(`Only in the shadow: ${c.onlyShadow.join(", ")}`);
  return lines.join("\n");
}
