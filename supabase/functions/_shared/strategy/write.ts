// supabase/functions/_shared/strategy/write.ts
//
// A client's content strategy, written from what the lifecycle already reads
// (spec: docs/superpowers/specs/2026-11-02-content-strategy-tab-design.md).
// The lifecycle step content_strategy (lifecycle/steps.ts) calls this; nobody
// has to fill anything in. Code works out every number (each platform's state,
// cadence and baselines in platforms.ts, each pillar's share here) and the
// model writes the words around them:
//   1. one Opus call writes every section; a reply that fails the code checks
//      is asked again once with its problems named (askTwice);
//   2. one Sonnet call lists any number, name, result or claim the evidence
//      does not support;
//   3. flagged statements get one fix call and one more check.
// At most three Opus and two Sonnet calls, usually one of each. A strategy
// that still fails is not returned: the step tries again later and the stored
// version stays. People's versions of sections (content_strategy_edits) are
// read as fixed context and never written here.

import { parseAnswer } from "../pipelines/competitive/analysis.ts";
import { applyRhythmSetting, type EvidenceItem, type RhythmLine } from "../calendar/evidence.ts";
import { fmtMultiple } from "../calendar/reasonText.ts";
import { competitorSet, gatherEvidence, trackedRates, type Gathered } from "../calendar/runWeek.ts";
import { competitiveBrief } from "../competitive/brief.ts";
import { setBy } from "../lifecycle/fields.ts";
import { activeTerms, askTwice } from "../trends/profile.ts";
import { clip } from "../trends/text.ts";
import { loadClientVoice } from "../voice/load.ts";
import { voicePromptBlock, type VoiceExample } from "../voice/voice.ts";
import { pillarSectionKey, platformKey, platformSectionKey, platformStates, type Cadence, type StrategyPlatform, type WrittenPlatform, type WrittenState } from "./platforms.ts";

export type { WrittenPlatform };

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Any = any;

export const STRATEGY_MODEL = "claude-opus-5-5";
export const CHECK_MODEL = "claude-sonnet-5-5";
export const STRATEGY_MAX_TOKENS = 8000;
const CHECK_MAX_TOKENS = 2000;
const BRIEF_CHARS = 6000;
const SITE_CHARS = 2500;
const BOOK_CHARS = 2500;

/** The sections every strategy has, besides one per pillar and one per platform. */
export const FIXED_SECTIONS = ["goals", "audience", "positioning", "avoid", "measures"] as const;
type FixedSection = typeof FIXED_SECTIONS[number];
const SECTION_NAMES: Record<FixedSection, string> = { goals: "goals", audience: "audience", positioning: "positioning", avoid: "what to avoid", measures: "measures" };

export interface StrategyEvidence {
  client: { name: string; market: string[]; languages: string[]; first_language: string };
  brief: string;
  /** The pillars from Client setup, unchanged, each with its share of posts. */
  pillars: Array<{ name: string; description: string; share: number }>;
  keywords: string[];
  brand_notes: string;
  brand_book: string;
  /** The client's learned voice (voicePromptBlock). */
  voice: string;
  site: string;
  competitors: string[];
  /** The competitive picture with the team's calls on it (competitive/brief.ts); "" when there is none. */
  competitive_brief: string;
  profile: { audience: string; fit_rubric: string; exclusions: Array<{ term: string; reason: string }> };
  platforms: StrategyPlatform[];
  /** The calendar's evidence: the client's best posts, competitors' best posts, topics, trends and report findings. */
  evidence: EvidenceItem[];
  /** The client's weakest posts, as the calendar words them. */
  avoid: string[];
  thin: string[];
  /** People's versions of sections still in play, by section key. */
  edits: Record<string, string>;
  /** What the strategy was written from, for the line that says so on screen. */
  sources: string[];
}

/** What the evidence reads outside the database rows, so the tests can stand in for it. */
export interface StrategyIO {
  gather(db: Db, client: Any, now: Date): Promise<Pick<Gathered, "own" | "learnedRhythm" | "evidence" | "avoid" | "thin" | "examples" | "fallbackRates">>;
  trackedRates(db: Db): Promise<Record<string, number>>;
  voiceBlock(db: Db, clientId: string, opts: { platforms: string[]; examples: Record<string, VoiceExample[]> }): Promise<string>;
  competitiveBrief(db: Db, clientId: string): Promise<string>;
  competitorSet(db: Db, clientId: string): Promise<Array<{ name: string }>>;
  siteText(url: string): Promise<string>;
}

/** The evidence as the app reads it: the calendar's own evidence, voice and competitive picture. */
export function liveStrategyIO(siteText: (url: string) => Promise<string>): StrategyIO {
  return {
    gather: (db, client, now) => gatherEvidence(db, client, now),
    trackedRates: (db) => trackedRates(db),
    voiceBlock: async (db, clientId, opts) => voicePromptBlock(await loadClientVoice(db, clientId), opts),
    competitiveBrief: (db, clientId) => competitiveBrief(db, clientId).catch(() => ""),
    competitorSet: (db, clientId) => competitorSet(db, clientId),
    siteText,
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (s: unknown) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

async function tryOr<T>(f: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await f();
  } catch {
    return fallback;
  }
}

/** Shares of posts that add up to 100, as even as whole numbers allow (the first pillars take the remainder). */
export function evenShares(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => base + (i < 100 - base * n ? 1 : 0));
}

function pillarsOf(v: unknown): Array<{ name: string; description: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ name: string; description: string }> = [];
  for (const p of v) {
    const pillar = typeof p === "string" ? { name: p.trim(), description: "" } : { name: str(p?.name), description: str(p?.description) };
    if (pillar.name && !out.some((x) => x.name === pillar.name)) out.push(pillar);
  }
  return out;
}

/** Every section key a strategy from this evidence can have, a suggested platform's launch plan included. */
export function keysInPlay(platforms: StrategyPlatform[], pillars: Array<{ name: string }>): Set<string> {
  const keys = new Set<string>([...FIXED_SECTIONS, "not_now", ...pillars.map((p) => pillarSectionKey(p.name))]);
  for (const p of platforms) keys.add(platformSectionKey(p.platform, p.state === "posting" ? "posting" : "new"));
  return keys;
}

/**
 * Everything a strategy is written from. Null while the client has no trend
 * profile: the strategy is written after it, from it.
 */
export async function strategyEvidence(db: Db, client: Any, now: Date, io: StrategyIO): Promise<StrategyEvidence | null> {
  const { data: profile, error } = await db.from("trend_profiles").select("audience, fit_rubric, platforms, written_at").eq("client_id", client.id).maybeSingle();
  if (error) throw new Error(`Could not read the trend profile: ${error.message}`);
  if (!profile) return null;

  const g = await io.gather(db, client, now);
  const terms = await activeTerms(db, client.id);
  const { data: accounts, error: accountsError } = await db.from("sprout_profiles").select("network_type, native_name").eq("client_id", client.id).eq("is_active", true);
  if (accountsError) throw new Error(`Could not read the client's social accounts: ${accountsError.message}`);
  const { data: edits, error: editsError } = await db.from("content_strategy_edits").select("section_key, text").eq("client_id", client.id);
  if (editsError) throw new Error(`Could not read the team's versions of the strategy: ${editsError.message}`);
  const extras = await tryOr(async () => (await db.from("clients").select("brand_book_text").eq("id", client.id).maybeSingle()).data, null);

  // The calendar's rhythm per platform, staff's setting applied, so the strategy and the calendar agree.
  const rhythm: RhythmLine[] = applyRhythmSetting(g.learnedRhythm, client.posting_rhythm);
  const input = {
    own: g.own, now, primary: client.primary_platforms, primarySet: setBy(client.field_sources, "primary_platforms") !== null,
    accounts: (accounts ?? []) as Array<{ network_type: string | null; native_name: string | null }>,
    profile: (Array.isArray(profile.platforms) ? profile.platforms : []) as Array<{ platform: string; reason: string }>,
    rhythm, rates: g.fallbackRates,
  };
  let states = platformStates(input);
  if (states.needsAllTracked) states = platformStates({ ...input, rates: { ...g.fallbackRates, allTracked: await io.trackedRates(db) } });

  const pillars = pillarsOf(client.content_pillars);
  const shares = evenShares(pillars.length);
  const website = str(client.website_url);
  const site = website ? clip(await tryOr(() => io.siteText(website), ""), SITE_CHARS) : "";
  const brief = clip(str(client.brief_text), BRIEF_CHARS);
  const brandBook = clip(str(extras?.brand_book_text), BOOK_CHARS);
  const competitors = (await tryOr(() => io.competitorSet(db, client.id), [])).map((c) => str(c.name)).filter(Boolean);
  const posting = states.platforms.filter((p) => p.state === "posting").map((p) => p.platform);
  const languages = list(client.language);
  const inPlay = keysInPlay(states.platforms, pillars);

  return {
    client: { name: str(client.name), market: list(client.geo), languages, first_language: languages[0] || "en" },
    brief,
    pillars: pillars.map((p, i) => ({ ...p, share: shares[i] })),
    keywords: Array.isArray(client.social_keywords) ? client.social_keywords.map(String) : [],
    brand_notes: str(client.brand_notes),
    brand_book: brandBook,
    voice: await io.voiceBlock(db, client.id, { platforms: posting, examples: g.examples }),
    site,
    competitors,
    competitive_brief: await tryOr(() => io.competitiveBrief(db, client.id), ""),
    profile: { audience: str(profile.audience), fit_rubric: str(profile.fit_rubric), exclusions: terms.exclusions.map((t) => ({ term: t.term, reason: t.reason })) },
    platforms: states.platforms,
    evidence: g.evidence,
    avoid: g.avoid,
    thin: g.thin,
    edits: Object.fromEntries(((edits ?? []) as Array<{ section_key: string; text: string }>)
      .filter((r) => inPlay.has(r.section_key) && str(r.text)).map((r) => [r.section_key, str(r.text)])),
    sources: [
      ...(brief ? ["brief"] : []),
      ...(str(client.strategy_doc_file_path) ? ["strategy_doc"] : []),
      ...(site ? ["website"] : []),
      ...(brandBook ? ["brand_book"] : []),
      ...(competitors.length ? ["competitors"] : []),
      ...(g.own.length ? ["posts"] : []),
    ],
  };
}

// ── What the writer is told ────────────────────────────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const percent = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

function cadenceWords(c: Cadence | null): string {
  if (!c) return "no posting rate is known for it yet";
  const n = `${c.per_week} post${c.per_week === 1 ? "" : "s"} a week`;
  switch (c.source) {
    case "setting": return `${n}, as the team set it for the calendar`;
    case "published_8w": return `${n}, the client's own pace over the last 8 weeks, which the calendar follows`;
    case "published_90d": return `${n}, the client's own pace over the last 90 days, which the calendar follows`;
    case "competitors": return `${n}, the median of its tracked competitors`;
    case "all_tracked": return `${n}, the median across every company the app tracks`;
  }
}

function platformLine(p: StrategyPlatform): string {
  const parts = [`cadence ${cadenceWords(p.cadence)}`];
  const b = p.baseline;
  if (b) {
    parts.push(`${plural(b.posts, "post")} in the last 90 days (${b.posts_per_week} a week)`);
    if (b.median_engagement !== null) parts.push(`median engagement per post ${b.median_engagement}`);
    if (b.engagement_rate !== null) parts.push(`engagement rate per impression ${percent(b.engagement_rate)}`);
  }
  const handle = p.handle ? ` (${p.state === "posting" ? "account" : "existing account, quiet"} @${p.handle.replace(/^@/, "")})` : "";
  const why = p.profile_reason && p.state === "candidate" ? ` The trend profile lists it: ${p.profile_reason}` : "";
  return `- ${p.platform}${handle}: ${parts.join("; ")}.${why}`;
}

/** One piece of the calendar's evidence, without its id: the strategy never cites ids. */
function itemLine(e: EvidenceItem): string {
  const where = [e.company, e.platform, e.format].filter(Boolean).join(" ");
  const numbers = e.multiple !== undefined ? `${fmtMultiple(e.multiple)} ${e.kind === "own" ? "the client's" : "their"} usual ${e.metric}` : "";
  const parts = [where, e.date, e.theme ? `theme "${e.theme}"` : "", numbers, e.companies ? `${e.companies} compan${e.companies === 1 ? "y" : "ies"}` : "", e.thin ? "early signal" : ""].filter(Boolean).join(", ");
  return `- ${parts ? `[${parts}] ` : ""}${e.text}`;
}

const EVIDENCE_TITLES: Array<[EvidenceItem["kind"], string]> = [
  ["own", "The client's posts that beat its usual numbers in the last 90 days:"],
  ["competitor", "Competitor posts that beat that competitor's usual numbers in the newest week:"],
  ["topic", "Topics several competitors posted about in the newest week:"],
  ["trend", "Industry trends this week, each shown by a real post that fit the client's audience:"],
  ["report", "Findings from the latest monthly report:"],
];

function evidenceText(e: StrategyEvidence): string {
  const lines: string[] = [];
  const c = e.client;
  lines.push(`Brand: ${c.name}`);
  lines.push(`Market: ${c.market.join(", ") || "not set"}; content languages: ${c.languages.join(", ") || "en"}`);
  if (e.brief) lines.push(`\nBrief (it carries the words of any strategy document):\n${e.brief}`);
  if (e.pillars.length) {
    lines.push(`\nContent pillars, each with its share of posts (worked out in code; use the shares as given):\n${e.pillars.map((p) => `- ${p.name} (${p.share}% of posts)${p.description ? `: ${p.description}` : ""}`).join("\n")}`);
  }
  if (e.keywords.length) lines.push(`\nKeywords the team uses for the brand: ${e.keywords.join(", ")}`);
  if (e.brand_notes) lines.push(`\nBrand notes:\n${e.brand_notes}`);
  if (e.brand_book) lines.push(`\nBrand book (excerpt):\n${e.brand_book}`);
  if (e.voice) lines.push(`\n${e.voice}`);
  if (e.site) lines.push(`\nWebsite (excerpt):\n${e.site}`);
  if (e.competitors.length) lines.push(`\nTracked competitors: ${e.competitors.join(", ")}`);
  if (e.competitive_brief) lines.push(`\n${e.competitive_brief}`);
  const p = e.profile;
  lines.push(`\nThe industry trend profile:\nAudience: ${p.audience}\nWhat fits: ${p.fit_rubric}`);
  if (p.exclusions.length) lines.push(`Kept out of the brand's space:\n${p.exclusions.map((x) => `- ${x.term}${x.reason ? `: ${x.reason}` : ""}`).join("\n")}`);

  const of = (state: StrategyPlatform["state"]) => e.platforms.filter((x) => x.state === state);
  lines.push("\nPlatforms. Every number here was worked out in code; use them as given and add no others.");
  if (of("posting").length) lines.push(`Posting now (the client published there in the last 90 days):\n${of("posting").map(platformLine).join("\n")}`);
  if (of("new").length) lines.push(`New (the client chose it or has an account there, with no posts in 90 days):\n${of("new").map(platformLine).join("\n")}`);
  if (of("candidate").length) lines.push(`Suggested (where the industry's audience is active; the client neither posts there nor chose it):\n${of("candidate").map(platformLine).join("\n")}`);

  for (const [kind, title] of EVIDENCE_TITLES) {
    const items = e.evidence.filter((x) => x.kind === kind);
    if (items.length) lines.push(`\n${title}\n${items.map(itemLine).join("\n")}`);
  }
  if (e.avoid.length) lines.push(`\nThe client's posts that did worst:\n${e.avoid.map((a) => `- ${a}`).join("\n")}`);
  if (e.thin.length) lines.push(`\nWhere the evidence is thin:\n${e.thin.map((t) => `- ${t}`).join("\n")}`);
  const edits = Object.entries(e.edits);
  if (edits.length) {
    lines.push(`\nThe team's own versions of these sections. They stay exactly as the team wrote them; keep every other section consistent with them:\n${edits.map(([k, v]) => `[${k}]\n${v}`).join("\n\n")}`);
  }
  return lines.join("\n");
}

const STRATEGY_SYSTEM = `You write the content strategy for a brand whose social media Moburst, a marketing agency, manages. The account team works from it every week, and the weekly calendar is planned from it.

Write these parts:
- goals: two to four goals for the next 90 days, each with its reason. Goals stated in the brief or a strategy document win.
- audience: who the brand speaks to and what they want, built on the trend profile's audience.
- positioning: what sets the brand apart from its tracked competitors, and how that shows in its posts.
- pillars: one per content pillar, named exactly as given. Each gives the formats that worked (the brand's or its competitors'), its share of posts as given, and two example post ideas.
- platforms: one per platform that is posting now or new, and one per suggested platform you mark new. Posting now: its role, what to post, and what has worked. New: why this platform, the account basics (name the existing handle when one is given), the first 30 days with example posts, and what to check 30 and 90 days after the first post.
- candidates: every suggested platform, marked "new" or "not_now", with a one-line reason. At most two can be new.
- avoid: what to avoid, from the brand's weakest posts, the trend profile's exclusions, and the restrictions in the brief and the brand notes.
- measures: for each platform, the measure that counts and the direction that counts as success, stated against the baselines given.

Rules:
- Every number you write is one of the numbers in the evidence. Never invent a figure, a name, a result, a quote or a claim. State targets against the baselines given, as a direction (above, below, more often), never as a number of your own.
- Never mention evidence by an id or a code.
- Never use an em dash; use a period, a comma, a colon or parentheses.
- Plain text inside each field: short paragraphs, or lines that start with "- ".

Answer with one JSON object and nothing else.`;

const STRATEGY_FORMAT = `{"goals": "...", "audience": "...", "positioning": "...", "pillars": [{"name": "...", "text": "..."}], "platforms": [{"platform": "...", "text": "..."}], "candidates": [{"platform": "...", "decision": "new", "reason": "..."}], "avoid": "...", "measures": "..."}`;

/** The Messages API request that writes a strategy. */
export function strategyRequest(e: StrategyEvidence): Record<string, unknown> {
  const language = `Write in English for the team. Write the example posts in the client's first content language (${e.client.first_language}).`;
  return {
    model: STRATEGY_MODEL,
    max_tokens: STRATEGY_MAX_TOKENS,
    system: STRATEGY_SYSTEM,
    messages: [{ role: "user", content: `${evidenceText(e)}\n\n${language}\n\nAnswer in this shape:\n${STRATEGY_FORMAT}` }],
  };
}

// ── The code checks ─────────────────────────────────────────────────────────

export interface StrategyDraft {
  goals: string;
  audience: string;
  positioning: string;
  avoid: string;
  measures: string;
  pillars: Array<{ name: string; text: string }>;
  platforms: Array<{ platform: string; text: string }>;
  candidates: Array<{ platform: string; decision: string; reason: string }>;
}

const EVIDENCE_ID = /\b[PCTNR]\d{1,2}\b/;
const DASH = /—|\s–\s/;

/** What a draft does not meet; empty when it is fine. */
export function strategyProblems(d: StrategyDraft, e: StrategyEvidence): string[] {
  const out: string[] = [];
  for (const k of FIXED_SECTIONS) if (!d[k]) out.push(`The ${SECTION_NAMES[k]} section (${k}) is missing.`);

  const want = e.pillars.map((p) => p.name);
  for (const name of want) {
    const hit = d.pillars.find((p) => p.name === name);
    if (!hit) out.push(`The pillar "${name}" has no section; name each pillar exactly as given.`);
    else if (!hit.text) out.push(`The pillar "${name}" has no text.`);
  }
  for (const p of d.pillars) if (!want.includes(p.name)) out.push(`"${p.name}" is not one of the brand's pillars; use the pillar names exactly as given.`);

  const candidates = e.platforms.filter((p) => p.state === "candidate");
  const decision = new Map(d.candidates.map((c) => [platformKey(c.platform), c]));
  for (const c of candidates) {
    const got = decision.get(c.key);
    if (!got || !["new", "not_now"].includes(got.decision) || !got.reason) out.push(`Mark the suggested platform ${c.platform} "new" or "not_now", with a one-line reason.`);
  }
  for (const c of d.candidates) if (!candidates.some((x) => x.key === platformKey(c.platform))) out.push(`${c.platform} is not one of the suggested platforms.`);
  const marked = candidates.filter((c) => decision.get(c.key)?.decision === "new");
  if (marked.length > 2) out.push(`At most two suggested platforms can be marked new; ${marked.length} are.`);

  const needed = [...e.platforms.filter((p) => p.state !== "candidate"), ...marked];
  const sections = new Map(d.platforms.map((p) => [platformKey(p.platform), p]));
  for (const p of needed) if (!sections.get(p.key)?.text) out.push(`The platform ${p.platform} has no section.`);
  for (const s of d.platforms) {
    if (needed.some((p) => p.key === platformKey(s.platform))) continue;
    out.push(candidates.some((c) => c.key === platformKey(s.platform))
      ? `${s.platform} is marked not now, so it gets only its one-line reason, no platform section.`
      : `${s.platform} is not one of the platforms in play, so it gets no section.`);
  }

  const texts = [...FIXED_SECTIONS.map((k) => d[k]), ...d.pillars.map((p) => p.text), ...d.platforms.map((p) => p.text), ...d.candidates.map((c) => c.reason)];
  if (texts.some((t) => EVIDENCE_ID.test(t))) out.push("Never cite evidence by an id (such as P1 or C2); say what it was in words.");
  if (texts.some((t) => DASH.test(t))) out.push("Use no em dashes; use a period, a comma, a colon or parentheses instead.");
  return out;
}

/** The strategy in a reply, or what is wrong with it. */
export function parseStrategy(text: string, e: StrategyEvidence): { value: StrategyDraft } | { error: string } {
  const parsed = parseAnswer(text);
  if ("error" in parsed) return parsed;
  const v = parsed.value ?? {};
  const rows = (x: unknown): Any[] => (Array.isArray(x) ? x : []);
  const draft: StrategyDraft = {
    goals: str(v.goals), audience: str(v.audience), positioning: str(v.positioning), avoid: str(v.avoid), measures: str(v.measures),
    pillars: rows(v.pillars).map((p) => ({ name: str(p?.name), text: str(p?.text) })),
    platforms: rows(v.platforms).map((p) => ({ platform: str(p?.platform), text: str(p?.text) })),
    candidates: rows(v.candidates).map((c) => ({ platform: str(c?.platform), decision: str(c?.decision).toLowerCase(), reason: str(c?.reason) })),
  };
  const problems = strategyProblems(draft, e);
  return problems.length ? { error: problems.join(" ") } : { value: draft };
}

// ── The fact check ──────────────────────────────────────────────────────────

const CHECK_SYSTEM = `You check a content strategy that Moburst, a marketing agency, wrote for a brand, against the evidence it was written from.
List every number, name, result or claim in the strategy that the evidence does not support: a figure that is not in the evidence, a person, product, partner or event the evidence does not name, a result the brand or a competitor is said to have had, or a fact about the audience or the market the evidence does not give.
Plans, advice, directions such as "above the current median", and example post ideas that state no fact are fine. Copy each statement word for word.
Answer with one JSON object and nothing else.`;

function sectionsText(sections: Record<string, string>): string {
  return Object.entries(sections).map(([k, v]) => `[${k}]\n${v}`).join("\n\n");
}

/** The Messages API request that checks a strategy against its evidence. */
export function checkRequest(e: StrategyEvidence, sections: Record<string, string>): Record<string, unknown> {
  return {
    model: CHECK_MODEL,
    max_tokens: CHECK_MAX_TOKENS,
    system: CHECK_SYSTEM,
    messages: [{ role: "user", content: `${evidenceText(e)}\n\nThe strategy, by section:\n\n${sectionsText(sections)}\n\nAnswer in this shape:\n{"unsupported": [{"section": "...", "statement": "..."}]}` }],
  };
}

/** The statements the check flagged, or why its reply could not be read. */
export function parseCheck(text: string): { value: Array<{ section: string; statement: string }> } | { error: string } {
  const parsed = parseAnswer(text);
  if ("error" in parsed) return { error: `The check's reply could not be read: ${parsed.error}` };
  if (!Array.isArray(parsed.value?.unsupported)) return { error: "The check's reply had no list of unsupported statements." };
  return { value: (parsed.value.unsupported as Any[]).map((u) => ({ section: str(u?.section), statement: str(u?.statement) })).filter((u) => u.statement) };
}

// ── Writing ─────────────────────────────────────────────────────────────────

export interface WrittenStrategy {
  /** The product's version of every section, by section key. */
  sections: Record<string, string>;
  platforms: WrittenPlatform[];
}

export interface WriteUsage {
  calls: { writer: number; checker: number };
  tokens: Record<string, { input: number; output: number }>;
}

export type WriteOutcome = ({ value: WrittenStrategy } | { error: string }) & { usage: WriteUsage };

export type StrategyCall = (args: { apiKey: string; body: Record<string, unknown> }) => Promise<{ text: string; raw?: unknown }>;

/** The sections and platforms of an accepted draft. Not now platforms share one section of one line each. */
function assemble(d: StrategyDraft, e: StrategyEvidence): WrittenStrategy {
  const sections: Record<string, string> = {};
  for (const k of FIXED_SECTIONS) sections[k] = d[k];
  for (const p of e.pillars) sections[pillarSectionKey(p.name)] = d.pillars.find((x) => x.name === p.name)!.text;
  const text = new Map(d.platforms.map((p) => [platformKey(p.platform), p.text]));
  const decision = new Map(d.candidates.map((c) => [platformKey(c.platform), c]));
  const platforms = e.platforms.map((p): WrittenPlatform => {
    const chosen = p.state === "candidate" ? decision.get(p.key)! : null;
    const state: WrittenState = p.state === "candidate" ? (chosen!.decision === "new" ? "new" : "not_now") : p.state;
    if (state !== "not_now") sections[platformSectionKey(p.platform, state)] = text.get(p.key)!;
    return { ...p, state, reason: chosen?.reason ?? null, suggested: p.state === "candidate" };
  });
  const notNow = platforms.filter((p) => p.state === "not_now");
  if (notNow.length) sections.not_now = notNow.map((p) => `${p.platform}: ${p.reason}`).join("\n");
  return { sections, platforms };
}

/**
 * Write and check a strategy. At most three Opus calls (a write, one more
 * ask, one fix) and two Sonnet calls (a check, one more after the fix).
 */
export async function writeStrategy(call: StrategyCall, apiKey: string, e: StrategyEvidence): Promise<WriteOutcome> {
  const usage: WriteUsage = { calls: { writer: 0, checker: 0 }, tokens: {} };
  const count = (model: string, raw: unknown) => {
    const u = (raw as { usage?: { input_tokens?: number; output_tokens?: number } } | null)?.usage;
    const t = (usage.tokens[model] ??= { input: 0, output: 0 });
    t.input += Number(u?.input_tokens) || 0;
    t.output += Number(u?.output_tokens) || 0;
  };
  let lastMessages: unknown[] = [];
  let lastText = "";
  const writer: StrategyCall = async (args) => {
    usage.calls.writer++;
    const r = await call(args);
    count(STRATEGY_MODEL, r.raw);
    lastMessages = args.body.messages as unknown[];
    lastText = r.text;
    return r;
  };
  const check = async (sections: Record<string, string>) => {
    usage.calls.checker++;
    const r = await call({ apiKey, body: checkRequest(e, sections) });
    count(CHECK_MODEL, r.raw);
    return parseCheck(r.text);
  };
  const parse = (text: string) => parseStrategy(text, e);

  const first = await askTwice(writer, apiKey, strategyRequest(e), parse);
  if ("error" in first) return { error: `The strategy did not meet the rules: ${first.error}`, usage };
  let written = assemble(first.value, e);
  const flagged = await check(written.sections);
  if ("error" in flagged) return { error: flagged.error, usage };
  if (!flagged.value.length) return { value: written, usage };

  const fix = [
    "A check against the evidence found statements it does not support:",
    ...flagged.value.map((f) => `- ${f.section ? `(${f.section}) ` : ""}${f.statement}`),
    "Rewrite only what is needed so none of them remains: drop each one, or say only what the evidence says. Keep every rule above, and send the whole JSON object again.",
  ].join("\n");
  const body = strategyRequest(e);
  const second = parse((await writer({ apiKey, body: { ...body, messages: [...lastMessages, { role: "assistant", content: lastText }, { role: "user", content: fix }] } })).text);
  if ("error" in second) return { error: `The fixed strategy did not meet the rules: ${second.error}`, usage };
  written = assemble(second.value, e);
  const again = await check(written.sections);
  if ("error" in again) return { error: again.error, usage };
  if (again.value.length) return { error: `The strategy still has statements the evidence does not support: ${again.value.map((f) => f.statement).join(" | ").slice(0, 300)}`, usage };
  return { value: written, usage };
}

/** Save the product's version. People's versions live in content_strategy_edits, which this never writes. */
export async function saveStrategy(db: Db, clientId: string, e: StrategyEvidence, out: { value: WrittenStrategy; usage: WriteUsage }, inputsKey: string, now: Date): Promise<void> {
  const at = now.toISOString();
  const { error } = await db.from("content_strategies").upsert({
    client_id: clientId,
    sections: out.value.sections,
    platforms: out.value.platforms,
    pillars: e.pillars,
    sources: e.sources,
    inputs_key: inputsKey,
    written_at: at,
    models: { writer: STRATEGY_MODEL, checker: CHECK_MODEL },
    usage: out.usage,
    updated_at: at,
  }, { onConflict: "client_id" });
  if (error) throw new Error(`Could not save the content strategy: ${error.message}`);
}
