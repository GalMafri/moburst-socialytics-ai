import { useQuery } from "@tanstack/react-query";
import { canRetry } from "@/lib/reportRun";
import { supabase } from "@/integrations/supabase/client";

/** Recover an in-flight run after navigation or refresh, before enabling Start. */
export function useActiveReportRun(clientId: string | undefined, kind: "monthly" | "competitive") {
  return useQuery({
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
      return failed.data && !canRetry(failed.data) ? failed.data : null;
    },
    enabled: !!clientId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 8000,
  });
}
