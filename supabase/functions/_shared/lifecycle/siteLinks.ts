// supabase/functions/_shared/lifecycle/siteLinks.ts
//
// How a page's profile links (siteProfileLinks, accounts.ts) are compared to a
// Sprout profile's key (profileKeyOf): case-insensitively, in this one place.
// A handle is the same handle whatever the case a link wrote it in, so no
// caller compares the strings as they are, and no list has to carry a handle
// twice (once as written, once lower-cased) for the comparison to work.

/** The links as a set to compare against: every key lower-cased. */
export function siteLinkSet(links: Iterable<string> | null | undefined): Set<string> {
  return new Set([...(links ?? [])].map((k) => String(k).toLowerCase()));
}

/** Whether the links include the profile key, whatever the case of either. */
export function linksTo(links: ReadonlySet<string>, key: string): boolean {
  return links.has(key.toLowerCase());
}
