// Does this client have a RivalIQ landscape a run can use?
//
// One answer for every caller: run-report (manual runs and retries), the
// scheduled dispatch in run-scheduled-jobs, and the competitor feed refresh.
// Each used to carry its own copy of this check, and the scheduler had none,
// so a scheduled competitive report could be created and posted to n8n for a
// client nobody had set up, and only fail inside the workflow.
//
// Three different "no" answers, because different things follow from them:
//   RIVALIQ_CLIENT_NOT_TRACKED       the current set has no linked landscape
//                                    and none on the account tracks it. That
//                                    is setup still to do, not a fault.
//   RIVALIQ_SELECTION_NOT_COVERED    the current set's linked landscape is
//                                    there, but does not hold the client once
//                                    and every confirmed competitor once (the
//                                    selection changed, or is not fully
//                                    covered). The analysis waits. The link
//                                    is kept: nothing is reset or removed.
//   RIVALIQ_LANDSCAPE_MISSING        the current set names a landscape that is
//                                    not on the account any more. Only this
//                                    one lets the lifecycle start tracking
//                                    again, and only as the selection decision
//                                    recorded it (gone), from a complete answer.
//
// A check never destroys a link as a side effect. A link is hard to win back
// (the tracking plan can be full), so the only answer that leads to a reset is
// "the linked landscape is not in a readable, non-empty list of the account's
// landscapes". An answer that is empty, malformed or incomplete is a provider
// that could not be asked (RIVALIQ_UNAVAILABLE): recorded nowhere.
//
// Every caller asks with landscapeClient: a client whose website is a page on
// another client's site is matched by its name only (lifecycle/parentPage.ts).
//
// One record. A competitive analysis asks more than the feed does: the
// landscape must hold the client and every confirmed competitor, each exactly
// once. That answer is resolveSelectionLandscape, the one shared decision of
// selectionTracking.ts that the pipeline's landscape step makes too, and it
// is the only one written on the set (competitor_sets.tracking_check). The
// feed still asks its own narrower question to decide whether it can read
// posts (resolveClientLandscape: does a landscape track the client?), but it
// records the selection decision from the same answer (checkFeedLandscape),
// so a feed refresh never overwrites what the dispatch decided and no screen
// flips between tracked and not.

import { bestLandscapeMatch, summarizeLandscape, summarizeLandscapes, type LandscapeSummary, type RivalIqLandscape } from "./rivaliqLandscape.ts";
import { CLIENT_NOT_TRACKED, LANDSCAPE_MISSING, SELECTION_NOT_COVERED, selectionTracking, unreadableLandscapes, type SelectedCompany, type Uncovered } from "./selectionTracking.ts";
import { rivalIqFetch } from "./rivaliqFetch.ts";
import { parentPageFor } from "../lifecycle/parentPage.ts";

export { CLIENT_NOT_TRACKED, LANDSCAPE_MISSING, SELECTION_NOT_COVERED };
export const RIVALIQ_BUSY = "RIVALIQ_BUSY";
export const RIVALIQ_UNAVAILABLE = "RIVALIQ_UNAVAILABLE";

/** Landscapes created by the app's tracking setup (rivaliqSetupRun.ts) carry this prefix in their name. */
export const APP_LANDSCAPE_PREFIX = "Socialytics - ";

export interface LandscapeClient {
  name: string;
  website_url?: string | null;
}

/**
 * The client as every landscape check and the import screen match it. A
 * website that is a page on another client's site (lifecycle/parentPage.ts:
 * Kitcaster's page on moburst.com) is left out, so the client is matched by
 * its name only and never takes that client's RivalIQ company. Any other
 * website is kept as it is, with no read of other clients.
 */
export async function landscapeClient(db: Db, client: { id?: unknown; name?: unknown; website_url?: unknown }): Promise<LandscapeClient> {
  const website = typeof client.website_url === "string" ? client.website_url : null;
  return { name: String(client.name ?? ""), website_url: (await parentPageFor(db, client)) ? null : website };
}

/**
 * `selection` marks the selection decision (resolveSelectionLandscape): the
 * only kind of answer written on the set. On a "no" from it, `gone` says the
 * linked landscape is not on the account any more, and `uncovered` what a
 * linked landscape that is still there does not hold.
 */
export type LandscapeResolution =
  | { ok: true; summary: LandscapeSummary & { client_company_id: string }; landscape: RivalIqLandscape; linked: boolean; selection?: true }
  | {
    ok: false; code: typeof CLIENT_NOT_TRACKED | typeof LANDSCAPE_MISSING | typeof SELECTION_NOT_COVERED; message: string; landscapeId: string | null;
    selection?: true; gone?: true; uncovered?: Uncovered;
  };

type Unasked = { ok: false; code: typeof RIVALIQ_BUSY | typeof RIVALIQ_UNAVAILABLE; message: string; status: number | null };

export type LandscapeCheck = LandscapeResolution | Unasked;

/** True when the answer is about tracking (not set up, not covered, or gone), not a provider that could not be asked. */
export const isTrackingProblem = (c: LandscapeCheck): c is Extract<LandscapeResolution, { ok: false }> =>
  "code" in c && (c.code === CLIENT_NOT_TRACKED || c.code === LANDSCAPE_MISSING || c.code === SELECTION_NOT_COVERED);

/** A set keeps the landscape it was linked to, so the way back is a selection linked afresh. */
const RECONNECT = "On the Competitors screen, import a landscape that tracks the client, or set up tracking for a new selection.";

const linkedIdOf = (value: unknown): string | null => {
  const id = value == null ? "" : String(value).trim();
  return id ? id : null;
};

/**
 * Pick the landscape for a client from RivalIQ's /v3/landscapes list: the
 * feed's own question, whether there is a landscape it can read the client's
 * and the tracked companies' posts from.
 *
 * A linked id is a selection, not proof of identity: the landscape it names
 * must still track the client as exactly one company. Without a link, the
 * strongest match on the account is used, as before. This answer is never
 * written on the set (trackingCheckRecord), so it cannot lead to a reset.
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

/** Tracking for a confirmed selection is the lifecycle's work, so nothing here asks a person to act. */
const CONNECTS = "Tracking for the confirmed competitors is connected on its own, and the analysis runs once it is.";

const andList = (names: string[]) => (names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * Is this confirmed selection tracked, for a competitive analysis? The shared
 * decision (selectionTracking.ts) as a landscape check: the set's linked
 * landscape, or with no link one landscape on the account, must hold the
 * client exactly once and every confirmed competitor exactly once.
 *
 *   no link, none fits          CLIENT_NOT_TRACKED: setup still under way,
 *                               the run waits.
 *   link there, not covering    SELECTION_NOT_COVERED: the run waits and the
 *                               link is kept. Nothing resets it.
 *   link not in the list        LANDSCAPE_MISSING, gone: the lifecycle starts
 *                               tracking again, as before.
 *   answer not readable         RIVALIQ_UNAVAILABLE: nothing is concluded.
 */
export function resolveSelectionLandscape(
  landscapes: RivalIqLandscape[],
  client: LandscapeClient,
  selection: SelectedCompany[],
  linkedLandscapeId: unknown,
): LandscapeCheck {
  const linked = linkedIdOf(linkedLandscapeId);
  const found = selectionTracking(landscapes, client, selection, linked);
  if (found.tracked === true) {
    const landscape = found.landscape as RivalIqLandscape;
    const summary = { ...summarizeLandscape(landscape, client.name, client.website_url), is_match: true, client_company_id: String(found.client_company.id) };
    return { ok: true, summary, landscape, linked: !!linked, selection: true };
  }
  if ("unreadable" in found) return { ok: false, code: RIVALIQ_UNAVAILABLE, status: null, message: `RivalIQ's answer to the tracking check could not be read as the account's landscapes (${found.message}).` };
  if (!linked) return { ok: false, code: CLIENT_NOT_TRACKED, landscapeId: null, selection: true, message: `No RivalIQ landscape tracks ${client.name} and every confirmed competitor yet. ${CONNECTS}` };
  const named = `The RivalIQ landscape linked to ${client.name}'s competitor set (${linked})`;
  if (found.code === "LANDSCAPE_NOT_FOUND") {
    return { ok: false, code: LANDSCAPE_MISSING, landscapeId: linked, selection: true, gone: true, message: `${named} no longer exists. ${CONNECTS}` };
  }
  const uncovered = found.uncovered ?? { client: found.code === "CLIENT_IDENTITY_UNVERIFIED", competitors: [] };
  const what = uncovered.client ? `it does not track ${client.name} as exactly one company`
    : uncovered.competitors.length ? `it does not track ${andList(uncovered.competitors)} exactly once`
    : "it does not track every confirmed competitor exactly once";
  return {
    ok: false, code: SELECTION_NOT_COVERED, landscapeId: linked, selection: true, uncovered,
    message: `${named} does not hold the confirmed selection: ${what}. The analysis waits until it does, and the link is kept as it is.`,
  };
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Read the account's landscapes (one RivalIQ call) and resolve the confirmed selection's. Never throws. */
export async function checkSelectionLandscape(
  key: string,
  client: LandscapeClient,
  selection: SelectedCompany[],
  linkedLandscapeId: unknown,
  fetchImpl: Fetcher = rivalIqFetch,
): Promise<LandscapeCheck> {
  const read = await readLandscapes(key, fetchImpl);
  return "landscapes" in read ? resolveSelectionLandscape(read.landscapes, client, selection, linkedLandscapeId) : read;
}

/** Read the account's landscapes (one RivalIQ call) and resolve the client's. Never throws. */
export async function checkClientLandscape(
  key: string,
  client: LandscapeClient,
  linkedLandscapeId: unknown,
  fetchImpl: Fetcher = rivalIqFetch,
): Promise<LandscapeCheck> {
  const read = await readLandscapes(key, fetchImpl);
  return "landscapes" in read ? resolveClientLandscape(read.landscapes, client, linkedLandscapeId) : read;
}

/**
 * The feed's read, one RivalIQ call for two answers:
 *   feed       can the feed read posts (resolveClientLandscape: a landscape
 *              tracks the client)? Its own gate, never written on the set.
 *   selection  the selection decision from the same answer: the one record
 *              (recordTrackingCheck), exactly what the dispatch would write.
 * Never throws.
 */
export async function checkFeedLandscape(
  key: string,
  client: LandscapeClient,
  selection: SelectedCompany[],
  linkedLandscapeId: unknown,
  fetchImpl: Fetcher = rivalIqFetch,
): Promise<{ feed: LandscapeCheck; selection: LandscapeCheck }> {
  const read = await readLandscapes(key, fetchImpl);
  if (!("landscapes" in read)) return { feed: read, selection: read };
  return {
    feed: resolveClientLandscape(read.landscapes, client, linkedLandscapeId),
    selection: resolveSelectionLandscape(read.landscapes, client, selection, linkedLandscapeId),
  };
}

/**
 * The account's landscapes, or why RivalIQ could not be asked. Only a 200
 * whose body holds a non-empty `landscapes` list with an id on every entry is
 * an answer; an empty or unrecognized 200 is a provider that could not be
 * asked, so nothing is concluded or recorded from it (above all, not that a
 * linked landscape is gone).
 */
async function readLandscapes(key: string, fetchImpl: Fetcher): Promise<{ landscapes: RivalIqLandscape[] } | Unasked> {
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
  let body: { landscapes?: unknown } | null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: RIVALIQ_UNAVAILABLE, status: response.status, message: "RivalIQ answered the tracking check with something unreadable." };
  }
  const landscapes = body && typeof body === "object" ? (body as { landscapes?: unknown }).landscapes : undefined;
  if (unreadableLandscapes(landscapes)) {
    return { ok: false, code: RIVALIQ_UNAVAILABLE, status: response.status, message: "RivalIQ answered the tracking check with no landscapes, or with something that is not its list of them." };
  }
  return { landscapes: landscapes as RivalIqLandscape[] };
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

/**
 * What competitor_sets.tracking_check holds: the last selection decision
 * about the set (resolveSelectionLandscape). Every screen, the schedule's
 * note and the run request read whether the set is tracked from this one
 * record (selectionTracking.ts trackedOnRecord).
 */
export interface TrackingCheckRecord {
  code: "ok" | typeof CLIENT_NOT_TRACKED | typeof LANDSCAPE_MISSING | typeof SELECTION_NOT_COVERED;
  landscape_id: string | null;
  message: string | null;
  checked_at: string;
  /**
   * For a set with no link: the landscape the decision found holding the
   * client and every confirmed competitor.
   */
  found_landscape_id?: string;
  /**
   * With LANDSCAPE_MISSING: the linked landscape was not in a readable,
   * non-empty list of the account's landscapes. The lifecycle starts tracking
   * again only for a record that carries it (lifecycle/steps.ts, tracking).
   */
  gone?: true;
  /** With SELECTION_NOT_COVERED: what the linked landscape does not hold, for the screen that says so. */
  uncovered?: Uncovered;
}

/**
 * The record for a check, or null when there is nothing to write: the
 * provider could not be asked (that says nothing about the landscape), or the
 * answer is not the selection decision (the feed's own narrower question
 * never overwrites it).
 */
export function trackingCheckRecord(check: LandscapeCheck, linkedLandscapeId: unknown, now = new Date()): TrackingCheckRecord | null {
  const landscape_id = linkedIdOf(linkedLandscapeId);
  if (!isTrackingProblem(check) && !check.ok) return null;
  if (!("selection" in check) || check.selection !== true) return null;
  if (check.ok === true) {
    const found = landscape_id ? {} : { found_landscape_id: String(check.summary.id) };
    return { code: "ok", landscape_id, message: null, checked_at: now.toISOString(), ...found };
  }
  return {
    code: check.code, landscape_id, message: check.message, checked_at: now.toISOString(),
    ...(check.code === LANDSCAPE_MISSING && check.gone ? { gone: true as const } : {}),
    ...(check.code === SELECTION_NOT_COVERED && check.uncovered ? { uncovered: check.uncovered } : {}),
  };
}

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any };

/**
 * Keep the selection decision on the set it was made for, so every screen can
 * show the real state without asking RivalIQ itself. Any other answer writes
 * nothing. Best effort: a failed write (or a database without the column
 * yet) never stops a run.
 */
export async function recordTrackingCheck(db: Db, setId: string | null | undefined, linkedLandscapeId: unknown, check: LandscapeCheck): Promise<void> {
  const record = trackingCheckRecord(check, linkedLandscapeId);
  if (!setId || !record) return;
  try {
    const { error } = await db.from("competitor_sets").update({ tracking_check: record }).eq("id", setId);
    if (error) console.warn("[landscapeCheck] could not record the tracking check:", error.message);
  } catch (e) {
    console.warn("[landscapeCheck] could not record the tracking check:", e instanceof Error ? e.message : String(e));
  }
}
