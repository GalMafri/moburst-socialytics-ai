// Design options for calendar posts: the request rows the design-request and
// canva-finish functions keep up to date, and the words every screen uses for
// them.
//
// Wording rule (Lital, 12 Oct 2026): nothing a client sees says AI, prompt,
// model, score, pipeline or gate, and a client never sees a failure. A request
// that needs Moburst's attention reads to a client as still being prepared.

import { supabase } from "@/integrations/supabase/client";
import { describeInvokeError } from "@/lib/invokeError";
import { postCopyOf } from "@/lib/postCopy";
import type { Iteration } from "@/lib/postMediaTiles";

export type DesignStage = "planning" | "designing" | "finishing" | "ready";

export interface DesignRequest {
  id: string;
  client_id: string;
  report_id: string | null;
  calendar_post_key: string;
  platform: string | null;
  post_copy: string;
  status: "preparing" | "ready" | "needs_staff" | "canceled";
  stage: DesignStage;
  kind?: "single" | "carousel" | "video";
  options_wanted: number;
  options_ready: number;
  /** Who asked; null when the design was prepared without anyone asking. */
  requested_by?: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export const DESIGN_STEPS: Array<{ stage: Exclude<DesignStage, "ready">; label: string }> = [
  { stage: "planning", label: "Planning" },
  { stage: "designing", label: "Designing" },
  { stage: "finishing", label: "Adding your logo and copy" },
];

/**
 * Used until a client has three finished requests of the kind to measure:
 * 6 min 24 s measured on 13 Oct for a single design; a carousel's five slides
 * are finished one Canva edit at a time.
 */
export const TYPICAL_MINUTES = 7;
export const TYPICAL_MINUTES_CAROUSEL = 12;
/** A video: two cards like a short carousel, plus footage that takes several minutes to generate. */
export const TYPICAL_MINUTES_VIDEO = 18;

/**
 * How long this kind of request usually takes: the median of the client's
 * finished one-design requests of the same kind, or the defaults above.
 */
export function typicalMinutes(r: Pick<DesignRequest, "kind">, history: DesignRequest[] = []): number {
  const kind = r.kind ?? "single";
  const took = history
    .filter((h) => h.status === "ready" && (h.kind ?? "single") === kind && h.options_wanted === 1)
    .map((h) => (new Date(h.updated_at).getTime() - new Date(h.created_at).getTime()) / 60000)
    .filter((m) => m > 0 && m < 180)
    .sort((a, b) => a - b);
  if (took.length >= 3) return Math.max(1, Math.round(took[Math.floor(took.length / 2)]));
  return kind === "carousel" ? TYPICAL_MINUTES_CAROUSEL : kind === "video" ? TYPICAL_MINUTES_VIDEO : TYPICAL_MINUTES;
}

export function isPreparing(r: DesignRequest | null | undefined, isStaff: boolean): boolean {
  if (!r) return false;
  return r.status === "preparing" || (r.status === "needs_staff" && !isStaff);
}

export function stageIndex(r: DesignRequest): number {
  const i = DESIGN_STEPS.findIndex((s) => s.stage === r.stage);
  return i < 0 ? DESIGN_STEPS.length : i;
}

/** 0–100 for a progress bar: the stage, plus the share of options already finished. */
export function progressPercent(r: DesignRequest): number {
  if (r.status === "ready") return 100;
  const base = [10, 35, 60][Math.min(stageIndex(r), 2)];
  return Math.min(95, base + Math.round((r.options_ready / Math.max(1, r.options_wanted)) * 35));
}

export function stageLine(r: DesignRequest, isStaff: boolean): string {
  const noun = r.kind === "carousel" ? "Carousel" : r.kind === "video" ? "Video" : "Design";
  if (r.status === "ready") return `${noun} ready`;
  if (r.status === "needs_staff" && isStaff) return "Needs a look from the team";
  return DESIGN_STEPS[Math.min(stageIndex(r), DESIGN_STEPS.length - 1)].label;
}

export function elapsedLabel(fromIso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

export async function createDesigns(args: { clientId: string; reportId?: string; post: { _calendarPostKey?: string; platform?: string; format?: string; copy?: string; [k: string]: unknown } }): Promise<{ request?: DesignRequest; notSetUp?: boolean }> {
  const { data, error } = await supabase.functions.invoke("design-request", {
    body: {
      action: "create",
      client_id: args.clientId,
      report_id: args.reportId ?? null,
      calendar_post_key: args.post._calendarPostKey,
      platform: args.post.platform ?? null,
      format: args.post.format ?? null,
      post_copy: postCopyOf(args.post as any),
    },
  });
  if (data?.code === "not_set_up") return { notSetUp: true };
  if (error || data?.error) throw new Error(await describeInvokeError(error, data));
  return { request: data.request as DesignRequest };
}

export async function putDesignInUse(iterationId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("design-request", { body: { action: "use", iteration_id: iterationId } });
  if (error || data?.error) throw new Error(await describeInvokeError(error, data));
}

/** A design made by a design request (as opposed to the older generators). */
export function isDesignOption(it: { variant_angle?: string | null }): boolean {
  return /^Design option \d+$/.test(String(it?.variant_angle || ""));
}

/** One finished design of a post: a single image, or a carousel's slides in order. */
export interface DesignVersion {
  iterationId: string;
  urls: string[];
  isSelected: boolean;
  createdAt: string;
}

/** A post's designs, newest first. */
export function designVersions(iterations: Iteration[], isImage: (url: string) => boolean): DesignVersion[] {
  return iterations
    .filter((it) => it.id && isDesignOption(it) && (it.media_urls || []).some(isImage))
    .map((it) => ({ iterationId: it.id!, urls: (it.media_urls || []).filter(isImage), isSelected: !!it.is_selected, createdAt: it.created_at || "" }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The design to show for a post: the one in use, else the newest. */
export function currentDesign(versions: DesignVersion[]): DesignVersion | null {
  return versions.find((v) => v.isSelected) ?? versions[0] ?? null;
}

/** Reasons a person can give for turning a design down; the client's next designs learn from them. */
export const DESIGN_FEEDBACK_REASONS: Array<{ value: string; label: string }> = [
  { value: "wrong_style", label: "Wrong style or layout" },
  { value: "repetitive", label: "Too similar to other designs" },
  { value: "off_brand_colours", label: "Off-brand colors" },
  { value: "not_relevant", label: "Doesn't fit the message" },
  { value: "text_errors", label: "Text is wrong or hard to read" },
  { value: "logo_or_mark", label: "A logo or mark looks wrong" },
  { value: "other", label: "Something else" },
];

/**
 * Turn a design down (its reason teaches the client's next designs, and a new
 * design is started unless makeNew is false) or delete it.
 */
export async function sendDesignFeedback(args: { iterationId: string; verdict: "rejected" | "deleted"; reason?: string; note?: string; makeNew?: boolean }): Promise<{ request: DesignRequest | null }> {
  const { data, error } = await supabase.functions.invoke("design-request", {
    body: { action: "feedback", iteration_id: args.iterationId, verdict: args.verdict, reason: args.reason, note: args.note, make_new: args.makeNew },
  });
  if (error || data?.error) throw new Error(await describeInvokeError(error, data));
  return { request: (data?.request as DesignRequest | null) ?? null };
}

/** Whether a design's media is a video file. */
export function isVideoMedia(url: string): boolean {
  return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url);
}

/** Stop a design being prepared. The post keeps the design it already had. */
export async function cancelDesign(requestId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("design-request", { body: { action: "cancel", request_id: requestId } });
  if (error || data?.error) throw new Error(data?.error || error?.message || "Could not stop the design.");
}
