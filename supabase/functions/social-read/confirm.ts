// supabase/functions/social-read/confirm.ts
//
// Whether a public profile is the brand's own, before its posts are read
// (plan of 25 Nov 2026, section 4). Nobody is asked to approve anything: an
// unconfirmed profile is simply not read, and staff see why.
//
//   * A profile a person entered is confirmed (competitor_handles source
//     manual, client_public_profiles source person), and so is one RivalIQ
//     tracks (source rivaliq): a person set that tracking up.
//   * Otherwise the profile's own record (one cheap profile read) decides:
//     it is confirmed when it links the brand's website, or when its name
//     matches the brand and the brand's website links to it.
//   * A profile that is not there, is private, or is a personal Facebook
//     profile is not confirmed.
//
// "The brand's website links to it": the handle was found on the brand's own
// site with the score the competitor review already trusts (detection
// confidence 0.8 or more; competitive/extractSocialHandles.ts), or the
// client's own profile came from its homepage links (source website).

import type { ProfileRecord } from "./readers/types.ts";

export type ConfirmReason =
  | "entered_by_person" | "tracked_in_rivaliq" | "links_brand_site" | "name_and_site_link"
  | "profile_not_found" | "private" | "not_a_page" | "name_differs" | "no_link_to_brand";

export interface Confirmation {
  confirmed: boolean;
  reason: ConfirmReason;
}

/** Sources that mean a person chose the profile. */
const BY_PERSON = new Set(["manual", "person"]);

export interface ConfirmInput {
  /** competitor_handles.source or client_public_profiles.source. */
  source: string;
  /** The brand's website links to the profile (see the header). */
  foundOnSite: boolean;
  brand: { name: string; website: string | null };
  handle: string;
  /** The profile's own record; null when the read found none. */
  record: ProfileRecord | null;
}

/** A confirmation that needs no read, or null when the profile's record must decide. */
export function confirmedWithoutRead(source: string): Confirmation | null {
  if (BY_PERSON.has(source)) return { confirmed: true, reason: "entered_by_person" };
  if (source === "rivaliq") return { confirmed: true, reason: "tracked_in_rivaliq" };
  return null;
}

export function confirmProfile(i: ConfirmInput): Confirmation {
  const given = confirmedWithoutRead(i.source);
  if (given) return given;
  const r = i.record;
  if (!r || !r.found) return { confirmed: false, reason: "profile_not_found" };
  if (!r.page) return { confirmed: false, reason: "not_a_page" };
  if (r.private) return { confirmed: false, reason: "private" };
  if (linksSite(r, i.brand.website)) return { confirmed: true, reason: "links_brand_site" };
  if (i.foundOnSite) {
    return nameMatches(i.brand.name, r.name, i.handle) ? { confirmed: true, reason: "name_and_site_link" } : { confirmed: false, reason: "name_differs" };
  }
  return { confirmed: false, reason: "no_link_to_brand" };
}

/** The site's host without www, lowercased, or "" when the value is not an address. */
export function siteHost(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The host's name without its public suffix: poliform.it and poliform.com are both "poliform". */
const brandLabel = (host: string) => {
  const parts = host.split(".");
  if (parts.length < 2) return host;
  // co.uk, com.au and the like: the label before the two-part suffix.
  const twoPart = parts.length >= 3 && parts[parts.length - 2].length <= 3 && parts[parts.length - 1].length === 2;
  return parts[parts.length - (twoPart ? 3 : 2)];
};

/** The profile links the brand's site: the same host or a subdomain of it, or the same name under another country's domain. */
export function linksSite(r: ProfileRecord, website: string | null): boolean {
  const brand = siteHost(website);
  if (!brand) return false;
  const label = brandLabel(brand);
  const hosts = [...r.links.map(siteHost), ...[...r.bio.matchAll(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)].map((m) => siteHost(m[1]))].filter(Boolean);
  return hosts.some((h) => h === brand || h.endsWith(`.${brand}`) || brand.endsWith(`.${h}`) || (label.length >= 5 && brandLabel(h) === label));
}

const compact = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
const LEGAL = /\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|pllc|pc|group|official)\b\.?/gi;

/** The profile's name (or its handle) and the brand's name are the same name: one holds the other, ignoring legal words, spaces and punctuation. */
export function nameMatches(brand: string, name: string | null, handle: string): boolean {
  const b = compact(brand.replace(/\([^)]*\)/g, " ").replace(LEGAL, " "));
  if (b.length < 3) return false;
  return [name ?? "", handle].some((n) => {
    const c = compact(n.replace(LEGAL, " "));
    return c.length >= 3 && (c.includes(b) || (b.includes(c) && c.length >= Math.min(5, b.length)));
  });
}
