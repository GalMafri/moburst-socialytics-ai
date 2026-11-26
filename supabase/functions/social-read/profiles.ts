// supabase/functions/social-read/profiles.ts
//
// The public profiles a client's competitive work reads (social_profiles),
// kept in line with where people edit handles: competitor_handles for the
// competitors of the client's newest confirmed set, client_public_profiles
// for the client's own (plan of 25 Nov 2026, section 4).
//
//   * Only Instagram, Facebook, TikTok and LinkedIn are read (readers/).
//   * A competitor's handle a person rejected or switched off is not read.
//   * The client's own profile is not read on a platform where its Sprout
//     profile measures it, nor when a person removed it.
//   * A profile no longer wanted stays, inactive, with its posts; one that
//     comes back is active again.
//   * A profile a person entered, or one RivalIQ tracks, is confirmed at
//     once (confirm.ts); every other profile waits for its first check.
//
// No paid call is made here.

import { platformName } from "../_shared/calendar/evidence.ts";
import { latestCompetitorSet, selectedCompetitors } from "../_shared/strategy/competitorSet.ts";
import { confirmedWithoutRead } from "./confirm.ts";
import { isReadPlatform, READERS, type SocialPlatform } from "./readers/index.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
// deno-lint-ignore no-explicit-any
type Db = any;

/** The detection score the competitor review trusts as a link on the brand's own site (extractSocialHandles.ts isReviewReadyHandle). */
export const ON_SITE_CONFIDENCE = 0.8;

export interface WantedProfile {
  client_id: string;
  competitor_id: string | null;
  /** The company the profile is for: the client's or the competitor's name. */
  company: string;
  website: string | null;
  platform: SocialPlatform;
  handle: string;
  url: string;
  handle_source: string;
  /** The brand's website links to the profile (confirm.ts). */
  found_on_site: boolean;
}

export interface ProfileSources {
  client: { id: string; name: string; website_url: string | null };
  own: Array<{ platform: string; handle: string; url: string | null; source: string }>;
  /** Platforms the client's active Sprout profiles cover, lowercased (instagram, facebook, ...). */
  sprout: Set<string>;
  competitors: Array<{ id: string; name: string; website_url: string | null }>;
  handles: Array<{ competitor_id: string; platform: string; handle: string | null; profile_url: string | null; is_active: boolean | null; source: string | null; detection_confidence: number | string | null }>;
}

/** The profiles that should be read for a client, one per company and platform. */
export function wantedProfiles(s: ProfileSources): WantedProfile[] {
  const out: WantedProfile[] = [];
  const add = (p: Omit<WantedProfile, "client_id" | "url" | "handle"> & { handle: string; url: string | null }) => {
    const url = READERS[p.platform].profileUrl(p.handle, p.url);
    if (!url) return;
    const handle = READERS[p.platform].handleOf(url);
    if (!handle || out.some((o) => o.competitor_id === p.competitor_id && o.platform === p.platform)) return;
    out.push({ ...p, client_id: s.client.id, handle, url });
  };
  for (const o of s.own) {
    const platform = String(o.platform).toLowerCase();
    if (!isReadPlatform(platform) || o.source === "removed" || s.sprout.has(platform)) continue;
    add({ competitor_id: null, company: s.client.name, website: s.client.website_url, platform, handle: String(o.handle ?? ""), url: o.url, handle_source: o.source, found_on_site: o.source === "website" });
  }
  for (const c of s.competitors) {
    // A person's handle first, then RivalIQ's, then the strongest detection, so a second one on the same platform is never the one read.
    const rank = (h: ProfileSources["handles"][number]) => (h.source === "manual" ? 3 : h.source === "rivaliq" ? 2 : 0) + Number(h.detection_confidence ?? 0);
    const handles = s.handles.filter((h) => h.competitor_id === c.id).sort((a, b) => rank(b) - rank(a));
    for (const h of handles) {
      const platform = String(h.platform).toLowerCase();
      if (!isReadPlatform(platform) || h.is_active === false || h.source === "rejected") continue;
      const source = String(h.source ?? "auto");
      add({
        competitor_id: c.id, company: c.name, website: c.website_url, platform, handle: String(h.handle ?? ""), url: h.profile_url,
        handle_source: source, found_on_site: source === "auto" && Number(h.detection_confidence ?? 0) >= ON_SITE_CONFIDENCE,
      });
    }
  }
  return out;
}

/** Where the profiles come from, read from the database. */
export async function readProfileSources(db: Db, clientId: string): Promise<ProfileSources> {
  const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
    if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
    return r.data;
  };
  const [client, own, sprout, set] = await Promise.all([
    db.from("clients").select("id, name, website_url").eq("id", clientId).maybeSingle(),
    db.from("client_public_profiles").select("platform, handle, url, source").eq("client_id", clientId),
    db.from("sprout_profiles").select("network_type").eq("client_id", clientId).eq("is_active", true),
    latestCompetitorSet(db, clientId),
  ]);
  const row = must(client, "the client") as Any;
  if (!row) throw new Error(`No client ${clientId}.`);
  const setRow = must(set, "the competitor set") as Any;
  let competitors: ProfileSources["competitors"] = [];
  let handles: ProfileSources["handles"] = [];
  if (setRow?.id) {
    competitors = must(await selectedCompetitors(db, setRow.id, "id, name, website_url"), "the competitors") ?? [];
    const ids = competitors.map((c) => c.id);
    handles = ids.length
      ? must(await db.from("competitor_handles").select("competitor_id, platform, handle, profile_url, is_active, source, detection_confidence").in("competitor_id", ids), "the competitors' profiles") ?? []
      : [];
  }
  return {
    client: { id: row.id, name: String(row.name ?? ""), website_url: row.website_url ?? null },
    own: (must(own, "the client's public profiles") ?? []) as ProfileSources["own"],
    sprout: new Set(((must(sprout, "the client's Sprout profiles") ?? []) as Any[]).map((a: Any) => platformName(a.network_type).toLowerCase()).filter(Boolean)),
    competitors,
    handles,
  };
}

export interface StoredProfile {
  id: string;
  client_id: string;
  competitor_id: string | null;
  platform: SocialPlatform;
  handle: string;
  url: string;
  handle_source: string;
  active: boolean;
  confirmed: boolean | null;
  confirmed_reason: string | null;
  last_read_at: string | null;
  last_read_status: string | null;
}

const keyOf = (p: { competitor_id: string | null; platform: string; handle: string }) => `${p.competitor_id ?? ""}|${p.platform}|${p.handle.toLowerCase()}`;

export interface ProfileChanges {
  insert: Array<Record<string, unknown>>;
  update: Array<{ id: string; patch: Record<string, unknown> }>;
}

/** What syncing changes: new profiles, ones active again or with a new source, and ones no longer wanted. */
export function profileChanges(wanted: WantedProfile[], stored: StoredProfile[], now: Date): ProfileChanges {
  const at = now.toISOString();
  const byKey = new Map(stored.map((s) => [keyOf(s), s]));
  const wantedKeys = new Set(wanted.map(keyOf));
  const insert: ProfileChanges["insert"] = [];
  const update: ProfileChanges["update"] = [];
  for (const w of wanted) {
    const s = byKey.get(keyOf(w));
    const given = confirmedWithoutRead(w.handle_source);
    if (!s) {
      insert.push({
        client_id: w.client_id, competitor_id: w.competitor_id, platform: w.platform, handle: w.handle, url: w.url, handle_source: w.handle_source, active: true,
        ...(given ? { confirmed: true, confirmed_reason: given.reason, confirmed_at: at } : {}), created_at: at, updated_at: at,
      });
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (!s.active) patch.active = true;
    if (s.url !== w.url) patch.url = w.url;
    if (s.handle_source !== w.handle_source) {
      patch.handle_source = w.handle_source;
      // A person now stands behind it; or the reason it was confirmed is gone, so it is checked again.
      if (given) Object.assign(patch, { confirmed: true, confirmed_reason: given.reason, confirmed_at: at });
      else if (s.confirmed_reason === "entered_by_person" || s.confirmed_reason === "tracked_in_rivaliq") Object.assign(patch, { confirmed: null, confirmed_reason: null, confirmed_at: null });
    }
    if (Object.keys(patch).length) update.push({ id: s.id, patch: { ...patch, updated_at: at } });
  }
  for (const s of stored) {
    if (s.active && !wantedKeys.has(keyOf(s))) update.push({ id: s.id, patch: { active: false, updated_at: at } });
  }
  return { insert, update };
}

const PROFILE_COLUMNS = "id, client_id, competitor_id, platform, handle, url, handle_source, active, confirmed, confirmed_reason, last_read_at, last_read_status";

export async function storedProfiles(db: Db, clientId: string): Promise<StoredProfile[]> {
  const { data, error } = await db.from("social_profiles").select(PROFILE_COLUMNS).eq("client_id", clientId);
  if (error) throw new Error(`Could not read the client's read profiles: ${error.message}`);
  return data ?? [];
}

/** Brings social_profiles in line with the client's handles; a dry run says what it would change and writes nothing. */
export async function syncSocialProfiles(db: Db, clientId: string, now: Date, o: { dryRun?: boolean } = {}): Promise<{ wanted: WantedProfile[]; changes: ProfileChanges; profiles: StoredProfile[] }> {
  const wanted = wantedProfiles(await readProfileSources(db, clientId));
  const stored = await storedProfiles(db, clientId);
  const changes = profileChanges(wanted, stored, now);
  if (o.dryRun) return { wanted, changes, profiles: stored };
  if (changes.insert.length) {
    const { error } = await db.from("social_profiles").insert(changes.insert);
    if (error) throw new Error(`Could not add the client's read profiles: ${error.message}`);
  }
  for (const u of changes.update) {
    const { error } = await db.from("social_profiles").update(u.patch).eq("id", u.id);
    if (error) throw new Error(`Could not update a read profile: ${error.message}`);
  }
  return { wanted, changes, profiles: changes.insert.length || changes.update.length ? await storedProfiles(db, clientId) : stored };
}
