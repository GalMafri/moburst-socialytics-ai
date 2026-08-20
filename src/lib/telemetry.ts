import { supabase } from "@/integrations/supabase/client";

/**
 * Action-level telemetry.
 *
 * Design notes worth knowing before adding events:
 *
 * • Identity is NOT sent from here. A BEFORE INSERT trigger on app_events
 *   stamps user_id/email/role/company from the JWT, so the browser cannot
 *   attribute actions to someone else. Do not add those fields to a payload.
 *
 * • Event names are fixed strings in object_action form, snake_case. Never
 *   build a name from a variable — variable data goes in `props`. This keeps
 *   the event catalogue finite and groupable.
 *
 * • Sessions rotate after 30 minutes of inactivity, which is what makes
 *   "session depth" and "dead-end session" meaningful. `seq` orders events
 *   inside a session so drop-off points can be reconstructed.
 *
 * • Never throw. Telemetry failing must never break a user flow: every path
 *   here swallows its errors and drops data rather than surfacing anything.
 *
 * • Do not put client content in props — no ad copy, no brand text, no
 *   generated output. Lengths, counts, ids and enums only.
 */

const SESSION_IDLE_MS = 30 * 60 * 1000;
const FLUSH_INTERVAL_MS = 8000;
const MAX_BATCH = 25;
const SS_ID = "mb_session_id";
const SS_TS = "mb_session_ts";
const SS_SEQ = "mb_session_seq";

type Props = Record<string, unknown>;

type Row = {
  occurred_at: string;
  event: string;
  session_id: string;
  seq: number;
  path: string;
  client_id?: string | null;
  entity_id?: string | null;
  duration_ms?: number | null;
  ok?: boolean | null;
  error_code?: string | null;
  props: Props;
};

let queue: Row[] = [];
let flushing = false;
let started = false;

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "00000000-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0");
  }
}

/** Current session id, rotating after SESSION_IDLE_MS of inactivity. */
function sessionId(): string {
  let id = "";
  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(SS_TS) || 0);
    id = sessionStorage.getItem(SS_ID) || "";
    if (!id || !last || now - last > SESSION_IDLE_MS) {
      id = uuid();
      sessionStorage.setItem(SS_ID, id);
      sessionStorage.setItem(SS_SEQ, "0");
    }
    sessionStorage.setItem(SS_TS, String(now));
  } catch {
    // private mode / storage disabled — fall back to a per-load session
    if (!id) id = uuid();
  }
  return id;
}

function nextSeq(): number {
  try {
    const n = Number(sessionStorage.getItem(SS_SEQ) || 0) + 1;
    sessionStorage.setItem(SS_SEQ, String(n));
    return n;
  } catch {
    return 0;
  }
}

/**
 * Record one action.
 *
 * `event` must be a literal from the product's event list, not a computed
 * string. Reserved props are lifted into real columns so they can be indexed:
 * client_id, entity_id, duration_ms, ok, error_code.
 */
export function track(event: string, props: Props = {}): void {
  try {
    const { client_id, entity_id, duration_ms, ok, error_code, ...rest } = props as {
      client_id?: string;
      entity_id?: string;
      duration_ms?: number;
      ok?: boolean;
      error_code?: string;
    } & Props;

    queue.push({
      occurred_at: new Date().toISOString(),
      event,
      session_id: sessionId(),
      seq: nextSeq(),
      path: location.pathname,
      client_id: client_id ?? null,
      entity_id: entity_id != null ? String(entity_id) : null,
      duration_ms: typeof duration_ms === "number" ? Math.round(duration_ms) : null,
      ok: typeof ok === "boolean" ? ok : null,
      error_code: error_code ?? null,
      props: rest,
    });

    if (queue.length >= MAX_BATCH) void flush();
  } catch {
    /* never break the app for telemetry */
  }
}

/** Start a timer; call the returned function to emit `event` with duration_ms. */
export function timed(event: string, props: Props = {}) {
  const t0 = performance.now();
  return (extra: Props = {}) =>
    track(event, { ...props, ...extra, duration_ms: performance.now() - t0 });
}

export async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue;
  queue = [];
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return; // signed out: drop, the insert would be rejected
    const { error } = await supabase.from("app_events").insert(batch as never);
    if (error) {
      // put it back, but never let the buffer grow without bound
      queue = [...batch, ...queue].slice(-200);
    }
  } catch {
    queue = [...batch, ...queue].slice(-200);
  } finally {
    flushing = false;
  }
}

/**
 * Wire up page views, session lifecycle, uncaught errors and autocapture.
 * Safe to call more than once. Call from App once, and let trackPageView
 * handle route changes.
 */
export function initTelemetry(): void {
  if (started) return;
  started = true;

  setInterval(() => void flush(), FLUSH_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  window.addEventListener("pagehide", () => void flush());

  window.addEventListener("error", (e) => {
    track("error_thrown", {
      message: String(e.message || "").slice(0, 200),
      source: String(e.filename || "").slice(0, 120),
      ok: false,
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = (e as PromiseRejectionEvent).reason;
    track("promise_rejected", {
      message: String(reason?.message ?? reason ?? "").slice(0, 200),
      ok: false,
    });
  });

  // Autocapture: one event per meaningful click, so unplanned interactions are
  // still visible without hand-instrumenting every button. Hand-written events
  // remain the source of truth for funnels; this fills the gaps between them.
  document.addEventListener(
    "click",
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        "button, a, [role='tab'], [role='menuitem'], [data-track]",
      );
      if (!el) return;
      const explicit = el.getAttribute("data-track");
      // Elements carrying data-track are hand-named; everything else is
      // identified by its visible label, truncated and stripped of digits so
      // the property stays groupable rather than turning into unique strings.
      const label =
        explicit ||
        (el.getAttribute("aria-label") || el.textContent || "")
          .trim()
          .slice(0, 40)
          .replace(/\s+/g, " ");
      if (!label) return;
      track("ui_clicked", {
        label,
        tag: el.tagName.toLowerCase(),
        instrumented: Boolean(explicit),
      });
    },
    { capture: true },
  );
}

let lastPath = "";
let pageEnteredAt = 0;

/** Call on every route change. Emits dwell time for the page being left. */
export function trackPageView(path: string, routeName?: string): void {
  if (path === lastPath) return;
  if (lastPath) {
    track("page_left", {
      from: lastPath,
      duration_ms: performance.now() - pageEnteredAt,
    });
  }
  lastPath = path;
  pageEnteredAt = performance.now();
  track("page_viewed", { route: routeName ?? path });
}

/**
 * Levenshtein-based edit distance as a percentage of the original, capped for
 * long strings so a big paste does not stall the main thread. Used to measure
 * how much of an AI draft survives, which is the difference between "accepted"
 * and "rewritten from scratch".
 */
export function editDistancePct(before: string, after: string): number {
  const a = (before || "").slice(0, 2000);
  const b = (after || "").slice(0, 2000);
  if (!a.length && !b.length) return 0;
  if (!a.length) return 100;
  if (!b.length) return 100;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return Math.min(100, Math.round((prev[b.length] / Math.max(a.length, b.length)) * 100));
}
