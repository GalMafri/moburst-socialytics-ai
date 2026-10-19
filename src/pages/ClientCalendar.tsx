/**
 * A client's content calendar, its own tab (Lital, 12 and 13 Oct): every
 * planned post on its date, week by week. Each week is planned once (Lital,
 * 19 Oct): every Monday for the following week, or with "Plan next week",
 * and "Revise this week" rewrites what nobody has worked on. Every active
 * client can be planned, with nothing to set up first. The team adds
 * posts at any time, and each post's design is prepared and can be
 * regenerated from the post's current copy.
 */

import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
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
import { PlanNextWeekButton, ReviseWeekButton, WeekPlanStatus } from "@/components/calendar/WeekPlanControls";
import { CLIENT_CONTEXT_COLUMNS, buildClientContext } from "@/lib/clientContext";
import { addDays, canRevise, mondayOf, nextPlannableWeek, shortDate, weekBoard, type CalendarPlanRow, type CalendarPostRow } from "@/lib/calendarPosts";
import { thisWeek as thisWeekWindow, weekOf } from "@/lib/weekWindow";

const DEFAULT_PLATFORMS = ["Instagram", "LinkedIn", "TikTok", "Facebook", "X"];

const inFlight = (p: CalendarPlanRow) => p.status === "queued" || p.status === "planning" || !!p.pending_revision;

export default function ClientCalendar() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { isMoburstStaff } = useAuth();

  const client = useQuery({
    queryKey: ["calendar-client", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select(`${CLIENT_CONTEXT_COLUMNS}, archived_at`).eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const plans = useQuery({
    queryKey: ["calendar-plans", id],
    enabled: !!id,
    // While a week is being planned or revised, look again every 10 seconds.
    refetchInterval: (q) => ((q.state.data as CalendarPlanRow[] | undefined)?.some(inFlight) ? 10_000 : false),
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("calendar_plans" as never) as any)
        .select("id, client_id, week_start, status, trigger, error, pending_revision, revisions, ready_at, created_at")
        .eq("client_id", id)
        .order("week_start");
      if (error) throw error;
      return (data || []) as CalendarPlanRow[];
    },
  });
  const busy = (plans.data ?? []).some(inFlight);
  const posts = useQuery({
    queryKey: ["calendar-posts", id],
    enabled: !!id,
    refetchInterval: busy ? 10_000 : false,
    queryFn: async () => {
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
  // "This week" is Monday to Sunday in the client's time zone, the one
  // definition the dashboard counts too (src/lib/weekWindow.ts).
  const current = thisWeekWindow(clientContext.timezone);
  const today = current.today;
  const week = weekOf(params.get("week") || today).start;
  const thisWeek = current.start;
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

  const weekPlan = (plans.data ?? []).find((p) => p.week_start === week) ?? null;
  const planOnItsWay = !!weekPlan && (weekPlan.status === "queued" || weekPlan.status === "planning");
  const nextWeek = plans.data ? nextPlannableWeek(plans.data, today) : null;
  const refresh = () => { void plans.refetch(); void posts.refetch(); };
  // Every client that isn't archived can be planned and revised, by staff and by the client's own users.
  const active = !!client.data && !(client.data as { archived_at?: string | null }).archived_at;
  const planButton = id && active ? <PlanNextWeekButton clientId={id} week={nextWeek} onRequested={(w) => { if (w) goTo(w); refresh(); }} /> : null;
  const revisable = active && canRevise(weekPlan, today);
  const showPlanBar = !!weekPlan && (inFlight(weekPlan) || revisable);

  return (
    <AppLayout
      title="Calendar"
      description="Every planned post on its date. Open a post to edit its copy, see its design or schedule it."
      actions={id ? (
        <div className="flex items-center gap-2 flex-wrap">
          {isMoburstStaff && <ClientPicker value={id} week={week} />}
          {planButton}
          {isMoburstStaff && <NewPostDialog clientId={id} platforms={platforms} defaultDate={week > today ? week : today} onCreated={(d) => goTo(mondayOf(d))} />}
        </div>
      ) : undefined}
    >
      {client.isLoading || posts.isLoading || plans.isLoading ? (
        <Loading label="Loading the calendar" />
      ) : client.isError || posts.isError || plans.isError ? (
        <LoadError title="Could not load the calendar" error={client.error || posts.error || plans.error} onRetry={() => { void client.refetch(); refresh(); }} />
      ) : (
        <div className="space-y-4">
          <WeekNav week={week} thisWeek={thisWeek} count={inWeek.length} onGo={goTo} />

          {showPlanBar && weekPlan && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <WeekPlanStatus plan={weekPlan} />
              {revisable && <div className="ml-auto"><ReviseWeekButton plan={weekPlan} onRequested={refresh} /></div>}
            </div>
          )}

          {inWeek.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No posts planned for this week"
              description={planOnItsWay
                ? "This week's plan is on its way."
                : nextWeek === week && planButton
                  ? "Each week is planned on the Monday before it. You can plan this one now."
                  : nextPlanned ? "The next planned posts are in a later week." : "Each week is planned on the Monday before it."}
              action={!planOnItsWay && nextWeek === week && planButton ? planButton : nextPlanned ? (
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

        </div>
      )}
    </AppLayout>
  );
}
