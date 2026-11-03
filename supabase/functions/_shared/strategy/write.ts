// supabase/functions/_shared/strategy/write.ts
//
// A client's content strategy, written from what the lifecycle already reads
// (spec: docs/superpowers/specs/2026-11-02-content-strategy-tab-design.md, and
// version 2: docs/superpowers/specs/2026-11-03-strategy-v2-design.md). The
// lifecycle step content_strategy (lifecycle/steps.ts) calls this; nobody has
// to fill anything in. Code works out every number (each platform's state,
// cadence, data basis and baselines, the competitors' figures, each pillar's
// share of the client's calendar posts, each goal's figure today and its
// date) and the model writes short fields around them, never prose: version 2
// is read as cards, lists and numbers, and goes to the client as a PDF or a
// deck, so it is written client-ready, the brand by name and "we" for Moburst.
//
// A write is a series of phases, one model call each, each its own lifecycle
// run, so no run holds more than one call against the time limit:
//   write    one Opus call writes every section's fields;
//   reask    a reply that failed the code checks (every field's cap and enum,
//            the metric each platform's data allows), or was cut off, is
//            asked again once with its problems named;
//   check    one Sonnet call lists any number, name, result or claim the
//            evidence does not support;
//   fix      flagged statements get one Opus fix;
//   recheck  and one more Sonnet check.
// At most three Opus and two Sonnet calls, usually one of each. A reply cut
// off at max_tokens is never read or kept. The draft between phases
// (PendingStrategy) is kept on the client's content_strategies row, with the
// evidence it is written from, so later phases read nothing again. A write
// that still fails ends (the step tries again later from the start) and the
// stored strategy stays until a new one passes every check. People's versions
// of sections (content_strategy_edits) are read as fixed context and never
// written here.

import { parseAnswer } from "../pipelines/competitive/analysis.ts";
import { applyRhythmSetting, numberEvidence, scoreOwnPosts, type EvidenceItem, type OwnPost, type RhythmLine } from "../calendar/evidence.ts";
import { fmtMultiple } from "../calendar/reasonText.ts";
import { competitorSet, feedSnapshots, gatherEvidence, trackedRates, type Gathered } from "../calendar/runWeek.ts";
import { competitiveBrief } from "../competitive/brief.ts";
import { setBy } from "../lifecycle/fields.ts";
import { activeTerms } from "../trends/profile.ts";
import { clip } from "../trends/text.ts";
import { loadClientVoice } from "../voice/load.ts";
import { voicePromptBlock, type VoiceExample } from "../voice/voice.ts";
import { baselineOf, pillarSectionKey, platformKey, platformSectionKey, platformStates, type Cadence, type StrategyPlatform, type WrittenPlatform, type WrittenState } from "./platforms.ts";
import { baselineFor, basisOf, basisWords, metricsFor, rateKindOf, type PlatformFigures } from "./basis.ts";
import { feedPosts, figures, READ_DAYS, type CompanyFigures, type PublicPost, type PublicReadState } from "./publicRead.ts";
import { AVOID_SOURCES, DIRECTIONS, GOAL_METRICS, metricWords, sectionLines, STRATEGY_SHAPE, type AvoidSource, type Direction, type Goal, type GoalMetric, type WorkedPost } from "./sections.ts";

export type { WrittenPlatform };

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Any = any;

export const STRATEGY_MODEL = "claude-opus-5-5";
export const CHECK_MODEL = "claude-sonnet-5-5";
/** Room for the reply and Opus's thinking, which counts against it (the calendar's week plan gives the same model 16,000). */
export const STRATEGY_MAX_TOKENS = 16000;
export const CHECK_MAX_TOKENS = 4000;
/** A pillar's share is of the client's calendar posts over this many days (8 weeks), up to today. */
const SHARE_DAYS = 56;
const BRIEF_CHARS = 6000;
const SITE_CHARS = 2500;
const BOOK_CHARS = 2500;
/** A goal is for this many days after the strategy is written. */
export const GOAL_DAYS = 90;

/** The sections every strategy has, besides one per pillar, one per platform and the not now list. */
export const FIXED_SECTIONS = ["goals", "audience", "positioning", "avoid"] as const;

/** Each field's longest answer, in characters (spec section 2). */
export const CAPS = {
  goal_title: 60, goal_why: 140, who: 120, want: 100, statement: 140, point: 120, purpose: 120, hook: 100,
  role: 100, post: 120, week: 140, check: 140, pattern: 120, reason: 140, format: 40,
} as const;

export interface StrategyEvidence {
  client: { name: string; market: string[]; languages: string[]; first_language: string };
  brief: string;
  /**
   * The pillars from Client setup, unchanged, each with its share (a whole
   * percent) of the client's calendar posts over the last 8 weeks; null for
   * every pillar when the calendar has no posts in that time.
   */
  pillars: Array<{ name: string; description: string; share: number | null }>;
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
  /** Every platform in play, each with its data basis and figures (code's). */
  platforms: Array<StrategyPlatform & { figures: PlatformFigures }>;
  /** The tracked competitors' figures per platform over the same 90 days, from the same read. */
  competitor_figures: CompanyFigures[];
  /** The 90 days the figures cover (YYYY-MM-DD). */
  window: { start: string; end: string };
  /** The day the strategy is written (YYYY-MM-DD); each goal is for 90 days after it. */
  written_on: string;
  /** The calendar's evidence: the client's best posts, competitors' best posts, topics, trends and report findings. */
  evidence: EvidenceItem[];
  /** The client's weakest posts, as the calendar words them. */
  avoid: string[];
  thin: string[];
  /** People's versions of sections still in play, by section key, as plain lines. */
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
  /** The client's weekly competitor feeds (rivaliq_snapshots, endpoint feed), newest first. */
  feedSnapshots(db: Db, clientId: string): Promise<Array<{ payload: Any }>>;
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
    feedSnapshots: (db, clientId) => feedSnapshots(db, clientId),
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (s: unknown) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

async function tryOr<T>(f: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await f();
  } catch {
    return fallback;
  }
}

/**
 * Each pillar's share of the client's calendar posts: the posts that carry its
 * name (any case) over every post in the window, as a whole percent. Null for
 * every pillar when the window has no posts.
 */
export function pillarShares(names: string[], posts: Array<{ pillar: string | null }>): Array<number | null> {
  if (!posts.length) return names.map(() => null);
  const key = (s: unknown) => String(s ?? "").trim().toLowerCase();
  return names.map((n) => Math.round((100 * posts.filter((p) => key(p.pillar) === key(n)).length) / posts.length));
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

/** A client's public post as the calendar's own posts are kept. */
const asOwn = (p: PublicPost): OwnPost => ({
  id: p.id, platform: p.platform, format: p.format, publishedAt: p.publishedAt, text: p.text, link: p.link, impressions: null, engagement: p.engagement, boosted: p.boosted,
});

/** A platform's figures: Sprout's measured numbers where it has the account, else the public read's. */
export function platformFigures(platform: string, i: { sprout: boolean; own: OwnPost[]; publicPosts: PublicPost[]; now: Date }): PlatformFigures {
  const pub = figures(i.publicPosts.filter((p) => p.client && p.platform === platform), i.now)[0];
  const followers = pub?.followers ?? null;
  if (i.sprout) {
    const b = baselineOf(i.own, platform, i.now);
    return { platform, basis: "measured", posts: b.posts, posts_per_week: b.posts_per_week, median_engagement: b.median_engagement, rate: b.engagement_rate, rate_kind: "impression", followers };
  }
  const posts = pub?.posts ?? 0;
  const basis = basisOf({ sprout: false, posts });
  const rate_kind = rateKindOf(platform, basis);
  return {
    platform, basis, posts, posts_per_week: pub?.posts_per_week ?? 0, median_engagement: pub?.median_engagement ?? null,
    rate: rate_kind ? pub?.rate_per_view ?? null : null, rate_kind: rate_kind && pub?.rate_per_view != null ? rate_kind : null, followers,
  };
}

/**
 * Everything a strategy is written from. Null while the client has no trend
 * profile: the strategy is written after it, from it. read is the 90-day
 * public read (publicRead.ts), done; its posts join the client's own and
 * give every platform Sprout does not cover its figures.
 */
export async function strategyEvidence(db: Db, client: Any, now: Date, io: StrategyIO, read: PublicReadState | null = null): Promise<StrategyEvidence | null> {
  const { data: profile, error } = await db.from("trend_profiles").select("audience, fit_rubric, platforms, written_at").eq("client_id", client.id).maybeSingle();
  if (error) throw new Error(`Could not read the trend profile: ${error.message}`);
  if (!profile) return null;

  const g = await io.gather(db, client, now);
  const terms = await activeTerms(db, client.id);
  const { data: accounts, error: accountsError } = await db.from("sprout_profiles").select("network_type, native_name").eq("client_id", client.id).eq("is_active", true);
  if (accountsError) throw new Error(`Could not read the client's social accounts: ${accountsError.message}`);
  const { data: edits, error: editsError } = await db.from("content_strategy_edits").select("section_key, text, value").eq("client_id", client.id);
  if (editsError) throw new Error(`Could not read the team's versions of the strategy: ${editsError.message}`);
  const extras = await tryOr(async () => (await db.from("clients").select("brand_book_text").eq("id", client.id).maybeSingle()).data, null);

  // The public read: the stored weekly feed's posts and what the app's public readers brought back.
  const window = { start: day(new Date(now.getTime() - READ_DAYS * DAY)), end: day(now) };
  const snapshots = await tryOr(() => io.feedSnapshots(db, client.id), []);
  const publicPosts: PublicPost[] = [...feedPosts(snapshots, str(client.name), window.start), ...(read?.posts ?? [])];
  const typedAccounts = (accounts ?? []) as Array<{ network_type: string | null; native_name: string | null }>;
  const sprout = new Set(typedAccounts.map((a) => platformKey(String(a.network_type ?? ""))).filter(Boolean));
  const onSprout = (platform: string) => sprout.has(platformKey(platform));

  // The client's own posts: Sprout and RivalIQ's copy (the calendar's), and its public posts the app read on platforms neither covers.
  const seen = new Set(g.own.map((p) => p.id));
  const added = (read?.posts ?? []).filter((p) => p.client && !onSprout(p.platform) && !seen.has(p.id)).map(asOwn);
  const own = [...g.own, ...added];
  let evidence = g.evidence;
  let avoid = g.avoid;
  if (added.length) {
    const scored = scoreOwnPosts(own, now);
    evidence = [...numberEvidence({ ownTop: scored.top, competitors: [], topics: [], trends: [], findings: [] }), ...g.evidence.filter((e) => e.kind !== "own")];
    avoid = scored.low.map((s) => `${s.post.platform} ${s.post.format} from ${s.post.publishedAt.slice(0, 10)} got ${s.multiple}x the usual ${s.metric}: ${s.post.text.replace(/\s+/g, " ").slice(0, 140)}`);
  }

  // The calendar's rhythm per platform, staff's setting applied, so the strategy and the calendar agree.
  const rhythm: RhythmLine[] = applyRhythmSetting(g.learnedRhythm, client.posting_rhythm);
  const input = {
    own, now, primary: client.primary_platforms, primarySet: setBy(client.field_sources, "primary_platforms") !== null,
    accounts: typedAccounts,
    profile: (Array.isArray(profile.platforms) ? profile.platforms : []) as Array<{ platform: string; reason: string }>,
    rhythm, rates: g.fallbackRates,
  };
  let states = platformStates(input);
  if (states.needsAllTracked) states = platformStates({ ...input, rates: { ...g.fallbackRates, allTracked: await io.trackedRates(db) } });
  const platforms = states.platforms.map((p) => ({ ...p, figures: platformFigures(p.platform, { sprout: onSprout(p.platform), own, publicPosts, now }) }));

  // The client's own calendar posts over the last 8 weeks, read from calendar_posts as the calendar reads them.
  const { data: calendar, error: calendarError } = await db.from("calendar_posts").select("pillar")
    .eq("client_id", client.id).gte("post_date", day(new Date(now.getTime() - SHARE_DAYS * DAY))).lte("post_date", day(now));
  if (calendarError) throw new Error(`Could not read the client's calendar: ${calendarError.message}`);
  const pillars = pillarsOf(client.content_pillars);
  const shares = pillarShares(pillars.map((p) => p.name), (calendar ?? []) as Array<{ pillar: string | null }>);
  const website = str(client.website_url);
  const site = website ? clip(await tryOr(() => io.siteText(website), ""), SITE_CHARS) : "";
  const brief = clip(str(client.brief_text), BRIEF_CHARS);
  const brandBook = clip(str(extras?.brand_book_text), BOOK_CHARS);
  const competitors = (await tryOr(() => io.competitorSet(db, client.id), [])).map((c) => str(c.name)).filter(Boolean);
  const posting = platforms.filter((p) => p.state === "posting").map((p) => p.platform);
  const languages = list(client.language);
  const inPlay = keysInPlay(platforms, pillars);

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
    platforms,
    competitor_figures: figures(publicPosts.filter((p) => !p.client), now),
    window,
    written_on: day(now),
    evidence,
    avoid,
    thin: g.thin,
    edits: Object.fromEntries(((edits ?? []) as Array<{ section_key: string; text: string; value: unknown }>)
      .filter((r) => inPlay.has(r.section_key))
      .map((r) => [r.section_key, sectionLines(r.section_key, r.value && typeof r.value === "object" ? r.value : str(r.text))])
      .filter(([, lines]) => lines)),
    sources: [
      ...(brief ? ["brief"] : []),
      ...(str(client.strategy_doc_file_path) ? ["strategy_doc"] : []),
      ...(site ? ["website"] : []),
      ...(brandBook ? ["brand_book"] : []),
      ...(competitors.length ? ["competitors"] : []),
      ...(own.length ? ["posts"] : []),
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
    case "published_8w": return `${n}, the brand's own pace over the last 8 weeks, which the calendar follows`;
    case "published_90d": return `${n}, the brand's own pace over the last 90 days, which the calendar follows`;
    case "competitors": return `${n}, the median of its tracked competitors`;
    case "all_tracked": return `${n}, the median across every company we track`;
  }
}

function figureWords(f: PlatformFigures): string[] {
  const parts: string[] = [`data: ${basisWords(f)}`];
  if (f.basis !== "none") parts.push(`${plural(f.posts, "post")} in the last 90 days (${f.posts_per_week} a week)`);
  if (f.median_engagement !== null && (f.basis === "measured" || f.basis === "public")) parts.push(`median engagement per post ${f.median_engagement}`);
  if (f.rate !== null && f.rate_kind) parts.push(`engagement rate per ${f.rate_kind} ${percent(f.rate)}`);
  if (f.followers !== null) parts.push(`${f.followers.toLocaleString("en-US")} followers`);
  parts.push(`goal metrics allowed: ${metricsFor(f).join(", ")}`);
  return parts;
}

function platformLine(p: StrategyEvidence["platforms"][number]): string {
  const parts = [`cadence ${cadenceWords(p.cadence)}`, ...figureWords(p.figures)];
  const handle = p.handle ? ` (${p.state === "posting" ? "account" : "existing account, quiet"} @${p.handle.replace(/^@/, "")})` : "";
  const why = p.profile_reason && p.state === "candidate" ? ` The trend profile lists it: ${p.profile_reason}` : "";
  return `- ${p.platform}${handle}: ${parts.join("; ")}.${why}`;
}

function competitorLines(e: StrategyEvidence): string {
  const rows = e.competitor_figures.filter((c) => c.posts > 0).map((c) => {
    const parts = [`${c.posts_per_week} posts a week`];
    if (c.median_engagement !== null) parts.push(`median engagement per post ${c.median_engagement}`);
    if (c.followers !== null) parts.push(`${c.followers.toLocaleString("en-US")} followers`);
    return `- ${c.company} on ${c.platform}: ${parts.join(", ")}`;
  });
  return rows.length ? `\nThe tracked competitors over the same 90 days (code's figures; a "vs" point may cite them):\n${rows.join("\n")}` : "";
}

/** One piece of the calendar's evidence. Only the client's own posts keep their id, for "worked". */
function itemLine(e: EvidenceItem): string {
  const where = [e.company, e.platform, e.format].filter(Boolean).join(" ");
  const numbers = e.multiple !== undefined ? `${fmtMultiple(e.multiple)} ${e.kind === "own" ? "the brand's" : "their"} usual ${e.metric}` : "";
  const parts = [where, e.date, e.theme ? `theme "${e.theme}"` : "", numbers, e.companies ? `${e.companies} compan${e.companies === 1 ? "y" : "ies"}` : "", e.thin ? "early signal" : ""].filter(Boolean).join(", ");
  return `- ${e.kind === "own" ? `${e.id} ` : ""}${parts ? `[${parts}] ` : ""}${e.text}`;
}

const EVIDENCE_TITLES: Array<[EvidenceItem["kind"], string]> = [
  ["own", "The brand's posts that beat its usual numbers in the last 90 days (an id here may be named only in a platform's \"worked\" list):"],
  ["competitor", "Competitor posts that beat that competitor's usual numbers in the newest week:"],
  ["topic", "Topics several competitors posted about in the newest week:"],
  ["trend", "Industry trends this week, each shown by a real post that fit the brand's audience:"],
  ["report", "Findings from the latest monthly report:"],
];

function evidenceText(e: StrategyEvidence): string {
  const lines: string[] = [];
  const c = e.client;
  lines.push(`Brand: ${c.name}`);
  lines.push(`Market: ${c.market.join(", ") || "not set"}; content languages: ${c.languages.join(", ") || "en"}`);
  lines.push(`The strategy is written on ${e.written_on} for the 90 days after it.`);
  if (e.brief) lines.push(`\nBrief (it carries the words of any strategy document):\n${e.brief}`);
  if (e.pillars.length) {
    const shared = e.pillars.some((p) => p.share !== null);
    const title = shared ? "Content pillars, each with its share of the brand's calendar posts over the last 8 weeks (counted in code; use the shares as given):" : "Content pillars:";
    const share = (p: StrategyEvidence["pillars"][number]) => (p.share === null ? "" : ` (${p.share}% of the brand's calendar posts over the last 8 weeks)`);
    lines.push(`\n${title}\n${e.pillars.map((p) => `- ${p.name}${share(p)}${p.description ? `: ${p.description}` : ""}`).join("\n")}`);
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
  if (of("posting").length) lines.push(`Posting now (the brand published there in the last 90 days):\n${of("posting").map(platformLine).join("\n")}`);
  if (of("new").length) lines.push(`New (the brand chose it or has an account there, with no posts in 90 days):\n${of("new").map(platformLine).join("\n")}`);
  if (of("candidate").length) lines.push(`Suggested (where the industry's audience is active; the brand neither posts there nor chose it):\n${of("candidate").map(platformLine).join("\n")}`);
  const comp = competitorLines(e);
  if (comp) lines.push(comp);

  for (const [kind, title] of EVIDENCE_TITLES) {
    const items = e.evidence.filter((x) => x.kind === kind);
    if (items.length) lines.push(`\n${title}\n${items.map(itemLine).join("\n")}`);
  }
  if (e.avoid.length) lines.push(`\nThe brand's posts that did worst:\n${e.avoid.map((a) => `- ${a}`).join("\n")}`);
  if (e.thin.length) lines.push(`\nWhere the evidence is thin:\n${e.thin.map((t) => `- ${t}`).join("\n")}`);
  const edits = Object.entries(e.edits);
  if (edits.length) {
    lines.push(`\nThe team's own versions of these sections. They stay exactly as the team wrote them; keep every other section consistent with them:\n${edits.map(([k, v]) => `[${k}]\n${v}`).join("\n\n")}`);
  }
  return lines.join("\n");
}

const STRATEGY_SYSTEM = `You write the social media strategy that Moburst, a marketing agency, runs for a brand for the next 90 days. It goes to the brand as a PDF and a slide deck, and our team plans every week from it. Write it ready for the brand to read: name the brand, write "we" for Moburst, and keep every field short. It is read as cards and lists, never as paragraphs.

Write these parts, as fields:
- goals: two to four goals for the 90 days. Each has a title (at most ${CAPS.goal_title} characters), why (one line, at most ${CAPS.goal_why}), the platform it is on (one of the platforms posting now or new), the metric (one of the metrics allowed for that platform) and the direction ("above" or "below" today's figure). Goals stated in the brief or a strategy document win. Code adds today's figure and the date.
- audience: who (one line, at most ${CAPS.who}), wants (exactly three items, each at most ${CAPS.want}), where (the platforms where they are, from the platforms given).
- positioning: statement (one sentence, at most ${CAPS.statement}) and up to three points, each naming one tracked competitor in "vs" and the difference in "point" (at most ${CAPS.point}), citing a competitor figure given where one fits.
- pillars: one per content pillar, named exactly as given: purpose (at most ${CAPS.purpose}), formats (up to three, such as carousel, reel, short video), planned_share (a whole percent; the shares add up to 100), and exactly two ideas, each a hook (at most ${CAPS.hook}) and its format. Write the hooks in the brand's first content language.
- platforms: one per platform posting now or new, and one per suggested platform you mark new: role (at most ${CAPS.role}), post (exactly three items, what we post, each at most ${CAPS.post}), worked (up to two ids of the brand's own posts listed as beating its usual numbers on that platform, or none), checks (day_30 and day_90: what we look at then, each at most ${CAPS.check}). A new platform also gets first_30: exactly four lines, one per week, each at most ${CAPS.week}.
- candidates: every suggested platform, marked "new" or "not_now", with a one-line reason (at most ${CAPS.reason}). At most two can be new.
- avoid: up to five patterns to stop (each at most ${CAPS.pattern}), each with its source: "posts" (the brand's weakest posts), "trend_profile" (what the trend profile keeps out) or "brief" (the brief or brand notes). Write each one as a pattern; never quote or describe one of the brand's own posts.

Rules:
- Every number you write is one of the numbers in the evidence. Never invent a figure, a name, a result, a quote or a claim. State goals as a direction against today's figure, never as a number of your own.
- An evidence id (such as P1) may appear only in a platform's worked list, nowhere else.
- A goal on a platform whose data is thin or has no public posts uses only posts_per_week or followers.
- Never use an em dash; use a period, a comma, a colon or parentheses.

Answer with one JSON object and nothing else.`;

const STRATEGY_FORMAT = `{"goals": [{"title": "...", "why": "...", "platform": "...", "metric": "median_engagement", "direction": "above"}], "audience": {"who": "...", "wants": ["...", "...", "..."], "where": ["..."]}, "positioning": {"statement": "...", "points": [{"vs": "...", "point": "..."}]}, "pillars": [{"name": "...", "purpose": "...", "formats": ["..."], "planned_share": 40, "ideas": [{"hook": "...", "format": "..."}, {"hook": "...", "format": "..."}]}], "platforms": [{"platform": "...", "role": "...", "post": ["...", "...", "..."], "worked": ["P1"], "first_30": ["...", "...", "...", "..."], "checks": {"day_30": "...", "day_90": "..."}}], "candidates": [{"platform": "...", "decision": "new", "reason": "..."}], "avoid": [{"pattern": "...", "source": "posts"}]}`;

/** The Messages API request that writes a strategy. */
export function strategyRequest(e: StrategyEvidence): Record<string, unknown> {
  const language = `Write in English. Write the example post hooks in the brand's first content language (${e.client.first_language}).`;
  return {
    model: STRATEGY_MODEL,
    max_tokens: STRATEGY_MAX_TOKENS,
    system: STRATEGY_SYSTEM,
    messages: [{ role: "user", content: `${evidenceText(e)}\n\n${language}\n\nAnswer in this shape:\n${STRATEGY_FORMAT}` }],
  };
}

// ── The code checks ─────────────────────────────────────────────────────────

export interface StrategyDraft {
  goals: Array<{ title: string; why: string; platform: string; metric: string; direction: string }>;
  audience: { who: string; wants: string[]; where: string[] };
  positioning: { statement: string; points: Array<{ vs: string; point: string }> };
  pillars: Array<{ name: string; purpose: string; formats: string[]; planned_share: number; ideas: Array<{ hook: string; format: string }> }>;
  platforms: Array<{ platform: string; role: string; post: string[]; worked: string[]; first_30: string[]; checks: { day_30: string; day_90: string } }>;
  candidates: Array<{ platform: string; decision: string; reason: string }>;
  avoid: Array<{ pattern: string; source: string }>;
}

const EVIDENCE_ID = /\b[PCTNR]\d{1,2}\b/;
const DASH = /—|\s–\s/;

/** Every text field of a draft, the worked ids left out. */
function draftTexts(d: StrategyDraft): string[] {
  return [
    ...d.goals.flatMap((g) => [g.title, g.why]), d.audience.who, ...d.audience.wants, d.positioning.statement,
    ...d.positioning.points.flatMap((p) => [p.vs, p.point]),
    ...d.pillars.flatMap((p) => [p.purpose, ...p.formats, ...p.ideas.flatMap((i) => [i.hook, i.format])]),
    ...d.platforms.flatMap((p) => [p.role, ...p.post, ...p.first_30, p.checks.day_30, p.checks.day_90]),
    ...d.candidates.map((c) => c.reason), ...d.avoid.map((a) => a.pattern),
  ];
}

/** What a draft does not meet; empty when it is fine. */
export function strategyProblems(d: StrategyDraft, e: StrategyEvidence): string[] {
  const out: string[] = [];
  const over = (what: string, s: string, cap: number) => { if (s.length > cap) out.push(`${what} is ${s.length} characters; keep it to ${cap}.`); };
  const empty = (what: string, s: string) => { if (!s) out.push(`${what} is missing.`); };

  // Which platforms a goal may be on, and what it may measure there.
  const candidates = e.platforms.filter((p) => p.state === "candidate");
  const decision = new Map(d.candidates.map((c) => [platformKey(c.platform), c]));
  const marked = candidates.filter((c) => decision.get(c.key)?.decision === "new");
  const live = [...e.platforms.filter((p) => p.state !== "candidate"), ...marked];
  const liveByKey = new Map(live.map((p) => [p.key, p]));

  if (d.goals.length < 2 || d.goals.length > 4) out.push(`Write two to four goals; there are ${d.goals.length}.`);
  d.goals.forEach((g, i) => {
    const n = `Goal ${i + 1}`;
    empty(`${n}'s title`, g.title);
    empty(`${n}'s why`, g.why);
    over(`${n}'s title`, g.title, CAPS.goal_title);
    over(`${n}'s why`, g.why, CAPS.goal_why);
    const p = liveByKey.get(platformKey(g.platform));
    if (!p) { out.push(`${n} is on ${g.platform || "no platform"}, which is not a platform posting now or new.`); return; }
    if (!(GOAL_METRICS as readonly string[]).includes(g.metric)) out.push(`${n}'s metric must be one of ${GOAL_METRICS.join(", ")}.`);
    else if (!metricsFor(p.figures).includes(g.metric as GoalMetric)) out.push(`${n} measures ${g.metric} on ${p.platform}, whose data allows only ${metricsFor(p.figures).join(", ")}.`);
    if (!(DIRECTIONS as readonly string[]).includes(g.direction)) out.push(`${n}'s direction must be "above" or "below".`);
  });

  empty("The audience's who", d.audience.who);
  over("The audience's who", d.audience.who, CAPS.who);
  if (d.audience.wants.length !== 3) out.push(`The audience needs exactly three wants; there are ${d.audience.wants.length}.`);
  d.audience.wants.forEach((w, i) => over(`Want ${i + 1}`, w, CAPS.want));
  for (const w of d.audience.where) if (!e.platforms.some((p) => p.key === platformKey(w))) out.push(`${w} in the audience's where is not one of the platforms given.`);

  empty("The positioning statement", d.positioning.statement);
  over("The positioning statement", d.positioning.statement, CAPS.statement);
  if (d.positioning.points.length > 3) out.push(`Give at most three positioning points; there are ${d.positioning.points.length}.`);
  const tracked = new Set(e.competitors.map((c) => c.toLowerCase()));
  d.positioning.points.forEach((p, i) => {
    if (!tracked.has(p.vs.toLowerCase())) out.push(`Positioning point ${i + 1} is against "${p.vs}", which is not a tracked competitor.`);
    empty(`Positioning point ${i + 1}`, p.point);
    over(`Positioning point ${i + 1}`, p.point, CAPS.point);
  });

  const want = e.pillars.map((p) => p.name);
  for (const name of want) if (!d.pillars.some((p) => p.name === name)) out.push(`The pillar "${name}" has no section; name each pillar exactly as given.`);
  for (const p of d.pillars) {
    if (!want.includes(p.name)) { out.push(`"${p.name}" is not one of the brand's pillars; use the pillar names exactly as given.`); continue; }
    empty(`The pillar "${p.name}"'s purpose`, p.purpose);
    over(`The pillar "${p.name}"'s purpose`, p.purpose, CAPS.purpose);
    if (!p.formats.length || p.formats.length > 3) out.push(`The pillar "${p.name}" needs one to three formats.`);
    p.formats.forEach((f) => over(`A format of "${p.name}"`, f, CAPS.format));
    if (!Number.isInteger(p.planned_share) || p.planned_share < 0 || p.planned_share > 100) out.push(`The pillar "${p.name}"'s planned share must be a whole percent.`);
    if (p.ideas.length !== 2) out.push(`The pillar "${p.name}" needs exactly two ideas.`);
    p.ideas.forEach((idea, i) => { empty(`Idea ${i + 1} of "${p.name}"`, idea.hook); over(`Idea ${i + 1} of "${p.name}"`, idea.hook, CAPS.hook); });
  }
  const sum = d.pillars.filter((p) => want.includes(p.name)).reduce((s, p) => s + (Number(p.planned_share) || 0), 0);
  if (want.length && d.pillars.length && sum !== 100) out.push(`The planned shares add up to ${sum}; they must add up to 100.`);

  for (const c of candidates) {
    const got = decision.get(c.key);
    if (!got || !["new", "not_now"].includes(got.decision) || !got.reason) out.push(`Mark the suggested platform ${c.platform} "new" or "not_now", with a one-line reason.`);
    if (got) over(`The reason for ${c.platform}`, got.reason, CAPS.reason);
  }
  for (const c of d.candidates) if (!candidates.some((x) => x.key === platformKey(c.platform))) out.push(`${c.platform} is not one of the suggested platforms.`);
  if (marked.length > 2) out.push(`At most two suggested platforms can be marked new; ${marked.length} are.`);

  const own = new Map(e.evidence.filter((x) => x.kind === "own").map((x) => [x.id, x]));
  const sections = new Map(d.platforms.map((p) => [platformKey(p.platform), p]));
  for (const p of live) {
    const s = sections.get(p.key);
    if (!s) { out.push(`The platform ${p.platform} has no section.`); continue; }
    empty(`${p.platform}'s role`, s.role);
    over(`${p.platform}'s role`, s.role, CAPS.role);
    if (s.post.length !== 3) out.push(`${p.platform} needs exactly three items in post; there are ${s.post.length}.`);
    s.post.forEach((x, i) => over(`${p.platform}'s post item ${i + 1}`, x, CAPS.post));
    if (s.worked.length > 2) out.push(`${p.platform}'s worked list has more than two posts.`);
    for (const id of s.worked) {
      const item = own.get(id);
      if (!item) out.push(`${id} in ${p.platform}'s worked list is not one of the brand's own posts given.`);
      else if (item.platform !== p.platform) out.push(`${id} is a ${item.platform} post, not a ${p.platform} one.`);
    }
    const isNew = p.state !== "posting";
    if (isNew && s.first_30.length !== 4) out.push(`${p.platform} is new, so it needs first_30: exactly four lines, one per week.`);
    if (!isNew && s.first_30.length) out.push(`${p.platform} is posting now, so it gets no first_30.`);
    s.first_30.forEach((w, i) => over(`${p.platform}'s week ${i + 1}`, w, CAPS.week));
    empty(`${p.platform}'s 30-day check`, s.checks.day_30);
    empty(`${p.platform}'s 90-day check`, s.checks.day_90);
    over(`${p.platform}'s 30-day check`, s.checks.day_30, CAPS.check);
    over(`${p.platform}'s 90-day check`, s.checks.day_90, CAPS.check);
  }
  for (const s of d.platforms) {
    if (liveByKey.has(platformKey(s.platform))) continue;
    out.push(candidates.some((c) => c.key === platformKey(s.platform))
      ? `${s.platform} is marked not now, so it gets only its one-line reason, no platform section.`
      : `${s.platform} is not one of the platforms in play, so it gets no section.`);
  }

  if (d.avoid.length > 5) out.push(`Give at most five patterns to avoid; there are ${d.avoid.length}.`);
  d.avoid.forEach((a, i) => {
    empty(`Pattern ${i + 1} to avoid`, a.pattern);
    over(`Pattern ${i + 1} to avoid`, a.pattern, CAPS.pattern);
    if (!(AVOID_SOURCES as readonly string[]).includes(a.source) || a.source === "team") out.push(`Pattern ${i + 1}'s source must be posts, trend_profile or brief.`);
  });

  const texts = draftTexts(d);
  if (texts.some((t) => EVIDENCE_ID.test(t))) out.push("An evidence id (such as P1 or C2) may appear only in a platform's worked list; say what it was in words.");
  if (texts.some((t) => DASH.test(t))) out.push("Use no em dashes; use a period, a comma, a colon or parentheses instead.");
  return out;
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const rows = (x: unknown): Any[] => (Array.isArray(x) ? x.filter((r) => r && typeof r === "object") : []);

/** The strategy in a reply, or what is wrong with it. */
export function parseStrategy(text: string, e: StrategyEvidence): { value: StrategyDraft } | { error: string } {
  const parsed = parseAnswer(text);
  if ("error" in parsed) return parsed;
  const v = parsed.value ?? {};
  const draft: StrategyDraft = {
    goals: rows(v.goals).map((g) => ({ title: str(g.title), why: str(g.why), platform: str(g.platform), metric: str(g.metric), direction: str(g.direction).toLowerCase() })),
    audience: { who: str(v.audience?.who), wants: strs(v.audience?.wants), where: strs(v.audience?.where) },
    positioning: { statement: str(v.positioning?.statement), points: rows(v.positioning?.points).map((p) => ({ vs: str(p.vs), point: str(p.point) })) },
    pillars: rows(v.pillars).map((p) => ({
      name: str(p.name), purpose: str(p.purpose), formats: strs(p.formats), planned_share: Number(p.planned_share),
      ideas: rows(p.ideas).map((i) => ({ hook: str(i.hook), format: str(i.format) })),
    })),
    platforms: rows(v.platforms).map((p) => ({
      platform: str(p.platform), role: str(p.role), post: strs(p.post), worked: strs(p.worked), first_30: strs(p.first_30),
      checks: { day_30: str(p.checks?.day_30), day_90: str(p.checks?.day_90) },
    })),
    candidates: rows(v.candidates).map((c) => ({ platform: str(c.platform), decision: str(c.decision).toLowerCase(), reason: str(c.reason) })),
    avoid: rows(v.avoid).map((a) => ({ pattern: str(a.pattern), source: str(a.source).toLowerCase() })),
  };
  const problems = strategyProblems(draft, e);
  return problems.length ? { error: problems.join(" ") } : { value: draft };
}

// ── The fact check ──────────────────────────────────────────────────────────

const CHECK_SYSTEM = `You check a social media strategy that Moburst, a marketing agency, wrote for a brand, against the evidence it was written from.
List every number, name, result or claim in the strategy that the evidence does not support: a figure that is not in the evidence, a person, product, partner or event the evidence does not name, a result the brand or a competitor is said to have had, or a fact about the audience or the market the evidence does not give.
Plans, advice, directions such as "above today's figure", and example post hooks that state no fact are fine. Copy each statement word for word.
Answer with one JSON object and nothing else.`;

function sectionsText(sections: Record<string, unknown>): string {
  return Object.entries(sections).map(([k, v]) => `[${k}]\n${sectionLines(k, v)}`).join("\n\n");
}

/** The Messages API request that checks a strategy against its evidence. */
export function checkRequest(e: StrategyEvidence, sections: Record<string, unknown>): Record<string, unknown> {
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

/** A platform as the written strategy keeps it: its state, the code's numbers and its competitors' figures there. */
export type StoredPlatform = WrittenPlatform & { figures: PlatformFigures; competitors: CompanyFigures[] };

export interface WrittenStrategy {
  /** The product's version of every section, by section key, as fields (sections.ts). */
  sections: Record<string, unknown>;
  platforms: StoredPlatform[];
}

export interface WriteUsage {
  calls: { writer: number; checker: number };
  tokens: Record<string, { input: number; output: number }>;
}

export type StrategyCall = (args: { apiKey: string; body: Record<string, unknown> }) => Promise<{ text: string; stopReason?: string; raw?: unknown }>;

export type StrategyPhase = "write" | "reask" | "check" | "fix" | "recheck";

/** A write under way between lifecycle runs (content_strategies.pending). */
export interface PendingStrategy {
  /** The inputs the write is for; a draft for other inputs is dropped and the write starts over. */
  inputs_key: string;
  /** What the next run does. */
  phase: StrategyPhase;
  /** What the strategy is written from, read once when the write starts. */
  evidence: StrategyEvidence;
  /** The writer's conversation so far: the request and its last reply that was read. Never a cut-off reply. */
  messages: Array<{ role: string; content: string }>;
  /** What the next writer call is asked to put right (reask, fix). */
  ask?: string;
  /** The draft that passed the code checks, while it is checked against the evidence. */
  draft?: StrategyDraft;
  usage: WriteUsage;
  started_at: string;
}

/**
 * What one phase came to: another phase to run, a strategy that passed every
 * check (to store), or a write that is over (its draft is dropped; the step
 * tries again later from the start).
 */
export type PhaseOutcome =
  | { kind: "next"; pending: PendingStrategy }
  | { kind: "passed"; value: WrittenStrategy; usage: WriteUsage; evidence: StrategyEvidence; inputs_key: string }
  | { kind: "over"; error: string; usage: WriteUsage };

/** The day 90 days after a YYYY-MM-DD. */
export const goalDate = (writtenOn: string) => new Date(Date.parse(`${writtenOn}T00:00:00Z`) + GOAL_DAYS * DAY).toISOString().slice(0, 10);

/** The fields of an accepted draft, with code's numbers: each goal's figure today and its date, each worked id as the real post. */
export function assemble(d: StrategyDraft, e: StrategyEvidence): WrittenStrategy {
  const sections: Record<string, unknown> = {};
  const byKey = new Map(e.platforms.map((p) => [p.key, p]));
  const by = goalDate(e.written_on);
  sections.goals = {
    items: d.goals.map((g): Goal => {
      const p = byKey.get(platformKey(g.platform))!;
      const metric = g.metric as GoalMetric;
      return { title: g.title, why: g.why, platform: p.platform, metric, direction: g.direction as Direction, baseline: baselineFor(p.figures, metric), by };
    }),
  };
  sections.audience = { who: d.audience.who, wants: d.audience.wants, where: d.audience.where.map((w) => byKey.get(platformKey(w))?.platform ?? w) };
  sections.positioning = { statement: d.positioning.statement, points: d.positioning.points.map((p) => ({ vs: e.competitors.find((c) => c.toLowerCase() === p.vs.toLowerCase()) ?? p.vs, point: p.point })) };
  for (const p of e.pillars) {
    const x = d.pillars.find((y) => y.name === p.name)!;
    sections[pillarSectionKey(p.name)] = { purpose: x.purpose, formats: x.formats, planned_share: x.planned_share, ideas: x.ideas };
  }
  sections.avoid = { items: d.avoid.map((a) => ({ pattern: a.pattern, source: a.source as AvoidSource })) };

  const own = new Map(e.evidence.filter((x) => x.kind === "own").map((x) => [x.id, x]));
  const drafted = new Map(d.platforms.map((p) => [platformKey(p.platform), p]));
  const decision = new Map(d.candidates.map((c) => [platformKey(c.platform), c]));
  const platforms = e.platforms.map((p): StoredPlatform => {
    const chosen = p.state === "candidate" ? decision.get(p.key)! : null;
    const state: WrittenState = p.state === "candidate" ? (chosen!.decision === "new" ? "new" : "not_now") : p.state;
    if (state !== "not_now") {
      const s = drafted.get(p.key)!;
      const worked: WorkedPost[] = s.worked.map((id) => own.get(id)!).map((x) => ({
        date: x.date ?? "", multiple: x.multiple ?? 0, metric: x.metric ?? "engagement", link: x.link ?? null, text: x.text, format: x.format ?? "",
      }));
      sections[platformSectionKey(p.platform, state)] = {
        role: s.role, post: s.post, worked, ...(state === "new" ? { first_30: s.first_30 } : {}), checks: s.checks,
      };
    }
    const competitors = e.competitor_figures.filter((c) => c.platform === p.platform);
    return { ...p, state, reason: chosen?.reason ?? null, suggested: p.state === "candidate", figures: p.figures, competitors };
  });
  const notNow = platforms.filter((p) => p.state === "not_now");
  if (notNow.length) sections.not_now = { items: notNow.map((p) => ({ platform: p.platform, reason: p.reason ?? "" })) };
  return { sections, platforms };
}

/** A new write for these inputs: the first run writes. */
export function startStrategy(e: StrategyEvidence, inputsKey: string, now: Date): PendingStrategy {
  return { inputs_key: inputsKey, phase: "write", evidence: e, messages: [], usage: { calls: { writer: 0, checker: 0 }, tokens: {} }, started_at: now.toISOString() };
}

/** A reply the model stopped because it ran out of room. Whatever it holds is never read. */
const cutOff = (r: { stopReason?: string; raw?: unknown }) =>
  r.stopReason === "max_tokens" || (r.raw as { stop_reason?: unknown } | null)?.stop_reason === "max_tokens";

const CUT_OFF_ASK = "Your last answer was cut off before it ended because it ran too long. Send the whole JSON object again, keeping every field shorter.";

function fixAsk(flagged: Array<{ section: string; statement: string }>): string {
  return [
    "A check against the evidence found statements it does not support:",
    ...flagged.map((f) => `- ${f.section ? `(${f.section}) ` : ""}${f.statement}`),
    "Rewrite only what is needed so none of them remains: drop each one, or say only what the evidence says. Keep every rule above, and send the whole JSON object again.",
  ].join("\n");
}

/**
 * Run the next phase of a write: exactly one model call. Write, then reask
 * once if the reply failed the code checks or was cut off; check; fix once if
 * the check flagged statements; check again. A reply that fails where no
 * further ask is allowed ends the write.
 */
export async function strategyPhase(call: StrategyCall, apiKey: string, pending: PendingStrategy): Promise<PhaseOutcome> {
  const e = pending.evidence;
  const usage: WriteUsage = structuredClone(pending.usage);
  const count = (model: string, raw: unknown) => {
    const u = (raw as { usage?: { input_tokens?: number; output_tokens?: number } } | null)?.usage;
    const t = (usage.tokens[model] ??= { input: 0, output: 0 });
    t.input += Number(u?.input_tokens) || 0;
    t.output += Number(u?.output_tokens) || 0;
  };
  const next = (patch: Partial<PendingStrategy>): PhaseOutcome => ({ kind: "next", pending: { ...pending, ask: undefined, ...patch, usage } });
  const over = (error: string): PhaseOutcome => ({ kind: "over", error, usage });

  if (pending.phase === "write" || pending.phase === "reask" || pending.phase === "fix") {
    const base = strategyRequest(e);
    const messages = pending.phase === "write" ? (base.messages as PendingStrategy["messages"]) : [...pending.messages, { role: "user", content: pending.ask ?? "" }];
    usage.calls.writer++;
    const r = await call({ apiKey, body: { ...base, messages } });
    count(STRATEGY_MODEL, r.raw);
    const got = cutOff(r) ? { error: "The answer was cut off before it ended." } : parseStrategy(r.text, e);
    if (pending.phase === "write") {
      if (!("error" in got)) return next({ phase: "check", messages: [...messages, { role: "assistant", content: r.text }], draft: got.value });
      // A cut-off reply is not kept: the writer is asked again without it.
      return cutOff(r)
        ? next({ phase: "reask", messages, ask: CUT_OFF_ASK })
        : next({ phase: "reask", messages: [...messages, { role: "assistant", content: r.text }], ask: `That answer has these problems: ${got.error} Send the whole JSON object again with them fixed.` });
    }
    if ("error" in got) return over(`${pending.phase === "fix" ? "The fixed strategy" : "The strategy"} did not meet the rules: ${got.error}`);
    return next({ phase: pending.phase === "fix" ? "recheck" : "check", messages: [...messages, { role: "assistant", content: r.text }], draft: got.value });
  }

  if (!pending.draft) return over("The draft to check was missing.");
  const written = assemble(pending.draft, e);
  usage.calls.checker++;
  const r = await call({ apiKey, body: checkRequest(e, written.sections) });
  count(CHECK_MODEL, r.raw);
  if (cutOff(r)) return over("The check's reply was cut off before it ended.");
  const flagged = parseCheck(r.text);
  if ("error" in flagged) return over(flagged.error);
  if (!flagged.value.length) return { kind: "passed", value: written, usage, evidence: e, inputs_key: pending.inputs_key };
  if (pending.phase === "recheck") return over(`The strategy still has statements the evidence does not support: ${flagged.value.map((f) => f.statement).join(" | ").slice(0, 300)}`);
  return next({ phase: "fix", ask: fixAsk(flagged.value) });
}

/** The write under way for a client, if any. */
export async function readPending(db: Db, clientId: string): Promise<PendingStrategy | null> {
  const { data, error } = await db.from("content_strategies").select("pending").eq("client_id", clientId).maybeSingle();
  if (error) throw new Error(`Could not read the content strategy under way: ${error.message}`);
  return (data?.pending ?? null) as PendingStrategy | null;
}

/** Keep a write under way between runs, or drop it (null). The stored strategy is never touched. */
export async function savePending(db: Db, clientId: string, pending: PendingStrategy | null, now: Date): Promise<void> {
  const { error } = await db.from("content_strategies").upsert({ client_id: clientId, pending, updated_at: now.toISOString() }, { onConflict: "client_id" });
  if (error) throw new Error(`Could not keep the content strategy under way: ${error.message}`);
}

/** Save the product's version and drop the draft. People's versions live in content_strategy_edits, which this never writes. */
export async function saveStrategy(db: Db, clientId: string, out: Extract<PhaseOutcome, { kind: "passed" }>, now: Date): Promise<void> {
  const at = now.toISOString();
  const { error } = await db.from("content_strategies").upsert({
    client_id: clientId,
    shape: STRATEGY_SHAPE,
    sections: out.value.sections,
    // Each section as the lines the page shows: the text Claude reads and every save checks its version against.
    section_texts: Object.fromEntries(Object.entries(out.value.sections).map(([k, v]) => [k, sectionLines(k, v)])),
    platforms: out.value.platforms,
    pillars: out.evidence.pillars,
    sources: out.evidence.sources,
    inputs_key: out.inputs_key,
    written_at: at,
    models: { writer: STRATEGY_MODEL, checker: CHECK_MODEL },
    usage: out.usage,
    pending: null,
    updated_at: at,
  }, { onConflict: "client_id" });
  if (error) throw new Error(`Could not save the content strategy: ${error.message}`);
}

export { metricWords };
