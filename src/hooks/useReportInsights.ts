// The shown insights of one report (its newest confirmed report_insights row), or null: a report
// with none shows its own fields. src/lib/reportInsights.ts shapes them.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ReportInsightsRow } from "@/lib/reportInsights";

export function useReportInsights(table: "reports" | "competitive_reports", reportId: string | null | undefined) {
  return useQuery({
    queryKey: ["report-insights", table, reportId],
    queryFn: async () => {
      const { data, error } = await supabase.from("report_insights")
        .select("id, report_id, kind, facts, fields, source, confirmed_at")
        .eq("report_table", table).eq("report_id", reportId!)
        // The newest confirmed answer is the one shown: an input met again is confirmed again.
        .order("confirmed_at", { ascending: false }).limit(1).maybeSingle();
      // A screen without its insights shows the report's own fields: nothing to say about it.
      if (error) return null;
      return (data ?? null) as unknown as ReportInsightsRow | null;
    },
    enabled: !!reportId,
    staleTime: 60 * 1000,
  });
}
