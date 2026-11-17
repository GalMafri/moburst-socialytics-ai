// Is the confirmed selection tracked? The one answer.
//
// A competitive analysis runs only when the confirmed set is tracked: the
// landscape the set is linked to, or (for a set with no link yet) one
// landscape on the account, holds the client exactly once and every confirmed
// competitor exactly once. Until then the app waits for tracking.
//
// Two callers used to answer this with two different rules, so a run could
// pass the first and be refused by the second, day after day:
//   the dispatch's check before a run   run-scheduled-jobs (landscapeCheck.ts
//                                       resolveSelectionLandscape)
//   the pipeline's landscape step       pipelines/competitive/nodes.ts
//                                       resolveLandscape
// Both now call selectionTracking below, so they cannot disagree.
//
// The matching is the n8n workflow's Resolve Landscape node, line for line
// (n8n/code/competitive-resolve.js; a test runs the mirror next to the
// pipeline step). Free of Deno and network imports so it can be tested.

// deno-lint-ignore no-explicit-any
type Any = any;

// ── What counts as a fact ───────────────────────────────────────────────────
//
// "Not tracked" is a fact only when RivalIQ's answer can carry it. A fact
// makes a run wait, and the one about a link that is gone lets the lifecycle
// set tracking up again, so nothing is concluded from an answer that is
// empty, malformed or incomplete. Such an answer is `unreadable`: the
// pipeline tries the step again as it does any fault, and the check before a
// run reads it as a provider that could not be asked (recorded nowhere).
//
// Unreadable, never a fact:
//   - the list is not an array, or is empty (the account this app runs on
//     always has landscapes, so an empty list is an answer that went wrong);
//   - an entry is not an object, or has no id;
//   - the landscape the decision rests on has no `companies` array, or one
//     with an entry that is not an object with an id. That is the linked
//     landscape for a set with a link; for a set with none, where "no
//     landscape fits" rests on every landscape, it is any of them.
//
// Facts, from a readable answer only:
//   LANDSCAPE_NOT_FOUND          the set's link names a landscape that is not
//                                in the list; or, with no link, no landscape
//                                holds the client once and every confirmed
//                                competitor once.
//   CLIENT_IDENTITY_UNVERIFIED   the linked landscape does not hold the client
//                                as exactly one company.
//   TRACKING_SELECTION_MISMATCH  the linked landscape does not hold every
//                                confirmed competitor exactly once.
//
// RivalIQ's landscapes answer carries no page or total, so a list that passes
// the checks above is taken as the whole account.

/** Why a selection is not tracked. The code leads its message. */
export const SELECTION_FACT_CODES = ["LANDSCAPE_NOT_FOUND", "CLIENT_IDENTITY_UNVERIFIED", "TRACKING_SELECTION_MISMATCH"] as const;
export type SelectionFactCode = (typeof SELECTION_FACT_CODES)[number];

/** Each fact's message, as the n8n node words it; the dispatch reads a fact back from a run's outcome by these words. */
export const SELECTION_FACT_MESSAGES: Readonly<Record<SelectionFactCode, string>> = {
  LANDSCAPE_NOT_FOUND: "LANDSCAPE_NOT_FOUND: no RivalIQ landscape tracks the client and the confirmed competitors. Connect tracking for this selection.",
  CLIENT_IDENTITY_UNVERIFIED: "CLIENT_IDENTITY_UNVERIFIED: the selected landscape does not uniquely track the client website.",
  TRACKING_SELECTION_MISMATCH: "TRACKING_SELECTION_MISMATCH: the selected landscape must track every confirmed competitor with the reviewed website exactly once.",
};

/** What an empty or missing list is called (the n8n node's words); a fault to try again, never a fact. */
export const NO_LANDSCAPES = "NO_LANDSCAPES on this RivalIQ account";

/** A confirmed competitor as the check reads it (competitors: name, website_url, rivaliq_company_id). */
export interface SelectedCompany {
  name?: string | null;
  website_url?: string | null;
  rivaliq_company_id?: unknown;
}

/** What a linked landscape does not hold: the client as one company, and the confirmed competitors it does not hold exactly once. */
export interface Uncovered {
  client: boolean;
  competitors: string[];
}

export type SelectionTracking =
  | {
    tracked: true;
    landscape: Any;
    matched_by: "explicit id" | "verified client and selected companies";
    /** The landscape's one company that is the client. */
    client_company: Any;
    /** The landscape's company for each confirmed competitor, in the selection's order. */
    selected_companies: Any[];
  }
  /** A fact, from a readable answer. `uncovered` says what a linked landscape that is still there does not hold. */
  | { tracked: false; code: SelectionFactCode; message: string; uncovered?: Uncovered }
  /** The answer cannot carry a decision: a fault to try again, never a fact. */
  | { tracked: false; unreadable: true; message: string };

const host = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw || /\s/.test(raw)) return "";
  const hostname = raw.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0].toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return hostname.includes(".") && /^[a-z0-9.-]+$/.test(hostname) ? hostname : "";
};
const normalizedName = (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/(?:\s+(?:inc|incorporated|ltd|limited|llc|llp|plc|corp|corporation))+$/, "").trim();

const hasId = (v: Any) => !!v && typeof v === "object" && !Array.isArray(v) && v.id != null && String(v.id).trim() !== "";
/** The landscape lists its companies in a form a decision can rest on. */
const companiesReadable = (l: Any) => Array.isArray(l.companies) && l.companies.every(hasId);

/**
 * Why a landscapes list cannot carry any decision, or null when it can: not
 * an array, empty, or holding an entry with no id.
 */
export function unreadableLandscapes(landscapes: unknown): string | null {
  if (!Array.isArray(landscapes) || landscapes.length === 0) return NO_LANDSCAPES;
  if (!landscapes.every(hasId)) return "RivalIQ's landscapes answer holds an entry with no id, so it cannot be read as the account's landscapes.";
  return null;
}

/**
 * The decision. `linkedLandscapeId` is the set's own link
 * (competitor_sets.rivaliq_landscape_id): with one, only that landscape is
 * looked at; without one, every landscape on the account is.
 */
export function selectionTracking(
  landscapes: unknown,
  client: { name?: unknown; website_url?: unknown },
  selection: SelectedCompany[] | null | undefined,
  linkedLandscapeId: unknown,
): SelectionTracking {
  const problem = unreadableLandscapes(landscapes);
  if (problem) return { tracked: false, unreadable: true, message: problem };
  const list = landscapes as Any[];
  const clientHost = host(client.website_url) || host(client.name);
  const clientMatchesIn = (l: Any) => (l.companies || []).filter((c: Any) => clientHost ? host(c.url) === clientHost : !!normalizedName(client.name) && normalizedName(c.name) === normalizedName(client.name));
  const selected: SelectedCompany[] = Array.isArray(selection) ? selection : [];
  const selectedMatchesIn = (l: Any) => selected.map((s) => (l.companies || []).filter((c: Any) => {
    if (clientMatchesIn(l).some((own: Any) => String(own.id) === String(c.id))) return false;
    const website = host(s.website_url);
    // A saved provider id does not override a conflicting reviewed website.
    if (s.rivaliq_company_id != null && String(c.id) !== String(s.rivaliq_company_id)) return false;
    return website ? host(c.url) === website : normalizedName(c.name) === normalizedName(s.name);
  }));
  const selectionFits = (l: Any) => {
    const matches = selectedMatchesIn(l);
    return matches.every((a: Any[]) => a.length === 1) && new Set(matches.flat().map((c: Any) => String(c.id))).size === selected.length;
  };
  const fact = (code: SelectionFactCode, uncovered?: Uncovered): SelectionTracking => ({ tracked: false, code, message: SELECTION_FACT_MESSAGES[code], ...(uncovered ? { uncovered } : {}) });
  const linked = linkedLandscapeId == null ? "" : String(linkedLandscapeId).trim();
  let match: Any;
  let matchedBy: "explicit id" | "verified client and selected companies";
  if (linked) {
    match = list.find((l: Any) => String(l.id) === linked);
    matchedBy = "explicit id";
    // Not in a readable list: the landscape the set links to is gone.
    if (!match) return fact("LANDSCAPE_NOT_FOUND");
    if (!companiesReadable(match)) return { tracked: false, unreadable: true, message: `RivalIQ's landscapes answer does not list the companies of landscape ${linked} in a readable form.` };
  } else {
    const candidates = list.filter((l: Any) => companiesReadable(l) && clientMatchesIn(l).length === 1 && selectionFits(l));
    candidates.sort((a: Any, b: Any) => Number(String(clientMatchesIn(b)[0].id) === String(b.focusCompanyId)) - Number(String(clientMatchesIn(a)[0].id) === String(a.focusCompanyId)));
    match = candidates[0];
    matchedBy = "verified client and selected companies";
    if (!match) {
      // "No landscape fits" rests on every landscape, so every one must list its companies.
      if (!list.every(companiesReadable)) return { tracked: false, unreadable: true, message: "RivalIQ's landscapes answer does not list every landscape's companies in a readable form." };
      return fact("LANDSCAPE_NOT_FOUND");
    }
  }
  const clientMatches = clientMatchesIn(match);
  const competitors = () => selectedMatchesIn(match).flatMap((a: Any[], i: number) => (a.length === 1 ? [] : [String(selected[i].name ?? "").trim()])).filter(Boolean);
  if (clientMatches.length !== 1) return fact("CLIENT_IDENTITY_UNVERIFIED", { client: true, competitors: competitors() });
  if (!selectionFits(match)) return fact("TRACKING_SELECTION_MISMATCH", { client: false, competitors: competitors() });
  return { tracked: true, landscape: match, matched_by: matchedBy, client_company: clientMatches[0], selected_companies: selectedMatchesIn(match).flat() };
}

const FACT_WORDS: Array<[SelectionFactCode, string]> = SELECTION_FACT_CODES.map((code) => [code, SELECTION_FACT_MESSAGES[code].split(". ")[0].replace(/\.$/, "")]);

/**
 * The selection fact a text carries, or null. A run that stopped on one keeps
 * its message as the run's outcome, so the dispatch reads the fact back from
 * there (also from a run the earlier code stopped after its retries, whose
 * outcome carries the same message after "did not finish in 5 tries"). Only
 * the landscape decision's own words count: another step's message that
 * begins with the same code (the aggregate's check of the companies answer)
 * is a fault, made again as before.
 */
export function selectionFactIn(text: unknown): SelectionFactCode | null {
  if (typeof text !== "string" || !text) return null;
  return FACT_WORDS.find(([, words]) => text.includes(words))?.[0] ?? null;
}

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any };

/** The set's confirmed competitors, as the run's request carries them (reports/payloads.ts buildCompetitivePayload). */
export async function readSelection(db: Db, setId: string): Promise<SelectedCompany[]> {
  const { data, error } = await db.from("competitors").select("name, website_url, rivaliq_company_id, selected_rank")
    .eq("set_id", setId).eq("is_selected", true).order("selected_rank");
  if (error) throw new Error(`Could not read the confirmed competitors: ${error.message}`);
  return (data ?? []) as SelectedCompany[];
}

/**
 * How a competitive schedule records that its confirmed selection is not
 * tracked (report_schedules.last_result begins with it). The dispatch writes
 * it when it waits for tracking, and the scheduled-jobs worker keeps it true
 * between runs, for every client, on each tick (lifecycle/trackingNote.ts).
 * It is the one tracking fact a client's own screens can read, so the prefix
 * is the contract they read: a screen never promises a run date while the
 * note stands.
 */
export const NEEDS_TRACKING = "needs tracking";

// ── What the decision left on the set ───────────────────────────────────────

/** The answers a landscape check gives about tracking (landscapeCheck.ts says what follows from each). */
export const CLIENT_NOT_TRACKED = "RIVALIQ_CLIENT_NOT_TRACKED";
export const LANDSCAPE_MISSING = "RIVALIQ_LANDSCAPE_MISSING";
export const SELECTION_NOT_COVERED = "RIVALIQ_SELECTION_NOT_COVERED";

/** A competitor set as far as its tracking goes (competitor_sets). */
export interface TrackedSetRow {
  rivaliq_landscape_id?: unknown;
  /** The last selection decision's record (landscapeCheck.ts TrackingCheckRecord). */
  tracking_check?: unknown;
}

/**
 * Where a set's tracking stands, from the one record on it:
 *   tracked       an analysis can run.
 *   not_started   no link, and no landscape found holding the selection.
 *   not_covered   the linked landscape is there but does not hold the client
 *                 and every confirmed competitor. The link is kept.
 *   gone          the linked landscape is not on the account any more; the
 *                 lifecycle starts tracking again.
 *   not_tracked   an older record of a problem with the link that names no
 *                 cause. Nothing follows from it but the wait.
 */
export type RecordedTracking =
  | { state: "tracked" | "not_started" | "gone" | "not_tracked" }
  | { state: "not_covered"; uncovered: Uncovered | null };

/**
 * The set's tracking, from what is stored on it, with no provider call: what
 * every screen, the schedule's note and the run request read, so they cannot
 * disagree. Tracked when the set has its own linked landscape and the last
 * decision about that link found no problem, or when the last decision found
 * one landscape holding the client and every confirmed competitor
 * (found_landscape_id). A set with no link and no such decision is not
 * tracked: its tracking has not started.
 */
export function recordedTracking(set: TrackedSetRow | null | undefined): RecordedTracking {
  if (!set) return { state: "not_started" };
  const linked = set.rivaliq_landscape_id == null ? "" : String(set.rivaliq_landscape_id).trim();
  const raw = set.tracking_check as { code?: unknown; landscape_id?: unknown; found_landscape_id?: unknown; gone?: unknown; uncovered?: unknown } | null | undefined;
  // A record about another link (the set was linked or unlinked since) says nothing about this one.
  const check = raw && typeof raw === "object" && typeof raw.code === "string" && String(raw.landscape_id ?? "") === linked ? raw : null;
  if (!linked) return check?.code === "ok" && check.found_landscape_id != null && String(check.found_landscape_id).trim() !== "" ? { state: "tracked" } : { state: "not_started" };
  if (!check || check.code === "ok") return { state: "tracked" };
  if (check.code === SELECTION_NOT_COVERED) {
    const u = check.uncovered as { client?: unknown; competitors?: unknown } | null | undefined;
    const uncovered = u && typeof u === "object" ? { client: u.client === true, competitors: (Array.isArray(u.competitors) ? u.competitors : []).map((n) => String(n ?? "").trim()).filter(Boolean) } : null;
    return { state: "not_covered", uncovered };
  }
  if (check.code === LANDSCAPE_MISSING && check.gone === true) return { state: "gone" };
  return { state: "not_tracked" };
}

/** Whether an analysis can run on the set, by the one record. */
export function trackedOnRecord(set: TrackedSetRow | null | undefined): boolean {
  return recordedTracking(set).state === "tracked";
}
