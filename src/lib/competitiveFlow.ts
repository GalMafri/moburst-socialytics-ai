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

/**
 * Step 2: is the selection connected to RivalIQ tracking?
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
  return {
    headline: "Tracking connected",
    detail: "Companies added recently may have little history before they were tracked.",
    ready: true,
  };
}

/** Step 4: the outcome of the last run, kept apart from the two steps above. */
export function describeReport(report: ReportRow | null): FlowState {
  if (!report) return { headline: "No report run yet", ready: false };
  if (report.status === "complete") return { headline: "Last report is ready to open", ready: true };
  if (report.status === "running") return { headline: "A report is running now", detail: "It finishes on its own; you can leave this page.", ready: false };
  return {
    headline: "Last report did not finish",
    detail: "Open it to see why, or start a new one once the retry window opens.",
    ready: false,
  };
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

/** Explain saved validation failures without exposing internal diagnostics. */
export function competitiveFailureMessage(data: unknown): string {
  const report = data as { quality_check?: { state?: string }; error?: string } | null;
  if (report?.quality_check?.state === "needs_review") {
    return "The analysis was saved, but its source figures did not pass validation. The report is being withheld to avoid showing inaccurate results.";
  }
  if (typeof report?.error === "string" && report.error.trim()) return plainCompetitiveError(report.error);
  return "The analysis could not be completed. Its saved status is available in report history.";
}
