// supabase/functions/_shared/lifecycle/agencyZone.ts
//
// The agency's time zone (spec: docs/superpowers/specs/2026-11-08-onboarding-
// profile-pages-and-no-n8n-design.md, section E): for a client no source
// places, the zone most of the agency's clients have from a real source.
// Worked out from the clients each time, never written into code: on 8 Nov
// 2026 the 11 clients with a sourced zone were all on America/New_York.
//
// A zone counts only when it came from somewhere: field_sources.timezone has
// a source (`from`) or a writer (`by`). UTC never counts (it is the column's
// default, not a place), and neither does a zone this default gave another
// client, so the default never feeds itself. Free of Deno and network
// imports so it can be tested.

// deno-lint-ignore no-explicit-any
type Db = any;

/** The source recorded for a zone the agency default gave (location.ts SOURCE_RANK.agency). */
export const AGENCY_SOURCE = "agency";

/** True when the client's time zone came from somewhere: field_sources.timezone has a `from` or a `by`. */
export function zoneHasSource(fieldSources: unknown): boolean {
  const fs = fieldSources && typeof fieldSources === "object" ? (fieldSources as Record<string, unknown>) : null;
  const entry = fs?.timezone;
  if (!entry || typeof entry !== "object") return false;
  const { from, by } = entry as { from?: unknown; by?: unknown };
  return (typeof from === "string" && !!from) || (typeof by === "string" && !!by);
}

/** True when the client's time zone is the one the agency default gave it. */
export function zoneFromAgency(fieldSources: unknown): boolean {
  const fs = fieldSources && typeof fieldSources === "object" ? (fieldSources as Record<string, unknown>) : null;
  const entry = fs?.timezone;
  return !!entry && typeof entry === "object" && (entry as { from?: unknown }).from === AGENCY_SOURCE;
}

/** The zone most rows have from a real source, UTC left out; a tie goes to the alphabetically first zone. Null when none counts. */
export function mostCommonZone(rows: Array<{ timezone: string | null; field_sources: unknown }>): string | null {
  const counts = new Map<string, number>();
  for (const r of rows ?? []) {
    const zone = typeof r.timezone === "string" ? r.timezone.trim() : "";
    if (!zone || zone.toUpperCase() === "UTC" || !zoneHasSource(r.field_sources) || zoneFromAgency(r.field_sources)) continue;
    counts.set(zone, (counts.get(zone) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0]?.[0] ?? null;
}

/**
 * The agency's zone, from its active clients that are not archived (a demo
 * copy is not a client), leaving out the client asked about. Null when no
 * client has a sourced zone, or when the clients cannot be read: the fill is
 * then tried again on the next look.
 */
export async function agencyZone(db: Db, exceptClientId: string): Promise<string | null> {
  const { data, error } = await db.from("clients").select("id, timezone, field_sources").is("archived_at", null).is("demo_job_id", null).neq("id", exceptClientId);
  if (error) {
    console.warn("[social_read] the agency's clients were not read:", error.message);
    return null;
  }
  return mostCommonZone((data ?? []) as Array<{ timezone: string | null; field_sources: unknown }>);
}
