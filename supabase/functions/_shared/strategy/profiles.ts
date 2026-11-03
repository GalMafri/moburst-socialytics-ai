// supabase/functions/_shared/strategy/profiles.ts
//
// The client's own public profiles (client_public_profiles; spec: docs/
// superpowers/specs/2026-11-03-strategy-v2-design.md, section 3, "Where
// profiles come from"), filled from data so nobody has to: RivalIQ's record
// of the client company (the tracking step's result) first, then the links on
// the client's homepage (brand_read's site_profiles), one profile per
// platform. The competitor_handles rules hold: a person's entry is never
// overwritten, and a profile a person removed never comes back.

import { canonicalProfileUrl } from "../competitive/extractSocialHandles.ts";
import { normName, textHash } from "../lifecycle/names.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const PROFILE_PLATFORMS = ["instagram", "facebook", "tiktok", "youtube", "x", "linkedin"] as const;

export interface ProfileRow { platform: string; handle: string; url: string | null; source: "rivaliq" | "website" | "person" | "removed" }

const clean = (h: unknown) => String(h ?? "").trim().replace(/^@/, "");

/**
 * The profiles the table should hold: what people set or removed stays as it
 * is; elsewhere RivalIQ's record wins over the homepage, and a platform the
 * homepage links several profiles on takes the one named like the brand, or
 * none.
 */
export function desiredProfiles(i: { rows: ProfileRow[]; rivaliq: Array<{ platform: string; handle: string; profile_url?: string | null }>; site: string[]; brand: string }): ProfileRow[] {
  const out = new Map<string, ProfileRow>();
  for (const r of i.rows) if (r.source === "person" || r.source === "removed") out.set(r.platform, r);
  const brand = normName(i.brand).replace(/\s+/g, "");
  for (const platform of PROFILE_PLATFORMS) {
    if (out.has(platform)) continue;
    const fromRivalIq = i.rivaliq.find((h) => h.platform === platform && clean(h.handle));
    if (fromRivalIq) {
      const handle = clean(fromRivalIq.handle);
      out.set(platform, { platform, handle, url: fromRivalIq.profile_url || canonicalProfileUrl(platform, handle), source: "rivaliq" });
      continue;
    }
    const linked = [...new Set(i.site.filter((k) => k.startsWith(`${platform}:`)).map((k) => k.slice(platform.length + 1)).filter(Boolean))];
    const handle = linked.length === 1 ? linked[0] : linked.find((h) => brand && h.replace(/[^a-z0-9]/g, "").includes(brand));
    if (handle) out.set(platform, { platform, handle, url: canonicalProfileUrl(platform, handle), source: "website" });
  }
  return PROFILE_PLATFORMS.filter((p) => out.has(p)).map((p) => out.get(p)!);
}

/** The profiles as one key, for the strategy's inputs. */
export const profilesKey = (rows: ProfileRow[]) => textHash(rows.filter((r) => r.source !== "removed").map((r) => `${r.platform}:${r.handle.toLowerCase()}`).join("|"));

/** What the lifecycle reads to fill the table: the rows, RivalIQ's handles for the client company and the homepage's links. */
export async function profileInputs(db: Db, client: { id: string; name: string }, results: { tracking?: Record<string, unknown> | null; brand_read?: Record<string, unknown> | null }) {
  const { data, error } = await db.from("client_public_profiles").select("platform, handle, url, source").eq("client_id", client.id);
  if (error) throw new Error(`Could not read the client's public profiles: ${error.message}`);
  const rivaliq = ((results.tracking?.client_company as { handles?: unknown } | null | undefined)?.handles ?? []) as Array<{ platform: string; handle: string; profile_url?: string | null }>;
  const site = (results.brand_read?.site_profiles ?? []) as string[];
  return { rows: (data ?? []) as ProfileRow[], rivaliq: Array.isArray(rivaliq) ? rivaliq : [], site: Array.isArray(site) ? site : [], brand: client.name };
}

/** Write what changed: only rows the lifecycle made, never a person's. */
export async function syncProfiles(db: Db, clientId: string, current: ProfileRow[], desired: ProfileRow[], now: Date): Promise<number> {
  let written = 0;
  for (const d of desired) {
    if (d.source === "person" || d.source === "removed") continue;
    const had = current.find((r) => r.platform === d.platform);
    if (had && (had.source === "person" || had.source === "removed")) continue;
    if (had && had.handle === d.handle && had.url === d.url && had.source === d.source) continue;
    const { error } = await db.from("client_public_profiles").upsert({ client_id: clientId, ...d, updated_by: null, updated_at: now.toISOString() }, { onConflict: "client_id,platform" });
    if (error) throw new Error(`Could not keep the client's public profiles: ${error.message}`);
    written++;
  }
  return written;
}
