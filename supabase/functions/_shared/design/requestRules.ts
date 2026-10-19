// supabase/functions/_shared/design/requestRules.ts
//
// When a post's design request is made again, closed or planned again, free
// of Deno and network imports so the rules can be tested. Used by
// design-request (automatic designs, filming requests) and design-worker
// (requests whose planning stopped).
//
// The rules (19 Oct): a request never sits waiting for a person and never
// shows anyone that it did not finish. A request with no design at the end
// is closed and a new one starts later, until the post's own time; a filmed
// post with no footage a day before its time gets a design made from the
// same idea; a post whose time has passed is left alone.

/** A request still planning after this long has stopped and is planned again. */
export const NO_PROGRESS_MINUTES = 30;
/** Planning tries for one request before it is closed and made again later. */
export const MAX_PLAN_ATTEMPTS = 3;
/** A filmed post with no footage this close to its time gets a design instead. */
export const FILMING_CLOSE_HOURS = 24;
/** The shortest and longest wait before a post whose request ended without a design gets a new one. */
export const RETRY_MIN_MINUTES = 60;
export const RETRY_MAX_MINUTES = 24 * 60;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Why a request was closed (design_requests.end_reason). */
export type EndReason =
  /** Every option was tried and none finished: made again later. */
  | "no_design"
  /** Planning stopped MAX_PLAN_ATTEMPTS times: made again later. */
  | "no_progress"
  /** A filmed post with no footage a day before its time: a design is made from the same idea. */
  | "no_footage"
  /** Footage arrived: its video was started from it. */
  | "filmed"
  /** The post's time passed first. */
  | "post_passed"
  /** The post is no longer in the calendar. */
  | "post_removed";

/** The UTC offset of a time zone at an instant, in milliseconds (UTC when the zone is unknown). */
function zoneOffset(at: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(at));
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(at / 1000) * 1000;
  } catch {
    return 0;
  }
}

/**
 * When a calendar post goes out: its date at its posting time ("6:00 PM",
 * "18:00") in the client's time zone. A post with no readable time counts
 * from the start of its day, so the rules act early rather than late.
 */
export function postInstant(postDate: string | null | undefined, postingTime: string | null | undefined, timeZone: string | null | undefined): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(postDate ?? ""));
  if (!d) return null;
  let hour = 0, minute = 0;
  const t = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b/i.exec(String(postingTime ?? "")) ?? /\b(\d{1,2}):(\d{2})\b/.exec(String(postingTime ?? ""));
  if (t) {
    hour = Number(t[1]) % 24;
    minute = Number(t[2] ?? 0) % 60;
    const half = t[3]?.toLowerCase();
    if (half === "p" && hour < 12) hour += 12;
    if (half === "a" && hour === 12) hour = 0;
  }
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), hour, minute);
  const zone = timeZone || "UTC";
  // The offset at the guess, then again at the result, so a change of clocks that day is respected.
  const first = wall - zoneOffset(wall, zone);
  return new Date(wall - zoneOffset(first, zone));
}

/** What becomes of a request waiting for footage, from its post's time and whether footage arrived. */
export function filmingOutcome(postAt: Date | null, now: Date, footageArrived: boolean): "keep" | Extract<EndReason, "no_footage" | "filmed" | "post_passed" | "post_removed"> {
  if (footageArrived) return "filmed";
  if (!postAt) return "post_removed";
  if (postAt.getTime() <= now.getTime()) return "post_passed";
  if (postAt.getTime() - now.getTime() < FILMING_CLOSE_HOURS * HOUR) return "no_footage";
  return "keep";
}

/**
 * When a post whose request ended without a design gets a new one: after
 * half the time left before the post, at least an hour and at most a day,
 * and only while that is still before the post. Null when the post comes first.
 */
export function nextDesignAttempt(endedAt: Date, postAt: Date): Date | null {
  const left = postAt.getTime() - endedAt.getTime();
  const wait = Math.min(RETRY_MAX_MINUTES * MINUTE, Math.max(RETRY_MIN_MINUTES * MINUTE, left / 2));
  const at = endedAt.getTime() + wait;
  return at < postAt.getTime() ? new Date(at) : null;
}

/** Whether a request still planning has stopped moving. */
export function planningStalled(r: { status: string; stage: string; updated_at: string }, now: Date): boolean {
  return r.status === "preparing" && r.stage === "planning" && now.getTime() - Date.parse(r.updated_at) >= NO_PROGRESS_MINUTES * MINUTE;
}

export interface PostRequest {
  status: string;
  end_reason?: string | null;
  ended_at?: string | null;
  created_at: string;
  video_route?: string | null;
}

/**
 * Whether the automatic designs start a request for a post that has no
 * design yet, from the post's earlier requests: never while one is being
 * prepared, is ready, was stopped by a person or waits for footage; a new
 * one once a request that ended without a design is due again, made the way
 * that one was; a design from the posts (never filming) once a filmed post's
 * footage did not arrive. askFilming: whether a video post is first checked
 * for someone who must be filmed (only a post never designed before).
 */
export function autoDecision(requests: PostRequest[], postAt: Date | null, now: Date): { start: false } | { start: true; route: string | null; askFilming: boolean } {
  if (!requests.length) return { start: true, route: null, askFilming: true };
  if (requests.some((r) => ["preparing", "ready", "canceled", "needs_filming"].includes(r.status))) return { start: false };
  const latest = [...requests].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (latest.status !== "closed") return { start: false };
  if (latest.end_reason === "no_footage") return { start: true, route: "posts", askFilming: false };
  if (latest.end_reason === "no_design" || latest.end_reason === "no_progress") {
    if (!postAt) return { start: false };
    const due = nextDesignAttempt(new Date(latest.ended_at ?? latest.created_at), postAt);
    return due && due.getTime() <= now.getTime() ? { start: true, route: latest.video_route ?? null, askFilming: false } : { start: false };
  }
  return { start: false };
}
