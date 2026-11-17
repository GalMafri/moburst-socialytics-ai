// supabase/functions/_shared/brand-references/corpus.ts
//
// Which of a client's posts its designs build on. The design feature turns
// to every member of the library in turn, so membership decides the look
// (plan: docs/superpowers/plans/2026-11-17-reference-library.md; the earlier
// design: docs/superpowers/specs/2026-11-02-design-refs-refresh-design.md).
// The rules:
//   1. A library has one owner. When a person has chosen 3 or more references
//      (uploads not left out, plus posts a person kept), the library is
//      exactly those: nothing is added, and everyday posts are offered as
//      suggestions. With fewer than 3, the person's picks are pinned inside
//      the automatic library.
//   2. An automatic library holds everyday posts only. A post made for an
//      occasion never enters: a holiday or season; an awareness, heritage or
//      cause day, week or month; a dated event; a named person; a giveaway,
//      contest, game or puzzle.
//   3. A post enters only on a full "everyday" answer under the current
//      review question. No answer keeps it out, and it is asked again a week
//      later. A cross-post takes its sibling's answer and counts once toward
//      the minimum of 3.
//   4. A person's choice outranks rule 2: a kept occasion post is in.
//   5. Short libraries: under 3 everyday posts in 90 days, the same check
//      reads 365 days, one part of the year per read (learnStyle.ts). With 1
//      or 2 found, the library is those; with none and no person picks, the
//      client keeps its library.
//   6. A reviewed post that is no longer the client's loses its review and
//      its place, unless a person kept it: a post of an account that is no
//      longer one of the client's active accounts, or one the read proves
//      absent (its account answered, and the read reached its day). A read
//      that comes back short proves nothing: what it did not return keeps
//      its review and its place (readVerdict).
// Inside an automatic library, as before: organic feed photos and albums of
// the assigned accounts, one frame per post (candidates.ts); per platform,
// named the calendar's way, kept posts first, then posts at or above the
// platform's median by the calendar's score newest first, then the rest
// newest first; up to 6 per platform and 16 overall, taken in turn across
// platforms, uploads first of all; a post left out never returns; posts from
// before a new look leave (kept ones stay); 4 posts on one platform before it
// gets rules of its own, and a platform the content strategy marks "not now"
// lends posts but gets none.
// Also what to review next (only what could reach the library) and when the
// look is learned again. Free of Deno and network imports so it can be tested.

import { platformName } from "../calendar/evidence.ts";
import { textHash } from "../lifecycle/names.ts";
import type { Candidate, Kind, Occasion } from "./candidates.ts";

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
/** The library rule's version, the last part of the design_refs step's key: every client's library is rebuilt once when it changes. */
export const LIBRARY_RULE = 2;
/** The review question's version, stored on each review row: a designed post answered under an older one is asked once more. */
export const REVIEW_RULE = 2;
/** The rulebook's version (design_style_synthesis.reference_pipeline_version). */
export const PIPELINE_VERSION = 3;
/** References a person must have chosen before the library is theirs alone. */
export const PERSON_MIN = MIN_REFERENCES;
/** The window read when 90 days hold too few everyday posts. */
export const THIN_WINDOW_DAYS = 365;
/** Past 90 days the year is read in parts of this many days, one part per read, so no run reads the whole year again. */
export const SLICE_DAYS = 45;
/** Cross-posts of one post are published within this many days of each other. */
export const SIBLING_DAYS = 3;
/** Most suggestions and most occasion posts listed for the setup card. */
export const SUGGESTIONS_MAX = 8;
export const OCCASIONS_LISTED = 16;
/** A post with no answer to the occasion question is asked again after this many days. */
export const UNANSWERED_RETRY_DAYS = 7;

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
  /** The answer to the occasion question; null or absent when there is none yet. */
  kind?: Kind | null;
  occasion?: Occasion | null;
  /** What showed the occasion: caption words, image lettering or a visible motif. */
  evidence?: string | null;
  /** The caption's key (captionHash), which ties cross-posts of one post together. */
  caption_hash?: string | null;
  /** The version of the review question the row answered; a missing one reads as 1. */
  rule?: number;
  /** The Sprout profile the post was published on; absent on a row from before it was stored. */
  profile_id?: string | null;
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
  /** The post's multiple of its platform's median, when the social read scored it. */
  multiple?: number;
  /** What the post was made for, on an entry listed as left out for its occasion. */
  occasion?: Occasion | null;
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
  /** Each post's multiple of its platform's median, by Sprout guid (the social read's). */
  multiples?: Record<string, number>;
  /** Platforms the content strategy marks "not now": they lend posts but get no rules of their own. */
  notNow?: string[];
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
  /** Everyday posts not in a person's library, offered on the setup card. Empty for an automatic library. */
  suggestions: StoredEntry[];
  owner: "person" | "app";
  platforms: Record<string, PlatformLine>;
  /** A person's library, or at least MIN_REFERENCES different posts. */
  enough: boolean;
}

const at = (iso: string | null | undefined) => String(iso ?? "");
const newestFirst = (a: { posted_at?: string | null }, b: { posted_at?: string | null }) => at(b.posted_at).localeCompare(at(a.posted_at));
/** Posts at or above the platform's median first, newest first, then the rest, newest first. Without scores, newest first. */
const byPerformance = (multiples: Record<string, number> | undefined) => (a: { posted_at?: string | null; source_post_id?: string | null }, b: { posted_at?: string | null; source_post_id?: string | null }) => {
  const up = (x: { source_post_id?: string | null }) => ((multiples?.[String(x.source_post_id ?? "")] ?? 0) >= 1 ? 0 : 1);
  return up(a) - up(b) || newestFirst(a, b);
};
const before = (iso: string | null | undefined, since: string | null | undefined) => !!since && !!iso && at(iso).slice(0, 10) < since.slice(0, 10);

function fromReview(r: Review, c?: Candidate): StoredEntry {
  return {
    path: r.path!, platform: c?.platform || platformName(r.network), posted_at: c?.posted_at || r.posted_at, source_url: c?.source_url || r.source_url,
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

const ruleOf = (r: Review) => r.rule ?? 1;
/** A designed post answered under the current review question (whatever the answer). */
const currentDesigned = (r: Review | undefined): r is Review => !!r && r.verdict === "designed" && ruleOf(r) >= REVIEW_RULE;

/**
 * Whether a post still needs a review: never reviewed; its image could not be
 * read a week or more ago; designed under an older question; or designed with
 * no answer to the occasion question a week or more ago. A post that is not
 * designed is never asked again.
 */
function needsReview(r: Review | undefined, now: Date): boolean {
  if (!r) return true;
  const age = now.getTime() - Date.parse(r.reviewed_at);
  if (r.verdict === "unreadable") return age >= UNREADABLE_RETRY_DAYS * DAY;
  if (r.verdict !== "designed") return false;
  if (ruleOf(r) < REVIEW_RULE) return true;
  return r.kind == null && age >= UNANSWERED_RETRY_DAYS * DAY;
}

/** A caption's key: lowercase, links, @mentions, #hashtags and punctuation out, first 160 characters; null under 24 characters. */
export function captionHash(text: string | null | undefined): string | null {
  const plain = String(text ?? "").toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/g, " ")
    .replace(/[@#][\p{L}\p{N}_.]+/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().slice(0, 160);
  return plain.length >= 24 ? textHash(plain) : null;
}

export interface Sibling {
  /** The group's name: one for every cross-post of one post. */
  group: string;
  /** The group's settled answer, which every member takes. */
  kind: Kind | null;
  occasion: Occasion | null;
  /** The group's members answered both ways. */
  disagreement: boolean;
}

/**
 * Each designed review's group (cross-posts of one post) and settled answer.
 * Posts with the same caption published within SIBLING_DAYS of the first are
 * one post. The group is an occasion when any member says so, everyday when
 * any member says so and none says occasion, and unanswered otherwise.
 */
export function siblings(reviews: Review[]): Map<string, Sibling> {
  const groups: Array<{ id: string; members: Review[] }> = [];
  const byCaption = new Map<string, Review[]>();
  for (const r of reviews) {
    if (!currentDesigned(r)) continue;
    if (r.caption_hash && r.posted_at && Number.isFinite(Date.parse(r.posted_at))) byCaption.set(r.caption_hash, [...(byCaption.get(r.caption_hash) ?? []), r]);
    else groups.push({ id: r.source_post_id, members: [r] });
  }
  for (const [hash, list] of byCaption) {
    list.sort((a, b) => Date.parse(a.posted_at!) - Date.parse(b.posted_at!) || a.source_post_id.localeCompare(b.source_post_id));
    let first: Review | null = null;
    for (const r of list) {
      if (!first || Date.parse(r.posted_at!) - Date.parse(first.posted_at!) > SIBLING_DAYS * DAY) {
        first = r;
        groups.push({ id: `${hash}:${at(first.posted_at).slice(0, 10)}`, members: [] });
      }
      groups[groups.length - 1].members.push(r);
    }
  }
  const out = new Map<string, Sibling>();
  for (const g of groups) {
    const occasion = g.members.find((r) => r.kind === "occasion");
    const everyday = g.members.some((r) => r.kind === "everyday");
    const settled: Sibling = { group: g.id, kind: occasion ? "occasion" : everyday ? "everyday" : null, occasion: occasion?.occasion ?? null, disagreement: !!occasion && everyday };
    for (const r of g.members) out.set(r.source_post_id, settled);
  }
  return out;
}

/** Whether a review lets its post into an automatic library: designed, stored, answered under the current question, and everyday once its cross-posts are settled. */
const eligibleWith = (sib: Map<string, Sibling>) => (r: Review | undefined): r is Review => currentDesigned(r) && !!r.path && sib.get(r.source_post_id)?.kind === "everyday";
/** The stored images an occasion answer covers: the same image never enters through another post of it. */
const occasionPathsOf = (reviews: Review[], sib: Map<string, Sibling>) =>
  new Set(reviews.filter((r) => currentDesigned(r) && !!r.path && sib.get(r.source_post_id)?.kind === "occasion").map((r) => r.path!));
const choiceSets = (choices: Record<string, Choice>) => ({
  kept: new Set(Object.entries(choices).filter(([, c]) => c === "kept").map(([p]) => p)),
  left: new Set(Object.entries(choices).filter(([, c]) => c === "left_out").map(([p]) => p)),
});

/** What the window's posts came to, for the step's result: its designed posts by settled answer, and the cross-post groups whose members disagreed. */
export function reviewCounts(i: CorpusInput): { everyday: number; occasion: number; unanswered: number; sibling_disagreements: number } {
  const byId = new Map(i.reviews.map((r) => [r.source_post_id, r]));
  const sib = siblings(i.reviews);
  const counts = { everyday: 0, occasion: 0, unanswered: 0 };
  const disagreed = new Set<string>();
  for (const c of i.candidates) {
    const s = currentDesigned(byId.get(c.source_post_id)) ? sib.get(c.source_post_id) : undefined;
    if (!s) continue;
    counts[s.kind ?? "unanswered"]++;
    if (s.disagreement) disagreed.add(s.group);
  }
  return { ...counts, sibling_disagreements: disagreed.size };
}

/** The window's posts left out as occasion posts (not kept, not left out), newest first, at most OCCASIONS_LISTED. */
export function occasionPosts(i: CorpusInput): StoredEntry[] {
  const byId = new Map(i.reviews.map((r) => [r.source_post_id, r]));
  const sib = siblings(i.reviews);
  const { kept, left } = choiceSets(i.choices);
  const out = new Map<string, StoredEntry>();
  for (const c of i.candidates) {
    const r = byId.get(c.source_post_id);
    const s = currentDesigned(r) ? sib.get(c.source_post_id) : undefined;
    if (!r?.path || s?.kind !== "occasion" || kept.has(r.path) || left.has(r.path) || out.has(r.path) || before(c.posted_at, i.lookSince)) continue;
    out.set(r.path, { ...fromReview(r, c), occasion: s.occasion });
  }
  return [...out.values()].sort(newestFirst).slice(0, OCCASIONS_LISTED);
}

/** One of the client's active accounts: its Sprout profile and the network it is on. */
export interface ActiveProfile { id: string; network: string }

/**
 * Item 6 of the rules: the reviews to remove after a read, because their
 * posts are no longer the client's. A review goes only when the read gives
 * positive evidence of it:
 *   * its post was published on an account that is no longer one of the
 *     client's active accounts (a second account that was parked); or
 *   * its account is active, the read returned posts of that account, and
 *     the post is absent although it is no older than the oldest post the
 *     read returned (the read lists every account's posts newest first, so
 *     that is how far back it is known to have reached).
 * So an active account the read returned nothing for removes nothing, and a
 * read that stopped short removes nothing older than what it reached: a read
 * that only looks complete is never taken as proof that posts are gone. A
 * row from before the account was stored is judged by its network the same
 * way. A kept post's row stays, as does a review with no date or one dated
 * outside the window. `rows` is the read as Sprout sent it.
 */
// deno-lint-ignore no-explicit-any
export function goneReviews(reviews: Review[], rows: any[], profiles: ActiveProfile[], window: { since: Date; until: Date }, kept: Set<string>): Review[] {
  return readVerdict(reviews, rows, profiles, window, kept).gone;
}

/**
 * What one read says about the reviewed posts dated inside its window that it
 * did not return: `gone` are the ones it proves are no longer the client's
 * (goneReviews); `unproven` are the designed ones it proves nothing about
 * (their account is active and returned nothing, or they are older than the
 * read reached, or a person kept them). The unproven ones keep their place:
 * the library is picked with them, as carried posts, so a read that came back
 * short neither removes a review nor empties a library. A read that was cut
 * at its cap (`cut`) proves nothing: none is gone.
 */
// deno-lint-ignore no-explicit-any
export function readVerdict(reviews: Review[], rows: any[], profiles: ActiveProfile[], window: { since: Date; until: Date }, kept: Set<string>, cut = false): { gone: Review[]; unproven: Candidate[] } {
  const active = new Map(profiles.map((p) => [String(p.id), platformName(p.network)]));
  const activePlatforms = new Set([...active.values()].filter(Boolean));
  const returned = new Set<string>();
  // The accounts and platforms the read returned posts for, and the oldest post it returned.
  const answered = new Set<string>();
  let reach = Infinity;
  for (const p of rows) {
    const id = String(p?.customer_profile_id ?? p?.dimensions?.customer_profile_id ?? "");
    if (!active.has(id)) continue;
    returned.add(String(p.guid ?? ""));
    answered.add(`account:${id}`);
    if (active.get(id)) answered.add(`platform:${active.get(id)}`);
    const t = Date.parse(String(p.created_time ?? ""));
    if (Number.isFinite(t)) reach = Math.min(reach, t);
  }
  const absent = reviews.filter((r) => {
    const posted = r.posted_at ? Date.parse(r.posted_at) : NaN;
    return Number.isFinite(posted) && posted >= window.since.getTime() && posted <= window.until.getTime() && !returned.has(r.source_post_id);
  });
  const gone = cut ? [] : absent.filter((r) => {
    if (r.path && kept.has(r.path)) return false;
    const platform = platformName(r.network);
    // Published on an account that is no longer the client's.
    if (r.profile_id ? !active.has(r.profile_id) : !!platform && !activePlatforms.has(platform)) return true;
    // Its account answered, and the post is absent inside the days the read reached.
    return answered.has(r.profile_id ? `account:${r.profile_id}` : `platform:${platform}`) && Date.parse(r.posted_at!) >= reach;
  });
  const removed = new Set(gone.map((r) => r.source_post_id));
  return { gone, unproven: asCarried(absent.filter((r) => !removed.has(r.source_post_id))) };
}

/** Designed posts known from their stored reviews, as the library's selection reads posts: each marked `carried`, newest first. */
function asCarried(reviews: Review[]): Candidate[] {
  return reviews
    .filter((r) => r.verdict === "designed" && !!r.path && !!r.posted_at)
    .map((r): Candidate => ({
      source_post_id: r.source_post_id, source_url: r.source_url ?? "", profile_id: r.profile_id ?? "", network: r.network, platform: platformName(r.network),
      posted_at: r.posted_at!, image_url: "", text: "", carried: true,
    }))
    .sort((a, b) => b.posted_at.localeCompare(a.posted_at));
}

/**
 * The designed posts a check already read and reviewed on an earlier run,
 * from the first of those days on, as the library's selection needs them:
 * known from their stored reviews, so the days they were published on are not
 * read again. Each is marked `carried` and is never sent to the reviewer.
 */
export function carriedCandidates(reviews: Review[], fromDay: string): Candidate[] {
  return asCarried(reviews.filter((r) => !!r.posted_at && at(r.posted_at).slice(0, 10) >= fromDay));
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
 * The posts to review now: never reviewed, unreadable or unanswered a week
 * ago, or designed under an older question; and only as many per platform as
 * it still needs to reach PER_PLATFORM everyday posts, taken in turn across
 * platforms, at most `batch`. An occasion post or one with no answer takes no
 * slot, so the queue reaches older posts.
 */
export function reviewQueue(i: CorpusInput, batch = REVIEW_BATCH): Candidate[] {
  const byId = new Map(i.reviews.map((r) => [r.source_post_id, r]));
  const { kept, left } = choiceSets(i.choices);
  const sib = siblings(i.reviews);
  const eligible = eligibleWith(sib);
  const occasionPaths = occasionPathsOf(i.reviews, sib);
  const keptOn = new Map<string, number>();
  for (const r of i.reviews) {
    if (r.verdict === "designed" && r.path && kept.has(r.path)) keptOn.set(platformName(r.network), (keptOn.get(platformName(r.network)) ?? 0) + 1);
  }
  const usable = i.candidates.filter((c) => !before(c.posted_at, i.lookSince));
  const queues = platformOrder(usable).map((platform) => {
    let slots = PER_PLATFORM - (keptOn.get(platform) ?? 0);
    const out: Candidate[] = [];
    for (const c of usable.filter((x) => x.platform === platform).sort(byPerformance(i.multiples))) {
      if (slots <= 0) break;
      const r = byId.get(c.source_post_id);
      // A post known only from its stored review (read on an earlier run of this check) is never asked again here.
      if (!c.carried && needsReview(r, i.now)) {
        out.push(c);
        slots--;
      } else if (eligible(r) && !occasionPaths.has(r.path!) && !left.has(r.path!) && !kept.has(r.path!)) {
        slots--;
      }
    }
    return out;
  });
  return inTurn(queues).slice(0, Math.max(0, batch));
}

/** The library this check writes, whose it is, each platform's line, and whether there is enough to learn from. */
export function selectLibrary(i: CorpusInput): Selection {
  const { kept, left } = choiceSets(i.choices);
  const byId = new Map(i.reviews.map((r) => [r.source_post_id, r]));
  const previous = previousPosts(i.previous);
  const sib = siblings(i.reviews);
  const eligible = eligibleWith(sib);
  const occasionPaths = occasionPathsOf(i.reviews, sib);
  const scored = (e: StoredEntry): StoredEntry => {
    const m = i.multiples?.[String(e.source_post_id ?? "")];
    return typeof m === "number" ? { ...e, multiple: m } : e;
  };
  const designedAt = (c: Candidate): Review | undefined => {
    const r = byId.get(c.source_post_id);
    return r?.verdict === "designed" && r.path ? r : undefined;
  };

  // What a person chose: uploads not left out, and kept posts, whatever they were made for (rule 4).
  const uploaded = new Set(i.uploads.filter((u) => typeof u === "string" && !!u));
  const uploads: StoredEntry[] = [...uploaded].filter((u) => !left.has(u)).map((path) => ({ path, upload: true, kept: true }));
  const keptPosts: StoredEntry[] = [];
  for (const path of kept) {
    if (uploaded.has(path)) continue;
    const c = i.candidates.find((x) => designedAt(x)?.path === path);
    const r = c ? designedAt(c) : i.reviews.find((x) => x.path === path && x.verdict === "designed");
    const e = r ? fromReview(r, c) : previous.find((x) => x.path === path);
    if (e) keptPosts.push(scored({ ...e, kept: true }));
  }
  keptPosts.sort(newestFirst);
  const chosen = [...uploads, ...keptPosts];
  const owner: Selection["owner"] = chosen.length >= PERSON_MIN ? "person" : "app";

  // The window's everyday posts (rules 2 and 3): the ones an automatic library may hold.
  const everyday: StoredEntry[] = [];
  const pooled = new Set<string>();
  for (const c of i.candidates) {
    const r = designedAt(c);
    if (!eligible(r) || occasionPaths.has(r.path!) || left.has(r.path!) || kept.has(r.path!) || pooled.has(r.path!) || !c.platform) continue;
    pooled.add(r.path!);
    everyday.push(scored(fromReview(r, c)));
  }
  const pool = everyday.filter((e) => !before(e.posted_at, i.lookSince));
  const perPlatform = (entries: StoredEntry[]) => {
    const lists = new Map<string, StoredEntry[]>();
    for (const platform of platformOrder(entries)) {
      const mine = entries.filter((e) => e.platform === platform);
      lists.set(platform, [...mine.filter((e) => e.kept).sort(newestFirst), ...mine.filter((e) => !e.kept).sort(byPerformance(i.multiples))].slice(0, PER_PLATFORM));
    }
    return lists;
  };

  const notNow = new Set((i.notNow ?? []).map((p) => platformName(p)));
  const platforms: Record<string, PlatformLine> = {};
  const line = (platform: string, posts: StoredEntry[]) => {
    platforms[platform] = { posts: posts.length, newest: posts.map((e) => at(e.posted_at)).sort().pop() || null, own_rules: posts.length >= PLATFORM_RULES_MIN && !notNow.has(platform) };
  };
  const emptyLines = () => {
    for (const raw of i.profilePlatforms ?? []) {
      const p = platformName(raw);
      if (p && !platforms[p]) platforms[p] = { posts: 0, newest: null, own_rules: false };
    }
  };

  if (owner === "person") {
    // Rule 1: the library is exactly what the person chose; the everyday posts are offered, never added.
    const library = chosen.slice(0, LIBRARY_MAX);
    for (const platform of platformOrder(library)) line(platform, library.filter((e) => !e.upload && e.platform === platform));
    emptyLines();
    return { library, suggestions: inTurn([...perPlatform(pool).values()]).slice(0, SUGGESTIONS_MAX), owner, platforms, enough: true };
  }

  // An automatic library: the person's picks pinned, then each platform's everyday posts in turn.
  const lists = perPlatform([...keptPosts.filter((e) => !!e.platform), ...pool]);
  const library: StoredEntry[] = [];
  const taken = new Set<string>();
  for (const e of [...uploads, ...keptPosts.filter((e) => !e.platform), ...inTurn([...lists.values()])]) {
    if (library.length >= LIBRARY_MAX) break;
    if (taken.has(e.path)) continue;
    taken.add(e.path);
    library.push(e);
  }
  // Age alone never leaves it short: the newest everyday posts that left (by age or before a new look) stay until replaced.
  if (library.length < MIN_REFERENCES) {
    const reviewOf = (e: StoredEntry) => (e.source_post_id ? byId.get(e.source_post_id) : undefined) ?? i.reviews.find((r) => r.path === e.path && eligible(r));
    const fill = [...previous, ...everyday].filter((e) => !left.has(e.path) && !taken.has(e.path) && !occasionPaths.has(e.path) && eligible(reviewOf(e))).sort(newestFirst);
    for (const e of fill) {
      if (library.length >= MIN_REFERENCES) break;
      if (taken.has(e.path)) continue;
      taken.add(e.path);
      library.push(e);
    }
  }

  for (const [platform, list] of lists) line(platform, list);
  emptyLines();
  // Cross-posts of one post count once (rule 3); an upload, or a post the reviews do not know, counts by its file.
  const different = new Set(library.map((e) => (e.upload || !e.source_post_id ? `file:${e.path}` : `post:${sib.get(e.source_post_id)?.group ?? e.source_post_id}`)));
  return { library, suggestions: [], owner, platforms, enough: different.size >= MIN_REFERENCES };
}

/**
 * Whether a stored library is one the reference rules wrote, and so never the
 * older harvest's to merge into, reorder or trim (competitive/refreshFeed.ts):
 * it holds an entry a person chose (an upload, a kept post) or a reviewed
 * post, or the design_refs step recorded whose library it is (a client that
 * keeps its library under rule 5 can hold entries with none of those marks).
 */
export function rulesLibrary(library: unknown, refsResult?: unknown): boolean {
  const owner = refsResult && typeof refsResult === "object" ? (refsResult as Record<string, unknown>).owner : null;
  if (owner === "person" || owner === "app") return true;
  return Array.isArray(library) && library.some((e) => !!e && typeof e === "object" && (e.upload === true || e.kept === true || e.quality_checked === true));
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
  if (!s || s.reference_pipeline_version !== PIPELINE_VERSION) return "first";
  if (s.choices_key !== key) return "choices";
  const learnedPlatforms = Object.keys((s.platforms as Record<string, unknown> | undefined) ?? {}).sort().join(",");
  if (qualifiedPlatforms(sel).join(",") !== learnedPlatforms) return "platforms";
  const learned = new Set((Array.isArray(s.source_posts) ? s.source_posts : []).map((p: { path?: unknown }) => String(p?.path ?? "")));
  const now = new Set(sel.library.map((e) => e.path));
  const added = [...now].filter((p) => !learned.has(p)).length;
  const removed = [...learned].filter((p) => !now.has(p)).length;
  return Math.max(added, removed) >= RELEARN_CHANGES ? "posts" : null;
}
