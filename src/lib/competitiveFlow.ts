import { formatDate, trackingNotCoveredSentence, trackingWaitSentence, type OnboardingStep } from "@/lib/display";
import { heldRedo, redoCanStillCome } from "../../supabase/functions/_shared/competitive/reportEvidence";
import { recordedTracking } from "../../supabase/functions/_shared/competitive/selectionTracking";

/**
 * Plain language for the competitive flow.
 *
 * Three different things used to be shown as one raw word each ("set: failed",
 * "report: failed", a RivalIQ phase name), and people read them as the same
 * fact. They are not: a saved selection, provider tracking and a report run
 * each have their own state. Everything a competitive screen says about
 * those three is written here, once, as facts: the product runs each of them
 * on its own (self-serve design, 19 Oct 2026), so nothing here asks anyone to
 * act.
 */

/** A set keeps its confirmation through later runs; only a draft cannot run. */
export const RUNNABLE_SET_STATUSES = ["confirmed", "analyzing", "complete", "failed"];

export type SetRow = {
  id: string;
  status: string;
  created_at: string;
  confirmed_at?: string | null;
  /** Who confirmed the set; null when the client lifecycle chose it as the system. */
  confirmed_by?: string | null;
  rivaliq_landscape_id?: string | null;
  /** When the set was linked to the landscape it has now (20261019230000_setup_view.sql). */
  tracked_since?: string | null;
  /** The last RivalIQ landscape check recorded on the set (landscapeCheck.ts). Absent until one has run. */
  tracking_check?: unknown;
};

export type ReportRow = {
  id: string;
  status: string;
  created_at: string;
};

/**
 * Which saved selection a report would actually use.
 *
 * The review page opens the newest set of any status and the run page uses the
 * newest confirmed one. When someone presses "Re-identify" those stop being
 * the same row, and nothing said so: the run quietly analysed an older
 * selection than the one on screen. Both are returned, and `newerDraft` says
 * when they differ so a screen can say it out loud.
 */
export function pickRunSelection(sets: SetRow[]): {
  latest: SetRow | null;
  runnable: SetRow | null;
  newerDraft: SetRow | null;
} {
  const ordered = [...sets].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const latest = ordered[0] || null;
  const runnable = ordered.filter((s) => RUNNABLE_SET_STATUSES.includes(s.status))
    .sort((a, b) => (b.confirmed_at || '').localeCompare(a.confirmed_at || ''))[0] || null;
  const newerDraft = latest && runnable && latest.id !== runnable.id && latest.status === "draft" ? latest : null;
  return { latest, runnable, newerDraft };
}

export type FlowState = {
  /** One short sentence, safe to show to anyone. Empty says nothing. */
  headline: string;
  /** A second fact, when there is one. */
  detail?: string;
  /** Whether this step is satisfied. */
  ready: boolean;
};

/** Tracking as a step, with which of its states it is in (selectionTracking.ts recordedTracking; "none" before a selection is confirmed). */
export type TrackingState = FlowState & { state: "none" | "tracked" | "not_started" | "starting" | "not_covered" | "gone" | "not_tracked" };

/** What the lifecycle writes on a set it confirmed as the system (steps.ts, competitors). */
export const CHOSEN_AUTOMATICALLY = "Chosen automatically: the three closest competitors with a website.";

/** Step 1, as facts: which competitors reports use, and how they were chosen. */
export function describeSelection(sets: SetRow[]): FlowState {
  const { latest, runnable, newerDraft } = pickRunSelection(sets);
  if (!latest) return { headline: "No competitors chosen yet", ready: false };
  if (!runnable) return { headline: "A draft selection is open", ready: false };
  const chosen = runnable.confirmed_by == null ? CHOSEN_AUTOMATICALLY : "Three competitors confirmed";
  if (newerDraft) return { headline: chosen, detail: "Reports use this selection. A newer draft is open beside it.", ready: true };
  return { headline: chosen, ready: true };
}

/** The set's recorded landscape check, when it is about the landscape the set links to now. */
export function currentTrackingCheck(set: SetRow | null): { code: string; message: string | null; checked_at: string } | null {
  const raw = set?.tracking_check as { code?: unknown; landscape_id?: unknown; message?: unknown; checked_at?: unknown } | null | undefined;
  if (!raw || typeof raw !== "object" || typeof raw.code !== "string" || typeof raw.checked_at !== "string") return null;
  if (String(raw.landscape_id ?? "") !== String(set?.rivaliq_landscape_id ?? "")) return null;
  return { code: raw.code, message: typeof raw.message === "string" ? raw.message : null, checked_at: raw.checked_at };
}

/**
 * Step 2, as a fact: tracking for the confirmed selection.
 *
 * The client lifecycle connects RivalIQ tracking on its own once a set is
 * confirmed, and sets it up again when a landscape disappears (Lital's
 * decision 1, 19 Oct 2026). A competitive analysis runs only when the
 * confirmed set is tracked, so this says which it is: since when the set has
 * been tracked, or that tracking has not started and what it waits for
 * (`step`, the lifecycle's tracking step, where the screen has read it).
 * Whether a set is tracked is the one rule every screen and the run request
 * read (selectionTracking.ts trackedOnRecord). It never asks anyone to act.
 * Tracking a company from now on does not give RivalIQ its past posts, so
 * this never promises history.
 */
export function describeTracking(set: SetRow | null, step?: OnboardingStep | null): TrackingState {
  if (!set || !RUNNABLE_SET_STATUSES.includes(set.status)) return { headline: "", ready: false, state: "none" };
  const recorded = recordedTracking(set);
  if (recorded.state === "tracked") {
    const since = formatDate(set.tracked_since);
    return { headline: since ? `Tracked since ${since}` : "Tracked in RivalIQ", ready: true, state: "tracked" };
  }
  // The linked landscape is there, but does not hold the confirmed selection. The link is kept, and the analysis waits.
  if (recorded.state === "not_covered") return { headline: "Does not cover this selection", detail: trackingNotCoveredSentence(recorded.uncovered), ready: false, state: "not_covered" };
  // The linked landscape is gone from the account: the lifecycle starts tracking again for the selection.
  if (recorded.state === "gone") return { headline: "Not tracked right now", detail: "Tracking is starting again.", ready: false, state: "gone" };
  if (recorded.state === "not_tracked") return { headline: "Not tracked right now", ready: false, state: "not_tracked" };
  const waitingFor = step?.status === "waiting" ? String(step.result?.waiting_for ?? "") : "";
  const why = trackingWaitSentence(waitingFor, step?.result);
  const starting = waitingFor === "in_progress";
  const headline = starting ? "Starting" : "Not started yet";
  return { headline, ...(why ? { detail: why } : {}), ready: false, state: starting ? "starting" : "not_started" };
}

/**
 * Step 3, as a fact: whether an analysis can run. It runs only when the
 * confirmed selection is tracked; until then it waits for tracking, and the
 * step links nowhere, since a run started now would only wait.
 */
export function describeAnalysis(selection: FlowState, tracking: TrackingState): FlowState {
  if (!selection.ready) return { headline: "", ready: false };
  if (tracking.ready) return { headline: "Ready to run", ready: false };
  return { headline: tracking.state === "not_covered" ? "Runs once tracking covers this selection" : "Runs once tracking has started", ready: false };
}

/** A state as one line of prose: the headline as a sentence, then the detail. */
export function stateLine(state: FlowState): string {
  if (!state.headline) return state.detail || "";
  const headline = /[.!?]$/.test(state.headline) ? state.headline : `${state.headline}.`;
  return state.detail ? `${headline} ${state.detail}` : headline;
}

/** Step 4: the outcome of the last run, kept apart from the two steps above. */
export function describeReport(report: ReportRow | null): FlowState {
  if (!report) return { headline: "No report run yet", ready: false };
  if (report.status === "complete") return { headline: "Last report is ready to open", ready: true };
  if (report.status === "running") return { headline: "A report is running now", detail: "It finishes on its own; you can leave this page.", ready: false };
  // A run that did not finish is made again by the product and never listed.
  return { headline: "No report run yet", ready: false };
}

/**
 * Why an analysis is being made again, as facts. Nothing here asks anyone
 * to act: the product makes a held analysis again once a day (HELD_REDOS
 * times, run-scheduled-jobs/dispatch.ts). Staff read the source's name; a
 * client (staff = false) reads the same fact with no vendor named. Once no
 * redo can come (the dispatch decided none on the row, or a newer row exists;
 * for an older row with no decision, the count and wait of reportEvidence.ts
 * redoCanStillCome) it is "Not shared" and says nothing about being made again.
 */
export function competitiveRecovery(data: any, staff = true, madeAt?: string | null, heldRuns = 1, opts: { durationMinutes?: number | null; newerRow?: boolean } = {}): { title: string; detail: string } {
  const redo = redoCanStillCome(madeAt, heldRuns, Date.now(), { ...opts, redo: heldRedo(data) });
  const title = redo ? "Being redone" : "Not shared";
  const reasons = (data?.quality_check?.reasons || []).join(' ');
  const again = redo ? " The product makes it again once a day, and it is shared when its figures pass." : "";
  if (data?.provider_status === 2 || /still collecting/i.test(reasons + ' ' + (data?.error || ''))) {
    return { title, detail: `${staff ? "RivalIQ had" : "The source had"} not finished collecting these profiles when this analysis ran, so its figures are incomplete and it is not shared.${again}` };
  }
  const companies = data?.aggregates?.companies;
  if (Array.isArray(companies) && companies.length && companies.every((c: any) => c.post_count === 0 && (c.observed_post_count ?? c.post_count) === 0)) {
    return { title, detail: `${staff ? "RivalIQ returned" : "The source returned"} no posts for the client or the selected competitors in this date range. This does not establish that these companies did not publish.${again}` };
  }
  return { title, detail: `Its source figures did not pass the checks, so it is not shared.${again}` };
}
