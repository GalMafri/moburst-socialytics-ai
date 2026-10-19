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

/** One key per profile: platform and handle, lowercased, without @ or a YouTube path prefix. */
export function profileKey(platform: string, handle: string): string {
  const h = String(handle || "").toLowerCase().replace(/^@/, "").replace(/^(c\/|user\/|channel\/)/, "").replace(/\/$/, "");
  return `${platform}:${h}`;
}

const HARVEST = /(?:https?:)?\/\/[^\s"'<>\\)]+|(?:^|[\s"'(>])((?:www\.)?(?:instagram|facebook|tiktok|linkedin|youtube|twitter|x)\.com\/[^\s"'<>\\)]+)/gi;

/** Every social profile a page links to, as profile keys (every link, not only the best one per platform). */
export function siteProfileLinks(html: string): string[] {
  const out = new Set<string>();
  for (const m of normalizeDocument(html).matchAll(HARVEST)) {
    const raw = (m[1] || m[0]).trim().replace(/[),.;]+$/, "");
    const url = raw.startsWith("//") ? `https:${raw}` : /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const hit = classifyUrl(url);
    if (hit) out.add(profileKey(hit.platform, hit.handle));
  }
  return [...out].sort();
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
  const links = new Set(i.siteLinks);
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
