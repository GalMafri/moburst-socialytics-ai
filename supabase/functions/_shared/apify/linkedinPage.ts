// supabase/functions/_shared/apify/linkedinPage.ts
//
// A client's LinkedIn company page, read through Apify: the website the
// company states, its about text, logo and headquarters. The run uses the
// app's Apify client and token (apify/client.ts, APIFY_API_TOKEN) with the
// harvestapi LinkedIn company actor, for one page address a run.
//
// Same flow as the Instagram bio read: a run is started and waited on for up
// to a minute; one still going is kept by its id and its dataset read on the
// next look, so the step never starts a second paid run for the same page.

import { type ApifyClient, isFinalRunStatus } from "./client.ts";

/** The LinkedIn company actor, named as its store lists it (owner~name works wherever an actor id does). */
export const LINKEDIN_PAGE_ACTOR = { id: "harvestapi~linkedin-company", name: "harvestapi/linkedin-company", timeoutSecs: 120 } as const;

export interface LinkedInPage {
  url: string;
  name: string | null;
  website: string | null;
  about: string;
  tagline: string | null;
  specialties: string[];
  industries: string[];
  logo: { url: string; width: number | null; height: number | null } | null;
  headquarters: { line1: string | null; city: string | null; region: string | null; postalCode: string | null; country: string | null } | null;
}

export type PageRead =
  | { state: "read"; page: LinkedInPage | null; run_id: string; usd: number | null }
  | { state: "pending"; run_id: string }
  | { state: "failed"; run_id: string; status: string };

const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);

/** The company page address for a native name (the part after /company/). */
export function pageUrlOf(nativeName: string): string {
  return `https://www.linkedin.com/company/${nativeName}/`;
}

/** The native name in a company page address, lowercased, or null when the address has none. */
const slugOf = (url: string) => /\/company\/([^/?#]+)/i.exec(url)?.[1]?.toLowerCase() ?? null;

/** The largest logo the page lists, else its single logo with no size. */
function logoOf(o: Record<string, unknown>): LinkedInPage["logo"] {
  const sized = (Array.isArray(o.logos) ? o.logos : [])
    .map((l) => ({ url: clean(rec(l)?.url), width: num(rec(l)?.width), height: num(rec(l)?.height) }))
    .filter((l): l is { url: string; width: number | null; height: number | null } => !!l.url)
    .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
  if (sized.length) return sized[0];
  const single = clean(o.logo);
  return single ? { url: single, width: null, height: null } : null;
}

/** The headquarters: the location marked as one, else the first location. */
function headquartersOf(o: Record<string, unknown>): LinkedInPage["headquarters"] {
  const locations = (Array.isArray(o.locations) ? o.locations : []).map(rec).filter((l): l is Record<string, unknown> => !!l);
  const hq = locations.find((l) => l.headquarter === true) ?? locations[0];
  if (!hq) return null;
  return { line1: clean(hq.line1), city: clean(hq.city), region: clean(hq.geographicArea), postalCode: clean(hq.postalCode), country: clean(hq.country) };
}

/** The page in one of the actor's dataset items, for the address asked about. */
export function pageFromItem(item: unknown, url: string): LinkedInPage | null {
  const o = rec(item);
  if (!o) return null;
  const universal = clean(o.universalName)?.toLowerCase();
  const wanted = slugOf(url);
  if (universal && wanted && universal !== wanted) return null;
  const website = clean(o.website);
  const about = clean(o.description) ?? "";
  const logo = logoOf(o);
  if (!website && !about && !logo) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.map(clean).filter((s): s is string => !!s) : []);
  const industries = (Array.isArray(o.industries) ? o.industries : []).map((i) => clean(typeof i === "string" ? i : rec(i)?.name)).filter((s): s is string => !!s);
  return { url, name: clean(o.name), website, about: about.slice(0, 3000), tagline: clean(o.tagline), specialties: strings(o.specialities ?? o.specialties), industries, logo, headquarters: headquartersOf(o) };
}

async function finished(apify: ApifyClient, runId: string, datasetId: string, url: string, usd: unknown): Promise<PageRead> {
  const items = await apify.datasetItems(datasetId, { pageSize: 10, maxItems: 10 });
  const page = items.map((i) => pageFromItem(i, url)).find(Boolean) ?? null;
  return { state: "read", page, run_id: runId, usd: typeof usd === "number" ? usd : null };
}

/**
 * The company page: a run started now and waited on for up to a minute,
 * or, given the id of a run an earlier look started, that run's answer.
 */
export async function readLinkedInPage(apify: ApifyClient, url: string, o: { runId?: string | null; waitSecs?: number } = {}): Promise<PageRead> {
  const run = o.runId
    ? await apify.getRun(o.runId)
    : await apify.startRun(LINKEDIN_PAGE_ACTOR.id, { companies: [url] }, { timeoutSecs: LINKEDIN_PAGE_ACTOR.timeoutSecs });
  const now = isFinalRunStatus(run.status) ? run : await apify.getRun(run.id, { waitSecs: o.waitSecs ?? 60 });
  if (!isFinalRunStatus(now.status)) return { state: "pending", run_id: now.id };
  if (now.status !== "SUCCEEDED") return { state: "failed", run_id: now.id, status: now.status };
  return finished(apify, now.id, now.defaultDatasetId, url, now.usageTotalUsd);
}
