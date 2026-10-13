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

export type DesignStage = "planning" | "designing" | "finishing" | "ready";

export interface DesignRequest {
  id: string;
  client_id: string;
  report_id: string | null;
  calendar_post_key: string;
  platform: string | null;
  post_copy: string;
  status: "preparing" | "ready" | "needs_staff";
  stage: DesignStage;
  options_wanted: number;
  options_ready: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export const DESIGN_STEPS: Array<{ stage: Exclude<DesignStage, "ready">; label: string }> = [
  { stage: "planning", label: "Planning" },
  { stage: "designing", label: "Designing" },
  { stage: "finishing", label: "Adding your logo and copy" },
];

/** Typical time from "Create designs" to options, measured on the first live runs. */
export const TYPICAL_MINUTES = 5;

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
  if (r.status === "ready") return `${r.options_ready} design${r.options_ready === 1 ? "" : "s"} ready`;
  if (r.status === "needs_staff" && isStaff) return "Needs a look from the team";
  const step = DESIGN_STEPS[Math.min(stageIndex(r), DESIGN_STEPS.length - 1)].label;
  return r.options_ready > 0 ? `${step} · ${r.options_ready} of ${r.options_wanted} ready` : step;
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
