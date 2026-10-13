/**
 * A client's content calendar, its own tab (Lital, 12 and 13 Oct): every
 * planned post on its date, week by week. Monthly reports plan posts into it,
 * the team adds posts at any time, and each post's design is prepared and can
 * be regenerated from the post's current copy.
 */

import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { LoadError } from "@/components/ui/load-error";
import { EmptyState } from "@/components/ui/empty-state";
import { ContentIdeasTab } from "@/components/reports/calendar/ContentIdeasTab";
import { NewPostDialog } from "@/components/calendar/NewPostDialog";
import { ClientPicker, WeekNav } from "@/components/calendar/CalendarHeaderControls";
import { PlanWeekButton } from "@/components/calendar/PlanWeekButton";
import { CLIENT_CONTEXT_COLUMNS, buildClientContext } from "@/lib/clientContext";
import { addDays, mondayOf, shortDate, todayIn, weekBoard, type CalendarPostRow } from "@/lib/calendarPosts";

const DEFAULT_PLATFORMS = ["Instagram", "LinkedIn", "TikTok", "Facebook", "X"];

export default function ClientCalendar() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { isMoburstStaff } = useAuth();

  const client = useQuery({
    queryKey: ["calendar-client", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select(CLIENT_CONTEXT_COLUMNS).eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const posts = useQuery({
    queryKey: ["calendar-posts", id],
    enabled: !!id,
    queryFn: async () => {
      // calendar_posts is not in the generated types yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("calendar_posts" as never) as any)
        .select("*")
        .eq("client_id", id)
        .order("post_date")
        .limit(2000);
      if (error) throw error;
      return (data || []) as CalendarPostRow[];
    },
  });

  const clientContext = buildClientContext(client.data as Record<string, unknown> | null, id);
  const today = todayIn(clientContext.timezone);
  const week = mondayOf(params.get("week") || today);
  const thisWeek = mondayOf(today);
  const all = posts.data ?? [];
  const inWeek = all.filter((p) => p.post_date >= week && p.post_date <= addDays(week, 6));
  const board = useMemo(() => weekBoard(inWeek, week), [inWeek, week]);
  const nextPlanned = all.find((p) => p.post_date > addDays(week, 6));
  const prevPlanned = [...all].reverse().find((p) => p.post_date < week);
  const platforms = [...new Set([...all.map((p) => p.platform), ...DEFAULT_PLATFORMS])];
  const languages = [...new Set(all.map((p) => p.language).filter(Boolean))] as string[];
  const goTo = (monday: string) => setParams((prev) => { const next = new URLSearchParams(prev); next.set("week", monday); return next; }, { replace: false });

  // Opened from the all-clients view: the post to open, by id.
  const openPostId = params.get("post");
  const openPostKey = openPostId ? all.find((p) => p.id === openPostId)?.post_key : undefined;

  return (
    <AppLayout
      title="Calendar"
      description="Every planned post on its date. Open a post to edit its copy, see its design or schedule it."
      actions={isMoburstStaff && id ? (
        <div className="flex items-center gap-2 flex-wrap">
          <ClientPicker value={id} week={week} />
          <NewPostDialog clientId={id} platforms={platforms} defaultDate={week > today ? week : today} onCreated={(d) => goTo(mondayOf(d))} />
        </div>
      ) : undefined}
    >
      {client.isLoading || posts.isLoading ? (
        <Loading label="Loading the calendar" />
      ) : client.isError || posts.isError ? (
        <LoadError title="Could not load the calendar" error={client.error || posts.error} onRetry={() => { void client.refetch(); void posts.refetch(); }} />
      ) : (
        <div className="space-y-4">
          <WeekNav week={week} thisWeek={thisWeek} count={inWeek.length} onGo={goTo} />

          {inWeek.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No posts planned for this week"
              description={nextPlanned
                ? "The next planned posts are in a later week."
                : isMoburstStaff ? "Plan this week from the client's latest report, or add a post with New post." : "Posts appear here once they are planned."}
              action={isMoburstStaff && id && all.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  <PlanWeekButton clientId={id} week={week} onPlanned={() => void posts.refetch()} />
                  {nextPlanned && <Button size="sm" variant="outline" onClick={() => goTo(mondayOf(nextPlanned.post_date))}>Go to the week of {shortDate(mondayOf(nextPlanned.post_date))}</Button>}
                </div>
              ) : nextPlanned ? (
                <Button size="sm" variant="outline" onClick={() => goTo(mondayOf(nextPlanned.post_date))}>
                  Go to the week of {shortDate(mondayOf(nextPlanned.post_date))}
                </Button>
              ) : prevPlanned ? (
                <Button size="sm" variant="outline" onClick={() => goTo(mondayOf(prevPlanned.post_date))}>Go to the last planned week</Button>
              ) : undefined}
            />
          ) : (
            <ContentIdeasTab
              key={week}
              mode="calendar"
              contentCalendar={board}
              aiAnalysis={null}
              sproutPerformance={null}
              clientContext={clientContext}
              clientId={id}
              clientTimezone={clientContext.timezone}
              availablePlatforms={platforms}
              availableLanguages={languages}
              openPostKey={openPostKey}
            />
          )}

          {inWeek.some((p) => p.report_id) && (
            <p className="t-secondary">
              Planned from{" "}
              <Link className="underline underline-offset-2 hover:text-white" to={`/clients/${id}/reports/${inWeek.find((p) => p.report_id)!.report_id}`}>the monthly report</Link>.
            </p>
          )}
        </div>
      )}
    </AppLayout>
  );
}
