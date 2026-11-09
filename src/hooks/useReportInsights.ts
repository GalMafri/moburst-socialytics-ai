// The shown insights of one report (its newest confirmed report_insights
// row), or null: a report with none shows its own fields. Read and shaped by
// the one reader every screen and job uses
// (supabase/functions/_shared/reports/shownFields.ts).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readShownInsights, type ReportTable } from "../../supabase/functions/_shared/reports/shownFields";

export function useReportInsights(table: ReportTable, reportId: string | null | undefined) {
  return useQuery({
    queryKey: ["report-insights", table, reportId],
    // A screen without its insights shows the report's own fields (the reader never fails).
    queryFn: () => readShownInsights(supabase, table, reportId),
    enabled: !!reportId,
    staleTime: 60 * 1000,
  });
}
