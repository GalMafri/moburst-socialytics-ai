// supabase/functions/_shared/design-prompts/designRefs.ts
//
// Which design references a generation actually sees.
//
// There are two pools. `design_references` is what staff uploaded: chosen,
// few, and authoritative. `harvested_design_references` is what the app
// pulled from the client's own published posts, weekly: plentiful, current,
// and unvetted. They are kept in separate columns because the setup page
// writes the first one wholesale — appending a harvest to it would be
// erased by the next edit, and would erase the uploads on the next harvest.
//
// A generation wants the chosen ones first and the harvested ones to fill
// the rest of the budget, so the brand's own eye leads and the recent work
// keeps it current.

export interface HarvestedRef {
  path: string;
  source_post_id?: string;
  platform?: string;
  posted_at?: string;
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
  return [...chosen, ...pulled].slice(0, Math.max(0, limit));
}

/** How many references a client has of each kind, for the setup screen. */
export function referenceCounts(manual: unknown, harvested: unknown): { manual: number; harvested: number } {
  return { manual: asPaths(manual).length, harvested: harvestedPaths(harvested).length };
}
