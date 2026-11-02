// supabase/functions/_shared/design-prompts/designRefs.ts
//
// Which design references a generation actually sees.
//
// The library (clients.harvested_design_references, written by the
// lifecycle's design_refs step) is the client's reviewed designed posts per
// platform, newest first, with the posts and uploads a person kept
// (brand-references/corpus.ts). A generation for one platform sees that
// platform's posts first, then the brand's other posts, kept ones first and
// then newest first. Legacy uploads and unvetted harvests remain a fallback
// only until a library exists.

import { platformName } from "../calendar/evidence.ts";

export interface HarvestedRef {
  path: string;
  source_post_id?: string;
  platform?: string;
  posted_at?: string;
  quality_checked?: boolean;
  source_url?: string;
  /** A person kept it (an upload always counts as kept). */
  kept?: boolean;
  /** One of the client's uploaded references, not a post. */
  upload?: boolean;
}

/** One post (or upload) of the library, as the planner and the setup page read it. */
export interface LibraryEntry {
  path: string;
  /** Named the calendar's way (Instagram, LinkedIn); null for an upload. */
  platform: string | null;
  posted_at: string | null;
  kept: boolean;
  upload: boolean;
  source_url: string | null;
  source_post_id: string | null;
}

const asPaths = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];

/** A stored entry the library holds: a post that passed review, or one the library keeps. */
const inLibrary = (r: unknown): boolean => {
  const o = r && typeof r === "object" ? (r as HarvestedRef) : null;
  return !!o && typeof o.path === "string" && !!o.path && (o.quality_checked === true || o.upload === true || o.kept === true);
};

/** The stored list as entries, in stored order, each path once. */
export function libraryEntries(value: unknown): LibraryEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: LibraryEntry[] = [];
  for (const v of value) {
    const r = (typeof v === "string" ? { path: v } : v) as HarvestedRef | null;
    if (!r || typeof r.path !== "string" || !r.path || seen.has(r.path)) continue;
    seen.add(r.path);
    out.push({
      path: r.path,
      platform: r.upload ? null : platformName(r.platform) || null,
      posted_at: r.posted_at ? String(r.posted_at) : null,
      kept: r.kept === true || r.upload === true,
      upload: r.upload === true,
      source_url: r.source_url ?? null,
      source_post_id: r.source_post_id ?? null,
    });
  }
  return out;
}

/** The harvested entries as storage paths, newest first. */
export function harvestedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? { path: v } : (v as HarvestedRef)))
    .filter((v) => v && typeof v.path === "string" && v.path.length > 0)
    .sort((a, b) => String(b.posted_at || "").localeCompare(String(a.posted_at || "")))
    .map((v) => v.path);
}

const newestFirst = (a: LibraryEntry, b: LibraryEntry) => String(b.posted_at ?? "").localeCompare(String(a.posted_at ?? ""));

/**
 * The library for a post on one platform: that platform's own posts first,
 * in library order (kept, then newest); then the rest: uploads and kept
 * posts first, then newest first. No platform keeps the library's own order.
 */
export function platformFirst(entries: LibraryEntry[], platform: string | null | undefined): LibraryEntry[] {
  const name = platform ? platformName(platform) : "";
  if (!name) return entries;
  const own = entries.filter((e) => e.platform === name);
  const rest = entries.filter((e) => e.platform !== name).sort((a, b) => Number(b.kept) - Number(a.kept) || Number(b.upload) - Number(a.upload) || newestFirst(a, b));
  return [...own, ...rest];
}

/**
 * The reference list for one generation, capped, for a post on `platform`
 * (null when there is no post: a design system, a check that a path is the
 * client's own).
 *
 * `limit` is the consumer's own budget: the synthesis reads eight, an image
 * generation attaches four, a video seed three.
 */
export function referencesFor(
  manual: unknown,
  harvested: unknown,
  limit: number,
  platform: string | null,
): string[] {
  const reviewed = Array.isArray(harvested) ? harvested.filter(inLibrary) : [];
  if (reviewed.length) {
    // The library holds the uploads a person kept; an older manual campaign never fills spare slots.
    return [...new Set(platformFirst(libraryEntries(reviewed), platform).map((e) => e.path))].slice(0, Math.max(0, limit));
  }
  const chosen = asPaths(manual);
  const pulled = harvestedPaths(harvested).filter((p) => !chosen.includes(p));
  return [...new Set([...chosen, ...pulled])].slice(0, Math.max(0, limit));
}

/** How many references a client has of each kind, for the setup screen. */
export function referenceCounts(manual: unknown, harvested: unknown): { manual: number; harvested: number } {
  return { manual: asPaths(manual).length, harvested: harvestedPaths(harvested).length };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 28, 2026", from an ISO date; empty when there is none. */
export function shortDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return "";
  return `${MONTHS[Number(m[2]) - 1] ?? ""} ${Number(m[3])}, ${m[1]}`;
}

/** How the planner is told about one image: "Post 3 (LinkedIn, Oct 28, 2026, kept by the team)". */
export function postLabel(n: number, entry: LibraryEntry | null | undefined): string {
  if (!entry) return `Post ${n}`;
  if (entry.upload) return `Post ${n} (uploaded by the team)`;
  const parts = [entry.platform ?? "", shortDay(entry.posted_at), entry.kept ? "kept by the team" : ""].filter(Boolean);
  return parts.length ? `Post ${n} (${parts.join(", ")})` : `Post ${n}`;
}

/**
 * A settings row's library for one request: its paths, each with what the
 * library knows of it, the request platform's posts first. A path the
 * library no longer describes keeps its place after the others.
 */
export function planLibrary(referencePaths: string[], harvested: unknown, platform: string | null | undefined): Array<{ path: string; entry: LibraryEntry | null }> {
  const known = new Map(libraryEntries(harvested).map((e) => [e.path, e]));
  const paths = [...new Set(referencePaths.filter((p) => typeof p === "string" && p))];
  const described = platformFirst(paths.filter((p) => known.has(p)).map((p) => known.get(p)!), platform);
  return [...described.map((e) => ({ path: e.path, entry: e as LibraryEntry | null })), ...paths.filter((p) => !known.has(p)).map((p) => ({ path: p, entry: null }))];
}
