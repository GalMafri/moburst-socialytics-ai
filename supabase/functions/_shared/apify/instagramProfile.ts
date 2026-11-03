// supabase/functions/_shared/apify/instagramProfile.ts
//
// A client's Instagram bio and bio links, read through Apify (Lital, 3 Nov
// 2026: Instagram bios are a source now, read through the public-data tools
// the app already uses, at their per-run cost; once per client, and again
// only on the weekly refresh when the profile changed). Sprout's API has no
// bio or bio link. The run uses the app's Apify client and token
// (apify/client.ts, APIFY_API_TOKEN) with Apify's own Instagram profile
// actor, apify/instagram-profile-scraper, for one username a run.
//
// A run is started and waited on for up to a minute; one still going is
// kept by its id and its dataset read on the next look, so the step never
// starts a second paid run for the same profile. No token means no run and
// no cost (ApifyTokenMissing), and the step reads it once the token is set.

import { type ApifyClient, isFinalRunStatus } from "./client.ts";

/** Apify's Instagram profile actor, named as its store lists it (owner~name works wherever an actor id does). */
export const INSTAGRAM_PROFILE_ACTOR = { id: "apify~instagram-profile-scraper", name: "apify/instagram-profile-scraper", timeoutSecs: 120 } as const;

export interface InstagramBio {
  handle: string;
  biography: string;
  /** The bio's links: its external URL and any others the profile lists. */
  links: string[];
  full_name: string | null;
  category: string | null;
}

export type BioRead =
  | { state: "read"; bio: InstagramBio | null; run_id: string; usd: number | null }
  | { state: "pending"; run_id: string }
  | { state: "failed"; run_id: string; status: string };

const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The bio in one of the actor's dataset items, for the handle asked about. */
export function bioFromItem(item: unknown, handle: string): InstagramBio | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const username = clean(o.username)?.toLowerCase();
  if (username && username !== handle.toLowerCase().replace(/^@/, "")) return null;
  const links = new Set<string>();
  const add = (v: unknown) => {
    const url = clean(typeof v === "object" && v ? (v as Record<string, unknown>).url : v);
    if (url && /^https?:\/\//i.test(url)) links.add(url);
  };
  add(o.externalUrl);
  if (Array.isArray(o.externalUrls)) o.externalUrls.forEach(add);
  const biography = clean(o.biography) ?? "";
  if (!biography && !links.size) return null;
  return { handle: handle.replace(/^@/, ""), biography: biography.slice(0, 600), links: [...links].slice(0, 5), full_name: clean(o.fullName), category: clean(o.businessCategoryName) };
}

async function finished(apify: ApifyClient, runId: string, datasetId: string, handle: string, usd: unknown): Promise<BioRead> {
  const items = await apify.datasetItems(datasetId, { pageSize: 10, maxItems: 10 });
  const bio = items.map((i) => bioFromItem(i, handle)).find(Boolean) ?? null;
  return { state: "read", bio, run_id: runId, usd: typeof usd === "number" ? usd : null };
}

/**
 * The profile's bio: a run started now and waited on for up to a minute,
 * or, given the id of a run an earlier look started, that run's answer.
 */
export async function readInstagramBio(apify: ApifyClient, handle: string, o: { runId?: string | null; waitSecs?: number } = {}): Promise<BioRead> {
  const run = o.runId
    ? await apify.getRun(o.runId)
    : await apify.startRun(INSTAGRAM_PROFILE_ACTOR.id, { usernames: [handle.replace(/^@/, "")] }, { timeoutSecs: INSTAGRAM_PROFILE_ACTOR.timeoutSecs });
  const now = isFinalRunStatus(run.status) ? run : await apify.getRun(run.id, { waitSecs: o.waitSecs ?? 60 });
  if (!isFinalRunStatus(now.status)) return { state: "pending", run_id: now.id };
  if (now.status !== "SUCCEEDED") return { state: "failed", run_id: now.id, status: now.status };
  return finished(apify, now.id, now.defaultDatasetId, handle, now.usageTotalUsd);
}
