/**
 * A report's posts live in the Calendar tab, planned a week at a time (Lital,
 * 19 Oct 2026), so the report's Content ideas tab points there. A report from
 * before the calendar existed, whose week was never imported, keeps showing
 * its own posts (passed as children).
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { mondayOf, todayIn } from "@/lib/calendarPosts";

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
    <div className="glass p-5 flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-start gap-3 min-w-0">
        <div className="shrink-0 rounded-full p-2 bg-[rgba(185,224,69,0.10)] text-[#b9e045]"><CalendarDays className="h-4 w-4" aria-hidden /></div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Posts are planned a week at a time</p>
          <p className="t-secondary">Each week's posts are written the Monday before, from the latest results, competitors and trends, including this report's findings. They're in the Calendar, where each post's copy, design and schedule are managed.</p>
        </div>
      </div>
      <Button asChild size="sm">
        <Link to={`/clients/${clientId}/calendar?week=${mondayOf(todayIn("UTC"))}`}>Open the calendar<ArrowRight className="h-3.5 w-3.5 ml-1.5" /></Link>
      </Button>
    </div>
  );
}
