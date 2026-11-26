// supabase/functions/_shared/lifecycle/portal.ts
//
// Client access from the portal's sign-in (spec section 1.4). A client's
// company slug is set when it is created, with the portal's slug rule. When
// a signed-in user's portal company slug matches no client, it is matched to
// a client whose slug nobody set (or the lifecycle set from its name) by
// exact name: the slug equals the client name's slug, or, for a user with
// one company, the portal's organization name equals the client name. The
// hub company name comes from the portal's organization name when the client
// has none. Exact equality only, and only when exactly one client fits.

import { lifecycleMayWrite, writeClientFields } from "./fields.ts";
import { sameName, slugify } from "./names.ts";

export interface PortalClient {
  id: string;
  name: string;
  company_slug: string | null;
  hub_company_name: string | null;
  field_sources?: unknown;
}

export interface PortalLink {
  client_id: string;
  fields: { company_slug?: string; hub_company_name?: string };
  matched_by: "slug" | "organization" | "existing";
}

/** What a sign-in with these company slugs and this organization name links. Pure. */
export function portalLinks(clients: PortalClient[], slugs: string[], organization: string | null | undefined): PortalLink[] {
  const wanted = [...new Set(slugs.map((s) => String(s || "").trim()).filter(Boolean))];
  const org = String(organization || "").trim();
  const known = new Map(clients.filter((c) => c.company_slug).map((c) => [String(c.company_slug), c]));
  const open = (c: PortalClient) => !c.company_slug || lifecycleMayWrite(c.field_sources, "company_slug");
  const links: PortalLink[] = [];
  const taken = new Set<string>();
  for (const slug of wanted) {
    if (known.has(slug)) {
      links.push({ client_id: known.get(slug)!.id, fields: {}, matched_by: "existing" });
      continue;
    }
    let fits = clients.filter((c) => open(c) && !taken.has(c.id) && slugify(c.name) === slug);
    let by: PortalLink["matched_by"] = "slug";
    if (fits.length === 0 && wanted.length === 1 && org) {
      fits = clients.filter((c) => open(c) && !taken.has(c.id) && sameName(c.name, org));
      by = "organization";
    }
    if (fits.length !== 1) continue;
    taken.add(fits[0].id);
    links.push({ client_id: fits[0].id, fields: { company_slug: slug }, matched_by: by });
  }
  // The organization name is the hub company name only for a user with one company.
  if (wanted.length === 1 && org && links.length === 1) {
    const client = clients.find((c) => c.id === links[0].client_id);
    if (client && !String(client.hub_company_name || "").trim()) links[0].fields.hub_company_name = org;
  }
  return links.filter((l) => Object.keys(l.fields).length > 0);
}

// deno-lint-ignore no-explicit-any
type Db = any;

/** Apply portalLinks for one sign-in. Never throws: a sign-in never fails because of it. */
export async function linkPortalCompanies(db: Db, slugs: string[], organization: string | null | undefined): Promise<PortalLink[]> {
  try {
    if (!slugs.length) return [];
    const { data, error } = await db.from("clients").select("id, name, company_slug, hub_company_name, field_sources").is("archived_at", null).is("demo_job_id", null);
    if (error) throw new Error(error.message);
    const links = portalLinks((data ?? []) as PortalClient[], slugs, organization);
    for (const l of links) await writeClientFields(db, l.client_id, l.fields, "portal");
    if (links.length) console.log("[portal-link]", JSON.stringify(links.map((l) => ({ client_id: l.client_id, fields: Object.keys(l.fields), by: l.matched_by }))));
    return links;
  } catch (e) {
    console.warn("[portal-link] could not link the portal company:", e instanceof Error ? e.message : String(e));
    return [];
  }
}

/**
 * The client a tools.moburst (Hub) company names, for a client user whose company no client's hub company name
 * matches yet. Socialytics is opened from moburst.ai, which scopes by company slug, and from tools.moburst, which
 * scopes by the Hub's company name; on 26 Nov 2026 16 of 18 clients had no Hub company name, so their users from
 * tools.moburst were given no client. The client whose name is the company's, or gives the same slug: exactly one,
 * with no hub company name yet and none a person set. Pure.
 */
export function hubCompanyMatch(clients: PortalClient[], company: string | null | undefined): string | null {
  const name = String(company || "").trim();
  if (!name) return null;
  const open = clients.filter((c) => !String(c.hub_company_name || "").trim() && lifecycleMayWrite(c.field_sources, "hub_company_name"));
  let fits = open.filter((c) => sameName(c.name, name));
  const slug = slugify(name);
  if (fits.length === 0 && slug !== "client") fits = open.filter((c) => slugify(c.name) === slug || String(c.company_slug || "") === slug);
  return fits.length === 1 ? fits[0].id : null;
}

/** Saves the company as that client's hub company name, and gives its id. Never throws: a sign-in never fails because of it. */
export async function linkHubCompany(db: Db, company: string): Promise<string[]> {
  try {
    const { data, error } = await db.from("clients").select("id, name, company_slug, hub_company_name, field_sources").is("archived_at", null).is("demo_job_id", null);
    if (error) throw new Error(error.message);
    const id = hubCompanyMatch((data ?? []) as PortalClient[], company);
    if (!id) return [];
    const written = await writeClientFields(db, id, { hub_company_name: company.trim() }, "portal");
    if (!written.written.includes("hub_company_name")) return [];
    console.log("[hub-link]", JSON.stringify({ client_id: id }));
    return [id];
  } catch (e) {
    console.warn("[hub-link] could not link the Hub company:", e instanceof Error ? e.message : String(e));
    return [];
  }
}
