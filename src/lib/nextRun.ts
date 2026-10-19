/**
 * The next scheduled run of a client's report, read from report_schedules.
 * Screens with no report yet say when the first one runs (a fact) instead of
 * asking anyone to set something up; with no schedule they say nothing.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ReportKind = "monthly" | "competitive";

export async function fetchNextRun(clientId: string, kind: ReportKind): Promise<string | null> {
  const { data, error } = await supabase
    .from("report_schedules")
    .select("next_run_at")
    .eq("client_id", clientId)
    .eq("report_kind", kind === "competitive" ? "competitive" : "social")
    .eq("is_active", true)
    .not("next_run_at", "is", null)
    .order("next_run_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.next_run_at as string | null | undefined) ?? null;
}

export function useNextRun(clientId: string | null | undefined, kind: ReportKind, enabled = true) {
  return useQuery({
    queryKey: ["next-run", clientId, kind],
    queryFn: () => fetchNextRun(clientId!, kind),
    enabled: !!clientId && enabled,
    staleTime: 5 * 60_000,
  });
}
