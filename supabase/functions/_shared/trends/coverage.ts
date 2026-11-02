// The coverage rewrite (spec, "How we'll know it works"): every client should
// keep at least 5 posts per platform per week. A platform under that in each
// of its last two finished weeks gets its searches rewritten from the trend
// profile by Claude (Sonnet), one request per platform, before that week's
// scrape. It is the one measure that acts on its own; the others are read
// with trend_measures() (20261108100000_trend_measures.sql).
//
// A rewrite takes the place of the profile's own terms on that platform: what
// a person added is still searched first, and what a person removed is never
// searched (ruled 2 Nov 2026). A profile written again clears every rewrite
// (writeTrendProfile), since each was made from the old profile.

import { parseAnswer } from "../pipelines/competitive/analysis.ts";
import type { FilterProfile } from "./filter.ts";
import { namesBrand, tagNamesBrand } from "./profile.ts";
import { MAX_SEARCHES } from "./sources.ts";
import { clip } from "./text.ts";
import type { Term, TrendPlatform } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const TREND_REWRITE_MODEL = "claude-sonnet-5-5";
/** Fewer kept posts than this on a platform in a week is a coverage gap. */
export const COVERAGE_FLOOR = 5;
const MAX_TOKENS = 1000;
const SEARCH_CHARS = 80;

/** What a week stored for one platform (trend_weeks.platforms). */
export interface PlatformTally {
  status?: string;
  kept?: number;
  /** The week ran on searches the coverage rewrite gave it that week. */
  rewritten?: boolean;
}

export interface CoverageWeek {
  week_start: string;
  status: string;
  filter_status?: string | null;
  platforms?: Record<string, PlatformTally | undefined> | null;
}

/** A platform whose answer came back, or that had nothing to search: its kept count says how well its searches did. */
const JUDGED = ["ok", "empty", "no_searches"];

const lastTwo = (weeks: CoverageWeek[]): CoverageWeek[] =>
  weeks.filter((w) => w.status === "done" || w.status === "partial").sort((a, b) => b.week_start.localeCompare(a.week_start)).slice(0, 2);

/**
 * True when the platform was watched and kept fewer than COVERAGE_FLOOR posts
 * in each of the last two finished weeks. A week whose source failed or whose
 * filter failed says nothing about the searches (a failing source is
 * developer work), so it is never short. Nor is a pair whose newer week
 * rewrote the searches: the older one ran on the searches that were replaced.
 */
export function coverageShort(weeks: CoverageWeek[], platform: TrendPlatform): boolean {
  const two = lastTwo(weeks);
  if (two.length < 2 || two[0].platforms?.[platform]?.rewritten) return false;
  return two.every((w) => {
    const p = w.platforms?.[platform];
    return w.filter_status !== "failed" && !!p && JUDGED.includes(String(p.status)) && (Number(p.kept) || 0) < COVERAGE_FLOOR;
  });
}

/** What the platform kept in the last two finished weeks, newest first. */
export function lastKept(weeks: CoverageWeek[], platform: TrendPlatform): number[] {
  return lastTwo(weeks).map((w) => Number(w.platforms?.[platform]?.kept) || 0);
}

/**
 * The client's last two finished weeks before the week starting `before`
 * that ran on its current profile (written at `since`), newest first. Weeks
 * on an older profile searched for other terms.
 */
export async function finishedWeeks(db: Db, clientId: string, o: { before: string; since: string }): Promise<CoverageWeek[]> {
  let q = db.from("trend_weeks").select("week_start, status, filter_status, platforms").eq("client_id", clientId)
    .in("status", ["done", "partial"]).lt("week_start", o.before);
  if (o.since) q = q.gt("created_at", o.since);
  const { data, error } = await q.order("week_start", { ascending: false }).limit(2);
  if (error) throw new Error(`Could not read the client's earlier weeks: ${error.message}`);
  return (data ?? []) as CoverageWeek[];
}

/** What a person removed, lowercase, as the platforms search it: topics on all but Instagram, Instagram's hashtags there. */
export interface Removed {
  topics: string[];
  instagram: string[];
}

export async function removedSearches(db: Db, clientId: string): Promise<Removed> {
  const { data, error } = await db.from("trend_terms").select("kind, platform, term").eq("client_id", clientId).not("removed_at", "is", null);
  if (error) throw new Error(`Could not read what a person removed: ${error.message}`);
  const out: Removed = { topics: [], instagram: [] };
  for (const r of (data ?? []) as Array<{ kind: string; platform: string | null; term: string }>) {
    const term = String(r.term ?? "").trim().toLowerCase();
    if (!term) continue;
    if (r.kind === "topic") out.topics.push(term);
    else if (r.kind === "hashtag" && r.platform === "instagram") out.instagram.push(term);
  }
  return out;
}

export const removedFor = (platform: string, removed: Removed): string[] => (platform === "instagram" ? removed.instagram : removed.topics);

/** The stored rewrites without any search a person has removed since. */
export function withoutRemoved(overrides: Record<string, string[]>, removed: Removed): Record<string, string[]> {
  return Object.fromEntries(Object.entries(overrides ?? {}).map(([platform, list]) => {
    const gone = new Set(removedFor(platform, removed));
    return [platform, (Array.isArray(list) ? list : []).filter((s) => typeof s === "string" && !gone.has(s.trim().toLowerCase()))];
  }));
}

/** The profile as the rewrite reads it: the filter's, with the client's languages, market and exclusions. */
export interface RewriteProfile extends FilterProfile {
  languages?: string[];
  region?: string;
  exclusions?: Term[];
}

const PLATFORM_NAMES: Record<TrendPlatform, string> = {
  tiktok: "TikTok", instagram: "Instagram", linkedin: "LinkedIn", youtube: "YouTube", pinterest: "Pinterest", facebook: "Facebook",
};

const REWRITE_SYSTEM = `You write the searches that find a brand's industry trends on one social platform. Moburst, a marketing agency, manages the brand's social media, and the team learns from the posts these searches find.
This platform's searches found too few posts worth learning from in each of the last two weeks. Write new searches from the brand's trend profile: the words people on this platform use in posts about the brand's industry, broad enough to find new posts every week, in the language the brand's audience posts in. Never the brand's own name or a competitor's, and never anything the brand doesn't want.
Answer with one JSON object and nothing else.`;

const postsWord = (n: number) => `${n} post${n === 1 ? "" : "s"}`;

/**
 * The Messages API request that rewrites one platform's searches. keep: the
 * searches a person added, which stay first, so the answer fills the places
 * left; avoid: what a person removed.
 */
export function rewriteRequest(profile: RewriteProfile, platform: TrendPlatform, lastSearches: string[], keptCounts: number[], o: { keep?: string[]; avoid?: string[] } = {}): Record<string, unknown> {
  const name = PLATFORM_NAMES[platform];
  const keep = o.keep ?? [];
  const places = Math.max(1, MAX_SEARCHES - keep.length);
  const instagram = platform === "instagram";
  const content = [
    `The platform: ${name}. ${instagram ? "Instagram is searched by hashtag: every search is one #tag, with no spaces." : `${name} is searched by keyword: every search is a short phrase.`}`,
    `Who the brand speaks to: ${clip(profile.audience, 1000)}`,
    `What fits: ${clip(profile.fit_rubric, 1000)}`,
    `Topics the brand tracks: ${profile.topics.map((t) => t.term).join(", ") || "none"}`,
    ...(profile.brand ? [`The brand: ${profile.brand}${profile.competitors?.length ? `. Its direct competitors: ${profile.competitors.join(", ")}` : ""}. Never search for them.`] : []),
    `The brand's audience posts in: ${(profile.languages ?? []).join(", ") || "en"}${profile.region ? `. Its market: ${profile.region}` : ""}.`,
    `The brand never wants posts like these: ${(profile.exclusions ?? []).map((x) => x.term).join("; ") || "none listed"}`,
    ...(o.avoid?.length ? [`A person on the team removed these; never search for them: ${o.avoid.join(", ")}`] : []),
    `\nThe searches that came up short: ${lastSearches.join(", ") || "none (the platform had nothing to search)"}`,
    `Posts kept from them, newest week first: ${keptCounts.map(postsWord).join(", then ") || "none"}.`,
    ...(keep.length ? [`A person on the team added these; they stay and are searched first, so don't repeat them: ${keep.join(", ")}`] : []),
    `\nAnswer with 1 to ${places} searches, best first, in this shape:\n{"searches": [${instagram ? `"#...", "#..."` : `"...", "..."`}]}`,
  ].join("\n");
  return { model: TREND_REWRITE_MODEL, max_tokens: MAX_TOKENS, system: REWRITE_SYSTEM, messages: [{ role: "user", content }] };
}

/** What a rewrite answer is checked against. */
export interface RewriteRules {
  platform: TrendPlatform;
  brand?: string;
  competitors?: string[];
  /** The searches that came up short. */
  last?: string[];
  /** A person's searches, which stay first. */
  keep?: string[];
  /** What a person removed. */
  avoid?: string[];
}

const lower = (s: string) => s.trim().toLowerCase();

/** The new searches in an answer, each once and without a person's own, or what is wrong with them. */
export function parseRewrite(text: string, o: RewriteRules): { value: string[] } | { error: string } {
  const parsed = parseAnswer(text);
  if ("error" in parsed) return parsed;
  const list = parsed.value?.searches;
  if (!Array.isArray(list)) return { error: "The answer has no searches list." };
  const instagram = o.platform === "instagram";
  const keep = new Set((o.keep ?? []).map(lower));
  const avoid = new Set((o.avoid ?? []).map(lower));
  const places = MAX_SEARCHES - keep.size;
  const names = (s: string, who: string) => (instagram ? tagNamesBrand(s, who) : namesBrand(s, who));
  const problems: string[] = [];
  const seen = new Set<string>();
  const value: string[] = [];
  for (const raw of list) {
    let s = typeof raw === "string" ? raw.trim() : "";
    if (!s) {
      problems.push("Every search must be text.");
      continue;
    }
    if (instagram && !s.startsWith("#")) s = `#${s}`;
    const key = s.toLowerCase();
    if (seen.has(key) || keep.has(key)) continue;
    seen.add(key);
    const competitor = (o.competitors ?? []).find((c) => names(s, c));
    if (s.length > SEARCH_CHARS) problems.push(`"${clip(s, 40)}" is longer than a search.`);
    else if (instagram && !/^#[\p{L}0-9_]+$/u.test(s)) problems.push(`The Instagram search "${s}" must be one #tag with no spaces.`);
    else if (o.brand && names(s, o.brand)) problems.push(`"${s}" searches for the brand's own name.`);
    else if (competitor) problems.push(`"${s}" searches for the competitor ${competitor}.`);
    else if (avoid.has(key)) problems.push(`A person on the team removed "${s}"; it is never searched.`);
    value.push(s);
  }
  if (!value.length || value.length > places) problems.push(`There must be 1 to ${places} new searches; there are ${value.length}.`);
  const last = new Set((o.last ?? []).map(lower));
  if (value.length && last.size && value.every((s) => last.has(s.toLowerCase()))) problems.push("Every search was already searched in the weeks that came up short; give new ones.");
  return problems.length ? { error: problems.join(" ") } : { value };
}
