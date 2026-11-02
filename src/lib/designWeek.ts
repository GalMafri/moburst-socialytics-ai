// The week's design button (Lital, 2 Nov 2026: "one button to design a whole
// week's posts, on request only, never automatic"). Spec:
// docs/superpowers/specs/2026-11-02-design-week-button-design.md, section 5.
//
// Staff see what a press would design and roughly what it costs, and press
// it; the server (design-request week_*) decides which posts, and starts each
// through the same request a single post's "Create design" makes. Everyone
// sees the week's progress, read from design_week_runs and the requests that
// carry its id. Nothing here reports a failure: a press that did not get
// through is sent again quietly, and the band shows what the server has.

import { supabase } from "@/integrations/supabase/client";
import { invokeResendable, sendQuietly } from "@/lib/quietSend";
import { typicalMinutes, type DesignRequest } from "@/lib/designRequests";

export type WeekKind = "single" | "carousel" | "video";

/** One post of a week run, as the server keeps it (_shared/design/weekRules.ts RunPost). */
export interface WeekRunPost {
  post_key: string;
  kind: WeekKind;
  post_at: string | null;
  state: "queued" | "started" | "filming" | "left_out";
  why?: string | null;
  /** A queued post whose copy is not written yet. */
  waits_for?: "copy" | null;
  added_by: string;
  added_at: string;
  request_id?: string | null;
  started_at?: string | null;
}

export interface WeekRun {
  id: string;
  client_id: string;
  week_start: string;
  status: "running" | "done" | "stopped";
  posts: WeekRunPost[];
  requested_by: string;
  stopped_by?: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface WeekCounts { single: number; carousel: number; video: number; copy_waits: number; filming: number }

/** What the client's setup waits for before designs can start. */
export type WeekWaitingFor = "look" | "designed_posts" | "social_accounts" | "logo_file";

export interface WeekPreview {
  code?: "not_set_up";
  waiting_for?: WeekWaitingFor;
  client_name: string | null;
  counts?: WeekCounts;
  /** Higgsfield credits the week's videos would take, from the clips recorded so far. */
  credits?: number;
  credits_per_clip?: number;
  /** The week's latest run, and the credits its clips used. */
  run_id?: string | null;
  credits_used?: number | null;
}

/** The columns a screen may read (the estimate stays with the server). */
export const WEEK_RUN_COLUMNS = "id, client_id, week_start, status, posts, requested_by, stopped_by, created_at, updated_at, finished_at";

export async function fetchWeekRuns(clientId: string): Promise<WeekRun[]> {
  const { data, error } = await (supabase.from("design_week_runs" as any) as any)
    .select(WEEK_RUN_COLUMNS).eq("client_id", clientId).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return ((data || []) as WeekRun[]).map((r) => ({ ...r, posts: Array.isArray(r.posts) ? r.posts : [] }));
}

/** What a press would design this week. Spends nothing. Null when the answer did not come. */
export async function previewWeek(clientId: string, week: string): Promise<WeekPreview | null> {
  const { data, error } = await sendQuietly(() => supabase.functions.invoke("design-request", { body: { action: "week_preview", client_id: clientId, week_start: week } }), {
    again: (e) => invokeResendable(e, { idempotent: true }),
  });
  if (error || !data || data.error) return null;
  return data as WeekPreview;
}

/**
 * Design the week's posts. Sent again quietly when it did not get through: a
 * second press adds only what became eligible since, so asking twice is
 * safe. Null when it was not sent; the band then shows what the server has.
 */
export async function designWeek(args: { clientId: string; week: string; estimate: Record<string, number> }): Promise<{ run: WeekRun | null; added: string[] } | null> {
  const { data, error } = await sendQuietly(() => supabase.functions.invoke("design-request", {
    body: { action: "week_start", client_id: args.clientId, week_start: args.week, estimate: args.estimate },
  }), { again: (e) => invokeResendable(e, { idempotent: true }) });
  if (error || !data || data.error || data.code) return null;
  return { run: (data.run as WeekRun | null) ?? null, added: Array.isArray(data.added) ? data.added : [] };
}

/** Leave the week's posts that have not started out; the ones being designed finish. */
export async function stopWeek(runId: string): Promise<WeekRun | null> {
  const { data, error } = await sendQuietly(() => supabase.functions.invoke("design-request", { body: { action: "week_stop", run_id: runId } }), {
    again: (e) => invokeResendable(e, { idempotent: true }),
  });
  if (error || !data || data.error) return null;
  return (data.run as WeekRun | null) ?? null;
}

// ── Words ───────────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Posts a press would design. */
export function postsToDesign(c: WeekCounts | undefined): number {
  return c ? c.single + c.carousel + c.video : 0;
}

export function durationWords(minutes: number): string {
  if (minutes < 60) return plural(minutes, "minute", "minutes");
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${plural(h, "hour", "hours")}${m ? ` and ${plural(m, "minute", "minutes")}` : ""}`;
}

/** "9 posts this week have no design yet: 6 designs, 2 carousels, 1 video. About 100 Higgsfield credits and 45 minutes." */
export function previewLine(c: WeekCounts, credits: number, minutes: number): string {
  const n = postsToDesign(c);
  const kinds = [
    c.single ? plural(c.single, "design", "designs") : "",
    c.carousel ? plural(c.carousel, "carousel", "carousels") : "",
    c.video ? plural(c.video, "video", "videos") : "",
  ].filter(Boolean).join(", ");
  const cost = c.video && credits > 0 ? `About ${Math.round(credits)} Higgsfield credits and ${durationWords(minutes)}.` : `About ${durationWords(minutes)}.`;
  return `${plural(n, "post", "posts")} this week ${n === 1 ? "has" : "have"} no design yet: ${kinds}. ${cost}`;
}

export function filmingLine(n: number): string | null {
  if (!n) return null;
  return n === 1 ? "1 video is filmed, so it isn't included." : `${n} videos are filmed, so they aren't included.`;
}

export function buttonLabel(n: number): string {
  return `Design ${plural(n, "post", "posts")}`;
}

/** What the client's setup still waits for before designs can start. */
export function waitingLine(waitingFor: WeekWaitingFor | undefined, clientName: string | null | undefined): string {
  const name = clientName?.trim() || "this client";
  const its = clientName?.trim() ? `${name}'s` : "this client's";
  if (waitingFor === "logo_file") return `Designs start once ${its} logo file is found on its website.`;
  if (waitingFor === "designed_posts") return `Designs start once ${name} has published enough designed posts to learn its look from.`;
  if (waitingFor === "social_accounts") return `Designs start once ${its} social accounts are connected.`;
  return `Designs start once ${its} look is learned from its own posts.`;
}

export function progressLine(p: { total: number; ready: number }): string {
  return `Designing this week's posts: ${p.ready} of ${p.total} ready.`;
}

/** "9 posts designed." For staff, with the Higgsfield credits the week's clips used. */
export function doneLine(ready: number, creditsUsed: number | null | undefined): string {
  const base = `${plural(ready, "post", "posts")} designed.`;
  return creditsUsed && creditsUsed > 0 ? `${base} ${Math.round(creditsUsed)} Higgsfield credits used.` : base;
}

/**
 * How long the week takes: each post's usual minutes (typicalMinutes, from
 * the client's own finished designs), two at a time, rounded up to five.
 */
export function weekMinutes(c: WeekCounts, history: DesignRequest[]): number {
  const each = [
    ...Array(c.single).fill(typicalMinutes({ kind: "single" }, history)),
    ...Array(c.carousel).fill(typicalMinutes({ kind: "carousel" }, history)),
    ...Array(c.video).fill(typicalMinutes({ kind: "video" }, history)),
  ] as number[];
  if (!each.length) return 0;
  const total = each.reduce((a, b) => a + b, 0);
  return Math.ceil(Math.max(Math.max(...each), total / 2) / 5) * 5;
}

// ── A run's progress ────────────────────────────────────────────────────────

/**
 * Where a week stands: the posts it is designing (queued or started), how
 * many are ready, and whether any is still to come. A post that ended
 * without a design counts as not ready; the button counts it again later.
 */
export function weekProgress(run: WeekRun, requests: Map<string, Pick<DesignRequest, "status">>): { total: number; ready: number; active: boolean } {
  const counted = run.posts.filter((p) => p.state === "queued" || p.state === "started");
  const status = (p: WeekRunPost) => (p.request_id ? requests.get(p.request_id)?.status : undefined);
  const ready = counted.filter((p) => p.state === "started" && status(p) === "ready").length;
  // A stopped week is still going while the posts it started are being designed.
  const active = run.status === "running" || counted.some((p) => p.state === "started" && status(p) === "preparing");
  return { total: counted.length, ready, active };
}

/** Where a post waiting in a running week stands: queued for design, or waiting for its copy. */
export function weekStateOf(runs: WeekRun[], postKey: string | undefined): "queued" | "copy" | null {
  if (!postKey) return null;
  for (const r of runs) {
    if (r.status !== "running") continue;
    const p = r.posts.find((x) => x.post_key === postKey && x.state === "queued");
    if (p) return p.waits_for === "copy" ? "copy" : "queued";
  }
  return null;
}
