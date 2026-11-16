// A strategy card's fields as the edit sheet shows them (spec: docs/
// superpowers/specs/2026-11-03-strategy-v2-design.md, section 1, "Editing"):
// a title input, list items one per line, and a picker beside each line that
// names a competitor or a platform. Each card kind turns its stored fields
// into the form and back. A goal's numbers and dates and a platform's worked
// posts are never stored with a person's edit: only what they typed is (a goal
// with the platform, metric and direction it was written against). That part
// is typedPart in sections.ts: the sheet saves it, the save compares it with
// the written version's (savedAsWritten), and withLatestSection (the one
// reader every consumer uses) puts it over the latest write when shown.
// What the form does not show for the other cards (a pillar idea's format) is
// kept from the version the person started from. The same caps the writer
// meets are shown as each field's limit.

import { AVOID_SOURCES, typedPart, type AvoidSource } from "../../supabase/functions/_shared/strategy/sections";
import { PLATFORM_NAMES, platformName } from "./display";

export interface Field {
  name: string;
  label: string;
  kind: "input" | "lines" | "number" | "pairs";
  /** Most characters per line, as the writer's caps. */
  max?: number;
  hint?: string;
  /** A "pairs" field: what is picked ("Competitor", "Platform"), and the choices. */
  pickLabel?: string;
  options?: string[];
  /** A "pairs" field: what to say beside a line that has only one half (the same words formIssue gives). */
  incomplete?: { pick: string; text: string };
}

/** One line of a "pairs" field: the picked name and what is written about it. */
export interface Pair { pick: string; text: string }
export type Form = Record<string, string | Pair[]>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const items = (v: unknown): Any[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const text = (v: string | Pair[] | undefined) => (typeof v === "string" ? v : "");
const pairs = (v: string | Pair[] | undefined): Pair[] => (Array.isArray(v) ? v : []);
const lines = (s: string | Pair[] | undefined) => String(text(s)).split("\n").map((l) => l.trim().replace(/^[-•*]\s+/, "")).filter(Boolean);

export type CardKind = "goals" | "audience" | "positioning" | "pillar" | "platform" | "avoid" | "not_now";

export function kindOf(key: string): CardKind | null {
  if (key === "goals" || key === "audience" || key === "positioning" || key === "avoid" || key === "not_now") return key;
  if (key.startsWith("pillar:")) return "pillar";
  if (key.startsWith("platform:")) return "platform";
  return null;
}

const PAIR_ISSUES: Record<string, { pick: string; text: string }> = {
  positioning: { pick: "Choose a competitor for each point.", text: "Write the point for each competitor you chose." },
  not_now: { pick: "Choose a platform for each line.", text: "Write the reason for each platform you chose." },
};

/** The fields of a card, for the version shown. */
export function fieldsOf(key: string, value: unknown, choices?: Choices): Field[] {
  const v = (value && typeof value === "object" ? value : {}) as Any;
  switch (kindOf(key)) {
    case "goals":
      return items(v.items).flatMap((_g, i) => [
        { name: `goal_${i}_title`, label: `Goal ${i + 1}`, kind: "input" as const, max: 60 },
        { name: `goal_${i}_why`, label: `Why goal ${i + 1}`, kind: "input" as const, max: 140 },
      ]);
    case "audience":
      return [
        { name: "who", label: "Who we write for", kind: "input", max: 120 },
        { name: "wants", label: "What they want", kind: "lines", max: 100, hint: "One per line" },
      ];
    case "positioning":
      return [
        { name: "statement", label: "Our position", kind: "input", max: 140 },
        { name: "points", label: "Against each competitor", kind: "pairs", max: 140, pickLabel: "Competitor", options: choices?.competitors ?? [], incomplete: PAIR_ISSUES.positioning },
      ];
    case "pillar":
      return [
        { name: "purpose", label: "What it is for", kind: "input", max: 120 },
        { name: "formats", label: "Formats", kind: "lines", max: 40, hint: "One per line" },
        { name: "planned_share", label: "Planned share of posts (%)", kind: "number" },
        { name: "ideas", label: "Example posts", kind: "lines", max: 100, hint: "One hook per line" },
      ];
    case "platform":
      return [
        { name: "role", label: "Role", kind: "input", max: 100 },
        { name: "post", label: "What we post", kind: "lines", max: 120, hint: "One per line" },
        ...(Array.isArray(v.first_30) ? [{ name: "first_30", label: "First 30 days", kind: "lines" as const, max: 140, hint: "One line per week" }] : []),
        { name: "day_30", label: "Check at 30 days", kind: "input", max: 140 },
        { name: "day_90", label: "Check at 90 days", kind: "input", max: 140 },
      ];
    case "avoid":
      return [{ name: "patterns", label: "Patterns we stop", kind: "lines", max: 120, hint: "One per line" }];
    case "not_now":
      return [{ name: "items", label: "Not now", kind: "pairs", max: 160, pickLabel: "Platform", options: choices?.platforms ?? [], incomplete: PAIR_ISSUES.not_now }];
    default:
      return [];
  }
}

/** The form for a card, filled from the version shown. */
export function toForm(key: string, value: unknown): Form {
  const v = (value && typeof value === "object" ? value : {}) as Any;
  switch (kindOf(key)) {
    case "goals":
      return Object.fromEntries(items(v.items).flatMap((g, i) => [[`goal_${i}_title`, str(g.title)], [`goal_${i}_why`, str(g.why)]]));
    case "audience":
      return { who: str(v.who), wants: strs(v.wants).join("\n") };
    case "positioning":
      return { statement: str(v.statement), points: items(v.points).map((p) => ({ pick: str(p.vs), text: str(p.point) })) };
    case "pillar":
      return { purpose: str(v.purpose), formats: strs(v.formats).join("\n"), planned_share: Number.isFinite(Number(v.planned_share)) ? String(v.planned_share) : "", ideas: items(v.ideas).map((i) => str(i.hook)).join("\n") };
    case "platform":
      return { role: str(v.role), post: strs(v.post).join("\n"), ...(Array.isArray(v.first_30) ? { first_30: strs(v.first_30).join("\n") } : {}), day_30: str(v.checks?.day_30), day_90: str(v.checks?.day_90) };
    case "avoid":
      return { patterns: items(v.items).map((i) => str(i.pattern)).join("\n") };
    case "not_now":
      return { items: items(v.items).map((i) => ({ pick: platformName(str(i.platform)) || str(i.platform), text: str(i.reason) })) };
    default:
      return {};
  }
}

/** The rows a person filled in: a row with neither half is dropped. */
const filled = (v: string | Pair[] | undefined) => pairs(v).map((r) => ({ pick: str(r.pick), text: str(r.text) })).filter((r) => r.pick || r.text);

/** Which half of a line is still empty, or null when the line is whole or untouched. */
export function missingHalf(row: Pair): "pick" | "text" | null {
  const pick = str(row.pick);
  const words = str(row.text);
  if (!pick && !words) return null;
  return !pick ? "pick" : !words ? "text" : null;
}

/** Why a form cannot be saved yet, or null. A line with only one half is never stored: the sheet marks the empty half and says what is missing beside it, and Save waits. */
export function formIssue(key: string, form: Form): string | null {
  const kind = kindOf(key);
  const words = kind ? PAIR_ISSUES[kind] : undefined;
  if (!words) return null;
  const rows = filled(form[kind === "positioning" ? "points" : "items"]);
  if (rows.some((r) => !r.pick)) return words.pick;
  if (rows.some((r) => !r.text)) return words.text;
  return null;
}

/** What the sheet offers to pick from, in the order shown, without repeats. */
export interface Choices { competitors: string[]; platforms: string[] }

const unique = (names: string[]) => {
  const seen = new Set<string>();
  return names.map(str).filter((n) => n && !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()));
};

/** The competitors the strategy was written against (and any the page names), and the platforms people know. */
export function choicesFor(product: unknown, shown: unknown, competitors: string[] = [], platforms: string[] = []): Choices {
  const from = (v: unknown, list: "points" | "items", name: "vs" | "platform") =>
    items(((v && typeof v === "object" ? v : {}) as Any)[list]).map((i) => str(i[name]));
  return {
    competitors: unique([...competitors, ...from(product, "points", "vs"), ...from(shown, "points", "vs")]),
    platforms: unique([...platforms.map((p) => platformName(p) || p), ...Object.values(PLATFORM_NAMES), ...from(product, "items", "platform").map((p) => platformName(p) || p), ...from(shown, "items", "platform").map((p) => platformName(p) || p)]),
  };
}

/** The card's fields from the form, keeping what the form does not show from the version started from. */
export function fromForm(key: string, form: Form, base: unknown, keep: Array<Record<string, unknown>> = []): Record<string, unknown> {
  const b = (base && typeof base === "object" ? base : {}) as Any;
  switch (kindOf(key)) {
    case "goals":
      // Each goal keeps the platform, metric and direction it was written against, so it finds its goal again when the strategy is written anew.
      // Goals the person wrote that match none of the latest goals (keep) stay in the saved version after them, until the person removes them.
      return typedPart(key, { items: [...items(b.items).map((g, i) => ({ ...g, title: str(form[`goal_${i}_title`]) || str(g.title), why: str(form[`goal_${i}_why`]) })), ...items(keep)] }) as Record<string, unknown>;
    case "audience":
      return { who: str(form.who), wants: lines(form.wants), where: strs(b.where) };
    case "positioning":
      return { statement: str(form.statement), points: filled(form.points).map((r) => ({ vs: r.pick, point: r.text })) };
    case "pillar": {
      const ideas = items(b.ideas);
      const share = Number(text(form.planned_share));
      return {
        purpose: str(form.purpose), formats: lines(form.formats), planned_share: Number.isFinite(share) && text(form.planned_share) !== "" ? Math.round(share) : Number(b.planned_share) || 0,
        ideas: lines(form.ideas).map((hook, i) => ({ hook, format: str(ideas[i]?.format) })),
      };
    }
    case "platform":
      return typedPart(key, {
        role: str(form.role), post: lines(form.post),
        ...(form.first_30 !== undefined ? { first_30: lines(form.first_30) } : {}), checks: { day_30: str(form.day_30), day_90: str(form.day_90) },
      }) as Record<string, unknown>;
    case "avoid": {
      const was = new Map(items(b.items).map((i) => [str(i.pattern), i.source]));
      return { items: lines(form.patterns).map((pattern) => ({ pattern, source: (AVOID_SOURCES as readonly string[]).includes(was.get(pattern)) ? (was.get(pattern) as AvoidSource) : "team" })) };
    }
    case "not_now":
      return { items: filled(form.items).map((r) => ({ platform: r.pick, reason: r.text })) };
    default:
      return {};
  }
}

/** The same JSON whatever the order of an object's keys. */
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Any)[k])}`).join(",")}}`
  : JSON.stringify(v ?? null);

/**
 * Whether a save holds exactly what the sheet saves from the written version
 * when nothing is typed: the written version run through the same form. For
 * goals and platform cards that is typedPart of the written version, the
 * part a person types. Such a save hands the card back, so it never becomes a
 * person's version that would hold the old words over every later rewrite.
 */
export function savedAsWritten(key: string, value: Record<string, unknown>, product: unknown): boolean {
  if (!product || typeof product !== "object") return false;
  return canonical(value) === canonical(fromForm(key, toForm(key, product), product));
}

/** Lines of a field over its cap, by field, for the "keep it to" hint. */
export function overCap(fields: Field[], form: Form): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fields) {
    if (!f.max) continue;
    const v = form[f.name];
    const longest = Math.max(0, ...(Array.isArray(v) ? v.map((r) => str(r.text).length) : String(v ?? "").split("\n").map((l) => l.trim().length)));
    if (longest > f.max) out[f.name] = longest;
  }
  return out;
}
