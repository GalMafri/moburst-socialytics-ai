// supabase/functions/_shared/lifecycle/accounts.ts
//
// Which Sprout profiles belong to a client, from two exact sources used
// together (proven on 19 Oct 2026 to reproduce all 10 hand-made assignments
// with no wrong pick among the other 67 profiles; either rule alone misses
// some):
//   (a) Sprout's own brand name for the profile equals the client's name,
//       by the name rule in names.ts;
//   (b) the profile's network and handle equal a profile link on the
//       client's homepage.
// A profile already assigned to any client is never assigned again, and a
// profile a person removed from this client stays removed. Free of Deno and
// network imports so it can be tested.

import { classifyUrl, normalizeDocument } from "../competitive/extractSocialHandles.ts";
import { sameName } from "./names.ts";

/** A profile as Sprout's /metadata/customer lists it. */
export interface SproutProfile {
  id: string;
  /** Sprout's brand name for the profile. */
  name: string;
  native_name: string;
  network_type: string;
  native_link: string;
  status: string;
  /** The Sprout groups the profile is in, by group id (Sprout's list has them; an assignment row does not). */
  groups?: string[];
}

/** Sprout network types to the platform names the site links use. */
const NETWORK_PLATFORM: Record<string, string> = {
  facebook: "facebook", fb_instagram_account: "instagram", instagram: "instagram", linkedin_company: "linkedin",
  tiktok: "tiktok", youtube: "youtube", twitter: "x",
};

/** Sprout network types to the platform names the app stores in clients.primary_platforms. */
const NETWORK_DISPLAY: Record<string, string> = {
  twitter: "Twitter/X", facebook: "Facebook", instagram: "Instagram", fb_instagram_account: "Instagram", linkedin: "LinkedIn",
  linkedin_company: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", pinterest: "Pinterest", threads: "Threads",
};

/** The handle without @ or a YouTube path prefix, in the case it was written. */
const bareHandle = (handle: string) => String(handle || "").replace(/^@/, "").replace(/^(c\/|user\/|channel\/)/i, "").replace(/\/$/, "");

/** One key per profile: platform and handle, lowercased, without @ or a YouTube path prefix. */
export function profileKey(platform: string, handle: string): string {
  return `${platform}:${bareHandle(handle).toLowerCase()}`;
}

/** The same key with the handle in the case it was written: a YouTube channel id is only an id in its own case. */
export function writtenProfileKey(platform: string, handle: string): string {
  return `${platform}:${bareHandle(handle)}`;
}

/** A Sprout profile's key, as a site's profile links are keyed; null for a network a site cannot link (a personal LinkedIn profile). */
export function profileKeyOf(p: Pick<SproutProfile, "network_type" | "native_name">): string | null {
  const platform = NETWORK_PLATFORM[String(p.network_type || "").toLowerCase()];
  return platform && p.native_name ? profileKey(platform, p.native_name) : null;
}

const HARVEST = /(?:https?:)?\/\/[^\s"'<>\\)]+|(?:^|[\s"'(>])((?:www\.)?(?:instagram|facebook|tiktok|linkedin|youtube|twitter|x)\.com\/[^\s"'<>\\)]+)/gi;

/**
 * Every social profile a page links to, as profile keys (every link, not only
 * the best one per platform), each once and in the case the link wrote it,
 * which is what the client's public profile stores (a YouTube channel id is
 * only an id in its own case). A profile is matched to these case-insensitively
 * (siteLinks.ts), so no key is listed a second time lower-cased. A handle the
 * page writes more than one way is listed in the way that has capitals.
 */
export function siteProfileLinks(html: string): string[] {
  const byKey = new Map<string, string>();
  for (const m of normalizeDocument(html).matchAll(HARVEST)) {
    const raw = (m[1] || m[0]).trim().replace(/[),.;]+$/, "");
    const url = raw.startsWith("//") ? `https:${raw}` : /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const hit = classifyUrl(url);
    if (!hit) continue;
    const key = profileKey(hit.platform, hit.handle);
    const written = writtenProfileKey(hit.platform, hit.handle);
    const kept = byKey.get(key);
    if (kept === undefined || (kept === key && written !== key)) byKey.set(key, written);
  }
  return [...byKey.values()].sort();
}

export interface MatchInput {
  client: { id: string; name: string };
  profiles: SproutProfile[];
  /** Profile keys the client's homepage links to (siteProfileLinks). */
  siteLinks: string[];
  /** Every current assignment, of any client: profile id to client ids. */
  assigned: Map<string, string[]>;
  /** Profiles a person removed from this client. */
  removed: Set<string>;
}

export interface ProfileMatch {
  profile: SproutProfile;
  by: Array<"name" | "site_link">;
}

/** The profiles to assign to the client now. */
export function matchProfiles(i: MatchInput): ProfileMatch[] {
  const links = new Set(i.siteLinks.map((k) => k.toLowerCase()));
  const out: ProfileMatch[] = [];
  for (const p of i.profiles) {
    if (String(p.status || "active").toLowerCase() !== "active") continue;
    const id = String(p.id);
    if (i.removed.has(id) || (i.assigned.get(id)?.length ?? 0) > 0) continue;
    const by: ProfileMatch["by"] = [];
    if (sameName(p.name, i.client.name)) by.push("name");
    const platform = NETWORK_PLATFORM[String(p.network_type || "").toLowerCase()];
    if (platform && p.native_name && links.has(profileKey(platform, p.native_name))) by.push("site_link");
    if (by.length) out.push({ profile: p, by });
  }
  return out;
}

/** The fingerprint of Sprout's profile list, so a run can say what it matched against. */
export function profileListKey(profiles: SproutProfile[]): string {
  return profiles.map((p) => `${p.id}:${p.status}:${p.network_type}:${p.native_name}:${p.name}`).sort().join("|");
}

/** The platforms a set of assigned profiles covers, as the app names them, in a stable order. */
export function platformsOf(networkTypes: string[]): string[] {
  const order = ["Instagram", "TikTok", "Facebook", "LinkedIn", "YouTube", "Twitter/X", "Pinterest", "Threads"];
  const names = new Set(networkTypes.map((n) => NETWORK_DISPLAY[String(n || "").toLowerCase()]).filter(Boolean));
  return order.filter((n) => names.has(n));
}
