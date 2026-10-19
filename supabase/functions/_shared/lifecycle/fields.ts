// supabase/functions/_shared/lifecycle/fields.ts
//
// The product never overwrites what a person set (Lital, 19 Oct 2026).
// clients.field_sources records, per field, who set the value now in it:
//   {"timezone": {"by": "person" | "lifecycle" | "portal", "at": "..."}}
// A person's save through the app marks the fields it changed (a database
// trigger, so no screen can forget to); a person who empties a field or puts
// a default back hands it back to the product. Every lifecycle write goes
// through lifecycle_write_client, which skips a field a person set and
// records the fields it wrote. A field with no entry was never set by anyone
// and is the lifecycle's to fill. Free of Deno and network imports so it can
// be tested.

// deno-lint-ignore no-explicit-any
type Db = any;

/** The client fields the lifecycle writes, and the only ones lifecycle_write_client accepts. */
export const LIFECYCLE_FIELDS = [
  "brand_identity", "logo_url", "timezone", "geo", "language", "location", "brief_text", "content_pillars", "pillars_source",
  "pillars_derived_at", "social_keywords", "primary_platforms", "company_slug", "hub_company_name",
] as const;
export type LifecycleField = typeof LIFECYCLE_FIELDS[number];

/** Who set a field: a person, the lifecycle, the portal's sign-in, or nobody yet. */
export function setBy(fieldSources: unknown, field: string): "person" | "lifecycle" | "portal" | null {
  const entry = fieldSources && typeof fieldSources === "object" ? (fieldSources as Record<string, unknown>)[field] : null;
  const by = entry && typeof entry === "object" ? (entry as { by?: unknown }).by : entry;
  return by === "person" || by === "lifecycle" || by === "portal" ? by : null;
}

/** True when the lifecycle may write the field: nobody set it, or the lifecycle did. */
export function lifecycleMayWrite(fieldSources: unknown, field: string): boolean {
  const by = setBy(fieldSources, field);
  return by === null || by === "lifecycle";
}

export interface FieldWrite {
  written: string[];
  skipped: string[];
}

/**
 * Write fields on a client, skipping every one a person set (and, for the
 * lifecycle, every one the portal set). Atomic: the check and the write
 * happen under the row's lock.
 */
export async function writeClientFields(db: Db, clientId: string, fields: Partial<Record<LifecycleField, unknown>>, by: "lifecycle" | "portal" = "lifecycle"): Promise<FieldWrite> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return { written: [], skipped: [] };
  const { data, error } = await db.rpc("lifecycle_write_client", { p_client: clientId, p_fields: Object.fromEntries(entries), p_by: by });
  if (error) throw new Error(`Could not save the client's details: ${error.message}`);
  const out = (data ?? {}) as { written?: string[]; skipped?: string[] };
  return { written: out.written ?? [], skipped: out.skipped ?? [] };
}
