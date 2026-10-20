// Stored report text that quotes a figure the report no longer shows.
//
// A report's text is written once, by a model, from the figures of the day.
// When a figure's definition changes (the engagement rate per impression on
// 19 Oct 2026, the client's figures from Sprout and one count of engagements
// on 20 Oct), the page shows the new figures while the text keeps quoting
// the old ones: Bader Law's competitive report said "Engagement rate per post
// at 28.6% is inflated by small-follower TikTok", LegaBot's said 153.39%.
//
// staleReportText finds the sentences that quote such a figure, by comparing
// every number the text quotes as a rate, a share or a count with two lists
// of figures, worked out by the same harvest:
//   stored  what the report held when it was written (and what the model saw)
//   shown   what the report shows now (the screens' own normalization)
// A number is stale when it is one of the stored figures of its kind and
// none of the shown ones, at the precision the text wrote it; in a sentence
// about one company (or platform), of that company's figures only. A target ("aim
// for 0.8%+") is never a quoted figure. Only those sentences are sent to the
// model (correctionPrompt), which may change only their numbers and the
// claims that rest on them; checkCorrection refuses an answer that adds a
// number the report does not show, and applyCorrections puts the sentences
// back in place, every other word of the report untouched.

import { normalizedCompetitiveMetrics } from "../competitive/reportMetrics.ts";
import { sourceCompetitiveSummary, withCompetitiveEvidenceLimits } from "../competitive/reportEvidence.ts";
import { normalizedSocialReport, sproutEngagementRate, sproutReach } from "./socialFigures.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export type ReportKind = "competitive" | "social";
export type FigureKind = "percent" | "posts" | "cadence" | "audience" | "engagement" | "impressions";
export type Figure = { key: string; label: string; kind: FigureKind; value: number };

const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const PLATFORM: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn", twitter: "X", x: "X", all: "all platforms" };
const platformName = (key: string) => PLATFORM[String(key).toLowerCase()] || String(key);

// ── Figures ──────────────────────────────────────────────────────────────

class Harvest {
  figures: Figure[] = [];
  add(key: string, label: string, kind: FigureKind, value: unknown, scale = 1) {
    if (!valid(value)) return;
    this.figures.push({ key, label, kind, value: value * scale });
  }
  both(key: string, label: string, kind: FigureKind, v: Any, scale = 1) {
    this.add(`${key}|current`, label, kind, v?.current, scale);
    this.add(`${key}|previous`, `${label}, previous period`, kind, v?.previous, scale);
  }
}

const RATE = 100; // rates are fractions; the text writes them as percentages

/**
 * The figures of a competitive report. "stored" reads the report as it was
 * written, including the provider figures the model was given; "shown" reads
 * it through the normalization every screen uses.
 */
export function competitiveFigures(reportData: Any, mode: "stored" | "shown", prefix = ""): Figure[] {
  const h = new Harvest();
  const rd = mode === "shown" ? normalizedCompetitiveMetrics(reportData || {}) : (reportData || {});
  const companies: Any[] = Array.isArray(rd?.aggregates?.companies) ? rd.aggregates.companies : [];
  const total = companies.reduce((n, c) => n + (valid(c?.post_count) ? c.post_count : 0), 0);
  const post = (company: string, channel: string, p: Any, i: number) => {
    const id = `${prefix}${company}|${channel}|post:${p?.url || i}`;
    const label = `${prefix ? "Competitive report: " : ""}${company}, a top ${platformName(p?.channel || channel)} post`;
    h.add(`${id}|engagements`, `${label}, engagements`, "engagement", p?.engagement);
    h.add(`${id}|engagement_rate`, `${label}, engagement rate`, "percent", p?.engagement_rate, RATE);
    h.add(`${id}|views`, `${label}, views`, "impressions", p?.views);
    h.add(`${id}|impressions`, `${label}, impressions`, "impressions", p?.actual_impressions ?? p?.est_impressions);
  };
  const bucket = (company: string, channel: string, b: Any) => {
    const key = `${prefix}${company}|${channel}`;
    const label = `${prefix ? "Competitive report: " : ""}${company}, ${platformName(channel)}`;
    h.add(`${key}|posts|current`, `${label}, posts`, "posts", b?.post_count);
    h.add(`${key}|observed_posts`, `${label}, posts in the sample`, "posts", b?.observed_post_count);
    h.add(`${key}|cadence`, `${label}, posts a week`, "cadence", b?.cadence_per_week);
    h.add(`${key}|engagement_rate|current`, `${label}, engagement rate`, "percent", b?.engagement_rate_avg, RATE);
    h.add(`${key}|engagements_per_post`, `${label}, engagements per post`, "engagement", b?.engagement_avg);
    h.add(`${key}|impressions_per_post`, `${label}, impressions per post`, "impressions", b?.impressions_avg);
    h.add(`${key}|impressions|current`, `${label}, impressions`, "impressions", b?.impressions_total);
    h.add(`${key}|views`, `${label}, video views`, "impressions", b?.views_total);
    (Array.isArray(b?.top_posts) ? b.top_posts : []).forEach((p: Any, i: number) => post(company, channel, p, i));
  };
  // Period figures of a company or a network, from the comparison or a provider.
  const metrics = (company: string, channel: string, m: Any) => {
    if (!m || typeof m !== "object") return;
    const key = `${prefix}${company}|${channel}`;
    const label = `${prefix ? "Competitive report: " : ""}${company}, ${platformName(channel)}`;
    h.both(`${key}|posts`, `${label}, posts`, "posts", m.posts);
    h.both(`${key}|engagements`, `${label}, engagements`, "engagement", m.engagement);
    h.both(`${key}|followers`, `${label}, followers`, "audience", channel === "all" ? m.audience : m.followers);
    h.both(`${key}|impressions`, `${label}, impressions`, "impressions", channel === "all" ? (m.impressions ?? m.estimated_impressions) : m.impressions);
    if (channel === "all" && m.impressions && m.estimated_impressions) h.both(`${key}|estimated_impressions`, `${label}, estimated impressions`, "impressions", m.estimated_impressions);
    h.both(`${key}|views`, `${label}, views`, "impressions", m.views);
    h.both(`${key}|engagement_rate`, `${label}, engagement rate`, "percent", m.engagement_rate, RATE);
    // Rates stored by older workflows (per follower, averaged per post): the text may quote them.
    if (mode === "stored") {
      h.both(`${key}|engagement_rate`, `${label}, engagement rate`, "percent", m.rate, RATE);
      h.both(`${key}|engagement_rate`, `${label}, engagement rate`, "percent", m.engagement_rate_per_post, RATE);
    }
    for (const [network, n] of Object.entries(m.by_network || {})) metrics(company, network, n);
  };
  for (const c of companies) {
    const company = String(c?.name || "");
    bucket(company, "all", c);
    for (const [channel, b] of Object.entries(c?.by_channel || {})) bucket(company, channel === "x" ? "twitter" : channel, b);
    metrics(company, "all", c?.comparison_metrics);
    if (mode === "stored") {
      metrics(company, "all", c?.rivaliq_metrics);
      metrics(company, "all", c?.owned_metrics);
      if (c?.linkedin_metrics) h.add(`${prefix}${company}|linkedin|posts|current`, `${company}, LinkedIn, posts`, "posts", c.linkedin_metrics.posts);
    }
    if (total > 0 && valid(c?.post_count)) h.add(`${prefix}${company}|all|share_of_voice`, `${prefix ? "Competitive report: " : ""}${company}, share of voice`, "percent", c.post_count / total, RATE);
  }
  for (const d of (Array.isArray(rd?.ai_analysis?.benchmark_scorecard?.dimensions) ? rd.ai_analysis.benchmark_scorecard.dimensions : [])) {
    const kind: FigureKind | null = /audience/i.test(d?.dimension) ? "audience" : /cadence/i.test(d?.dimension) ? "cadence" : /engagement/i.test(d?.dimension) ? "engagement" : /impression/i.test(d?.dimension) ? "impressions" : null;
    if (!kind) continue;
    h.add(`${prefix}dimension|${d.dimension}|client`, `${prefix ? "Competitive report: " : ""}client ${String(d.dimension).toLowerCase()}`, kind, d.client);
    h.add(`${prefix}dimension|${d.dimension}|competitor_avg`, `${prefix ? "Competitive report: " : ""}competitor average ${String(d.dimension).toLowerCase()}`, kind, d.competitor_avg);
  }
  return h.figures;
}

/**
 * The figures of a monthly report. "stored" reads Sprout's stored totals and
 * the rate the screens used to show (Sprout's engagements total, which adds
 * clicks, over impressions); "shown" reads them through normalizedSocialReport.
 */
export function socialFigures(reportData: Any, mode: "stored" | "shown"): Figure[] {
  const h = new Harvest();
  const raw = Array.isArray(reportData) ? reportData[0] : reportData;
  const rd = mode === "shown" ? normalizedSocialReport(raw || {}) : (raw || {});
  const sp = rd?.sprout_performance || {};
  const oldRate = (m: Any) => (valid(Number(m?.engagements)) && Number(m?.impressions) > 0 ? Number(m.engagements) / Number(m.impressions) : null);
  const set = (key: string, label: string, m: Any, network?: string) => {
    if (!m || typeof m !== "object") return;
    h.add(`${key}|engagements`, `${label}, engagements`, "engagement", num(m.engagements));
    h.add(`${key}|impressions`, `${label}, impressions`, "impressions", num(m.impressions));
    h.add(`${key}|views`, `${label}, video views`, "impressions", num(m.video_views));
    h.add(`${key}|reach`, `${label}, reach`, "impressions", sproutReach(m, network));
    h.add(`${key}|engagement_rate`, `${label}, engagement rate`, "percent", mode === "shown" ? sproutEngagementRate(m, network) : oldRate(m), RATE);
  };
  const changes = (key: string, label: string, ch: Any) => {
    // Text writes a fall as "down 28%": a change is matched by its size.
    for (const [metric, v] of Object.entries(ch || {}) as [string, Any][]) {
      const pct = num(v?.percent);
      h.add(`${key}|${metric}_change`, `${label}, ${metric.replace(/_/g, " ")} change`, "percent", pct == null ? null : Math.abs(pct));
    }
  };
  for (const p of Array.isArray(sp.platform_breakdown) ? sp.platform_breakdown : []) {
    const net = String(p?.network || "");
    set(`${net}|current`, platformName(net), p?.current, net);
    set(`${net}|previous`, `${platformName(net)}, previous period`, p?.previous, net);
    h.add(`${net}|posts`, `${platformName(net)}, posts`, "posts", num(p?.post_count));
    h.add(`${net}|posts_previous`, `${platformName(net)}, posts, previous period`, "posts", num(p?.previous_post_count));
    changes(net, platformName(net), p?.changes);
  }
  for (const [net, m] of Object.entries(sp.platform_metrics || {}) as [string, Any][]) {
    set(`${net}|current`, platformName(net), m, net);
    h.add(`${net}|posts`, `${platformName(net)}, posts`, "posts", num(m?.post_count));
  }
  set("all|current", "All platforms", sp.overall_totals || sp.month_comparison?.current_month);
  set("all|previous", "All platforms, previous period", sp.month_comparison?.previous_month);
  changes("all", "All platforms", sp.month_comparison?.changes);
  if (mode === "shown" && sp.engagement_rate) {
    h.add("all|current|engagement_rate", "All platforms, engagement rate", "percent", sp.engagement_rate.current, RATE);
    h.add("all|previous|engagement_rate", "All platforms, previous period, engagement rate", "percent", sp.engagement_rate.previous, RATE);
  }
  const posts: Any[] = [...(Array.isArray(sp.top_posts) ? sp.top_posts : []), ...Object.values(sp.top_posts_by_platform || {}).flat() as Any[]];
  posts.forEach((p, i) => {
    const id = `post:${p?.url || p?.permalink || i}`;
    const label = `A top ${platformName(String(p?.platform_display || p?.platform || "").toLowerCase())} post`;
    h.add(`${id}|engagements`, `${label}, engagements`, "engagement", num(p?.engagements ?? p?.engagement));
    h.add(`${id}|impressions`, `${label}, impressions`, "impressions", num(p?.impressions));
    h.add(`${id}|views`, `${label}, video views`, "impressions", num(p?.video_views));
    h.add(`${id}|engagement_rate`, `${label}, engagement rate`, "percent", mode === "shown" ? sproutEngagementRate(p) : oldRate(p), RATE);
  });
  return h.figures;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Numbers in text ──────────────────────────────────────────────────────

export type Claim = { text: string; value: number; tolerance: number; kind: FigureKind; start: number; end: number };

/** Every number in a text, with the tolerance its written precision allows. */
function numbersIn(text: string): Array<{ text: string; value: number; tolerance: number; start: number; end: number; percent: boolean }> {
  const out: Array<{ text: string; value: number; tolerance: number; start: number; end: number; percent: boolean }> = [];
  const re = /(?<![\w.$/:])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s?[KkMmBb](?![a-zA-Z]))?(\s?%|\s?percent\b)?/g;
  for (const m of text.matchAll(re)) {
    const digits = m[1].replace(/,/g, "");
    const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
    const unit = (m[2] || "").trim().toLowerCase();
    const scale = unit === "k" ? 1e3 : unit === "m" ? 1e6 : unit === "b" ? 1e9 : 1;
    const value = Number(digits) * scale;
    if (!Number.isFinite(value)) continue;
    out.push({ text: m[0], value, tolerance: 0.5 * Math.pow(10, -decimals) * scale + 1e-9, start: m.index!, end: m.index! + m[0].length, percent: !!m[3] });
  }
  return out;
}

const UNIT_AFTER: Array<[FigureKind, RegExp]> = [
  ["cadence", /^[\s-]*(?:[A-Za-z]+\s*){0,2}(?:\/\s?(?:wk|week)\b|(?:a|per|each|every)\s+week\b)/i],
  ["posts", /^[\s-]*(?:[A-Za-z]+\s+)?(?:posts?|uploads?|videos?|reels|shorts|tiktoks)\b/i],
  ["audience", /^[\s-]*(?:[A-Za-z]+\s+)?(?:followers?|subscribers?|fans)\b/i],
  ["engagement", /^[\s-]*(?:[A-Za-z]+\s+)?(?:engagements?|interactions)\b/i],
  ["impressions", /^[\s-]*(?:[A-Za-z]+\s+)?(?:impressions?|views?)\b/i],
];
const TARGET_BEFORE = /\b(?:target(?:ing)?|aim(?:ing)?(?:\s+for)?|goal|get\s+to|toward|towards|hit|reach\s+for|at\s+least)\s*(?:of\s+|an?\s+|the\s+)?(?:[a-z]+\s+){0,3}$/i;

/**
 * The numbers a text quotes as a figure: a percentage (a rate, a share or a
 * change), or a count of posts, followers, engagements or impressions and
 * views, or posts a week. A target is not a quoted figure.
 */
export function quotedFigures(text: string): Claim[] {
  const claims: Claim[] = [];
  for (const n of numbersIn(text)) {
    const after = text.slice(n.end, n.end + 40);
    if (/^\s?\+/.test(after)) continue;
    if (TARGET_BEFORE.test(text.slice(Math.max(0, n.start - 40), n.start))) continue;
    const kind: FigureKind | undefined = n.percent ? "percent" : UNIT_AFTER.find(([, re]) => re.test(after))?.[0];
    if (!kind) continue;
    claims.push({ text: n.text, value: n.value, tolerance: n.tolerance, kind, start: n.start, end: n.end });
  }
  return claims;
}

const matches = (claim: { value: number; tolerance: number }, f: Figure) => Math.abs(f.value - claim.value) <= claim.tolerance;
/** Whose figure it is: the company (or, in a monthly report, the platform or post) a figure belongs to. */
const subjectOf = (key: string) => (key.startsWith("competitive|") ? key.split("|").slice(0, 2).join("|") : key.split("|")[0]);

// ── Stale sentences ──────────────────────────────────────────────────────

export type StaleNumber = { text: string; kind: FigureKind; was: Figure[]; now: Figure[] };
export type StaleSentence = { id: string; path: Array<string | number>; field: string; sentence: string; numbers: StaleNumber[] };

/**
 * The sentences of a text, each an exact substring of it. A decimal point
 * ("0.5%") or an abbreviation ("e.g.") does not end a sentence.
 */
export function sentences(text: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let start = 0;
  for (const m of text.matchAll(/[.!?](?=\s+["\u201c'(#@]?[A-Z0-9])|\n+/g)) {
    const end = m.index! + m[0].length;
    if (/\b(?:e\.g|i\.e|vs|approx|incl|etc)\.$/i.test(text.slice(Math.max(0, end - 7), end))) continue;
    if (text.slice(start, end).trim()) out.push({ text: text.slice(start, end), start });
    start = end;
  }
  if (text.slice(start).trim()) out.push({ text: text.slice(start), start });
  return out;
}

/** The text fields of a report's analysis a reader sees, with their paths. */
function textFields(ai: Any, skip: (path: Array<string | number>) => boolean): Array<{ path: Array<string | number>; text: string }> {
  const out: Array<{ path: Array<string | number>; text: string }> = [];
  const walk = (v: Any, path: Array<string | number>) => {
    if (skip(path)) return;
    if (typeof v === "string") {
      if (/\d/.test(v) && !/^https?:\/\//.test(v)) out.push({ path, text: v });
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, [...path, i]));
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
  };
  walk(ai, []);
  return out;
}

const NOT_PROSE = new Set(["url", "urls", "example_post_urls", "platform", "competitor", "name", "is_client", "post_url", "permalink", "link", "image", "content_calendar", "posts", "hashtags"]);

const nameKey = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/com$/, "");

/**
 * The company (or, in a monthly report, the platform) a text field is about:
 * the first item on its path whose name, competitor or platform is one the
 * figures belong to ("Reyes Law" is reyeslaw.com). Null when none is.
 */
function subjectAt(ai: Any, path: Array<string | number>, subjects: string[]): string | null {
  const keys = subjects.map((s) => ({ s, k: nameKey(s.replace(/^competitive\|/, "")) })).filter((x) => x.k.length >= 3);
  let node = ai;
  for (const step of path) {
    node = node?.[step];
    if (typeof step !== "number" || !node || typeof node !== "object") continue;
    for (const name of [node.name, node.competitor, node.platform]) {
      const k = nameKey(name);
      if (k.length < 3) continue;
      const hit = keys.find((x) => x.k === k) || keys.find((x) => x.k.startsWith(k) || k.startsWith(x.k));
      if (hit) return hit.s;
    }
  }
  return null;
}

/** A readable name for where a sentence sits, for the model and the audit record. */
function fieldName(ai: Any, path: Array<string | number>): string {
  const parts: string[] = [];
  let node = ai;
  for (const step of path) {
    if (typeof step === "number") {
      const item = node?.[step];
      const who = item?.name || item?.competitor || item?.platform || item?.gap;
      if (who) parts.push(String(who));
    } else parts.push(step.replace(/_/g, " "));
    node = node?.[step];
  }
  return parts.join(" / ");
}

/**
 * The sentences of a report's text that quote a figure the report no longer
 * shows. `stored` and `shown` are the report's figures as written and as
 * shown now (competitiveFigures or socialFigures, plus those of the
 * competitive report a monthly report shows beside it). A report's
 * competitive executive summary is written from the shown figures whenever
 * the report is read (reportEvidence.ts), so it is never one of them.
 */
export function staleReportText(kind: ReportKind, reportData: Any, stored: Figure[], shown: Figure[]): StaleSentence[] {
  const raw = Array.isArray(reportData) ? reportData[0] : reportData;
  const ai = raw?.ai_analysis;
  if (!ai || typeof ai !== "object") return [];
  const regenerated = kind === "competitive" && !!sourceCompetitiveSummary(withCompetitiveEvidenceLimits(normalizedCompetitiveMetrics(raw)));
  const skip = (path: Array<string | number>) => path.some((p) => typeof p === "string" && NOT_PROSE.has(p))
    || (regenerated && path[0] === "executive_summary");
  const out: StaleSentence[] = [];
  const subjects = [...new Set([...stored, ...shown].map((f) => subjectOf(f.key)))];
  for (const field of textFields(ai, skip)) {
    const subject = subjectAt(ai, field.path, subjects);
    for (const s of sentences(field.text)) {
      const numbers: StaleNumber[] = [];
      for (const claim of quotedFigures(s.text)) {
        // A sentence about one company (or platform) quotes that company's figures; otherwise any.
        const own = (f: Figure) => !subject || subjectOf(f.key) === subject;
        const was = stored.filter((f) => f.kind === claim.kind && own(f) && matches(claim, f));
        if (!was.length) continue;
        if (shown.some((f) => f.kind === claim.kind && own(f) && matches(claim, f))) continue;
        const keys = new Set(was.map((f) => f.key));
        numbers.push({ text: claim.text, kind: claim.kind, was, now: shown.filter((f) => keys.has(f.key)) });
      }
      if (numbers.length) out.push({ id: `s${out.length + 1}`, path: field.path, field: fieldName(ai, field.path), sentence: s.text.trim(), numbers });
    }
  }
  return out;
}

// ── The model's correction ───────────────────────────────────────────────

const display = (f: Figure) => {
  if (f.kind === "percent") return `${f.value < 10 ? f.value.toFixed(2) : f.value < 100 ? f.value.toFixed(1) : Math.round(f.value)}%`;
  if (f.kind === "cadence") return `${Math.round(f.value * 10) / 10} a week`;
  return Math.round(f.value).toLocaleString("en-US");
};

/** The figures the report shows that a correction may use: those of the flagged numbers, then the period figures. */
function figureList(stale: StaleSentence[], shown: Figure[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  const add = (f: Figure) => {
    const line = `${f.label}: ${display(f)}`;
    if (!seen.has(line)) { seen.add(line); lines.push(line); }
  };
  for (const s of stale) for (const n of s.numbers) n.now.forEach(add);
  const period = shown.filter((f) => !f.key.includes("|post:") && !f.key.includes("previous") && !f.key.endsWith("_change"));
  period.filter((f) => f.key.includes("|all|") || f.key.startsWith("all|") || f.key.startsWith("dimension|")).forEach(add);
  period.forEach(add);
  return lines.slice(0, 140);
}

export const CORRECTION_SYSTEM = [
  "You correct the numbers in sentences of a social media report.",
  "The report's figures were counted again under the product's current definitions, and these sentences still quote the old figures.",
  "For each sentence: change the numbers that quote the report's figures to the figures the report shows now, and change only the words whose claim depends on those numbers (for example \"inflated by\", \"higher than\", \"the highest\", \"up\", \"down\").",
  "Keep every other word, the word order and the punctuation exactly as written. Keep a number that is a target or a recommendation.",
  "Use only the figures listed. Do not add a number, a comparison, a cause or any claim that is not already in the sentence or the list.",
  "If a claim no longer holds and the list has no figure for it, drop just that clause and keep the rest of the sentence.",
  "Write numbers the way the sentence already does (1.08%, 12.6 a week, 683K). American English. Never add an em dash or an en dash.",
  'Return only JSON: {"sentences":[{"id":"s1","text":"..."}]} with one entry for every sentence id you were given.',
].join("\n");

/** The one message the model gets for a report. */
export function correctionPrompt(context: { client: string; kind: ReportKind; period?: string | null }, stale: StaleSentence[], shown: Figure[]): string {
  const lines = [
    `Report: ${context.kind === "competitive" ? "competitive analysis" : "monthly social report"} for ${context.client}${context.period ? `, ${context.period}` : ""}.`,
    "Engagements count reactions or likes, comments and shares (not on Instagram or YouTube), never clicks, saves or views. The engagement rate is engagements divided by impressions, with views on TikTok and YouTube. The client's figures come from Sprout; competitors' from RivalIQ.",
    "",
    "Figures the report shows now:",
    ...figureList(stale, shown).map((l) => `- ${l}`),
    "",
    "Sentences to correct:",
  ];
  for (const s of stale) {
    lines.push(`${s.id} (${s.field}): ${s.sentence}`);
    for (const n of s.numbers) {
      const was = [...new Set(n.was.map((f) => f.label))].slice(0, 3).join("; ");
      const now = n.now.length ? [...new Set(n.now.map((f) => `${f.label} ${display(f)}`))].slice(0, 3).join("; ") : "no figure for this now";
      lines.push(`  "${n.text}" was ${was}. Now: ${now}.`);
    }
  }
  return lines.join("\n");
}

/** The model's sentences by id, or null when the answer cannot be read. */
export function parseCorrection(text: string): Map<string, string> | null {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed?.sentences)) return null;
    const out = new Map<string, string>();
    for (const s of parsed.sentences) if (typeof s?.id === "string" && typeof s?.text === "string") out.set(s.id, s.text.trim());
    return out;
  } catch {
    return null;
  }
}

/**
 * Why a corrected sentence cannot be used, or null when it can: it must
 * answer every sentence, stay a sentence of about the same length, add no
 * dash, and every number in it must be one the sentence already had or one
 * the report shows now (nothing invented).
 */
export function checkCorrection(stale: StaleSentence[], answer: Map<string, string> | null, shown: Figure[]): string | null {
  if (!answer) return "The answer could not be read.";
  for (const s of stale) {
    const text = answer.get(s.id);
    if (!text) return `No sentence came back for ${s.id}.`;
    if (text.length > s.sentence.length * 2 + 80) return `${s.id} came back much longer than it was.`;
    if (/\n/.test(text) && !/\n/.test(s.sentence)) return `${s.id} came back as more than one line.`;
    const dashes = (t: string) => (t.match(/[\u2013\u2014]/g) || []).length;
    if (dashes(text) > dashes(s.sentence)) return `${s.id} came back with a dash.`;
    const before = numbersIn(s.sentence);
    for (const n of numbersIn(text)) {
      const kept = before.some((b) => Math.abs(b.value - n.value) <= Math.max(b.tolerance, n.tolerance));
      const shownNow = shown.some((f) => Math.abs(f.value - n.value) <= n.tolerance);
      if (!kept && !shownNow) return `${s.id} came back with ${n.text}, a number the report does not show.`;
    }
  }
  return null;
}

const getAt = (root: Any, path: Array<string | number>) => path.reduce((node, step) => node?.[step], root);

/**
 * The analysis with the corrected sentences in place, and what changed.
 * Null when a sentence is no longer where it was (the text changed since it
 * was read): nothing is written then.
 */
export function applyCorrections(ai: Any, stale: StaleSentence[], answer: Map<string, string>): { ai: Any; changed: Array<{ path: Array<string | number>; before: string; after: string }> } | null {
  const next = structuredClone(ai);
  const changed: Array<{ path: Array<string | number>; before: string; after: string }> = [];
  const byPath = new Map<string, StaleSentence[]>();
  for (const s of stale) byPath.set(JSON.stringify(s.path), [...(byPath.get(JSON.stringify(s.path)) || []), s]);
  for (const [key, list] of byPath) {
    const path = JSON.parse(key) as Array<string | number>;
    const before = getAt(next, path);
    if (typeof before !== "string") return null;
    let after = before;
    for (const s of list) {
      const at = after.indexOf(s.sentence);
      if (at < 0) return null;
      after = after.slice(0, at) + (answer.get(s.id) as string) + after.slice(at + s.sentence.length);
    }
    if (after === before) continue;
    const parent = getAt(next, path.slice(0, -1));
    parent[path[path.length - 1]] = after;
    changed.push({ path, before, after });
  }
  return { ai: next, changed };
}
