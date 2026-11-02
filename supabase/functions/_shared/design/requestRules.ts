// supabase/functions/_shared/design/requestRules.ts
//
// When a post's design request is made again, closed or planned again, free
// of Deno and network imports so the rules can be tested. Used by
// design-request (the week's design button, filming requests) and
// design-worker (requests whose planning stopped).
//
// The rules (19 Oct): a request never sits waiting for a person and never
// shows anyone that it did not finish. A request with no design at the end
// is closed, and the post is counted again the next time someone designs its
// week (2 Nov: designs are made on request only, never automatically); a
// filmed post with no footage a day before its time is designed from the
// client's posts instead; a post whose time has passed is left alone.

/** A request still planning after this long has stopped and is planned again. */
export const NO_PROGRESS_MINUTES = 30;
/** Planning tries for one request before it is closed and made again later. */
export const MAX_PLAN_ATTEMPTS = 3;
/** A filmed post with no footage this close to its time gets a design instead. */
export const FILMING_CLOSE_HOURS = 24;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Why a request was closed (design_requests.end_reason). */
export type EndReason =
  /** Every option was tried and none finished: counted again by the week's design button. */
  | "no_design"
  /** Planning stopped MAX_PLAN_ATTEMPTS times: counted again by the week's design button. */
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

/** Why the week's design button leaves a post alone, from its requests. */
export type WeekHold = "preparing" | "filming" | "ready" | "ended";

/**
 * Whether the week's design button starts a request for a post, from the
 * post's earlier requests (the rules the automatic designs used until 2 Nov, with no
 * retry timer: a person asked). Never while one is being prepared or waits
 * for footage, nor once the newest one made a design; at once when the
 * newest ended without a design or was stopped by a person, made the way
 * that one was; from the client's posts (never filming) once a filmed post's
 * footage did not arrive. askFilming: whether a video post is first checked
 * for someone who must be filmed (only a post never designed before).
 */
export function weekDecision(requests: PostRequest[]): { start: false; why: WeekHold } | { start: true; route: string | null; askFilming: boolean } {
  if (!requests.length) return { start: true, route: null, askFilming: true };
  if (requests.some((r) => r.status === "preparing")) return { start: false, why: "preparing" };
  if (requests.some((r) => r.status === "needs_filming")) return { start: false, why: "filming" };
  const latest = [...requests].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (latest.status === "ready") return { start: false, why: "ready" };
  if (latest.status === "canceled") return { start: true, route: latest.video_route ?? null, askFilming: false };
  if (latest.status === "closed" && latest.end_reason === "no_footage") return { start: true, route: "posts", askFilming: false };
  if (latest.status === "closed" && (latest.end_reason === "no_design" || latest.end_reason === "no_progress")) {
    return { start: true, route: latest.video_route ?? null, askFilming: false };
  }
  return { start: false, why: "ended" };
}
