/**
 * The posts a report planned now live in the Calendar tab. A report whose
 * posts are in the calendar points there; an older report, planned before the
 * calendar existed, keeps showing its own posts (passed as children).
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PlatformBadge } from "@/lib/platform-config";
import { CALENDAR_VIEW, mondayOf, shortDate, type CalendarPostRow } from "@/lib/calendarPosts";

export function ReportCalendarLink({ clientId, reportId, children }: { clientId: string; reportId: string; children: ReactNode }) {
  const { data: posts, isLoading } = useQuery({
    queryKey: ["report-calendar-posts", reportId],
    queryFn: async () => {
      // The report's posts the calendar shows (a newer plan may have taken some weeks).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from(CALENDAR_VIEW as never) as any)
        .select("id, post_date, posting_time, platform, format, copy")
        .eq("report_id", reportId)
        .order("post_date");
      if (error) throw error;
      return (data || []) as Pick<CalendarPostRow, "id" | "post_date" | "posting_time" | "platform" | "format" | "copy">[];
    },
  });
  if (isLoading) return null;
  if (!posts?.length) return <>{children}</>;

  const week = mondayOf(posts[0].post_date);
  return (
    <div className="glass p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="shrink-0 rounded-full p-2 bg-[rgba(185,224,69,0.10)] text-[#b9e045]"><CalendarDays className="h-4 w-4" aria-hidden /></div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">{posts.length} post{posts.length === 1 ? "" : "s"} planned from this report</p>
            <p className="t-secondary">They're in the Calendar, where each post's copy, design and schedule are managed.</p>
          </div>
        </div>
        <Button asChild size="sm">
          <Link to={`/clients/${clientId}/calendar?week=${week}`}>Open the calendar<ArrowRight className="h-3.5 w-3.5 ml-1.5" /></Link>
        </Button>
      </div>
      <ul className="divide-y divide-white/[0.06]">
        {posts.map((p) => (
          <li key={p.id} className="py-2.5 flex items-center gap-3 min-w-0">
            <span className="t-label w-16 shrink-0 tabular-nums">{shortDate(p.post_date)}</span>
            <PlatformBadge platform={p.platform} size="sm" />
            {p.format && <span className="t-badge text-[#b1b7c1] shrink-0">{p.format}</span>}
            <span className="t-body truncate min-w-0">{p.copy.split("\n")[0]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
