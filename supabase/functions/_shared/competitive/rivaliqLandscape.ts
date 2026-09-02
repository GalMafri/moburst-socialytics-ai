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

/** Summarize a landscape and flag whether its focus company (or its name) is this client. */
export function summarizeLandscape(landscape: RivalIqLandscape, clientName: string): LandscapeSummary {
  const companies = landscape.companies || [];
  const focus = companies.find((c) => String(c.id) === String(landscape.focusCompanyId ?? ""));
  const focusName = focus?.name || null;
  const isMatch =
    (!!focusName && namesOverlap(focusName, clientName)) ||
    namesOverlap(String(landscape.name || ""), clientName);
  return {
    id: String(landscape.id),
    name: String(landscape.name || landscape.id),
    focus_company: focusName,
    is_match: isMatch,
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
export function summarizeLandscapes(landscapes: RivalIqLandscape[], clientName: string): LandscapeSummary[] {
  return landscapes
    .map((l) => summarizeLandscape(l, clientName))
    .sort((a, b) => Number(b.is_match) - Number(a.is_match) || a.name.localeCompare(b.name));
}
