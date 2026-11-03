// supabase/functions/_shared/calendar/moments.ts
//
// Seasonal posts that fit the client (Lital, 3 Nov 2026). Design:
// docs/superpowers/specs/2026-11-03-seasonal-insights-design.md, part 1.
//
// The planner no longer picks holidays, awareness days or events from its own
// knowledge. A dated moment reaches a week's plan only like this:
//   1. moments_list lists the next five weeks' moments of a country (or the
//      world) with one web search call; a moment is kept only with a source
//      link and a date in range (parseMomentsList);
//   2. code drops, with no model call, a moment outside the client's
//      countries, outside the week, one this client removed before, or one in
//      a category the client's removals blocked (filterMoments); a sensitive
//      moment (civic or political, religious, remembrance or tragedy, conflict
//      or disaster) stays only when the client's own words name its space or
//      the client posted on it last year (belongsToSpace);
//   3. one model call keeps or drops each moment left, with one client-facing
//      sentence on why it fits, citing pillar names or the client's posts
//      (judgePrompt);
//   4. code checks that answer: cited pillars exist, cited posts were in the
//      input, and a sensitive moment stays only on the client's own evidence;
//      competitors posting about it are never proof (checkJudgement).
// The kept moments become the planner's evidence M1, M2 (momentEvidence),
// with their numbers from code, never from a model.
// Free of Deno and network imports so it can be tested.

import { clientFit } from "./reasonText.ts";
import { median, ratio, MIN_SAMPLE, type EvidenceItem, type OwnPost } from "./evidence.ts";
import { countryCode } from "../lifecycle/location.ts";

export const MOMENT_CATEGORIES = [
  "public_holiday", "cultural_commercial", "awareness_day", "sports", "civic_political", "religious", "remembrance_tragedy", "conflict_disaster",
] as const;
export type MomentCategory = typeof MOMENT_CATEGORIES[number];

/** Lital, 3 Nov 2026 (decision 1): the four sensitive categories. */
export const SENSITIVE_CATEGORIES: ReadonlySet<string> = new Set(["civic_political", "religious", "remembrance_tragedy", "conflict_disaster"]);

/** A category in words, for prompts and the memory. */
export const CATEGORY_WORDS: Record<MomentCategory, string> = {
  public_holiday: "public holiday", cultural_commercial: "cultural or commercial moment", awareness_day: "awareness day", sports: "sports event",
  civic_political: "civic or political moment", religious: "religious moment", remembrance_tragedy: "day of remembrance or tragedy", conflict_disaster: "conflict or disaster",
};

/** The country code of moments marked worldwide. */
export const GLOBAL = "GLOBAL";
/** Weeks one list covers, from the week it was made for. */
export const LIST_WEEKS = 5;
/** Days either side of last year's date the client's own posts are read for it. */
export const HISTORY_DAYS = 7;

export interface Moment {
  /** Country and name with no year ("us:election-day"): the same moment every year. */
  key: string;
  name: string;
  /** This year's date (the first day of a moment longer than a day). */
  date: string;
  last_year_date: string | null;
  /** ISO 3166 code, or GLOBAL. */
  country: string;
  category: MomentCategory;
  /** The page that gives this year's date. */
  link: string;
  hashtags: string[];
  /** Other names it is written as. */
  aliases: string[];
  /** Words that name its subject ("election", "voting"). */
  terms: string[];
}

const DAY_MS = 86400_000;
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const str = (x: unknown, n = 200) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, n) : "");
const round1 = (n: number) => Math.round(n * 10) / 10;

function jsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/** Lowercase words with accents, punctuation and years removed. */
function words(s: string): string {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ")
    .replace(/\b(19|20)\d{2}\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** "us:election-day": the country, then the name without its year. */
export function momentKey(country: string, name: string): string {
  return `${country.toLowerCase()}:${words(name).replace(/ /g, "-")}`;
}

/** The moment's name with no country, so two lists that name it can be told apart from two moments. */
const slugOf = (key: string) => key.slice(key.indexOf(":") + 1);

// ── 1. The list ─────────────────────────────────────────────────────────────

/** The one web search call that lists a country's moments (or the world's) for five weeks. */
export function momentsListPrompt(country: string, countryName: string, from: string, through: string): string {
  const where = country === GLOBAL ? "marked worldwide (international days and events followed around the world)" : `marked in ${countryName}`;
  return [
    `List the dated moments ${where} from ${from} to ${through} that brands post about on social media.`,
    "Search the web for each one's date this year. Include public holidays, cultural or commercial moments (shopping days, seasons people mark), awareness days, major sports events, civic or political days (elections, national civic days), religious holidays, days of remembrance or tragedy, and conflicts or disasters people are marking.",
    "Leave out industry events, conferences and product launches. Leave out any moment you could not find a page for.",
    "For each moment give:",
    "- name: its usual English name",
    "- date: its date this year, YYYY-MM-DD (the first day of a moment longer than a day)",
    "- last_year_date: its date last year, YYYY-MM-DD, or null when it did not happen last year",
    `- category: one of ${MOMENT_CATEGORIES.join(", ")}`,
    "- link: the address of a page you found that gives this year's date",
    "- hashtags: up to 3 hashtags people use for it",
    "- aliases: up to 4 other names it is written as",
    "- terms: up to 5 words that name its subject (for an election: election, voting, politics)",
    'Reply with JSON only: {"moments":[{"name":"...","date":"YYYY-MM-DD","last_year_date":"YYYY-MM-DD","category":"...","link":"https://...","hashtags":["#..."],"aliases":["..."],"terms":["..."]}]}',
  ].join("\n\n");
}

const tag = (t: unknown) => {
  const s = str(t, 60).replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return s ? `#${s}` : "";
};

/**
 * The listed moments code keeps: a name, a date from `from` to `through`, and
 * a link. A category the list doesn't know is read as cultural or
 * commercial, never as a sensitive one; one moment is kept once.
 */
export function parseMomentsList(text: string, range: { country: string; from: string; through: string }): Moment[] {
  const data = jsonObject(text);
  const raw = Array.isArray(data?.moments) ? data!.moments as Array<Record<string, unknown>> : [];
  const out = new Map<string, Moment>();
  for (const m of raw) {
    const name = str(m?.name, 120);
    const date = str(m?.date, 10);
    const link = str(m?.link, 600);
    if (!name || !isDay(date) || date < range.from || date > range.through || !/^https?:\/\/\S+$/i.test(link)) continue;
    const key = momentKey(range.country, name);
    if (!slugOf(key) || out.has(`${key}|${date}`)) continue;
    const category = (MOMENT_CATEGORIES as readonly string[]).includes(String(m.category)) ? m.category as MomentCategory : "cultural_commercial";
    const list = (x: unknown, n: number, each: (v: unknown) => string) => (Array.isArray(x) ? [...new Set(x.map(each).filter(Boolean))].slice(0, n) : []);
    out.set(`${key}|${date}`, {
      key, name, date, last_year_date: isDay(m.last_year_date) ? m.last_year_date : null, country: range.country, category, link,
      hashtags: list(m.hashtags, 3, tag), aliases: list(m.aliases, 4, (v) => str(v, 80)), terms: list(m.terms, 5, (v) => str(v, 40)),
    });
  }
  return [...out.values()];
}

// ── 2. Code's filter ────────────────────────────────────────────────────────

/** The client's countries: clients.geo, else its headquarters' country (clients.location), else none (global moments only). */
export function clientCountries(client: { geo?: unknown; location?: unknown }): string[] {
  const fromGeo = [...new Set(String(client.geo ?? "").split(",").map((s) => countryCode(s.trim())).filter((c): c is string => !!c))];
  if (fromGeo.length) return fromGeo;
  const loc = client.location && typeof client.location === "object" ? countryCode(String((client.location as Record<string, unknown>).country ?? "")) : null;
  return loc ? [loc] : [];
}

export type DropWhy = "country" | "week" | "removed" | "blocked_category" | "sensitive" | "off_brand" | "wrong_audience" | "no_angle" | "unchecked" | "no_answer";

export interface DroppedMoment {
  key: string;
  name: string;
  date: string;
  category: string;
  why: DropWhy;
}

const dropped = (m: Moment, why: DropWhy): DroppedMoment => ({ key: m.key, name: m.name, date: m.date, category: m.category, why });

/**
 * Step 1, with no model call: the moments of the client's countries (and the
 * world's) on a day of the week it can still post on, that this client never
 * removed, outside every category it blocked. A moment two lists name is
 * kept once, the country's own first.
 */
export function filterMoments(moments: Moment[], c: { countries: string[]; monday: string; firstDate: string; removedKeys: Set<string>; blocked: Set<string> }): { kept: Moment[]; dropped: DroppedMoment[] } {
  const countries = new Set([...c.countries, GLOBAL]);
  const last = addDays(c.monday, 6);
  const sorted = [...moments].sort((a, b) => Number(a.country === GLOBAL) - Number(b.country === GLOBAL) || a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const seen = new Set<string>();
  const kept: Moment[] = [];
  const out: DroppedMoment[] = [];
  for (const m of sorted) {
    const once = `${slugOf(m.key)}|${m.date}`;
    if (seen.has(once)) continue;
    seen.add(once);
    if (!countries.has(m.country)) out.push(dropped(m, "country"));
    else if (m.date < c.monday || m.date > last || m.date < c.firstDate) out.push(dropped(m, "week"));
    else if (c.removedKeys.has(m.key)) out.push(dropped(m, "removed"));
    else if (c.blocked.has(m.category)) out.push(dropped(m, "blocked_category"));
    else kept.push(m);
  }
  return { kept: kept.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key)), dropped: out };
}

/**
 * Lital, 3 Nov 2026 (decision 2): two removals in one category, with no
 * seasonal post of that category kept through its week, block the category.
 * `kept` is the client's planned seasonal posts still on the calendar after
 * their week ended.
 */
export function blockedCategories(removals: Array<{ category: string | null }>, kept: Array<{ category: string | null }>): Set<string> {
  const count = new Map<string, number>();
  for (const r of removals) if (r.category) count.set(r.category, (count.get(r.category) ?? 0) + 1);
  const keptCategories = new Set(kept.map((k) => k.category).filter(Boolean));
  return new Set([...count].filter(([c, n]) => n >= 2 && !keptCategories.has(c)).map(([c]) => c));
}

/** Words too general to say a brand's text is about a moment's subject. */
const GENERAL = new Set(["day", "days", "week", "month", "year", "holiday", "holidays", "season", "national", "international", "world", "global", "event", "events", "celebration"]);

/** Whether a text names the moment: its name, another name, a hashtag, or (with terms) a word for its subject, as whole words. */
export function namesMoment(text: string, m: Moment, opts: { terms?: boolean } = { terms: true }): boolean {
  const spaced = ` ${words(text)} `;
  const tokens = new Set(spaced.trim().split(" "));
  const phrases = [m.name, ...m.aliases, ...m.hashtags.map((h) => h.replace(/^#/, "")), ...(opts.terms === false ? [] : m.terms)]
    .map(words).filter((p) => p.length >= 4 && !GENERAL.has(p));
  return phrases.some((p) => spaced.includes(` ${p} `) || tokens.has(p.replace(/ /g, "")));
}

/** A post of the client's from last year on the moment, scored against that window's usual. */
export interface HistoryPost {
  id: string;
  platform: string;
  format: string;
  date: string;
  link: string | null;
  metric: "engagement";
  value: number;
  median: number;
  multiple: number;
  /** Posts on the platform in that format in the window, the median is from. */
  sample: number;
  thin: boolean;
}

export interface MomentHistory {
  /** The client's posts in the window. */
  posts: number;
  matched: HistoryPost[];
  best: HistoryPost | null;
}

/**
 * The client's own posts from a week either side of last year's date that
 * name the moment, each scored against the window's median for its platform
 * and format (the planner's smoothed ratio, evidence.ts). Under 5 posts in
 * that group is an early signal. Null when the moment has no date last year.
 */
export function momentHistory(m: Moment, posts: OwnPost[]): MomentHistory | null {
  if (!m.last_year_date) return null;
  const from = addDays(m.last_year_date, -HISTORY_DAYS);
  const to = addDays(m.last_year_date, HISTORY_DAYS);
  const window = posts.filter((p) => !p.boosted && String(p.publishedAt).slice(0, 10) >= from && String(p.publishedAt).slice(0, 10) <= to);
  const groups = new Map<string, OwnPost[]>();
  for (const p of window) groups.set(`${p.platform}|${p.format}`, [...(groups.get(`${p.platform}|${p.format}`) ?? []), p]);
  const matched: HistoryPost[] = [];
  for (const p of window) {
    if (!namesMoment(p.text, m, { terms: false })) continue;
    const group = groups.get(`${p.platform}|${p.format}`) ?? [p];
    const usual = median(group.map((g) => g.engagement)) ?? 0;
    matched.push({
      id: p.id, platform: p.platform, format: p.format, date: String(p.publishedAt).slice(0, 10), link: p.link, metric: "engagement",
      value: p.engagement, median: usual, multiple: round1(ratio(p.engagement, usual)), sample: group.length, thin: group.length < MIN_SAMPLE,
    });
  }
  matched.sort((a, b) => b.multiple - a.multiple || a.id.localeCompare(b.id));
  return { posts: window.length, matched, best: matched[0] ?? null };
}

/**
 * Lital, 3 Nov 2026 (decision 1): a brand is part of a sensitive moment's
 * space when its pillars, strategy or brief name it, or it posted on that
 * same moment last year. Competitors posting about it never count.
 */
export function belongsToSpace(m: Moment, ownText: string, history: MomentHistory | null): boolean {
  return !!history?.matched.length || namesMoment(ownText, m);
}

/** The competitors whose posts in the stored feeds name the moment, with how many posts each. */
export function competitorMentions(m: Moment, posts: Array<{ company: string; text: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of posts) if (p.company && namesMoment(p.text, m, { terms: false })) out[p.company] = (out[p.company] ?? 0) + 1;
  return out;
}

// ── 3. The judge ────────────────────────────────────────────────────────────

/** A client's own post from last year, as the judge sees it and cites it (O1, O2). */
export interface JudgeOwnPost {
  ref: string;
  id: string;
  text: string;
  platform: string;
  format: string;
  date: string;
  multiple: number;
  metric: string;
}

export interface JudgeInput {
  brand: string;
  pillars: Array<{ name: string; description?: string }>;
  /** The brief: brief_text and the brand identity's words. */
  brief: string;
  /** The strategy's audience, positioning and what to avoid (strategy/prompt.ts strategyBlock). */
  strategy: string;
  trendAudience: string;
  fitRubric: string;
  exclusions: string[];
  /** How the brand writes, in one line or two. */
  voice: string;
  /** The team's preferences from the memory, removals included. */
  preferences: string[];
  moments: Array<{ moment: Moment; sensitive: boolean; own: JudgeOwnPost[]; competitors: Record<string, number> }>;
}

export const JUDGE_REASONS = ["fits", "off_brand", "wrong_audience", "sensitive", "no_angle"] as const;

/** The judge's answer, through structured outputs. */
export const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["moments"],
  properties: {
    moments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "keep", "reason", "fit", "pillars", "posts"],
        properties: {
          key: { type: "string" },
          keep: { type: "boolean" },
          reason: { type: "string", enum: [...JUDGE_REASONS] },
          fit: { type: "string" },
          pillars: { type: "array", items: { type: "string" } },
          posts: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function judgePrompt(c: JudgeInput): string {
  const block = (title: string, body: string) => (body.trim() ? `${title}:\n${body.trim()}` : "");
  const moments = c.moments.map(({ moment: m, sensitive, own, competitors }) => [
    `- ${m.key}: ${m.name}, ${m.date}, a ${CATEGORY_WORDS[m.category]}${sensitive ? " (sensitive)" : ""}.`,
    own.length
      ? `  ${c.brand}'s own posts on it last year: ${own.map((o) => `${o.ref} (${o.platform} ${o.format}, ${o.date}, ${o.multiple}x its usual ${o.metric}): "${clip(o.text.replace(/\s+/g, " "), 200)}"`).join("; ")}`
      : `  ${c.brand} did not post on it last year.`,
    Object.keys(competitors).length
      ? `  Competitors that posted about it recently: ${Object.entries(competitors).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} (${n})`).join(", ")}`
      : "",
  ].filter(Boolean).join("\n")).join("\n");
  return [
    `You decide which dated moments this week ${c.brand} should post about on social media.`,
    c.pillars.length ? ["Content pillars:", ...c.pillars.map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ""}`)].join("\n") : "",
    block("The brief", clip(c.brief, 2500)),
    block("From the content strategy", c.strategy),
    block("The audience its trends are picked for", c.trendAudience),
    block("What makes a topic fit the brand", c.fitRubric),
    c.exclusions.length ? ["Topics the brand stays away from:", ...c.exclusions.map((x) => `- ${x}`)].join("\n") : "",
    block("How the brand writes", c.voice),
    c.preferences.length ? ["The team's preferences (always follow these):", ...c.preferences.map((p) => `- ${p}`)].join("\n") : "",
    ["The moments, each with the client's own posts on it last year by id:", moments].join("\n"),
    [
      "Rules:",
      "- Keep a moment only when the brand has a natural, specific angle on it for its own audience. A moment that is merely popular is no reason.",
      "- A sensitive moment (civic or political, religious, remembrance or tragedy, conflict or disaster) stays only when the brand's own pillars, brief or strategy are about that subject, or its own posts on it last year are listed. Competitors posting about it is never a reason.",
      "- Follow the team's preferences: a preference to skip a kind of moment drops every moment of that kind.",
      "- reason: fits for a keep; off_brand, wrong_audience, sensitive or no_angle for a drop.",
      "- For a keep, fit is ONE sentence (under 25 words) written for the client on why it suits them. Never mention ids, numbers, competitors or other posts in it.",
      "- For a keep, pillars lists the pillar names it rests on, written exactly as above, and posts lists the ids of the client's own posts it rests on (like O1). A keep cites at least one of them.",
      "- Answer for every moment listed, by its key.",
    ].join("\n"),
  ].filter(Boolean).join("\n\n");
}

/** A moment the judge kept and code checked: what the planner and the post's reason read. */
export interface JudgedMoment extends Moment {
  fit: string;
  /** Pillar names as the client has them. */
  pillars: string[];
  /** The ids of the client's own posts it rests on. */
  posts: string[];
  /** Competitors whose recent posts name it. */
  companies: number;
  /** The client's best post on it last year, scored; null without one. */
  history: HistoryPost | null;
}

/**
 * Step 4: the judge's answer, checked. A keep stays only with a usable
 * client-facing sentence (clientFit: one short sentence, no ids), at least
 * one citation, every cited pillar one of the client's and every cited post
 * one it was given for that moment; a sensitive keep also needs the client's
 * own evidence (a pillar or a post of its own). A failed keep is dropped.
 */
export function checkJudgement(text: string, input: JudgeInput, history: Map<string, HistoryPost | null> = new Map()): { kept: JudgedMoment[]; dropped: DroppedMoment[] } {
  const data = jsonObject(text);
  const answers = new Map<string, Record<string, unknown>>();
  for (const a of (Array.isArray(data?.moments) ? data!.moments : []) as Array<Record<string, unknown>>) {
    const key = str(a?.key, 200);
    if (key && !answers.has(key)) answers.set(key, a);
  }
  const pillarNames = new Map(input.pillars.map((p) => [p.name.trim().toLowerCase(), p.name]));
  const kept: JudgedMoment[] = [];
  const out: DroppedMoment[] = [];
  for (const { moment: m, sensitive, own, competitors } of input.moments) {
    const a = answers.get(m.key);
    if (!a) { out.push(dropped(m, "no_answer")); continue; }
    if (a.keep !== true) {
      const why = (["off_brand", "wrong_audience", "sensitive", "no_angle"] as const).find((r) => r === a.reason) ?? "no_angle";
      out.push(dropped(m, why));
      continue;
    }
    const cited = (x: unknown) => (Array.isArray(x) ? x.map((v) => str(v, 120)).filter(Boolean) : []);
    const pillars = cited(a.pillars);
    const posts = cited(a.posts);
    const fit = clientFit(str(a.fit, 400));
    const ownByRef = new Map(own.map((o) => [o.ref, o]));
    const pillarsOk = pillars.every((p) => pillarNames.has(p.toLowerCase()));
    const postsOk = posts.every((p) => ownByRef.has(p));
    // Every citation is the client's own evidence; a keep resting on nothing of its own (competitors only) cites nothing.
    if (!(pillars.length + posts.length)) { out.push(dropped(m, sensitive ? "sensitive" : "unchecked")); continue; }
    if (!fit || !pillarsOk || !postsOk) { out.push(dropped(m, "unchecked")); continue; }
    kept.push({
      ...m, fit, pillars: pillars.map((p) => pillarNames.get(p.toLowerCase())!), posts: posts.map((p) => ownByRef.get(p)!.id),
      companies: Object.keys(competitors).length, history: history.get(m.key) ?? null,
    });
  }
  return { kept, dropped: out };
}

// ── The planner's evidence ──────────────────────────────────────────────────

/** The kept moments as the planner cites them, M1, M2 by date, each with the client's own numbers when it has a post from last year. */
export function momentEvidence(kept: JudgedMoment[]): EvidenceItem[] {
  return [...kept].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key)).map((m, i) => ({
    id: `M${i + 1}`, kind: "moment" as const, text: m.name, key: m.key, category: m.category, date: m.date, link: m.link, fit: m.fit,
    ...(m.history ? { platform: m.history.platform, format: m.history.format, metric: m.history.metric, value: m.history.value, median: m.history.median, multiple: m.history.multiple, sample: m.history.sample, thin: m.history.thin } : {}),
    ...(m.companies ? { companies: m.companies } : {}),
  }));
}
