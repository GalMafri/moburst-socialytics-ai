import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { canRetry } from "@/lib/reportRun";
import { watchExpired, WATCH_LIMIT_MINUTES } from "@/lib/runWatch";
import { supabase } from "@/integrations/supabase/client";

const POLL_MS = 8000;

/**
 * Recover an in-flight run after navigation or refresh, before enabling Start.
 *
 * It polls so a run started in another tab shows up, but not for ever: after
 * the same limit runWatch uses (WATCH_LIMIT_MINUTES) on one page, or once the
 * run it found is past that limit, it stops, and `watchStopped` lets the
 * page say so. A manual refetch still works, and run-report itself resumes
 * an active run rather than starting a second one.
 */
export function useActiveReportRun(clientId: string | undefined, kind: "monthly" | "competitive") {
  const stopped = useRef(false);
  const [watchStopped, setWatchStopped] = useState(false);
  useEffect(() => {
    stopped.current = false;
    setWatchStopped(false);
    const timer = setTimeout(() => {
      stopped.current = true;
      setWatchStopped(true);
    }, WATCH_LIMIT_MINUTES * 60000);
    return () => clearTimeout(timer);
  }, [clientId, kind]);

  const query = useQuery({
    queryKey: ["active-report-run", kind, clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(kind === "competitive" ? "competitive_reports" : "reports")
        .select("id, status, created_at, date_range_start, date_range_end")
        .eq("client_id", clientId!)
        .eq("status", "running")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) return data;
      const failed = await supabase
        .from(kind === "competitive" ? "competitive_reports" : "reports")
        .select("id, status, created_at, date_range_start, date_range_end")
        .eq("client_id", clientId!).eq("status", "failed")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (failed.error) throw failed.error;
      return failed.data && !canRetry(failed.data, Date.now(), kind === "competitive" ? "competitive" : undefined) ? failed.data : null;
    },
    enabled: !!clientId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: (q) => {
      if (stopped.current) return false;
      const run = q.state.data as { status?: string; created_at?: string | null } | null | undefined;
      return run?.status === "running" && watchExpired(run.created_at) ? false : POLL_MS;
    },
  });
  return { ...query, watchStopped };
}
