/**
 * The client's design requests, read from the server so progress survives a
 * closed panel, another tab, or a reload (Lital, 12 Oct: "users can safely
 * exit and return"; the status must stay visible without scrolling).
 *
 * Polls while anything is being prepared or a week is being designed (the
 * week's design button, design_week_runs), and refreshes the post's designs
 * as soon as a request finishes another option.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { latestPerPost, type DesignRequest } from "@/lib/designRequests";
import { fetchWeekRuns, weekStateOf, type WeekRun } from "@/lib/designWeek";

interface Ctx {
  requests: DesignRequest[];
  /** Where each post stands, by calendar post key (latestPerPost). */
  byPost: Map<string, DesignRequest>;
  /** Why a post's video is filmed, kept after a video from the client's posts was chosen instead. */
  filmedByPost: Map<string, string>;
  /** The client's weeks being designed or designed lately, newest first. */
  weekRuns: WeekRun[];
  /** Open a post's panel on its Design tab. */
  openDesigns: (calendarPostKey: string) => void;
  /** The signed-in user's id, to tell their own requests from other people's. */
  myId: string | null;
  refresh: () => void;
}

const DesignRequestsCtx = createContext<Ctx | null>(null);

const POLL_MS = 6000;

const REQUEST_COLUMNS = "id, client_id, report_id, calendar_post_key, platform, post_copy, status, stage, kind, upload_size, options_wanted, options_ready, requested_by, batch_id, error, end_reason, on_camera, footage_path, video_route, note, note_learned, created_at, started_at, ended_at, updated_at";

async function fetchDesignRequests(clientId: string): Promise<DesignRequest[]> {
  const { data, error } = await supabase.from("design_requests")
    .select(REQUEST_COLUMNS)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []) as unknown as DesignRequest[];
}

/**
 * The client's design requests and its week runs, as every screen reads them:
 * one query each, shared by key, asked again only while something is being
 * prepared or a week is running (the calendar's week band reads them too).
 */
export function designRequestsQuery(clientId: string | undefined, weekRunning = false) {
  return {
    queryKey: ["design-requests", clientId],
    enabled: !!clientId,
    queryFn: () => fetchDesignRequests(clientId!),
    refetchInterval: (query: { state: { data?: DesignRequest[] } }) => (weekRunning || query.state.data?.some((r) => r.status === "preparing") ? POLL_MS : false),
    // Asked for in a browser tab left in the background too, so the status is current the moment the person comes back.
    refetchIntervalInBackground: true,
  } as const;
}

export function weekRunsQuery(clientId: string | undefined) {
  return {
    queryKey: ["design-week-runs", clientId],
    enabled: !!clientId,
    queryFn: () => fetchWeekRuns(clientId!),
    refetchInterval: (query: { state: { data?: WeekRun[] } }) => (query.state.data?.some((r) => r.status === "running") ? POLL_MS : false),
    refetchIntervalInBackground: true,
  } as const;
}

export function DesignRequestsProvider({ clientId, onOpenPost, children }: { clientId?: string; onOpenPost: (calendarPostKey: string) => void; children: ReactNode }) {
  const qc = useQueryClient();
  const [myId, setMyId] = useState<string | null>(null);
  // Who is signed in, kept current: a session that was not ready when the
  // calendar opened (a sign-in still being handed over) is known as soon as it
  // is, so the person's own progress cards never stay away for the visit.
  useEffect(() => {
    const auth = supabase.auth as Partial<typeof supabase.auth> | undefined;
    let live = true;
    if (typeof auth?.getSession === "function") {
      void auth.getSession().then(({ data }) => { if (live) setMyId((known) => data.session?.user?.id ?? known); });
    }
    const listening = typeof auth?.onAuthStateChange === "function"
      ? auth.onAuthStateChange((_event, session) => { if (live) setMyId(session?.user?.id ?? null); })
      : null;
    return () => { live = false; listening?.data?.subscription?.unsubscribe?.(); };
  }, []);
  const { data: weekRuns = [] } = useQuery(weekRunsQuery(clientId));
  // A running week starts its posts one after another: its requests are asked for while it runs.
  const { data: requests = [] } = useQuery(designRequestsQuery(clientId, weekRuns.some((r) => r.status === "running")));

  // A finished option is a new post_iterations row: refresh the post's designs
  // whenever any request's count of ready options moves.
  const seen = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    let changed = false;
    for (const r of requests) {
      const before = seen.current.get(r.id);
      if (before !== undefined && before !== r.options_ready) changed = true;
      seen.current.set(r.id, r.options_ready);
    }
    if (changed && clientId) void qc.invalidateQueries({ queryKey: ["post-iterations", clientId] });
  }, [requests, clientId, qc]);

  const value = useMemo<Ctx>(() => {
    const byPost = latestPerPost(requests);
    const filmedByPost = new Map<string, string>();
    for (const r of requests) {
      if (r.status === "needs_filming" && !filmedByPost.has(r.calendar_post_key)) filmedByPost.set(r.calendar_post_key, r.on_camera || "it needs footage filmed for it");
    }
    return {
      requests,
      byPost,
      filmedByPost,
      weekRuns,
      openDesigns: onOpenPost,
      myId,
      refresh: () => { void qc.invalidateQueries({ queryKey: ["design-requests", clientId] }); },
    };
  }, [requests, weekRuns, onOpenPost, qc, clientId, myId]);

  return <DesignRequestsCtx.Provider value={value}>{children}</DesignRequestsCtx.Provider>;
}

export function useDesignRequests(): Ctx | null {
  return useContext(DesignRequestsCtx);
}

/** Why the post's video is filmed, or null when it can be generated from the client's own videos. */
export function useFilmedReasonForPost(post: { _calendarPostKey?: string } | null | undefined): string | null {
  const ctx = useContext(DesignRequestsCtx);
  if (!ctx || !post?._calendarPostKey) return null;
  return ctx.filmedByPost.get(post._calendarPostKey) ?? null;
}

export function useDesignRequestForPost(post: { _calendarPostKey?: string } | null | undefined): DesignRequest | null {
  const ctx = useContext(DesignRequestsCtx);
  if (!ctx || !post?._calendarPostKey) return null;
  return ctx.byPost.get(post._calendarPostKey) ?? null;
}

/** Where the post stands in a week being designed: queued for design, waiting for its copy, or a video waiting for video credits. Null otherwise. */
export function useWeekStateForPost(post: { _calendarPostKey?: string } | null | undefined): "queued" | "copy" | "credits" | null {
  const ctx = useContext(DesignRequestsCtx);
  if (!ctx) return null;
  return weekStateOf(ctx.weekRuns, post?._calendarPostKey);
}
