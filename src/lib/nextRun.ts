/**
 * The next scheduled run of a client's report, read from report_schedules.
 * Screens with no report yet say when the first one runs (a fact) instead of
 * asking anyone to set something up; with no schedule they say nothing.
 *
 * A competitive analysis runs only when the confirmed competitors are
 * tracked. The schedule row says when they are not (its note, which a
 * client's own screens can read; display.ts scheduleAwaitsTracking), and the
 * sentence then promises no date.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduleAwaitsTracking, type NextRun } from "@/lib/display";

export type ReportKind = "monthly" | "competitive";

export async function fetchNextRun(clientId: string, kind: ReportKind): Promise<NextRun | null> {
  const { data, error } = await supabase
    .from("report_schedules")
    .select("next_run_at, last_result")
    .eq("client_id", clientId)
    .eq("report_kind", kind === "competitive" ? "competitive" : "social")
    .eq("is_active", true)
    .not("next_run_at", "is", null)
    .order("next_run_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const at = (data?.next_run_at as string | null | undefined) ?? null;
  if (!at) return null;
  return { at, awaitsTracking: kind === "competitive" && scheduleAwaitsTracking(data?.last_result as string | null | undefined) };
}

export function useNextRun(clientId: string | null | undefined, kind: ReportKind, enabled = true) {
  return useQuery({
    queryKey: ["next-run", clientId, kind],
    queryFn: () => fetchNextRun(clientId!, kind),
    enabled: !!clientId && enabled,
    staleTime: 5 * 60_000,
  });
}
