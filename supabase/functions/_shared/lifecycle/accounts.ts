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
import { ownedNetwork } from "../competitive/ownedMerge.ts";
import { plainDisplayName } from "../text/displayName.ts";
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

// ── One own account per network ─────────────────────────────────────────────
//
// A client has at most one own account on a network (copy sources, 17 Nov
// 2026). A client that held a national brand's account and a local
// franchise's on the same network was read, learned from and planned as one
// voice, so its copy mixed the two. Which account is the brand's is decided
// from exact facts in a fixed order; the other is parked, and nothing reads
// from or publishes to a parked account. A parked account stays the client's
// row, so it is never handed to another client, and it returns by itself
// when the kept one is gone.
//
// The rule never guesses, because a wrong choice switches off an account a
// client publishes to:
//   * when no exact fact says which account is the brand's, nothing is
//     parked: both stay in use and the choice is recorded as open;
//   * it sorts out only the accounts the client already had when the rule
//     began (OWN_RULE_SINCE). From then on nothing but a person adds a
//     second account on a network (the step's own matcher does not, see
//     steps.ts), so an account added later is a person's choice: it is never
//     parked and never a reason to park another;
//   * a personal LinkedIn profile is not a brand's account: a brand has a
//     company page and its people's profiles together, so personal profiles
//     are outside the rule altogether.
//
// What was parked, when and why is written on the row itself
// (sprout_profiles.parked_at and parked_reason, with is_active = false), so
// the record does not depend on any one run of the accounts step: a run that
// fails, or a step result that is cleared, loses nothing, and the next run
// reads the same facts again. A parked row a person adds back from the setup
// page is active with its parked_at still set: that is how the rule knows a
// person chose it, for as long as the row says so.

/** The version of the rule; part of the accounts step's inputs key, so raising it runs the step once for every client. */
export const ONE_PER_NETWORK_RULE = 1;

/**
 * When the rule began: a moment before the rule was first released, so no
 * account a person adds once the rule runs is ever sorted out by it. An
 * account assigned to a client before this moment is one the rule may sort
 * out; one assigned at or after it was added by a person and is outside the
 * rule.
 */
export const OWN_RULE_SINCE = "2026-11-17T21:00:00.000Z";

/** A sprout_profiles row of the client, as the rule reads it. */
export interface OwnRow {
  id: string;
  name: string;
  native_name: string;
  network_type: string;
  is_active: boolean;
  /** When the row was assigned to the client (sprout_profiles.assigned_at); null or absent for a row older than the column's use. */
  assigned_at?: string | null;
  /** When the rule parked the row (sprout_profiles.parked_at); null or absent for a row it never parked. */
  parked_at?: string | null;
  /** A person removed the row from the client (sprout_profile_removals): never a candidate while it is inactive. */
  removed?: boolean;
}
/** The exact fact that decided a network, in the order the rule asks them. */
export type OwnBy = "only" | "person" | "name" | "public_profile" | "handle" | "name_cut";
export interface OwnPick { network: string; kept: string; dropped: string[]; by: OwnBy; why: string }
/** A network where two accounts stay in use because nothing exact decides between them. */
export interface OwnOpen { network: string; accounts: string[]; why: string }

/**
 * The network an account counts on for the rule, or null for an account the
 * rule leaves alone: a personal LinkedIn profile (Sprout's type "linkedin";
 * a company page is "linkedin_company").
 */
export function parkingNetwork(networkType: string | null | undefined): string | null {
  const type = String(networkType ?? "").toLowerCase();
  if (!type || type === "linkedin") return null;
  return ownedNetwork(type);
}

/** Profile ids are digits; a shorter one is older (as sprout/brands.ts orders them). */
const olderFirst = (a: OwnRow, b: OwnRow) => a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** A handle as two networks can share it: lowercase letters and digits only. */
const handleLetters = (handle: string) => bareHandle(handle).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const NETWORK_WORDS: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", twitter: "X", pinterest: "Pinterest", threads: "Threads",
};
const networkWords = (network: string) => NETWORK_WORDS[network] ?? network;

/** One wording per fact, said of the account that was kept. */
const OWN_WORDS: Record<OwnBy, string> = {
  only: "it is the client's only account there now",
  person: "a person switched it back on",
  name: "its name is the client's name",
  public_profile: "its handle is the client's public profile there",
  handle: "its handle is the one the client's account on another network has",
  name_cut: "its name before its tagline is the client's name",
};

const said = (r: OwnRow) => `"${r.name}"${r.native_name ? ` (${r.native_name})` : ""}`;
const listed = (rows: OwnRow[]) => (rows.length === 2 ? `${said(rows[0])} and ${said(rows[1])}` : rows.map(said).join(", "));

function ownWhy(network: string, kept: OwnRow, dropped: OwnRow[], by: OwnBy): string {
  return `Kept ${said(kept)} on ${networkWords(network)}: ${OWN_WORDS[by]}.${dropped.length ? ` Parked: ${dropped.map(said).join(", ")}.` : ""}`;
}

/** What a parked row says of itself on the setup page (sprout_profiles.parked_reason): which account is the brand's own there. */
export function parkedReason(network: string, kept: Pick<OwnRow, "name">): string {
  return `The brand's own ${networkWords(network)} account is "${kept.name}".`;
}

/**
 * Which of the client's accounts stays on each network, which are parked,
 * and where the choice is open.
 *
 * The rule looks only at brand accounts (parkingNetwork) the client had when
 * the rule began, and at the rows it parked itself. Candidates on a network
 * are those of them that are active, plus the inactive ones the rule parked
 * (parked_at is set) that no person removed. An inactive row the rule did
 * not park was switched off by a person and is ignored. One candidate is
 * kept, and brought back if it was parked and no other account is in use
 * there. With more, the candidates are narrowed in this order; at each step
 * exactly one qualifying is kept, several narrow the set to them, none leave
 * it as it was:
 *   1. person          a person switched a parked account back on (it is
 *                      active and parked_at is set); of several, the one
 *                      parked last, which is the one switched on last;
 *   2. name            its whole name is the client's name (names.ts);
 *   3. public_profile  its handle is the client's public profile on that
 *                      platform (client_public_profiles, not a removed one);
 *   4. handle          its handle, as letters and digits, is the handle of
 *                      the client's kept account on another network that
 *                      "only" or steps 1 to 3 decided;
 *   5. name_cut        its name before a tagline (" - ", " | ") is the
 *                      client's name.
 * When the facts leave exactly one, the others are parked. When they leave
 * several, nothing on that network changes and it is listed as open. An
 * account a person added after the rule began is never parked and parks
 * nothing; a network where one is in use beside another is listed as open.
 */
export function ownPerNetwork(i: {
  clientName: string;
  /** Every sprout_profiles row of the client, active or not. */
  rows: OwnRow[];
  /** client_public_profiles rows of the client. */
  publicProfiles: Array<{ platform: string; handle: string; source: string }>;
}): { keep: string[]; park: string[]; picks: OwnPick[]; open: OwnOpen[] } {
  const parkedAt = (r: OwnRow) => { const t = r.parked_at ? Date.parse(r.parked_at) : NaN; return Number.isFinite(t) ? t : 0; };
  const wasParked = (r: OwnRow) => !!r.parked_at;
  const since = Date.parse(OWN_RULE_SINCE);
  // The client's from before the rule began (a row with no assignment time is older than the column's use), or parked by the rule.
  const inRule = (r: OwnRow) => wasParked(r) || !r.assigned_at || !(Date.parse(r.assigned_at) >= since);
  const networks = new Map<string, OwnRow[]>();
  /** Accounts in use that a person added after the rule began, by network. */
  const later = new Map<string, OwnRow[]>();
  for (const r of [...new Map(i.rows.map((x) => [String(x.id), { ...x, id: String(x.id) }])).values()].sort(olderFirst)) {
    const network = parkingNetwork(r.network_type);
    if (!network) continue;
    if (!r.is_active && (!wasParked(r) || r.removed)) continue;
    const into = inRule(r) ? networks : later;
    into.set(network, [...(into.get(network) ?? []), r]);
  }
  const publicHandle = new Map<string, string>();
  for (const p of i.publicProfiles) if (p.source !== "removed" && p.handle) publicHandle.set(String(p.platform).toLowerCase(), profileKey(String(p.platform).toLowerCase(), p.handle));
  const onPublicProfile = (r: OwnRow) => {
    const key = profileKeyOf(r);
    return !!key && publicHandle.get(key.slice(0, key.indexOf(":"))) === key;
  };

  /** Narrow a pool by one fact: the one that qualifies, the several that do, or the pool as it was. */
  const narrow = (pool: OwnRow[], fits: (r: OwnRow) => boolean): OwnRow[] => {
    const hits = pool.filter(fits);
    return hits.length ? hits : pool;
  };
  const decided = new Map<string, { kept: OwnRow; by: OwnBy }>();
  const undecided = new Map<string, OwnRow[]>();
  // First pass: a network with one account, and the facts that need no other network.
  for (const [network, all] of networks) {
    if (all.length === 1) {
      // A parked account comes back only where no other account is in use.
      if (all[0].is_active || !(later.get(network) ?? []).length) decided.set(network, { kept: all[0], by: "only" });
      continue;
    }
    let pool = all;
    // Of several accounts a person switched back on, the one parked last was switched on last.
    const lastParked = Math.max(0, ...all.filter((r) => r.is_active && wasParked(r)).map(parkedAt));
    const early: Array<[OwnBy, (r: OwnRow) => boolean]> = [
      ["person", (r) => r.is_active && wasParked(r) && parkedAt(r) === lastParked],
      ["name", (r) => sameName(r.name, i.clientName)],
      ["public_profile", onPublicProfile],
    ];
    for (const [by, fits] of early) {
      pool = narrow(pool, fits);
      if (pool.length === 1) { decided.set(network, { kept: pool[0], by }); break; }
    }
    if (!decided.has(network)) undecided.set(network, pool);
  }
  // Second pass: the handle the client's settled accounts on other networks carry, then the name before a tagline.
  const settled = [...decided.entries()];
  const open: OwnOpen[] = [];
  for (const [network, narrowed] of undecided) {
    const handles = new Set(settled.filter(([n]) => n !== network).map(([, d]) => handleLetters(d.kept.native_name)).filter(Boolean));
    let pool = narrowed;
    const late: Array<[OwnBy, (r: OwnRow) => boolean]> = [
      ["handle", (r) => handles.has(handleLetters(r.native_name))],
      ["name_cut", (r) => sameName(plainDisplayName(r.name, [i.clientName]), i.clientName)],
    ];
    for (const [by, fits] of late) {
      pool = narrow(pool, fits);
      if (pool.length === 1) { decided.set(network, { kept: pool[0], by }); break; }
    }
    // No exact fact left one account: nothing is parked and nothing is brought back.
    if (!decided.has(network)) {
      const inUse = (networks.get(network) ?? []).filter((r) => r.is_active);
      if (inUse.length > 1) open.push({ network, accounts: inUse.map((r) => r.id), why: `${listed(inUse)} stay in use on ${networkWords(network)}: no exact fact says which one is the brand's own.` });
    }
  }

  const keep: string[] = [];
  const park: string[] = [];
  const picks: OwnPick[] = [];
  for (const [network, all] of networks) {
    const choice = decided.get(network);
    if (!choice) {
      // Open: every account stays as it is.
      keep.push(...all.filter((r) => r.is_active).map((r) => r.id));
      continue;
    }
    const { kept, by } = choice;
    const dropped = all.filter((r) => r.id !== kept.id);
    keep.push(kept.id);
    park.push(...dropped.map((r) => r.id));
    // A network that never had two records nothing; one whose parked account is back records why.
    if (dropped.length || wasParked(kept)) picks.push({ network, kept: kept.id, dropped: dropped.map((r) => r.id), by, why: ownWhy(network, kept, dropped, by) });
  }
  // An account a person added later is in use beside another: the person's choice, listed so it can be seen.
  for (const [network, added] of later) {
    const beside = [...(networks.get(network) ?? []).filter((r) => keep.includes(r.id)), ...added.filter((r) => r.is_active)];
    keep.push(...added.filter((r) => r.is_active).map((r) => r.id));
    if (beside.length > 1 && !open.some((o) => o.network === network)) {
      open.push({ network, accounts: beside.map((r) => r.id), why: `${listed(beside)} stay in use on ${networkWords(network)}: a person added ${added.length === 1 ? "one" : "some"} of them after the client was set up.` });
    }
  }
  const byNetwork = <T extends { network: string }>(a: T, b: T) => (a.network < b.network ? -1 : a.network > b.network ? 1 : 0);
  return { keep, park, picks: picks.sort(byNetwork), open: open.sort(byNetwork) };
}
