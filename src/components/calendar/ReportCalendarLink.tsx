/**
 * A report's posts live in the Calendar tab, planned a week at a time (Lital,
 * 19 Oct 2026), so the report's Content ideas tab points there. The link
 * carries no week: the client's calendar opens on this week in the client's
 * own time zone. A report from
 * before the calendar existed, whose week was never imported, keeps showing
 * its own posts (passed as children).
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * hasBoard: the report wrote its own week of posts (reports before 19 Oct
 * 2026). Reports since then write none: the calendar is planned a week at a
 * time from their findings, so the report links to it instead.
 */
export function ReportCalendarLink({ clientId, reportId, hasBoard, children }: { clientId: string; reportId: string; hasBoard: boolean; children: ReactNode }) {
  const { data: imported, isLoading } = useQuery({
    queryKey: ["report-calendar-posts", reportId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count, error } = await (supabase.from("calendar_posts" as never) as any)
        .select("id", { count: "exact", head: true })
        .eq("report_id", reportId);
      if (error) throw error;
      return count ?? 0;
    },
  });
  if (isLoading) return null;
  // A report from before the calendar tab, whose week was never imported, keeps its own board.
  if (!imported && hasBoard) return <>{children}</>;
  return (
    <EmptyState
      icon={CalendarDays}
      title="Posts are planned a week at a time"
      description="This report's findings feed the weekly plan. Each post's copy, design and schedule are in the Calendar."
      action={
        <Button asChild size="sm">
          <Link to={`/clients/${clientId}/calendar`}>Open the calendar <ArrowRight /></Link>
        </Button>
      }
    />
  );
}
