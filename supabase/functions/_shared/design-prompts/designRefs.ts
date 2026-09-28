// supabase/functions/_shared/design-prompts/designRefs.ts
//
// Which design references a generation actually sees.
//
// Reviewed social references are the current visual corpus. Legacy uploads and
// unvetted harvests remain a fallback only until automatic onboarding succeeds.

export interface HarvestedRef {
  path: string;
  source_post_id?: string;
  platform?: string;
  posted_at?: string;
  quality_checked?: boolean;
  source_url?: string;
}

const asPaths = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];

/** The harvested entries as storage paths, newest first. */
export function harvestedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? { path: v } : (v as HarvestedRef)))
    .filter((v) => v && typeof v.path === "string" && v.path.length > 0)
    .sort((a, b) => String(b.posted_at || "").localeCompare(String(a.posted_at || "")))
    .map((v) => v.path);
}

/**
 * The reference list for one generation, capped.
 *
 * `limit` is the consumer's own budget: the synthesis reads eight, an image
 * generation attaches four, a video seed three.
 */
export function referencesFor(
  manual: unknown,
  harvested: unknown,
  limit: number,
): string[] {
  const chosen = asPaths(manual);
  const pulled = harvestedPaths(harvested).filter((p) => !chosen.includes(p));
  const verified = Array.isArray(harvested) ? harvested.filter((r) => r?.quality_checked === true).map((r) => r.path) : [];
  // Do not fill spare slots with an older, contradictory manual campaign.
  return [...new Set(verified.length ? verified : [...chosen, ...pulled])].slice(0, Math.max(0, limit));
}

/** How many references a client has of each kind, for the setup screen. */
export function referenceCounts(manual: unknown, harvested: unknown): { manual: number; harvested: number } {
  return { manual: asPaths(manual).length, harvested: harvestedPaths(harvested).length };
}
