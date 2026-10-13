// Does this client have a RivalIQ landscape a run can use?
//
// One answer for every caller: run-report (manual runs and retries), the
// scheduled dispatch in run-scheduled-jobs, and the competitor feed refresh.
// Each used to carry its own copy of this check, and the scheduler had none,
// so a scheduled competitive report could be created and posted to n8n for a
// client nobody had set up, and only fail inside the workflow.
//
// Two different "no" answers, because they need different people:
//   RIVALIQ_CLIENT_NOT_TRACKED  the current set has no linked landscape and no
//                               landscape on the account tracks the client.
//                               That is setup still to do, not a fault.
//   RIVALIQ_LANDSCAPE_MISSING   the current set names a landscape that no
//                               longer exists, or no longer tracks the client
//                               as exactly one company. Something that worked
//                               has broken, and staff need to hear about it.

import { bestLandscapeMatch, summarizeLandscapes, type LandscapeSummary, type RivalIqLandscape } from "./rivaliqLandscape.ts";
import { rivalIqFetch } from "./rivaliqFetch.ts";

export const CLIENT_NOT_TRACKED = "RIVALIQ_CLIENT_NOT_TRACKED";
export const LANDSCAPE_MISSING = "RIVALIQ_LANDSCAPE_MISSING";
export const RIVALIQ_BUSY = "RIVALIQ_BUSY";
export const RIVALIQ_UNAVAILABLE = "RIVALIQ_UNAVAILABLE";

/** Landscapes created by setup-rivaliq-landscape carry this prefix in their name. */
export const APP_LANDSCAPE_PREFIX = "Socialytics - ";

export interface LandscapeClient {
  name: string;
  website_url?: string | null;
}

export type LandscapeResolution =
  | { ok: true; summary: LandscapeSummary & { client_company_id: string }; landscape: RivalIqLandscape; linked: boolean }
  | { ok: false; code: typeof CLIENT_NOT_TRACKED | typeof LANDSCAPE_MISSING; message: string; landscapeId: string | null };

export type LandscapeCheck =
  | LandscapeResolution
  | { ok: false; code: typeof RIVALIQ_BUSY | typeof RIVALIQ_UNAVAILABLE; message: string; status: number | null };

/** True when the answer is about setup or a broken link, not a provider that could not be asked. */
export const isTrackingProblem = (c: LandscapeCheck): c is Extract<LandscapeResolution, { ok: false }> =>
  "code" in c && (c.code === CLIENT_NOT_TRACKED || c.code === LANDSCAPE_MISSING);

/** A set keeps the landscape it was linked to, so the way back is a selection linked afresh. */
const RECONNECT = "On the Competitors screen, import a landscape that tracks the client, or set up tracking for a new selection.";

const linkedIdOf = (value: unknown): string | null => {
  const id = value == null ? "" : String(value).trim();
  return id ? id : null;
};

/**
 * Pick the landscape for a client from RivalIQ's /v3/landscapes list.
 *
 * A linked id is a selection, not proof of identity: the landscape it names
 * must still track the client as exactly one company. Without a link, the
 * strongest match on the account is used, as before.
 */
export function resolveClientLandscape(
  landscapes: RivalIqLandscape[],
  client: LandscapeClient,
  linkedLandscapeId: unknown,
): LandscapeResolution {
  const listed = summarizeLandscapes(landscapes || [], client.name, client.website_url);
  const linked = linkedIdOf(linkedLandscapeId);
  const match = linked ? listed.find((l) => l.id === linked) : bestLandscapeMatch(listed);
  if (match?.is_match && match.client_company_id) {
    const landscape = (landscapes || []).find((l) => String(l.id) === match.id)!;
    return { ok: true, summary: match as LandscapeSummary & { client_company_id: string }, landscape, linked: !!linked };
  }
  if (linked) {
    return {
      ok: false,
      code: LANDSCAPE_MISSING,
      landscapeId: linked,
      message: match
        ? `The RivalIQ landscape linked to ${client.name}'s competitor set (${linked}) no longer tracks ${client.name} as exactly one company. ${RECONNECT}`
        : `The RivalIQ landscape linked to ${client.name}'s competitor set (${linked}) no longer exists. ${RECONNECT}`,
    };
  }
  return {
    ok: false,
    code: CLIENT_NOT_TRACKED,
    landscapeId: null,
    message:
      `No RivalIQ landscape tracks ${client.name}. Use Set up RivalIQ tracking on the Competitors screen ` +
      `to connect the reviewed companies, or import an existing matching landscape. No RivalIQ sign-in is required.`,
  };
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Read the account's landscapes (one RivalIQ call) and resolve the client's. Never throws. */
export async function checkClientLandscape(
  key: string,
  client: LandscapeClient,
  linkedLandscapeId: unknown,
  fetchImpl: Fetcher = rivalIqFetch,
): Promise<LandscapeCheck> {
  let response: Response;
  try {
    response = await fetchImpl(`https://api.rivaliq.com/v3/landscapes?apiKey=${encodeURIComponent(key)}`, { headers: { Accept: "application/json" } });
  } catch {
    return { ok: false, code: RIVALIQ_UNAVAILABLE, status: null, message: "RivalIQ could not be reached to check tracking." };
  }
  if (response.status === 429) {
    await response.body?.cancel().catch(() => {});
    return { ok: false, code: RIVALIQ_BUSY, status: 429, message: "RivalIQ cannot accept a new request yet." };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { ok: false, code: RIVALIQ_UNAVAILABLE, status: response.status, message: `RivalIQ connection check failed (HTTP ${response.status}).` };
  }
  let body: { landscapes?: RivalIqLandscape[] } | null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: RIVALIQ_UNAVAILABLE, status: response.status, message: "RivalIQ answered the tracking check with something unreadable." };
  }
  return resolveClientLandscape(Array.isArray(body?.landscapes) ? body!.landscapes! : [], client, linkedLandscapeId);
}

export interface SetupJobRecord {
  landscape_id: string | number | null;
  plan: { name?: string | null } | null;
}

/**
 * Whether the app created this landscape, so the app may edit its companies.
 *
 * Only a landscape a setup job recorded, still carrying that setup's own
 * "Socialytics - ..." name, qualifies. Everything else (a strategy team's
 * shared "TIER 2 FIRMS", an imported landscape, or an existing landscape a
 * setup reused because it already held every company) belongs to someone
 * else and is read, never written.
 */
export function isAppCreatedLandscape(landscape: { id: string | number; name?: string | null }, setupJobs: SetupJobRecord[]): boolean {
  const name = String(landscape.name || "");
  if (!name.startsWith(APP_LANDSCAPE_PREFIX)) return false;
  return (setupJobs || []).some((job) =>
    job.landscape_id != null && String(job.landscape_id) === String(landscape.id) && job.plan?.name === name);
}
