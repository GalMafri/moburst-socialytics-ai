// A strategy card's fields as the edit sheet shows them (spec: docs/
// superpowers/specs/2026-11-03-strategy-v2-design.md, section 1, "Editing"):
// a title input, list items one per line. Each card kind turns its stored
// fields into the form and back; what the form does not show (a goal's
// metric, a pillar idea's format, the posts that worked) is kept from the
// version the person started from. The same caps the writer meets are shown
// as each field's limit.

import { AVOID_SOURCES, type AvoidSource, type Goal } from "../../supabase/functions/_shared/strategy/sections";

export interface Field {
  name: string;
  label: string;
  kind: "input" | "lines" | "number";
  /** Most characters per line, as the writer's caps. */
  max?: number;
  hint?: string;
}

export type Form = Record<string, string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const items = (v: unknown): Any[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const lines = (s: string | undefined) => String(s ?? "").split("\n").map((l) => l.trim().replace(/^[-•*]\s+/, "")).filter(Boolean);

export type CardKind = "goals" | "audience" | "positioning" | "pillar" | "platform" | "avoid" | "not_now";

export function kindOf(key: string): CardKind | null {
  if (key === "goals" || key === "audience" || key === "positioning" || key === "avoid" || key === "not_now") return key;
  if (key.startsWith("pillar:")) return "pillar";
  if (key.startsWith("platform:")) return "platform";
  return null;
}

/** The fields of a card, for the version shown. */
export function fieldsOf(key: string, value: unknown): Field[] {
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
        { name: "points", label: "Against each competitor", kind: "lines", max: 140, hint: "One per line: the competitor, a colon, the point" },
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
      return [{ name: "items", label: "Not now", kind: "lines", max: 160, hint: "One per line: the platform, a colon, the reason" }];
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
      return { statement: str(v.statement), points: items(v.points).map((p) => `${str(p.vs)}: ${str(p.point)}`).join("\n") };
    case "pillar":
      return { purpose: str(v.purpose), formats: strs(v.formats).join("\n"), planned_share: Number.isFinite(Number(v.planned_share)) ? String(v.planned_share) : "", ideas: items(v.ideas).map((i) => str(i.hook)).join("\n") };
    case "platform":
      return { role: str(v.role), post: strs(v.post).join("\n"), ...(Array.isArray(v.first_30) ? { first_30: strs(v.first_30).join("\n") } : {}), day_30: str(v.checks?.day_30), day_90: str(v.checks?.day_90) };
    case "avoid":
      return { patterns: items(v.items).map((i) => str(i.pattern)).join("\n") };
    case "not_now":
      return { items: items(v.items).map((i) => `${str(i.platform)}: ${str(i.reason)}`).join("\n") };
    default:
      return {};
  }
}

const colonPair = (line: string) => {
  const at = line.indexOf(":");
  return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1).trim()] : ["", line.trim()];
};

/** The card's fields from the form, keeping what the form does not show from the version started from. */
export function fromForm(key: string, form: Form, base: unknown): Record<string, unknown> {
  const b = (base && typeof base === "object" ? base : {}) as Any;
  switch (kindOf(key)) {
    case "goals":
      return { items: items(b.items).map((g: Goal, i) => ({ ...g, title: str(form[`goal_${i}_title`]) || g.title, why: str(form[`goal_${i}_why`]) })) };
    case "audience":
      return { who: str(form.who), wants: lines(form.wants), where: strs(b.where) };
    case "positioning":
      return { statement: str(form.statement), points: lines(form.points).map((l) => { const [vs, point] = colonPair(l); return { vs, point }; }) };
    case "pillar": {
      const ideas = items(b.ideas);
      const share = Number(form.planned_share);
      return {
        purpose: str(form.purpose), formats: lines(form.formats), planned_share: Number.isFinite(share) && form.planned_share !== "" ? Math.round(share) : Number(b.planned_share) || 0,
        ideas: lines(form.ideas).map((hook, i) => ({ hook, format: str(ideas[i]?.format) })),
      };
    }
    case "platform":
      return {
        role: str(form.role), post: lines(form.post), worked: Array.isArray(b.worked) ? b.worked : [],
        ...(form.first_30 !== undefined ? { first_30: lines(form.first_30) } : {}), checks: { day_30: str(form.day_30), day_90: str(form.day_90) },
      };
    case "avoid": {
      const was = new Map(items(b.items).map((i) => [str(i.pattern), i.source]));
      return { items: lines(form.patterns).map((pattern) => ({ pattern, source: (AVOID_SOURCES as readonly string[]).includes(was.get(pattern)) ? (was.get(pattern) as AvoidSource) : "team" })) };
    }
    case "not_now":
      return { items: lines(form.items).map((l) => { const [platform, reason] = colonPair(l); return { platform, reason }; }) };
    default:
      return {};
  }
}

/** Lines of a field over its cap, by field, for the "keep it to" hint. */
export function overCap(fields: Field[], form: Form): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fields) {
    if (!f.max) continue;
    const longest = Math.max(0, ...String(form[f.name] ?? "").split("\n").map((l) => l.trim().length));
    if (longest > f.max) out[f.name] = longest;
  }
  return out;
}
