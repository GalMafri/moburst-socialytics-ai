/**
 * Plain language for the competitive flow.
 *
 * Three different things used to be shown as one raw word each ("set: failed",
 * "report: failed", a RivalIQ phase name), and people read them as the same
 * fact. They are not: a saved selection, provider tracking and a report run
 * each succeed or fail on their own. Everything a competitive screen says
 * about those three states is written here, once, in words that name the next
 * action.
 */

/** A set keeps its confirmation through later runs; only a draft cannot run. */
export const RUNNABLE_SET_STATUSES = ["confirmed", "analyzing", "complete", "failed"];

export type SetRow = {
  id: string;
  status: string;
  created_at: string;
  confirmed_at?: string | null;
  rivaliq_landscape_id?: string | null;
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
  /** One short sentence, safe to show to anyone. */
  headline: string;
  /** What to do about it, when there is something to do. */
  detail?: string;
  /** Whether this step is satisfied. */
  ready: boolean;
  /**
   * Whether a report may still be started although the step is not
   * satisfied. A run makes the tracking check again, so a stale "needs
   * reconnecting" never locks the button that would clear it.
   */
  runnable?: boolean;
};

/** Step 1: are three competitors saved, and is the saved one the newest? */
export function describeSelection(sets: SetRow[]): FlowState {
  const { latest, runnable, newerDraft } = pickRunSelection(sets);
  if (!latest) return { headline: "No competitors chosen yet", detail: "Propose or import three competitors to start.", ready: false };
  if (!runnable) return { headline: "Selection awaiting review", detail: "Choose three competitors, review their profiles, and confirm the selection.", ready: false };
  if (newerDraft) {
    return {
      headline: "A report would use the older confirmed selection",
      detail: "A newer draft is waiting for review. Confirm it if you want the report to use it.",
      ready: true,
    };
  }
  return { headline: "Three competitors confirmed", ready: true };
}

/** The set's recorded landscape check, when it is about the landscape the set links to now. */
export function currentTrackingCheck(set: SetRow | null): { code: string; message: string | null; checked_at: string } | null {
  const raw = set?.tracking_check as { code?: unknown; landscape_id?: unknown; message?: unknown; checked_at?: unknown } | null | undefined;
  if (!raw || typeof raw !== "object" || typeof raw.code !== "string" || typeof raw.checked_at !== "string") return null;
  if (String(raw.landscape_id ?? "") !== String(set?.rivaliq_landscape_id ?? "")) return null;
  return { code: raw.code, message: typeof raw.message === "string" ? raw.message : null, checked_at: raw.checked_at };
}

/**
 * Step 2: is the selection connected to RivalIQ tracking?
 *
 * A stored landscape id says the set was linked, not that the landscape still
 * exists. The real state is the last check a run, the scheduler or the feed
 * made (competitor_sets.tracking_check); the page never asks RivalIQ itself.
 * With no check recorded yet the headline is empty: saying nothing beats
 * claiming a connection nobody has verified.
 *
 * A connected landscape means the companies are being tracked from now on. It
 * does not mean RivalIQ holds their past posts, so this never promises history.
 */
export function describeTracking(set: SetRow | null): FlowState {
  if (!set || !RUNNABLE_SET_STATUSES.includes(set.status)) {
    return { headline: "Tracking not set up", detail: "Confirm a selection first, then connect tracking.", ready: false };
  }
  if (!set.rivaliq_landscape_id) {
    return {
      headline: "Tracking not connected",
      detail: "Connect these three companies to RivalIQ before running a report.",
      ready: false,
    };
  }
  const check = currentTrackingCheck(set);
  if (check && check.code !== "ok") {
    return {
      headline: "Tracking needs reconnecting",
      detail: check.message || "The linked RivalIQ landscape no longer tracks this client. Import a landscape that does, or set up tracking for a new selection.",
      ready: false,
      runnable: true,
    };
  }
  if (check) {
    const when = new Date(check.checked_at);
    return {
      headline: "Tracking connected",
      detail: `${Number.isFinite(when.getTime()) ? `Last checked ${when.toLocaleDateString()}. ` : ""}Companies added recently may have little history before they were tracked.`,
      ready: true,
    };
  }
  return { headline: "", ready: true };
}

/** Whether the tracking step lets a report start (see FlowState.runnable). */
export const trackingAllowsRun = (state: FlowState) => state.runnable ?? state.ready;

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
  // A run that did not finish runs again on its own; it is never shown as a failure.
  return { headline: "The last report is scheduled to run again", ready: false };
}

/**
 * A server or provider message, rewritten as something to act on.
 *
 * RivalIQ allows one request at a time per account and 100 calls in a UTC
 * hour. Two clients analysed at once therefore fails one of them with a bare
 * "HTTP 429" from the landscape-listing step, which reads like a broken app.
 */
export function plainCompetitiveError(raw: string | null | undefined): string {
  const message = String(raw || "").trim();
  if (!message) return "The request did not complete. Try again.";
  const low = message.toLowerCase();
  if (/\b429\b/.test(low) || low.includes("rate limit") || low.includes("too many requests") || low.includes("spacing your requests")) {
    return "RivalIQ temporarily limited this request. The account allows one request at a time and 100 an hour. The report could not finish. Use the report's Retry control when its 90-minute wait has ended; an hourly limit may also need time to reset.";
  }
  if (low.includes("not tracked") || low.includes("rivaliq_client_not_tracked")) {
    return "This client is not tracked in RivalIQ yet. Connect tracking for the confirmed selection, then run the report.";
  }
  if (low.includes("timed out") || low.includes("timeout") || /\b504\b/.test(low)) {
    return "The request timed out, but the report may still be processing. Check its status before starting another run. Retry remains locked until 90 minutes after the run started.";
  }
  if (low.includes("session has expired")) {
    return "Your session has expired. Re-open the tool from the portal and try again.";
  }
  if (/\b5\d\d\b/.test(low) && low.includes("server error")) {
    return "The report service returned an error. Check the saved report status; its Retry control becomes available 90 minutes after the run started.";
  }
  return message;
}

/**
 * Why an analysis is held back, as facts. Nothing here asks anyone to act:
 * the next run for the period replaces a held one. Staff read the source's
 * name; a client (staff = false) reads the same fact with no vendor named.
 */
export function competitiveRecovery(data: any, staff = true): { title: string; detail: string } {
  const reasons = (data?.quality_check?.reasons || []).join(' ');
  if (data?.provider_status === 2 || /still collecting/i.test(reasons + ' ' + (data?.error || ''))) {
    return { title: 'Source data was still loading', detail: staff
      ? 'RivalIQ had not finished collecting these profiles when this analysis ran, so its figures are incomplete and it is not shared. The next run replaces it.'
      : 'The tracked profiles were still being collected when this analysis ran, so its figures are incomplete. The next run replaces it.' };
  }
  const companies = data?.aggregates?.companies;
  if (Array.isArray(companies) && companies.length && companies.every(c => c.post_count === 0 && (c.observed_post_count ?? c.post_count) === 0)) {
    return { title: 'No posts available for this period', detail: staff
      ? 'RivalIQ returned no posts for the client or the selected competitors in this date range. This does not establish that these companies did not publish.'
      : 'No posts were found for the client or the selected competitors in this date range. This does not establish that these companies did not publish.' };
  }
  return { title: 'Held back', detail: 'Its source figures did not pass the checks, so it is not shared. The next run replaces it.' };
}
