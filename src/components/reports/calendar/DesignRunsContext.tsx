// One source of truth for design runs on a calendar: every run of this client's report, with its progress and
// how many options passed, keyed by the calendar post. The card shows "Designing…" or "N designs ready", the
// Design tab shows the steps. Polls while any run is queued or running; otherwise rests.
//
// Spec: docs/superpowers/specs/2026-10-08-design-engine-design.md, section 13.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as SupabaseClient<any>;

export type RunStage = "queued" | "reading" | "planned" | "pictures" | "checking" | "checked" | "finished";

export type RunKind = "static" | "video";
export const VIDEO_FORMAT = /\b(video|reel|reels|short|shorts|clip)\b/i;
export function kindOfFormat(format: string | null | undefined): RunKind {
  return VIDEO_FORMAT.test(String(format || "")) ? "video" : "static";
}
export const runKey = (postKey: string, kind: RunKind) => `${kind}|${postKey}`;

export interface DesignRunSummary {
  id: string;
  postKey: string;
  kind: RunKind;
  status: "queued" | "running" | "offered" | "picked" | "failed" | "dropped";
  stage: RunStage;
  turn: number;
  options: number;
  pictures: number;
  composed: number;
  passed: number;
  offered: number; // options that passed every check and are shown
  sizes: Array<{ name: string; w: number; h: number }>;
  failure: string | null;
  createdAt: string;
  leaseUntil: string | null;
  interrupted: boolean; // running, but its worker stopped reporting: it is picked up again shortly
}

interface Ctx {
  runs: Record<string, DesignRunSummary>; // latest run per post key
  refresh: () => Promise<void>;
  active: boolean; // any run queued or running
}

const DesignRunsCtx = createContext<Ctx>({ runs: {}, refresh: async () => {}, active: false });
const POLL_MS = 8_000;

export function DesignRunsProvider({ clientId, reportId, children }: { clientId?: string; reportId?: string; children: ReactNode }) {
  const [runs, setRuns] = useState<Record<string, DesignRunSummary>>({});
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!clientId) return;
    let q = db.from("design_runs").select("id, post_key, format, status, plan, sizes, failure, created_at, lease_until").eq("client_id", clientId)
      .order("created_at", { ascending: false }).limit(200);
    if (reportId) q = q.eq("report_id", reportId);
    const { data } = await q;
    const rows = (data || []) as Array<{ id: string; post_key: string; format: string | null; status: DesignRunSummary["status"]; plan: Record<string, unknown> | null;
      sizes: DesignRunSummary["sizes"] | null; failure: string | null; created_at: string; lease_until: string | null }>;
    const latest: Record<string, DesignRunSummary> = {};
    for (const r of rows) {
      const kind = kindOfFormat(r.format);
      const key = runKey(r.post_key, kind);
      if (latest[key]) continue;
      const plan = (r.plan || {}) as Record<string, unknown>;
      const offeredList = Array.isArray(plan.offered) ? (plan.offered as unknown[]) : [];
      latest[key] = {
        id: r.id, postKey: r.post_key, kind, status: r.status,
        stage: (r.status === "queued" ? "queued" : (plan.stage as RunStage) || "reading"),
        turn: Number(plan.turn || 0), options: Number(plan.options || 0), pictures: Number(plan.pictures || 0),
        composed: Number(plan.composed || 0), passed: Number(plan.passed || 0),
        offered: r.status === "offered" || r.status === "picked" ? Math.max(offeredList.length, Number(plan.passed || 0)) : 0,
        sizes: r.sizes || [], failure: r.failure, createdAt: r.created_at, leaseUntil: r.lease_until,
        interrupted: r.status === "running" && !!r.lease_until && new Date(r.lease_until).getTime() < Date.now(),
      };
    }
    setRuns(latest);
  }, [clientId, reportId]);

  const active = useMemo(() => Object.values(runs).some((r) => r.status === "queued" || r.status === "running"), [runs]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (timer.current) window.clearInterval(timer.current);
    if (!active) return;
    timer.current = window.setInterval(() => { void refresh(); }, POLL_MS);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [active, refresh]);

  const value = useMemo(() => ({ runs, refresh, active }), [runs, refresh, active]);
  return <DesignRunsCtx.Provider value={value}>{children}</DesignRunsCtx.Provider>;
}

export function useDesignRuns(): Ctx {
  return useContext(DesignRunsCtx);
}

export function useDesignRunForPost(postKey?: string, kind: RunKind = "static"): DesignRunSummary | null {
  const { runs } = useDesignRuns();
  return postKey ? runs[runKey(postKey, kind)] || null : null;
}

/** The step a person is told about, in their words. */
export function stageLabel(run: DesignRunSummary): string {
  if (run.interrupted) return "Picking up again";
  switch (run.stage) {
    case "queued": return "Waiting to start";
    case "reading": return "Reading your brand";
    case "planned": return run.options ? `Planning ${run.options} option${run.options === 1 ? "" : "s"}` : "Planning options";
    case "pictures": return `Making pictures (${run.pictures} so far)`;
    case "checking": return `Composing and checking (${run.passed}/${run.options} passed)`;
    case "checked": return "Final checks";
    case "finished": return "Done";
    default: return "In progress";
  }
}

export const STAGES: Array<{ key: RunStage; label: string }> = [
  { key: "reading", label: "Brand" }, { key: "planned", label: "Options" }, { key: "pictures", label: "Pictures" },
  { key: "checking", label: "Checks" }, { key: "finished", label: "Ready" },
];

export function stageIndex(stage: RunStage): number {
  const order: RunStage[] = ["queued", "reading", "planned", "pictures", "checking", "checked", "finished"];
  const i = order.indexOf(stage);
  return i <= 1 ? 0 : i === 2 ? 1 : i === 3 ? 2 : i <= 5 ? 3 : 4;
}
