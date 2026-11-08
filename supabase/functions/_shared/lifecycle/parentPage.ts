// supabase/functions/_shared/lifecycle/parentPage.ts
//
// A client whose website is a page on another client's site (spec:
// docs/superpowers/specs/2026-11-08-onboarding-profile-pages-and-no-n8n-
// design.md, section B). Kitcaster's own LinkedIn page states
// https://www.moburst.com/services/organic/podcast-booking/, a page on the
// website of Moburst, another client. Such a page is used for text only: it
// feeds the brief, pillars, keywords and competitor identification, never the
// other client's logo, brand, location, profile links or RivalIQ company
// (steps.ts brand_read, accounts and tracking). A subdomain whose homepage is
// the stated site (Uproar on uproar.moburst.com) has no path, so it is a site
// of its own. "Another client's site" follows net/domains.ts siteMatch: a
// client on a subdomain of its own owns that host only. Free of Deno and
// network imports so it can be tested.

import { siteMatch } from "../net/domains.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The website's path without trailing slashes ("/services/organic/podcast-booking"), or "" for a homepage or no website. */
function pathOf(website: string | null | undefined): string {
  const raw = str(website);
  if (!raw) return "";
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** True when the website has a path other than "/" and is on the site of one of the other clients' websites. */
export function isParentPage(website: string | null, otherSites: Array<string | null>): boolean {
  if (!pathOf(website)) return false;
  return otherSites.some((site) => !!str(site) && siteMatch(website, site) !== null);
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
  if (!pathOf(website)) return false;
  return isParentPage(website, await otherClientSites(db, String(client.id)));
}
