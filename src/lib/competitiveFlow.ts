import { formatDate } from "@/lib/display";

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
 * decision 1, 19 Oct 2026). So this says when the set has been tracked, or
 * nothing while tracking is being connected. It never asks anyone to act.
 * Tracking a company from now on does not give RivalIQ its past posts, so
 * this never promises history.
 */
export function describeTracking(set: SetRow | null): FlowState {
  if (!set || !RUNNABLE_SET_STATUSES.includes(set.status) || !set.rivaliq_landscape_id) return { headline: "", ready: false };
  const check = currentTrackingCheck(set);
  if (check && check.code !== "ok") return { headline: "", ready: false };
  const since = formatDate(set.tracked_since);
  return { headline: since ? `Tracked since ${since}` : "Tracked in RivalIQ", ready: true };
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
 * client (staff = false) reads the same fact with no vendor named.
 */
export function competitiveRecovery(data: any, staff = true): { title: string; detail: string } {
  const title = "Being redone";
  const reasons = (data?.quality_check?.reasons || []).join(' ');
  const again = "The product makes it again once a day, and it is shared when its figures pass.";
  if (data?.provider_status === 2 || /still collecting/i.test(reasons + ' ' + (data?.error || ''))) {
    return { title, detail: `${staff ? "RivalIQ had" : "The source had"} not finished collecting these profiles when this analysis ran, so its figures are incomplete and it is not shared. ${again}` };
  }
  const companies = data?.aggregates?.companies;
  if (Array.isArray(companies) && companies.length && companies.every((c: any) => c.post_count === 0 && (c.observed_post_count ?? c.post_count) === 0)) {
    return { title, detail: `${staff ? "RivalIQ returned" : "The source returned"} no posts for the client or the selected competitors in this date range. This does not establish that these companies did not publish. ${again}` };
  }
  return { title, detail: `Its source figures did not pass the checks, so it is not shared. ${again}` };
}
