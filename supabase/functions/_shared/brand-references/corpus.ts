// supabase/functions/_shared/brand-references/corpus.ts
//
// Which of a client's posts its designs learn from (design: docs/superpowers/
// specs/2026-11-02-design-refs-refresh-design.md, "Which posts count" and
// "Minimum valid sample per platform"):
//   * the client's own organic designed posts (feed photos and albums that
//     passed review) on its assigned accounts in the last 90 days, one frame
//     per post (candidates.ts);
//   * per platform, named the calendar's way, newest first, up to 6 per
//     platform and 16 overall, taken in turn across platforms; kept posts
//     first, uploads first of all; a post left out never returns;
//   * posts from before a new look leave (kept ones stay), and age alone
//     never shrinks the library below 3: an old post leaves only when a newer
//     one replaces it;
//   * 3 designed posts across the client to learn its look, 4 on one platform
//     before that platform gets rules of its own.
// Also what to review next (only what could reach the library) and when the
// look is learned again. Free of Deno and network imports so it can be tested.

import { platformName } from "../calendar/evidence.ts";
import { textHash } from "../lifecycle/names.ts";
import type { Candidate } from "./candidates.ts";

/** Most of one platform's posts in the library. */
export const PER_PLATFORM = 6;
/** Most posts in the library (the planner is shown them all). */
export const LIBRARY_MAX = 16;
/** Fewer designed posts than this is too little to learn a reliable look from. */
export const MIN_REFERENCES = 3;
/** Posts a platform needs before the rulebook gets a section for it. */
export const PLATFORM_RULES_MIN = 4;
/** How many posts the library must change by before the look is learned again. */
export const RELEARN_CHANGES = 2;
/** Most posts reviewed in one run; the rest are reviewed a minute later. */
export const REVIEW_BATCH = 24;
/** An image that could not be read is looked at again on a later weekly check. */
export const UNREADABLE_RETRY_DAYS = 7;

const DAY = 86_400_000;

export type Choice = "kept" | "left_out";
export type Verdict = "designed" | "not_designed" | "unreadable";

/** A row of design_reference_reviews. */
export interface Review {
  source_post_id: string;
  network: string;
  posted_at: string | null;
  source_url: string | null;
  content_hash: string | null;
  verdict: Verdict;
  path: string | null;
  confidence: number | null;
  reason: string | null;
  reviewed_at: string;
}

/** A library entry as clients.harvested_design_references stores it. */
export interface StoredEntry {
  path: string;
  /** Named the calendar's way; absent on an upload. */
  platform?: string;
  posted_at?: string | null;
  source_url?: string | null;
  source_post_id?: string | null;
  source?: "sprout";
  quality_checked?: true;
  classification?: string | null;
  confidence?: number | null;
  content_hash?: string | null;
  kept?: true;
  upload?: true;
}

export interface CorpusInput {
  /** The window's designed posts, newest first (sproutCandidates). */
  candidates: Candidate[];
  reviews: Review[];
  /** A person's choices, by storage path. */
  choices: Record<string, Choice>;
  /** The client's uploaded references (clients.design_references): kept unless left out. */
  uploads: string[];
  /** The library before this check (clients.harvested_design_references). */
  previous: unknown;
  /** The day the newest look began: posts before it leave, kept ones stay. */
  lookSince?: string | null;
  /** The platforms of the client's assigned accounts, so a platform with no designed posts is still listed. */
  profilePlatforms?: string[];
  now: Date;
}

export interface PlatformLine {
  /** Its designed posts, at most PER_PLATFORM. */
  posts: number;
  newest: string | null;
  /** Enough posts for rules of its own. */
  own_rules: boolean;
}

export interface Selection {
  library: StoredEntry[];
  platforms: Record<string, PlatformLine>;
  /** At least MIN_REFERENCES to learn the look from. */
  enough: boolean;
}

const at = (iso: string | null | undefined) => String(iso ?? "");
const newestFirst = (a: { posted_at?: string | null }, b: { posted_at?: string | null }) => at(b.posted_at).localeCompare(at(a.posted_at));
const before = (iso: string | null | undefined, since: string | null | undefined) => !!since && !!iso && at(iso).slice(0, 10) < since.slice(0, 10);

function fromReview(r: Review, c?: Candidate): StoredEntry {
  return {
    path: r.path!, platform: c?.platform || platformName(r.network), posted_at: c?.posted_at ?? r.posted_at, source_url: c?.source_url ?? r.source_url,
    source_post_id: r.source_post_id, source: "sprout", quality_checked: true, classification: r.reason, confidence: r.confidence, content_hash: r.content_hash,
  };
}

/** The stored library's posts (not its uploads) as entries, with each platform named the calendar's way. */
function previousPosts(previous: unknown): StoredEntry[] {
  if (!Array.isArray(previous)) return [];
  return previous.flatMap((v): StoredEntry[] => {
    const r = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    if (!r || typeof r.path !== "string" || !r.path || r.upload === true) return [];
    return [{
      path: r.path, platform: platformName(r.platform as string) || undefined, posted_at: (r.posted_at as string) ?? null, source_url: (r.source_url as string) ?? null,
      source_post_id: (r.source_post_id as string) ?? null, source: "sprout", quality_checked: true,
      classification: (r.classification as string) ?? null, confidence: typeof r.confidence === "number" ? r.confidence : null, content_hash: (r.content_hash as string) ?? null,
    }];
  });
}

/** Whether a post still needs a review: never reviewed, or its image could not be read a week or more ago. */
function needsReview(r: Review | undefined, now: Date): boolean {
  if (!r) return true;
  return r.verdict === "unreadable" && now.getTime() - Date.parse(r.reviewed_at) >= UNREADABLE_RETRY_DAYS * DAY;
}

/** Lists taken in turn, first of each, then second of each, ... */
function inTurn<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/** Platforms in the order their newest post came, the first to appear first on a tie. */
function platformOrder<T extends { platform?: string; posted_at?: string | null }>(items: T[]): string[] {
  const newest = new Map<string, string>();
  const first: string[] = [];
  for (const x of items) {
    const p = x.platform ?? "";
    if (!p) continue;
    if (!newest.has(p)) first.push(p);
    if (at(x.posted_at) > (newest.get(p) ?? "")) newest.set(p, at(x.posted_at));
  }
  return first.map((p, i) => ({ p, i })).sort((a, b) => (newest.get(b.p) ?? "").localeCompare(newest.get(a.p) ?? "") || a.i - b.i).map((x) => x.p);
}

/**
 * The posts to review now: never reviewed (or unreadable a week ago), and
 * only as many per platform as it still needs to reach PER_PLATFORM, newest
 * first, taken in turn across platforms, at most `batch`.
 */
export function reviewQueue(i: CorpusInput, batch = REVIEW_BATCH): Candidate[] {
  const byId = new Map(i.reviews.map((r) => [r.source_post_id, r]));
  const kept = new Set(Object.entries(i.choices).filter(([, c]) => c === "kept").map(([p]) => p));
  const left = new Set(Object.entries(i.choices).filter(([, c]) => c === "left_out").map(([p]) => p));
  const keptOn = new Map<string, number>();
  for (const r of i.reviews) {
    if (r.verdict === "designed" && r.path && kept.has(r.path)) keptOn.set(platformName(r.network), (keptOn.get(platformName(r.network)) ?? 0) + 1);
  }
  const usable = i.candidates.filter((c) => !before(c.posted_at, i.lookSince));
  const queues = platformOrder(usable).map((platform) => {
    let slots = PER_PLATFORM - (keptOn.get(platform) ?? 0);
    const out: Candidate[] = [];
    for (const c of usable.filter((x) => x.platform === platform)) {
      if (slots <= 0) break;
      const r = byId.get(c.source_post_id);
      if (needsReview(r, i.now)) {
        out.push(c);
        slots--;
      } else if (r!.verdict === "designed" && r!.path && !left.has(r!.path) && !kept.has(r!.path)) {
        slots--;
      }
    }
    return out;
  });
  return inTurn(queues).slice(0, Math.max(0, batch));
}

/** The library this check writes, each platform's line, and whether there is enough to learn from. */
export function selectLibrary(i: CorpusInput): Selection {
  const left = new Set(Object.entries(i.choices).filter(([, c]) => c === "left_out").map(([p]) => p));
  const kept = new Set(Object.entries(i.choices).filter(([, c]) => c === "kept").map(([p]) => p));
  const byId = new Map(i.reviews.map((r) => [r.source_post_id, r]));
  const previous = previousPosts(i.previous);

  // The window's designed posts, then kept posts from before it.
  const pool = new Map<string, StoredEntry>();
  for (const c of i.candidates) {
    const r = byId.get(c.source_post_id);
    if (r?.verdict === "designed" && r.path && !pool.has(r.path)) pool.set(r.path, fromReview(r, c));
  }
  for (const path of kept) {
    if (pool.has(path)) continue;
    const r = i.reviews.find((x) => x.path === path && x.verdict === "designed");
    const p = previous.find((x) => x.path === path);
    if (r) pool.set(path, fromReview(r));
    else if (p) pool.set(path, p);
  }
  const posts = [...pool.values()].filter((e) => !left.has(e.path) && !!e.platform);
  for (const e of posts) if (kept.has(e.path)) e.kept = true;
  const current = posts.filter((e) => e.kept || !before(e.posted_at, i.lookSince));

  const lists = new Map<string, StoredEntry[]>();
  for (const platform of platformOrder(current)) {
    const mine = current.filter((e) => e.platform === platform);
    lists.set(platform, [...mine.filter((e) => e.kept).sort(newestFirst), ...mine.filter((e) => !e.kept).sort(newestFirst)].slice(0, PER_PLATFORM));
  }

  const uploads: StoredEntry[] = [...new Set(i.uploads.filter((u) => typeof u === "string" && u && !left.has(u)))].map((path) => ({ path, upload: true, kept: true }));
  const library: StoredEntry[] = [];
  const taken = new Set<string>();
  for (const e of [...uploads, ...inTurn([...lists.values()])]) {
    if (library.length >= LIBRARY_MAX) break;
    if (taken.has(e.path)) continue;
    taken.add(e.path);
    library.push(e);
  }
  // Age alone never leaves it short: the newest posts that left (by age or before a new look) stay until replaced.
  if (library.length < MIN_REFERENCES) {
    const fill = [...previous, ...posts].filter((e) => !left.has(e.path) && !taken.has(e.path)).sort(newestFirst);
    for (const e of fill) {
      if (library.length >= MIN_REFERENCES) break;
      if (taken.has(e.path)) continue;
      taken.add(e.path);
      library.push(e);
    }
  }

  const platforms: Record<string, PlatformLine> = {};
  for (const [platform, list] of lists) {
    platforms[platform] = { posts: list.length, newest: list.map((e) => at(e.posted_at)).sort().pop() || null, own_rules: list.length >= PLATFORM_RULES_MIN };
  }
  for (const raw of i.profilePlatforms ?? []) {
    const p = platformName(raw);
    if (p && !platforms[p]) platforms[p] = { posts: 0, newest: null, own_rules: false };
  }
  return { library, platforms, enough: library.length >= MIN_REFERENCES };
}

/** The platforms that get rules of their own, in a stable order. */
export function qualifiedPlatforms(sel: Pick<Selection, "platforms">): string[] {
  return Object.entries(sel.platforms).filter(([, l]) => l.own_rules).map(([p]) => p).sort();
}

/** A key for what people chose and uploaded, so a change in either is seen. */
export function choicesKey(choices: Record<string, Choice>, uploads: string[]): string {
  const lines = [...Object.entries(choices).map(([p, c]) => `${c}:${p}`), ...uploads.map((u) => `upload:${u}`)].sort();
  return textHash(lines.join("\n"));
}

/**
 * Why the look is learned again now, or null when it is not: the first check
 * after this change, a person's choice or upload, a platform reaching (or
 * losing) its minimum, or the library changing by RELEARN_CHANGES posts.
 */
export function relearnReason(sel: Selection, synthesis: unknown, key: string): "first" | "choices" | "platforms" | "posts" | null {
  const s = synthesis && typeof synthesis === "object" ? (synthesis as Record<string, unknown>) : null;
  if (!s || s.reference_pipeline_version !== 2) return "first";
  if (s.choices_key !== key) return "choices";
  const learnedPlatforms = Object.keys((s.platforms as Record<string, unknown> | undefined) ?? {}).sort().join(",");
  if (qualifiedPlatforms(sel).join(",") !== learnedPlatforms) return "platforms";
  const learned = new Set((Array.isArray(s.source_posts) ? s.source_posts : []).map((p: { path?: unknown }) => String(p?.path ?? "")));
  const now = new Set(sel.library.map((e) => e.path));
  const added = [...now].filter((p) => !learned.has(p)).length;
  const removed = [...learned].filter((p) => !now.has(p)).length;
  return Math.max(added, removed) >= RELEARN_CHANGES ? "posts" : null;
}
