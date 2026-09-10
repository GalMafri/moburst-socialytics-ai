// Pure helpers over RivalIQ's live /v3/landscapes shape (verified 2026-09-02):
//   { landscapes: [{ id, name, focusCompanyId, companies: [{ id, name, url,
//       twitter|facebook|instagram|tikTok|youTube|linkedin: { handle, url, nativeId } }] }] }
// Landscapes are named by tier ("TIER 1 Competitors"), not by client, so the
// client is identified through the focus company, never the landscape name.

export interface RivalIqSocial {
  handle?: string | null;
  url?: string | null;
  nativeId?: string | null;
}

export interface RivalIqCompany {
  id: number | string;
  name?: string | null;
  url?: string | null;
  twitter?: RivalIqSocial | null;
  facebook?: RivalIqSocial | null;
  instagram?: RivalIqSocial | null;
  tikTok?: RivalIqSocial | null;
  youTube?: RivalIqSocial | null;
  linkedin?: RivalIqSocial | null;
}

export interface RivalIqLandscape {
  id: number | string;
  name?: string | null;
  focusCompanyId?: number | string | null;
  companies?: RivalIqCompany[] | null;
}

export interface HandleOut {
  platform: string;
  handle: string;
  profile_url: string | null;
}

export interface LandscapeSummary {
  id: string;
  name: string;
  focus_company: string | null;
  is_match: boolean;
  /** Why it matched, so the import screen can say so: "focus company", "website", "landscape name". */
  match_reason: string | null;
  companies: Array<{
    id: string;
    name: string;
    url: string | null;
    is_focus: boolean;
    handles: HandleOut[];
  }>;
}

const PLATFORM_KEYS: Array<[keyof RivalIqCompany, string]> = [
  ["instagram", "instagram"],
  ["facebook", "facebook"],
  ["tikTok", "tiktok"],
  ["twitter", "x"],
  ["youTube", "youtube"],
  ["linkedin", "linkedin"],
];

/** RivalIQ social objects → the app's competitor_handles rows. YouTube has no
 *  handle, so its channel id (nativeId) stands in, matching detect-competitor-handles. */
export function companyToHandles(company: RivalIqCompany): HandleOut[] {
  const out: HandleOut[] = [];
  for (const [key, platform] of PLATFORM_KEYS) {
    const social = company[key] as RivalIqSocial | null | undefined;
    if (!social) continue;
    const handle = (social.handle || (platform === "youtube" ? social.nativeId : null) || "").toString().trim();
    if (!handle) continue;
    out.push({ platform, handle, profile_url: social.url || null });
  }
  return out;
}

function namesOverlap(a: string, b: string): boolean {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

/**
 * The registrable part of a URL or bare domain: "https://www.Moburst.com/x"
 * and "Moburst.com" both give "moburst".
 *
 * A landscape's focus company is often stored with a suffix the client row
 * does not have ("Moburst Ltd", "Bader Law LLC") or the other way round, and
 * some are stored as the website. Matching the domain stem catches every one
 * of those, which matching names alone does not.
 */
export function domainStem(value: string | null | undefined): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const host = raw
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  if (!host.includes(".")) return "";
  const parts = host.split(".").filter(Boolean);
  // Drop the TLD, then the registry label behind a country code (.co.uk,
  // .com.au). Testing the label's LENGTH instead kept the whole suffix for
  // anything newer than three characters, so every company on .agency or
  // .studio reduced to that suffix and compared equal to each other.
  parts.pop();
  if (parts.length > 1 && REGISTRY_SECOND_LEVELS.has(parts[parts.length - 1])) parts.pop();
  return parts[parts.length - 1] || "";
}

/**
 * Summarize a landscape and say whether it belongs to this client.
 *
 * Three ways it can: the focus company's name, the focus company's website,
 * or the landscape's own name. The website is the reliable one — RivalIQ
 * companies are named however whoever built the landscape typed them, and
 * "Moburst" against a focus company called "Moburst Ltd." or a landscape
 * whose focus is stored as moburst.com used to come back as no match at all,
 * which is what left a client with an empty import screen.
 */
/** Second-level labels that are part of the suffix, not the name. */
const REGISTRY_SECOND_LEVELS = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/**
 * How much a match is worth, so the pick is the strongest one rather than
 * whichever happened to come first. "The client is in the set" also matches
 * a competitor's landscape that merely tracks them, which is somebody else's
 * landscape; it should only win when nothing better exists.
 */
const MATCH_RANK: Record<string, number> = {
  "focus company": 4,
  website: 3,
  "landscape name": 2,
  "client is in the set": 1,
};

export function bestLandscapeMatch<T extends { is_match?: boolean; match_reason?: string | null }>(
  summaries: T[],
): T | undefined {
  return summaries
    .filter((l) => l.is_match)
    .sort((a, b) => (MATCH_RANK[b.match_reason || ""] || 0) - (MATCH_RANK[a.match_reason || ""] || 0))[0];
}

export function summarizeLandscape(
  landscape: RivalIqLandscape,
  clientName: string,
  clientWebsite?: string | null,
): LandscapeSummary {
  const companies = landscape.companies || [];
  const focus = companies.find((c) => String(c.id) === String(landscape.focusCompanyId ?? ""));
  const focusName = focus?.name || null;
  const clientStem = domainStem(clientWebsite) || domainStem(clientName);
  const focusStem = domainStem(focus?.url) || domainStem(focusName);
  let matchReason: string | null = null;
  if (!!focusName && namesOverlap(focusName, clientName)) matchReason = "focus company";
  else if (!!clientStem && clientStem === focusStem) matchReason = "website";
  else if (namesOverlap(String(landscape.name || ""), clientName)) matchReason = "landscape name";
  else if (
    !!clientStem &&
    companies.some((c) => domainStem(c.url) === clientStem || namesOverlap(String(c.name || ""), clientName))
  ) {
    // The client is in the landscape but is not its focus company. Still theirs.
    matchReason = "client is in the set";
  }
  return {
    id: String(landscape.id),
    name: String(landscape.name || landscape.id),
    focus_company: focusName,
    is_match: matchReason !== null,
    match_reason: matchReason,
    companies: companies.map((c) => ({
      id: String(c.id),
      name: String(c.name || c.id),
      url: c.url || null,
      is_focus: String(c.id) === String(landscape.focusCompanyId ?? ""),
      handles: companyToHandles(c),
    })),
  };
}

/** All landscapes summarized, matches first, then alphabetical. */
export function summarizeLandscapes(
  landscapes: RivalIqLandscape[],
  clientName: string,
  clientWebsite?: string | null,
): LandscapeSummary[] {
  return landscapes
    .map((l) => summarizeLandscape(l, clientName, clientWebsite))
    .sort((a, b) => Number(b.is_match) - Number(a.is_match) || a.name.localeCompare(b.name));
}
