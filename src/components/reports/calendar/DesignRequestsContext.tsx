/**
 * The client's design requests, read from the server so progress survives a
 * closed panel, another tab, or a reload (Lital, 12 Oct: "users can safely
 * exit and return"; the status must stay visible without scrolling).
 *
 * Polls while anything is being prepared, and refreshes the post's designs as
 * soon as a request finishes another option.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DesignRequest } from "@/lib/designRequests";

interface Ctx {
  requests: DesignRequest[];
  /** Latest request per calendar post key. */
  byPost: Map<string, DesignRequest>;
  /** Open a post's panel on its Design tab. */
  openDesigns: (calendarPostKey: string) => void;
  /** The signed-in user's id, to tell their own requests from designs prepared without anyone asking. */
  myId: string | null;
  refresh: () => void;
}

const DesignRequestsCtx = createContext<Ctx | null>(null);

const POLL_MS = 6000;

export function DesignRequestsProvider({ clientId, onOpenPost, children }: { clientId?: string; onOpenPost: (calendarPostKey: string) => void; children: ReactNode }) {
  const qc = useQueryClient();
  const [myId, setMyId] = useState<string | null>(null);
  useEffect(() => {
    const auth = supabase.auth as Partial<typeof supabase.auth> | undefined;
    if (typeof auth?.getSession !== "function") return;
    void auth.getSession().then(({ data }) => setMyId(data.session?.user?.id ?? null));
  }, []);
  const { data: requests = [] } = useQuery({
    queryKey: ["design-requests", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("design_requests" as any) as any)
        .select("id, client_id, report_id, calendar_post_key, platform, post_copy, status, stage, kind, options_wanted, options_ready, requested_by, error, on_camera, footage_path, created_at, updated_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as DesignRequest[];
    },
    // Asked again only while something is being prepared or waits on the team.
    refetchInterval: (query) => ((query.state.data as DesignRequest[] | undefined)?.some((r) => r.status === "preparing" || r.status === "needs_staff") ? POLL_MS : false),
  });

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
    const byPost = new Map<string, DesignRequest>();
    for (const r of requests) if (!byPost.has(r.calendar_post_key)) byPost.set(r.calendar_post_key, r);
    return {
      requests,
      byPost,
      openDesigns: onOpenPost,
      myId,
      refresh: () => { void qc.invalidateQueries({ queryKey: ["design-requests", clientId] }); },
    };
  }, [requests, onOpenPost, qc, clientId, myId]);

  return <DesignRequestsCtx.Provider value={value}>{children}</DesignRequestsCtx.Provider>;
}

export function useDesignRequests(): Ctx | null {
  return useContext(DesignRequestsCtx);
}

export function useDesignRequestForPost(post: { _calendarPostKey?: string } | null | undefined): DesignRequest | null {
  const ctx = useContext(DesignRequestsCtx);
  if (!ctx || !post?._calendarPostKey) return null;
  return ctx.byPost.get(post._calendarPostKey) ?? null;
}
