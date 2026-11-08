// supabase/functions/_shared/lifecycle/parentPage.ts
//
// A client whose website is a page on another client's site (spec:
// docs/superpowers/specs/2026-11-08-onboarding-profile-pages-and-no-n8n-
// design.md, section B). Kitcaster's own LinkedIn page states
// https://www.moburst.com/services/organic/podcast-booking/, a page on the
// website of Moburst, another client. Such a page is used for text only: it
// feeds the brief, pillars, keywords and competitor identification, never the
// other client's logo, brand, location, profile links or RivalIQ company
// (steps.ts brand_read, accounts and tracking; competitive/landscapeCheck.ts
// landscapeClient). A page is under another client only when that client
// sits above it: on the same site (net/domains.ts siteMatch, where a client
// on a subdomain of its own owns that host only) with a path that is a strict
// prefix of the page's (a homepage is above every page). So Kitcaster's page
// is under Moburst's homepage; a client stored as www.moburst.com/en/ is under
// nobody unless a client sits above it; two pages side by side (/x and /y)
// mark neither. A subdomain whose homepage is the stated site (Uproar on
// uproar.moburst.com) has no path, so it is a site of its own. Free of Deno
// and network imports so it can be tested.

import { pathSegments, siteMatch } from "../net/domains.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** True when the other website's path is a strict prefix of the page's, segment by segment (a homepage's is a prefix of every path). */
function above(other: string[], page: string[]): boolean {
  return other.length < page.length && other.every((segment, i) => segment === page[i]);
}

/**
 * True when the website is a page under another client's website: on that
 * client's site, with that client's path a strict prefix of its own.
 */
export function isParentPage(website: string | null, otherSites: Array<string | null>): boolean {
  const page = pathSegments(website);
  if (!page.length) return false;
  return otherSites.some((site) => !!str(site) && siteMatch(website, site) !== null && above(pathSegments(site), page));
}

/** The websites of the other clients: active (not archived), never a demo copy. */
export async function otherClientSites(db: Db, clientId: string): Promise<string[]> {
  const { data, error } = await db.from("clients").select("website_url").is("archived_at", null).is("demo_job_id", null).neq("id", clientId).not("website_url", "is", null);
  if (error) throw new Error(`Could not read the other clients' websites: ${error.message}`);
  return ((data ?? []) as Array<{ website_url: unknown }>).map((r) => str(r.website_url)).filter(Boolean);
}

/**
 * True when the client's website is a page on another client's site. The
 * other clients are read only for a website with a path, so a client whose
 * website is a homepage (a plain domain or a subdomain of its own) costs no
 * read and is never one.
 */
export async function parentPageFor(db: Db, client: { id?: unknown; website_url?: unknown }): Promise<boolean> {
  const website = str(client.website_url);
  if (!pathSegments(website).length) return false;
  return isParentPage(website, await otherClientSites(db, String(client.id)));
}
