/**
 * The Calendar tab. Staff see every client's posts for the week, with a client
 * filter; a client's own users go straight to their own calendar.
 */

import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Loading } from "@/components/ui/loading";
import { LoadError } from "@/components/ui/load-error";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { ALL_CLIENTS, ClientPicker, WeekNav } from "@/components/calendar/CalendarHeaderControls";
import { AllClientsWeek, type ClientPost } from "@/components/calendar/AllClientsWeek";
import { addDays, mondayOf, shortDate, todayIn, type CalendarPostRow } from "@/lib/calendarPosts";

export default function CalendarIndex() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { isClient, isMoburstStaff, user, isGosSession } = useAuth();

  const clients = useQuery({
    queryKey: ["calendar-clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name, hub_company_name, archived_at").order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // A client's own users go straight to their calendar.
  useEffect(() => {
    const list = clients.data;
    if (!isClient || !list?.length) return;
    const userCompany = (user?.company ?? "").trim().toLowerCase();
    const mine = isGosSession
      ? list[0]
      : (list.find((c) => (c.hub_company_name ?? "").trim().toLowerCase() === userCompany) ?? (list.length === 1 ? list[0] : null));
    if (mine) navigate(`/clients/${mine.id}/calendar`, { replace: true });
  }, [isClient, clients.data, user?.company, isGosSession, navigate]);

  const today = todayIn("UTC");
  const week = mondayOf(params.get("week") || today);
  const thisWeek = mondayOf(today);
  const goTo = (monday: string) => setParams((prev) => { const next = new URLSearchParams(prev); next.set("week", monday); return next; });

  const posts = useQuery({
    queryKey: ["calendar-all-posts", week],
    enabled: isMoburstStaff,
    queryFn: async () => {
      // calendar_posts is not in the generated types yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("calendar_posts" as never) as any)
        .select("*").gte("post_date", week).lte("post_date", addDays(week, 6)).order("post_date").limit(2000);
      if (error) throw error;
      return (data || []) as CalendarPostRow[];
    },
  });
  const nextPlanned = useQuery({
    queryKey: ["calendar-all-next", week],
    enabled: isMoburstStaff && !!posts.data && posts.data.length === 0,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from("calendar_posts" as never) as any).select("post_date").gt("post_date", addDays(week, 6)).order("post_date").limit(1);
      return (data?.[0]?.post_date as string | undefined) ?? null;
    },
  });

  const active = useMemo(() => new Map((clients.data || []).filter((c) => !c.archived_at).map((c) => [c.id, c.name] as const)), [clients.data]);
  const weekPosts: ClientPost[] = (posts.data || []).filter((p) => active.has(p.client_id)).map((p) => ({ ...p, client_name: active.get(p.client_id)! }));

  if (isClient) return <AppLayout title="Calendar"><Loading label="Opening your calendar" /></AppLayout>;

  return (
    <AppLayout
      title="Calendar"
      description="Every client's planned posts on their dates. Choose a client to work on its posts."
      actions={<ClientPicker value={ALL_CLIENTS} week={week} />}
    >
      {clients.isLoading || posts.isLoading ? (
        <Loading label="Loading the calendar" />
      ) : clients.isError || posts.isError ? (
        <LoadError title="Could not load the calendar" error={clients.error || posts.error} onRetry={() => { void clients.refetch(); void posts.refetch(); }} />
      ) : (
        <div className="space-y-4">
          <WeekNav week={week} thisWeek={thisWeek} count={weekPosts.length} onGo={goTo} />
          {weekPosts.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No posts planned for this week"
              description={nextPlanned.data ? "The next planned posts are in a later week." : "Posts appear here when a monthly report plans them, or when one is added to a client's calendar."}
              action={nextPlanned.data ? (
                <Button size="sm" variant="outline" onClick={() => goTo(mondayOf(nextPlanned.data!))}>Go to the week of {shortDate(mondayOf(nextPlanned.data!))}</Button>
              ) : undefined}
            />
          ) : (
            <AllClientsWeek posts={weekPosts} week={week} />
          )}
        </div>
      )}
    </AppLayout>
  );
}
