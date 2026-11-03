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

const SOURCE_WORDS: Record<AvoidSource, string> = { posts: "Our posts", trend_profile: "Trend profile", brief: "Brief", team: "Team" };
export const avoidSourceWords = (s: string) => SOURCE_WORDS[s as AvoidSource] ?? "Team";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "1 Feb 2027" from YYYY-MM-DD. */
export function dayWords(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day ?? ""));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

/** A figure as a person reads it: a rate as a percent, a count with separators, one decimal under 100. */
export function figureWords(metric: GoalMetric, n: number | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  if (metric === "engagement_rate") return `${Math.round(n * 1000) / 10}%`;
  return Math.abs(n) < 100 ? String(Math.round(n * 10) / 10) : Math.round(n).toLocaleString("en-US");
}

/** "Median engagement per post: 42 today, above it by 1 Feb 2027". */
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
      push(`- ${str(g.title)}${g.metric ? ` (${targetLine(g as unknown as Goal)})` : ""}${str(g.why) ? `. Why: ${str(g.why)}` : ""}`);
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

/** The section a person's version stands for: its fields when it has them, else its text. */
export function editShown(edit: { text?: string | null; value?: unknown } | null | undefined): unknown {
  if (!edit) return null;
  return edit.value && typeof edit.value === "object" ? edit.value : str(edit.text);
}
