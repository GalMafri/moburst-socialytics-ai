// supabase/functions/_shared/strategy/sections.ts
//
// The fields of each strategy section in version 2 (spec: docs/superpowers/
// specs/2026-11-03-strategy-v2-design.md, section 2), and how a section reads
// as plain lines: the writer's fixed context, the calendar planner's block and
// a person's version all read the same lines. Shared by the writer, the
// prompt, the deck and the page, so it imports nothing.
//
// Section keys are the 2 Nov keys: goals, audience, positioning,
// pillar:<name>, platform:<platform>:<posting|new>, not_now, avoid. A 2 Nov
// measures section has no field form; a person's version of it keeps showing,
// as text, under "Where we start" (placeOf). Nothing a person wrote is
// converted or lost: a 2 Nov text edit shows as text in its card until
// someone saves the card's fields.

/** content_strategies.shape of a strategy written as fields. */
export const STRATEGY_SHAPE = 2;

export const GOAL_METRICS = ["posts_per_week", "median_engagement", "engagement_rate", "followers"] as const;
export type GoalMetric = typeof GOAL_METRICS[number];
export const DIRECTIONS = ["above", "below"] as const;
export type Direction = typeof DIRECTIONS[number];

export interface Goal {
  title: string;
  why: string;
  platform: string;
  metric: GoalMetric;
  direction: Direction;
  /** Today's figure for the metric on the platform, from code; null when the platform has none yet. */
  baseline: number | null;
  /** The date the goal is for (YYYY-MM-DD): the written date plus 90 days, from code. */
  by: string;
}
export interface GoalsValue { items: Goal[] }
export interface AudienceValue { who: string; wants: string[]; where: string[] }
export interface PositioningValue { statement: string; points: Array<{ vs: string; point: string }> }
export interface PillarValue { purpose: string; formats: string[]; planned_share: number; ideas: Array<{ hook: string; format: string }> }
/** A real post of the client's that beat its usual numbers, as code finds it from the evidence id the writer named. */
export interface WorkedPost { date: string; multiple: number; metric: string; link: string | null; text: string; format: string }
export interface PlatformValue {
  role: string;
  post: string[];
  worked: WorkedPost[];
  /** New platforms only: four lines, one per week. */
  first_30?: string[];
  checks: { day_30: string; day_90: string };
}
export const AVOID_SOURCES = ["posts", "trend_profile", "brief", "team"] as const;
export type AvoidSource = typeof AVOID_SOURCES[number];
export interface AvoidValue { items: Array<{ pattern: string; source: AvoidSource }> }
export interface NotNowValue { items: Array<{ platform: string; reason: string }> }

export type SectionValue = GoalsValue | AudienceValue | PositioningValue | PillarValue | PlatformValue | AvoidValue | NotNowValue;

/** Where a section's card sits on the version 2 page. */
export type Place = "plan" | "start" | "audience" | "pillars" | "platforms" | "avoid";

/** Every section key, 2 Nov keys included, has a place on the page: no person's version is lost. */
export function placeOf(key: string): Place | null {
  if (key === "goals") return "plan";
  if (key === "measures") return "start";
  if (key === "audience" || key === "positioning") return "audience";
  if (key === "avoid") return "avoid";
  if (key === "not_now" || /^platform:[a-z0-9]+:(posting|new)$/.test(key)) return "platforms";
  if (/^pillar:.+/.test(key)) return "pillars";
  return null;
}

const METRIC_WORDS: Record<GoalMetric, string> = {
  posts_per_week: "posts a week",
  median_engagement: "median engagement per post",
  engagement_rate: "engagement rate",
  followers: "followers",
};
export const metricWords = (m: GoalMetric) => METRIC_WORDS[m] ?? m;

const SOURCE_WORDS: Record<AvoidSource, string> = { posts: "Our posts", trend_profile: "Industry trends", brief: "Brief", team: "Team" };
export const avoidSourceWords = (s: string) => SOURCE_WORDS[s as AvoidSource] ?? "Team";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/**
 * The one date style of the strategy, on the page and in the deck: "Feb 1,
 * 2027" from YYYY-MM-DD, or "Feb 1" with year: false. "" when it is no date.
 */
export function dayWords(day: string, opts: { year?: boolean } = {}): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day ?? ""));
  if (!m || !MONTHS[Number(m[2]) - 1]) return "";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}${opts.year === false ? "" : `, ${m[1]}`}`;
}

/** A figure as a person reads it: a rate as a percent, a count with separators, one decimal under 100. */
export function figureWords(metric: GoalMetric, n: number | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  if (metric === "engagement_rate") return `${Math.round(n * 1000) / 10}%`;
  return Math.abs(n) < 100 ? String(Math.round(n * 10) / 10) : Math.round(n).toLocaleString("en-US");
}

/** "Median engagement per post: 42 today, above it by Feb 1, 2027". */
export function targetLine(g: Pick<Goal, "metric" | "direction" | "baseline" | "by" | "platform">): string {
  const what = metricWords(g.metric);
  const name = `${g.platform} ${what}`;
  const by = dayWords(g.by);
  if (g.baseline === null) return `${name}: ${g.direction} today's by ${by}`;
  return `${name}: ${figureWords(g.metric, g.baseline)} today, ${g.direction} it by ${by}`;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const items = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");

/** A section's fields as plain lines. A string (a 2 Nov section or edit) is itself. */
export function sectionLines(key: string, value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  // deno-lint-ignore no-explicit-any
  const v = value as any;
  const lines: string[] = [];
  const push = (s: string) => { if (s) lines.push(s); };
  if (key === "goals") {
    for (const g of items(v.items)) {
      push(`- ${str(g.title)}${g.metric && g.by ? ` (${targetLine(g as unknown as Goal)})` : ""}${str(g.why) ? `. Why: ${str(g.why)}` : ""}`);
    }
  } else if (key === "audience") {
    push(str(v.who));
    if (strs(v.wants).length) push(`Wants:\n${bullets(strs(v.wants))}`);
    if (strs(v.where).length) push(`Where: ${strs(v.where).join(", ")}`);
  } else if (key === "positioning") {
    push(str(v.statement));
    for (const p of items(v.points)) push(`- vs ${str(p.vs)}: ${str(p.point)}`);
  } else if (key.startsWith("pillar:")) {
    push(str(v.purpose));
    if (strs(v.formats).length) push(`Formats: ${strs(v.formats).join(", ")}`);
    if (Number.isFinite(Number(v.planned_share))) push(`Planned share: ${Number(v.planned_share)}%`);
    for (const i of items(v.ideas)) push(`- Idea (${str(i.format)}): ${str(i.hook)}`);
  } else if (key.startsWith("platform:")) {
    push(str(v.role));
    if (strs(v.post).length) push(`What we post:\n${bullets(strs(v.post))}`);
    if (strs(v.first_30).length) push(`First 30 days:\n${strs(v.first_30).map((w, i) => `- Week ${i + 1}: ${w}`).join("\n")}`);
    const checks = v.checks ?? {};
    if (str(checks.day_30)) push(`Check at 30 days: ${str(checks.day_30)}`);
    if (str(checks.day_90)) push(`Check at 90 days: ${str(checks.day_90)}`);
  } else if (key === "avoid") {
    push(bullets(items(v.items).map((i) => str(i.pattern)).filter(Boolean)));
  } else if (key === "not_now") {
    push(items(v.items).map((i) => `${str(i.platform)}: ${str(i.reason)}`).join("\n"));
  }
  return lines.join("\n");
}

/** What a goal was written against: its platform, metric and direction. A person's goal is matched to the latest write's goal by this, never by position. */
const goalIdentity = (g: Record<string, unknown>): string | null => {
  const platform = str(g.platform).toLowerCase();
  const metric = str(g.metric);
  const direction = str(g.direction);
  return platform && metric && direction ? `${platform}|${metric}|${direction}` : null;
};

/** Each of a person's goals with the latest goal it was written against (the nth of a repeated identity matches the nth), and the ones that match none. */
function matchGoals(latest: unknown, edited: unknown): { found: Array<Record<string, unknown> | null>; orphans: Array<Record<string, unknown>> } {
  const now = items((latest as { items?: unknown } | null)?.items);
  const mine = items((edited as { items?: unknown } | null)?.items);
  const found: Array<Record<string, unknown> | null> = now.map(() => null);
  const orphans: Array<Record<string, unknown>> = [];
  for (const g of mine) {
    const id = goalIdentity(g);
    const at = id === null ? -1 : now.findIndex((n, i) => found[i] === null && goalIdentity(n) === id);
    if (at < 0) orphans.push(g); else found[at] = g;
  }
  return { found, orphans };
}

/** A goal as a person types it: the title and why, with the platform, metric and direction it was written against. */
const typedGoal = (g: Record<string, unknown>): Record<string, unknown> => ({
  title: str(g.title), ...(typeof g.why === "string" ? { why: g.why.trim() } : {}),
  platform: str(g.platform), metric: str(g.metric), direction: str(g.direction),
});

/**
 * What a person types in a card, and so the only part of a card that is
 * theirs: a goal's title and why (with the platform, metric and direction it
 * was written against) and a platform's role, posts, launch weeks and checks.
 * Numbers, dates and worked posts are never part of it. The edit sheet saves
 * this, the save compares it with the written version's (an unchanged save
 * hands the card back), and withLatestSection lays it over the latest write.
 * Every other card is all typed, so it is itself; a 2 Nov text is itself.
 */
export function typedPart(key: string, value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  if (key === "goals") return Array.isArray(v.items) ? { items: items(v.items).map(typedGoal) } : value;
  if (key.startsWith("platform:")) {
    const checks = (v.checks && typeof v.checks === "object" ? v.checks : null) as Record<string, unknown> | null;
    return {
      ...(typeof v.role === "string" ? { role: v.role.trim() } : {}),
      ...(Array.isArray(v.post) ? { post: strs(v.post) } : {}),
      ...(Array.isArray(v.first_30) ? { first_30: strs(v.first_30) } : {}),
      ...(checks ? { checks: { day_30: str(checks.day_30), day_90: str(checks.day_90) } } : {}),
    };
  }
  return value;
}

/**
 * A person's fields over the latest write. Only what the person typed is
 * theirs: a goal's title and why (matched to the latest goal by its platform,
 * metric and direction) and a platform's role, posts, launch weeks and
 * checks. Every number, date and worked post comes from the latest write, so
 * a strategy written again updates them. A section the person did not edit as
 * fields (a 2 Nov text, another card) is returned as saved.
 */
export function withLatestSection(key: string, latest: unknown, edited: unknown): unknown {
  if (!edited || typeof edited !== "object" || !latest || typeof latest !== "object") return edited;
  const e = edited as Record<string, unknown> & { checks?: unknown };
  const l = latest as Record<string, unknown>;
  if (key === "goals") {
    if (!Array.isArray(e.items) || !Array.isArray(l.items)) return edited;
    const { found } = matchGoals(l, e);
    return { ...l, items: items(l.items).map((g, i) => {
      const mine = found[i] ? typedGoal(found[i]!) : null;
      return mine ? { ...g, title: str(mine.title) || g.title, ...(mine.why !== undefined ? { why: mine.why } : {}) } : g;
    }) };
  }
  if (key.startsWith("platform:")) return { ...l, ...(typedPart(key, e) as Record<string, unknown>) };
  return edited;
}

/** The goals a person wrote that no goal of the latest write matches: shown beside the latest goals so their words are not lost. */
export function orphanedGoals(latest: unknown, edited: unknown): Array<{ title: string; why: string }> {
  return orphanGoalItems(latest, edited).map((g) => ({ title: str(g.title), why: str(g.why) })).filter((g) => g.title || g.why);
}

/** The same goals as stored (with the platform, metric and direction they were written against), so a save can keep them. */
export function orphanGoalItems(latest: unknown, edited: unknown): Array<Record<string, unknown>> {
  if (!edited || typeof edited !== "object" || !latest || typeof latest !== "object") return [];
  return matchGoals(latest, edited).orphans.filter((g) => str(g.title) || str(g.why));
}

/**
 * The section a person's version stands for: its fields over the latest
 * write's numbers, dates and worked posts when it has fields and the latest
 * write is known, else its fields, else its text. Every reader of a person's
 * version (the page, the deck, the planner's prompt, the writer's fixed
 * context) reads it here.
 */
export function editShown(key: string, edit: { text?: string | null; value?: unknown } | null | undefined, latest?: unknown): unknown {
  if (!edit) return null;
  return edit.value && typeof edit.value === "object" ? withLatestSection(key, latest, edit.value) : str(edit.text);
}
