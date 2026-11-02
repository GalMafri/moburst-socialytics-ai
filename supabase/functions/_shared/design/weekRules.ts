// supabase/functions/_shared/design/weekRules.ts
//
// Which posts of a calendar week the week's design button designs, and how a
// running week moves on, free of Deno and network imports so the rules can
// be tested. Used by design-request (week_preview, week_start, week_continue).
//
// The button (Lital, 2 Nov 2026: "one button to design a whole week's posts,
// on request only, never automatic"). Spec:
// docs/superpowers/specs/2026-11-02-design-week-button-design.md, section 2.
// Every post starts through the same request a single post's "Create design"
// uses; only which posts, in what order and how many at once is decided here.

import { type PostRequest, postInstant, weekDecision } from "./requestRules.ts";
import { DESIGN_ANGLE } from "../canva/jobs.ts";

/**
 * Week posts being designed at once across the app: the pace the automatic
 * designs ran at, kept because the design worker's memory ran out with three
 * designs at once on 13 Oct. A single post's own button never waits for it.
 */
export const WEEK_AT_ONCE = 2;

export type DesignKind = "single" | "carousel" | "video";

/** A post with nothing to design: its format is words alone. */
export function needsNoDesign(format: string | null | undefined): boolean {
  return /^\s*text(\s*only)?\s*$|text[-\s]only/i.test(String(format || ""));
}

/**
 * What a post's design is made as, from its format: a LinkedIn document is a
 * deck of slides like a carousel; a Reel, short, story video or any post on
 * TikTok is a video.
 */
export function designKind(format: string | null | undefined, platform: string | null | undefined): DesignKind {
  const f = String(format || "");
  if (/carousel|document|pdf/i.test(f)) return "carousel";
  if (/reel|video|short|tiktok/i.test(f) || /tiktok/i.test(String(platform || ""))) return "video";
  return "single";
}

/** Why a post of the week is not designed by the button. */
export type LeftOut =
  /** It has a finished design. */
  | "designed"
  /** A request for it is being prepared (someone pressed its own button). */
  | "preparing"
  /** Its video is filmed, so it waits for footage. */
  | "filming"
  /** Someone put other media in use for it (an upload): a finished design would never take its place. */
  | "media_in_use"
  /** Its format is words alone. */
  | "text_only"
  /** Its time passed. */
  | "passed"
  /** It left the calendar. */
  | "removed"
  /** Its last request ended in a way that calls for nothing more. */
  | "ended"
  /** Someone pressed "Stop designing the rest" before it started. */
  | "stopped"
  /** The client's design settings are gone, or the client was archived. */
  | "not_set_up";

/** What the rules read about one post of the week. */
export interface PostFacts {
  post: { post_key: string; post_date: string; posting_time: string | null; format: string | null; platform: string | null };
  /** The post's design requests, any status. */
  requests: PostRequest[];
  /** A finished design on the post that nobody deleted. */
  hasDesign: boolean;
  /** Media someone put in use for the post that is not a design (an upload, an older generator's image). */
  otherMedia: boolean;
  /** The post's copy as it is now (currentCopyOf); empty while the daily run has not written it. */
  copy: string;
}

export type Classified =
  | { in: true; kind: DesignKind; route: string | null; askFilming: boolean; postAt: Date | null }
  | { in: false; why: LeftOut };

/** Whether the button designs this post now, and how; or why not. */
export function classifyPost(f: PostFacts, timeZone: string | null | undefined, now: Date): Classified {
  if (needsNoDesign(f.post.format)) return { in: false, why: "text_only" };
  const postAt = postInstant(f.post.post_date, f.post.posting_time, timeZone);
  if (postAt && postAt.getTime() <= now.getTime()) return { in: false, why: "passed" };
  if (f.hasDesign) return { in: false, why: "designed" };
  if (f.otherMedia) return { in: false, why: "media_in_use" };
  const d = weekDecision(f.requests);
  if (!d.start) return { in: false, why: d.why === "ready" ? "designed" : d.why };
  const kind = designKind(f.post.format, f.post.platform);
  return { in: true, kind, route: kind === "video" ? d.route : null, askFilming: kind === "video" && d.askFilming, postAt };
}

/** A post's copy as it is now: its latest saved edit (a revision row without media), or the copy it was planned with. */
export function currentCopyOf(rows: Array<{ post_copy?: string | null; media_urls?: string[] | null; created_at?: string | null }>, planned: string | null | undefined): string {
  const edit = [...rows]
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .find((r) => !(Array.isArray(r.media_urls) && r.media_urls.length) && r.post_copy);
  return String(edit?.post_copy || planned || "").trim();
}

/** Whether a post has a finished design, and whether other media is in use for it, from its post_iterations rows. */
export function mediaOf(rows: Array<{ variant_angle?: string | null; is_selected?: boolean | null; archived_at?: string | null }>): { hasDesign: boolean; otherMedia: boolean } {
  return {
    hasDesign: rows.some((r) => DESIGN_ANGLE.test(r.variant_angle ?? "") && !r.archived_at),
    // The same test a finished design makes before it takes over its post (canva/jobs.ts takeOverPost).
    otherMedia: rows.some((r) => r.is_selected === true && !DESIGN_ANGLE.test(r.variant_angle ?? "")),
  };
}

/** What a press would design, by kind; posts whose copy is not written yet; and video posts left for filming. */
export function weekCounts(posts: Array<{ post_key: string; copy: string; result: Classified }>): { single: number; carousel: number; video: number; copy_waits: number; filming: number } {
  const out = { single: 0, carousel: 0, video: 0, copy_waits: 0, filming: 0 };
  for (const p of posts) {
    if (!p.result.in) {
      if (p.result.why === "filming") out.filming++;
      continue;
    }
    out[p.result.kind]++;
    if (!p.copy.trim()) out.copy_waits++;
  }
  return out;
}

/** One post of a week run (design_week_runs.posts). */
export interface RunPost {
  post_key: string;
  kind: DesignKind;
  /** When the post goes out, for soonest-first order. */
  post_at: string | null;
  /** queued: waits its turn; started: its request was made; filming: its video is filmed instead; left_out: see why. */
  state: "queued" | "started" | "filming" | "left_out";
  why?: LeftOut | null;
  /** A queued post whose copy is not written yet. */
  waits_for?: "copy" | null;
  /** Who added the post to the run; its request names them. */
  added_by: string;
  added_at: string;
  request_id?: string | null;
  started_at?: string | null;
}

/**
 * A press: every eligible post that is not already queued joins the run,
 * named for whoever pressed. A second press, by anyone, adds only what has
 * become eligible since (a post added to the calendar, or one of the run's
 * that ended without a design).
 */
export function mergeIntoRun(posts: RunPost[], eligible: Array<{ post_key: string; kind: DesignKind; postAt: Date | null }>, by: string, now: Date): { posts: RunPost[]; added: string[] } {
  const out = [...posts];
  const added: string[] = [];
  for (const e of eligible) {
    const i = out.findIndex((p) => p.post_key === e.post_key);
    if (i >= 0 && out[i].state === "queued") continue;
    const entry: RunPost = { post_key: e.post_key, kind: e.kind, post_at: e.postAt ? e.postAt.toISOString() : null, state: "queued", why: null, waits_for: null, added_by: by, added_at: now.toISOString(), request_id: null, started_at: null };
    if (i >= 0) out[i] = entry; else out.push(entry);
    added.push(e.post_key);
  }
  return { posts: out, added };
}

/** A run is over once nothing is queued and none of the requests it started is still being prepared. */
export function runFinished(posts: RunPost[], preparing: Set<string>): boolean {
  return !posts.some((p) => p.state === "queued" || (p.state === "started" && !!p.request_id && preparing.has(p.request_id)));
}

export interface PassRun { id: string; client_id: string; posts: RunPost[]; revising: boolean }
export interface PassStart { runId: string; client_id: string; post_key: string; kind: DesignKind; route: string | null; askFilming: boolean; copy: string; added_by: string; postAt: Date | null }

/**
 * One pass over the running weeks: each queued post is checked again (a post
 * designed, removed, given media or passed in the meantime leaves the run),
 * and the soonest posts across every run start, while there is room (at most
 * WEEK_AT_ONCE week posts designing across the app), one per client and only
 * when none of that client's requests is planning (so each plan sees the
 * designs before it), never while the week is being revised, and a video only
 * while the Higgsfield balance covers a clip. A post whose copy is not
 * written yet waits for it. Returns the starts, every run's posts as they now
 * stand, and the runs that are over.
 */
export function planPass(input: {
  now: Date;
  room: number;
  runs: PassRun[];
  /** Each queued post's facts by `client|post_key`; null when the post left the calendar. */
  facts: Map<string, PostFacts | null>;
  zones: Map<string, string | null>;
  /** Clients with a request planning now. */
  planning: Set<string>;
  /** Requests still being prepared. */
  preparing: Set<string>;
  /** Clients whose design settings exist. */
  settings: Set<string>;
  clipAffordable: boolean;
}): { starts: PassStart[]; runs: Map<string, RunPost[]>; finished: string[] } {
  const runs = new Map<string, RunPost[]>();
  const candidates: Array<PassStart & { order: number }> = [];
  for (const run of input.runs) {
    const posts = run.posts.map((p) => ({ ...p }));
    runs.set(run.id, posts);
    for (const p of posts) {
      if (p.state !== "queued") continue;
      const f = input.facts.get(`${run.client_id}|${p.post_key}`);
      const leave = (why: LeftOut) => { p.state = "left_out"; p.why = why; p.waits_for = null; };
      if (!f) { leave("removed"); continue; }
      if (!input.settings.has(run.client_id)) { leave("not_set_up"); continue; }
      const c = classifyPost(f, input.zones.get(run.client_id), input.now);
      if (!c.in) { leave(c.why); continue; }
      p.kind = c.kind;
      p.post_at = c.postAt ? c.postAt.toISOString() : p.post_at;
      p.waits_for = f.copy.trim() ? null : "copy";
      if (p.waits_for || run.revising) continue;
      candidates.push({ runId: run.id, client_id: run.client_id, post_key: p.post_key, kind: c.kind, route: c.route, askFilming: c.askFilming, copy: f.copy.trim(), added_by: p.added_by, postAt: c.postAt, order: c.postAt ? c.postAt.getTime() : Number.MAX_SAFE_INTEGER });
    }
  }
  candidates.sort((a, b) => a.order - b.order);
  const starts: PassStart[] = [];
  const busy = new Set(input.planning);
  for (const { order: _order, ...c } of candidates) {
    if (starts.length >= input.room) break;
    if (busy.has(c.client_id)) continue;
    if (c.kind === "video" && !input.clipAffordable) continue;
    starts.push(c);
    busy.add(c.client_id);
  }
  const starting = new Set(starts.map((s) => `${s.runId}|${s.post_key}`));
  const finished = input.runs
    .filter((run) => !(runs.get(run.id) ?? []).some((p) => starting.has(`${run.id}|${p.post_key}`)) && runFinished(runs.get(run.id) ?? [], input.preparing))
    .map((run) => run.id);
  return { starts, runs, finished };
}

/**
 * A run stopped while a pass was starting posts: the run keeps what the stop
 * wrote, plus the posts that pass did start (their requests exist and finish
 * on their own).
 */
export function keepStarts(stored: RunPost[], pass: RunPost[]): RunPost[] {
  const started = new Map(pass.filter((p) => (p.state === "started" || p.state === "filming") && p.request_id).map((p) => [p.post_key, p]));
  return stored.map((p) => {
    const s = started.get(p.post_key);
    return s && p.request_id !== s.request_id ? { ...s } : p;
  });
}
