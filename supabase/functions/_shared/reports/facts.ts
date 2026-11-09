// supabase/functions/_shared/reports/facts.ts
//
// Report insights from the data (Lital, 3 Nov 2026). Design:
// docs/superpowers/specs/2026-11-03-seasonal-insights-design.md, part 2.
//
// What a report says is decided here, in code, from the figures the report
// shows (reportText.ts socialFigures, competitiveFigures "shown"), the same
// for n8n's reports and the app's. A model only words these facts
// (insights.ts). The facts:
//   change    current against previous, absolute and percent, overall and
//             per platform (the social aggregate's calcChange rounding);
//   ranking   the client's place among its competitors on each comparison
//             metric, with the leader and the set's median;
//   outlier   a post far above its account's usual per post on its platform
//             (the planner's smoothed ratio, calendar/evidence.ts);
//   share     each platform's share of engagements and impressions.
// A change is a finding when it is bigger than the client's usual
// month-to-month swing in that metric (the median absolute change across its
// earlier reports); with fewer than three earlier reports, the five largest
// changes are kept. Facts are sorted by score, then by their key, and
// numbered F1, F2: no clock, no object order and no model touches the list.
// A fact's words name no data vendor: clients read them. Where its figures
// come from is data (sources), which staff see appended (shownFields.ts).
// Free of Deno and network imports so it can be tested.

import { competitiveFigures, socialFigures, type Figure } from "./reportText.ts";
import { normalizedCompetitiveMetrics } from "../competitive/reportMetrics.ts";
import { sproutEngagements } from "./socialFigures.ts";
import { median } from "../calendar/evidence.ts";
import { mediaKind, mediaLabel } from "./mediaKind.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export type FactKind = "change" | "ranking" | "outlier" | "share";
/** How a fact's numbers are written: a count, a percentage (a rate or a share), or posts a week. */
export type FactUnit = "count" | "percent" | "per_week";
/** Where a fact's figures come from: the client's own connected profiles, the competitor tracking, or both. Never in its words. */
export type FactSource = "sprout" | "rivaliq";

export interface Fact {
  /** F1, F2 by score; given by numberFacts. */
  id: string;
  /** What the fact is about, the same in every report: kind, platform, metric, company. */
  key: string;
  kind: FactKind;
  /** "all" or a platform's name. */
  platform: string;
  metric: string;
  company?: string;
  unit: FactUnit;
  value: number;
  previous?: number;
  /** current minus previous; a rate's change is in points. */
  change?: number;
  percent?: number;
  rank?: number;
  of?: number;
  leader?: string;
  leaderValue?: number;
  median?: number;
  multiple?: number;
  usual?: number;
  /** A share: the part and the whole. */
  total?: number;
  link?: string;
  format?: string;
  score: number;
  /** Every number a sentence citing this fact may write. */
  numbers: number[];
  /** The fact in a sentence, written here: what the report shows when no model answer checks out. */
  sentence: string;
  /** The "Based on" line under an insight that cites it, naming no data vendor. */
  basis: string;
  /** Where its figures come from (staff see it named after the basis). */
  sources: FactSource[];
}

export const MAX_FACTS = 20;
/** Earlier reports needed before a client's own usual swing decides what changed. */
export const HISTORY_MIN = 3;
/** Changes kept without that history. */
export const FALLBACK_CHANGES = 5;
/** A post this many times its account's usual is an outlier. */
export const OUTLIER_MULTIPLE = 2;
const OUTLIERS = 3;

const METRIC_WORDS: Record<string, string> = {
  engagements: "engagements", impressions: "impressions", views: "video views", engagement_rate: "engagement rate", posts: "posts",
  cadence: "posts a week", compared_rate: "engagement rate compared on likes, comments and shares", engagements_per_post: "engagements per post",
  impressions_per_post: "impressions per post", share_of_voice: "share of voice", followers: "followers",
};
const PLATFORM: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn", twitter: "X", x: "X" };
const platformName = (p: string) => (p === "all" ? "all" : PLATFORM[p.toLowerCase()] ?? p);

const round1 = (n: number) => Math.round(n * 10) / 10;
/** How far above its usual a value is, smoothed so a near-zero usual can't give a four-digit multiple (the planner's ratio, calendar/evidence.ts). */
const ratio = (value: number, usual: number) => (value + 1) / (usual + 1);
const round2 = (n: number) => Math.round(n * 100) / 100;
const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The social aggregate's change: one decimal, none when there was nothing before (pipelines/social/nodes.ts calcChange). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** A number as a fact writes it. */
export function fmt(n: number, unit: FactUnit): string {
  if (unit === "percent") return `${Math.abs(n) < 10 ? round2(n) : round1(n)}%`;
  if (unit === "per_week") return `${round1(n)} a week`;
  return Math.round(n).toLocaleString("en-US");
}
const fmtPct = (n: number) => `${round1(Math.abs(n))}%`;
const fmtX = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}x`;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "a" or "an" as the word after it is said: an Instagram post, an X post, a LinkedIn post. */
const article = (word: string) => (/^(?:[aeiou]|x\b)/i.test(word) ? "an" : "a");
/** A post as the screens label its type: "Instagram video post", "LinkedIn document post". */
const postWords = (platform: string, format: string) => `${platformName(platform)} ${format} post`;
/**
 * A post's type through the screens' label (mediaKind.ts), never a raw type
 * such as INSTAGRAM_MEDIA. A raw type starts with its platform's name, which
 * is no type: "LINKEDIN_COMPANY_UPDATE" holds "link" and would read as a link post.
 */
const formatOf = (raw: unknown, link: string) => mediaLabel(mediaKind(String(raw || "").replace(/linkedin/gi, ""), link)).toLowerCase();

export interface Period { start?: string | null; end?: string | null }

/** "September" and "August" for a calendar month; otherwise the period and the one before it. */
export function periodWords(p: Period | undefined): { now: string; before: string } {
  const start = String(p?.start ?? "").slice(0, 10);
  const end = String(p?.end ?? "").slice(0, 10);
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && s.getUTCDate() === 1 && s.getUTCMonth() === e.getUTCMonth()
    && new Date(e.getTime() + 86400_000).getUTCDate() === 1) {
    const month = (d: Date) => d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    return { now: month(s), before: month(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1))) };
  }
  return { now: "this period", before: "the period before" };
}

type Draft = Omit<Fact, "id">;

const subject = (platform: string, metric: string) => (platform === "all" ? cap(METRIC_WORDS[metric] ?? metric) : `${platformName(platform)} ${METRIC_WORDS[metric] ?? metric}`);

/** A change in words: "Impressions rose 26.5% to 12,400." A rate's change is in points. */
function changeFact(platform: string, metric: string, unit: FactUnit, value: number, previous: number, period: Period | undefined, sources: FactSource[], company?: string): Draft | null {
  const words = periodWords(period);
  const who = company ? `${company}'s ${platform === "all" ? "" : `${platformName(platform)} `}${METRIC_WORDS[metric] ?? metric}` : subject(platform, metric);
  if (unit === "percent") {
    const change = round2(value - previous);
    if (change === 0) return null;
    return {
      key: `change|${platform}|${metric}|${company ?? ""}`, kind: "change", platform, metric, ...(company ? { company } : {}), unit, value, previous, change, percent: change,
      score: 0, numbers: [value, previous, Math.abs(change)], sources,
      sentence: `${cap(who)} ${change > 0 ? "rose" : "fell"} ${round2(Math.abs(change))} points to ${fmt(value, unit)}.`,
      basis: `${cap(who)} ${fmt(value, unit)} in ${words.now} against ${fmt(previous, unit)} in ${words.before}, ${change > 0 ? "+" : "-"}${round2(Math.abs(change))} points`,
    };
  }
  const percent = percentChange(value, previous);
  if (percent === null || percent === 0) return null;
  const change = value - previous;
  return {
    key: `change|${platform}|${metric}|${company ?? ""}`, kind: "change", platform, metric, ...(company ? { company } : {}), unit, value, previous, change, percent,
    score: 0, numbers: [value, previous, Math.abs(change), Math.abs(percent)], sources,
    sentence: `${cap(who)} ${percent > 0 ? "rose" : "fell"} ${fmtPct(percent)} to ${fmt(value, unit)}.`,
    basis: `${cap(who)} ${fmt(value, unit)} in ${words.now} against ${fmt(previous, unit)} in ${words.before}, ${percent > 0 ? "+" : "-"}${fmtPct(percent)}`,
  };
}

/**
 * The changes kept as findings, each scored. With three or more earlier
 * reports, a change is kept when it is bigger than the median absolute
 * change of the same fact across them; a change the history never saw is
 * kept only among the five largest. Without that history, the five largest.
 */
export function keepChanges(changes: Draft[], history: Array<Array<Pick<Fact, "key" | "percent">>>): Draft[] {
  const size = (d: Draft) => Math.abs(d.percent ?? 0);
  const largest = new Set([...changes].sort((a, b) => size(b) - size(a) || a.key.localeCompare(b.key)).slice(0, FALLBACK_CHANGES));
  if (history.length < HISTORY_MIN) return [...largest].map((d) => ({ ...d, score: size(d) / 10 }));
  const out: Draft[] = [];
  for (const d of changes) {
    const seen = history.map((h) => h.find((f) => f.key === d.key)?.percent).filter(valid).map(Math.abs);
    if (seen.length >= HISTORY_MIN) {
      const usual = median(seen) ?? 0;
      if (size(d) > usual) out.push({ ...d, usual, score: size(d) / Math.max(usual, 0.1) });
    } else if (largest.has(d)) {
      out.push({ ...d, score: size(d) / 10 });
    }
  }
  return out;
}

/** Facts in their fixed order (score, then key), numbered F1, F2, at most MAX_FACTS. */
export function numberFacts(drafts: Draft[]): Fact[] {
  return [...drafts]
    .sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.platform.localeCompare(b.platform) || a.metric.localeCompare(b.metric) || String(a.company ?? "").localeCompare(String(b.company ?? "")) || a.key.localeCompare(b.key))
    .slice(0, MAX_FACTS)
    .map((d, i) => ({ id: `F${i + 1}`, ...d, score: round2(d.score) }));
}

// ── The monthly report ──────────────────────────────────────────────────────

const byKey = (figures: Figure[]) => {
  const out = new Map<string, number>();
  for (const f of figures) if (!out.has(f.key)) out.set(f.key, f.value);
  return out;
};

/** The monthly report's changes, unfiltered (what an earlier report contributes to the client's usual swing). */
export function socialChanges(reportData: Any, period?: Period): Draft[] {
  const fig = byKey(socialFigures(reportData));
  const platforms = [...new Set([...fig.keys()].map((k) => k.split("|")).filter((p) => p.length === 3 && p[1] === "current" && p[0] !== "all" && !p[0].startsWith("post:")).map((p) => p[0]))].sort();
  const out: Draft[] = [];
  for (const net of ["all", ...platforms]) {
    for (const metric of ["engagements", "impressions", "views"]) {
      const cur = fig.get(`${net}|current|${metric}`), prev = fig.get(`${net}|previous|${metric}`);
      if (valid(cur) && valid(prev)) { const d = changeFact(net, metric, "count", cur, prev, period, ["sprout"]); if (d) out.push(d); }
    }
    const rate = fig.get(`${net}|current|engagement_rate`), ratePrev = fig.get(`${net}|previous|engagement_rate`);
    if (valid(rate) && valid(ratePrev)) { const d = changeFact(net, "engagement_rate", "percent", rate, ratePrev, period, ["sprout"]); if (d) out.push(d); }
    const posts = fig.get(`${net}|posts`), postsPrev = fig.get(`${net}|posts_previous`);
    if (net !== "all" && valid(posts) && valid(postsPrev)) { const d = changeFact(net, "posts", "count", posts, postsPrev, period, ["sprout"]); if (d) out.push(d); }
  }
  return out;
}

export interface FactOptions {
  period?: Period;
  /** The client's earlier reports of the same kind, each as its changes (socialChanges / competitiveChanges). */
  history?: Array<Array<Pick<Fact, "key" | "percent">>>;
}

export function socialFacts(reportData: Any, opts: FactOptions = {}): Fact[] {
  const rd = (Array.isArray(reportData) ? reportData[0] : reportData) || {};
  const fig = byKey(socialFigures(rd));
  const drafts: Draft[] = keepChanges(socialChanges(rd, opts.period), opts.history ?? []);
  const platforms = [...new Set([...fig.keys()].map((k) => k.split("|")).filter((p) => p.length === 3 && p[1] === "current" && p[0] !== "all" && !p[0].startsWith("post:")).map((p) => p[0]))].sort();

  // Shares: each platform's part of the period's engagements and impressions.
  for (const metric of ["engagements", "impressions"]) {
    const total = fig.get(`all|current|${metric}`);
    if (!valid(total) || total <= 0 || platforms.length < 2) continue;
    for (const net of platforms) {
      const part = fig.get(`${net}|current|${metric}`);
      if (!valid(part)) continue;
      const share = round1((part / total) * 100);
      drafts.push({
        key: `share|${net}|${metric}|`, kind: "share", platform: net, metric, unit: "percent", value: share, total, score: share / (100 / platforms.length) / 2,
        numbers: [share, part, total], sources: ["sprout"],
        sentence: `${platformName(net)} brought ${fmt(share, "percent")} of the period's ${METRIC_WORDS[metric]}.`,
        basis: `${platformName(net)} ${fmt(part, "count")} of ${fmt(total, "count")} ${METRIC_WORDS[metric]}`,
      });
    }
  }

  // Outliers: a top post against its platform's engagements per post in the period.
  const sp = rd?.sprout_performance || {};
  const posts: Any[] = [...(Array.isArray(sp.top_posts) ? sp.top_posts : []), ...Object.values(sp.top_posts_by_platform || {}).flat() as Any[]];
  const seen = new Set<string>();
  const outliers: Draft[] = [];
  for (const p of posts) {
    const link = String(p?.permalink || p?.url || "");
    if (!link || seen.has(link)) continue;
    seen.add(link);
    const raw = String(p?.platform_display || p?.network_type || p?.platform || "").toLowerCase();
    const net = platforms.find((n) => n.toLowerCase() === raw) ?? platforms.find((n) => n.length >= 3 && raw.includes(n.toLowerCase())) ?? "";
    const value = sproutEngagements(p);
    const total = fig.get(`${net}|current|engagements`), count = fig.get(`${net}|posts`);
    if (!net || !valid(value) || !valid(total) || !valid(count) || count <= 0) continue;
    const usual = round1(total / count);
    const multiple = round1(ratio(value, usual));
    if (multiple < OUTLIER_MULTIPLE) continue;
    const format = formatOf(p?.content_category || p?.post_type || p?.media_type, link);
    const post = postWords(net, format);
    outliers.push({
      key: `outlier|${net}|engagements|${link}`, kind: "outlier", platform: net, metric: "engagements", unit: "count", value, usual, multiple, link, format,
      score: multiple / 2, numbers: [value, usual, multiple], sources: ["sprout"],
      sentence: `${cap(article(post))} ${post} got ${fmt(value, "count")} engagements, ${fmtX(multiple)} the platform's usual per post.`,
      basis: `${cap(article(post))} ${post}: ${fmt(value, "count")} engagements against ${fmt(usual, "count")} per post on ${platformName(net)} this period`,
    });
  }
  drafts.push(...outliers.sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0) || a.key.localeCompare(b.key)).slice(0, OUTLIERS));
  return numberFacts(drafts);
}

// ── The competitive report ──────────────────────────────────────────────────

const RANKED: Array<{ metric: string; field: (company: string, channel: string) => string; unit: FactUnit; channels: boolean }> = [
  { metric: "cadence", field: (c, ch) => `${c}|${ch}|cadence`, unit: "per_week", channels: true },
  { metric: "compared_rate", field: (c, ch) => `${c}|${ch}|engagement_rate|current`, unit: "percent", channels: true },
  { metric: "engagements_per_post", field: (c, ch) => `${c}|${ch}|engagements_per_post`, unit: "count", channels: false },
  { metric: "impressions_per_post", field: (c, ch) => `${c}|${ch}|impressions_per_post`, unit: "count", channels: false },
  { metric: "share_of_voice", field: (c, ch) => `${c}|${ch}|share_of_voice`, unit: "percent", channels: false },
  { metric: "followers", field: (c, ch) => `${c}|${ch}|followers|current`, unit: "count", channels: false },
];

const companiesOf = (rd: Any): Array<{ name: string; is_client: boolean }> =>
  (Array.isArray(rd?.aggregates?.companies) ? rd.aggregates.companies : []).map((c: Any) => ({ name: String(c?.name || ""), is_client: !!c?.is_client })).filter((c: { name: string }) => c.name);

/** The competitive report's changes for the client, unfiltered. */
export function competitiveChanges(reportData: Any, period?: Period): Draft[] {
  const rd = normalizedCompetitiveMetrics(reportData || {}) as Any;
  const client = companiesOf(rd).find((c) => c.is_client)?.name;
  if (!client) return [];
  const fig = byKey(competitiveFigures(reportData || {}, "shown"));
  const out: Draft[] = [];
  for (const metric of ["followers", "engagements", "impressions", "posts"]) {
    const cur = fig.get(`${client}|all|${metric}|current`), prev = fig.get(`${client}|all|${metric}|previous`);
    if (valid(cur) && valid(prev)) { const d = changeFact("all", metric, "count", cur, prev, period, ["sprout"], client); if (d) out.push(d); }
  }
  return out;
}

export function competitiveFacts(reportData: Any, opts: FactOptions = {}): Fact[] {
  const rd = normalizedCompetitiveMetrics(reportData || {}) as Any;
  const companies = companiesOf(rd).sort((a, b) => a.name.localeCompare(b.name));
  const client = companies.find((c) => c.is_client)?.name;
  if (!client) return [];
  const fig = byKey(competitiveFigures(reportData || {}, "shown"));
  const drafts: Draft[] = keepChanges(competitiveChanges(reportData, opts.period), opts.history ?? []);
  const channels = [...new Set([...fig.keys()].filter((k) => k.startsWith(`${client}|`)).map((k) => k.split("|")[1]).filter((ch) => ch && ch !== "all"))].sort();

  // Rankings: the client's place on each comparison metric, overall and on each of its platforms.
  for (const r of RANKED) {
    for (const ch of ["all", ...(r.channels ? channels : [])]) {
      const values = companies.map((c) => ({ name: c.name, v: fig.get(r.field(c.name, ch)) })).filter((x): x is { name: string; v: number } => valid(x.v));
      const mine = values.find((x) => x.name === client);
      if (!mine || values.length < 2) continue;
      const sorted = [...values].sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));
      const rank = 1 + values.filter((x) => x.v > mine.v).length;
      const leader = sorted[0];
      const mid = median(values.map((x) => x.v)) ?? 0;
      const where = ch === "all" ? "" : ` on ${platformName(ch)}`;
      const words = METRIC_WORDS[r.metric];
      drafts.push({
        key: `ranking|${ch}|${r.metric}|${client}`, kind: "ranking", platform: ch, metric: r.metric, company: client, unit: r.unit, value: mine.v, rank, of: values.length,
        leader: leader.name, leaderValue: leader.v, median: mid, score: 1 + Math.min(Math.abs(mine.v - mid) / Math.max(Math.abs(mid), 1e-9), 4),
        numbers: [mine.v, leader.v, mid, rank, values.length], sources: ["sprout", "rivaliq"],
        sentence: rank === 1
          ? `${client} leads on ${words}${where} with ${fmt(mine.v, r.unit)}; the median is ${fmt(mid, r.unit)}.`
          : `${client} ranks ${ordinal(rank)} of ${values.length} on ${words}${where} with ${fmt(mine.v, r.unit)}, against ${leader.name}'s ${fmt(leader.v, r.unit)}.`,
        basis: `${cap(words)}${where}: ${client} ${fmt(mine.v, r.unit)}, ${leader.name} ${fmt(leader.v, r.unit)} (highest), median ${fmt(mid, r.unit)} across ${values.length} companies`,
      });
    }
  }

  // Outliers: a top post against its company's engagements per post on that platform.
  const outliers: Draft[] = [];
  for (const c of (Array.isArray(rd?.aggregates?.companies) ? rd.aggregates.companies : []) as Any[]) {
    const company = String(c?.name || "");
    for (const [channel, b] of Object.entries(c?.by_channel || {}) as Array<[string, Any]>) {
      const usual = Number(b?.engagement_avg);
      if (!company || !valid(usual) || usual <= 0) continue;
      for (const p of (Array.isArray(b?.top_posts) ? b.top_posts : []) as Any[]) {
        const value = Number(p?.engagement);
        const link = String(p?.url || "");
        if (!valid(value) || !link) continue;
        const multiple = round1(ratio(value, round1(usual)));
        if (multiple < OUTLIER_MULTIPLE) continue;
        const format = formatOf(p?.media_type, link);
        const net = channel === "x" ? "twitter" : channel;
        const post = postWords(net, format);
        outliers.push({
          key: `outlier|${net}|engagements|${link}`, kind: "outlier", platform: net, metric: "engagements", company, unit: "count", value, usual: round1(usual), multiple, link, format,
          score: multiple / 2, numbers: [value, round1(usual), multiple], sources: [company === client ? "sprout" : "rivaliq"],
          sentence: `${cap(article(post))} ${post} by ${company} got ${fmt(value, "count")} engagements, ${fmtX(multiple)} its usual per post.`,
          basis: `${company}'s ${post}: ${fmt(value, "count")} engagements against ${fmt(usual, "count")} per post on ${platformName(net)}`,
        });
      }
    }
  }
  drafts.push(...outliers.sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0) || a.key.localeCompare(b.key)).slice(0, OUTLIERS));
  return numberFacts(drafts);
}
