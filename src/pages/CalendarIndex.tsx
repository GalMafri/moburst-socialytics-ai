/**
 * The Calendar tab. Staff see every client's posts for the week, with a client
 * filter. A client's own users go straight to their calendar when they have
 * one client, choose between them when they have several, and see the
 * dashboard's empty state when none is linked yet.
 *
 * A strategy-only client (no active account in Sprout, src/lib/strategyOnly.ts)
 * has no calendar: its posts are left off the week, and one line under the
 * week names it, with the way to its strategy.
 */

import { useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Loading } from "@/components/ui/loading";
import { LoadRetry } from "@/components/ui/load-error";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { ALL_CLIENTS, ClientPicker, WeekNav } from "@/components/calendar/CalendarHeaderControls";
import { isActiveClient, useActiveClients, viewerClients } from "@/lib/activeClients";
import { ClientNotLinked } from "@/components/dashboard/ClientDashboard";
import { ClickableCard } from "@/components/ui/clickable-card";
import { CardContent } from "@/components/ui/card";
import { readAll } from "@/lib/readAll";
import { thisWeek as thisWeekWindow, viewerTimeZone, weekFromParam } from "@/lib/weekWindow";
import { AllClientsWeek, type ClientPost } from "@/components/calendar/AllClientsWeek";
import { addDays, mondayOf, shortDate, type CalendarPostRow } from "@/lib/calendarPosts";
import { STRATEGY_ONLY_SHORT_STAFF, useStrategyOnlyClients } from "@/lib/strategyOnly";

export default function CalendarIndex() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { isClient, isMoburstStaff, user, isGosSession } = useAuth();

  // Active clients only, the one shared definition every client list uses.
  const clients = useActiveClients<{ id: string; name: string; hub_company_name: string | null; archived_at: string | null; timezone: string | null }>("id, name, hub_company_name, archived_at, timezone");

  // A client user has the clients the shared rule gives it (src/lib/activeClients.ts).
  const mine = isClient && clients.data ? viewerClients(clients.data, { company: user?.company, isGosSession }) : null;
  const only = mine?.length === 1 ? mine[0] : null;
  useEffect(() => {
    if (only) navigate(`/clients/${only.id}/calendar`, { replace: true });
  }, [only, navigate]);

  // This week for the viewer, in the viewer's own time zone, and the week the address names (a damaged value gives this week).
  const current = thisWeekWindow(viewerTimeZone());
  const today = current.today;
  const week = weekFromParam(params.get("week"), today);
  const thisWeek = current.start;
  const goTo = (monday: string) => setParams((prev) => { const next = new URLSearchParams(prev); next.set("week", monday); return next; });

  // A strategy-only client's posts stay where they are and are not shown; they are there again once it has an account.
  const strategyOnly = useStrategyOnlyClients();
  const hidden = [...strategyOnly.ids].sort();
  const posts = useQuery({
    queryKey: ["calendar-all-posts", week],
    enabled: isMoburstStaff,
    // The week is read page by page until a short page comes back, so a busy week is never cut.
    queryFn: () => readAll<CalendarPostRow>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("calendar_posts" as never) as any)
        .select("*").gte("post_date", week).lte("post_date", addDays(week, 6)).order("post_date").order("id").range(from, to)),
  });
  const nextPlanned = useQuery({
    queryKey: ["calendar-all-next", week, hidden.join(",")],
    enabled: isMoburstStaff && !strategyOnly.isLoading && !!posts.data && posts.data.every((p) => strategyOnly.has(p.client_id)),
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let later = (supabase.from("calendar_posts" as never) as any).select("post_date").gt("post_date", addDays(week, 6));
      // The next week that has posts to show: never one that holds only a strategy-only client's.
      if (hidden.length) later = later.not("client_id", "in", `(${hidden.join(",")})`);
      const { data } = await later.order("post_date").limit(1);
      return (data?.[0]?.post_date as string | undefined) ?? null;
    },
  });

  const active = useMemo(() => new Map((clients.data || []).filter(isActiveClient).map((c) => [c.id, c] as const)), [clients.data]);
  const closed = [...active.values()].filter((c) => strategyOnly.has(c.id));
  const weekPosts: ClientPost[] = (posts.data || []).filter((p) => active.has(p.client_id) && !strategyOnly.has(p.client_id)).map((p) => ({ ...p, client_name: active.get(p.client_id)!.name, client_timezone: active.get(p.client_id)!.timezone }));

  if (isClient) {
    return (
      <AppLayout title="Calendar" description={mine && mine.length > 1 ? "Choose a client to open its calendar." : undefined}>
        {clients.isError ? (
          <LoadRetry context="calendar" error={clients.error} onRetry={() => { void clients.refetch(); }} />
        ) : !mine || only ? (
          <Loading label="Opening your calendar" />
        ) : mine.length === 0 ? (
          <ClientNotLinked appears="Your calendar appears here once your account is connected." />
        ) : (
          <div className="grid gap-inner sm:grid-cols-2 lg:grid-cols-3 stagger-children">
            {mine.map((c) => (
              <ClickableCard key={c.id} className="hover-lift" ariaLabel={`Open the calendar for ${c.name}`} onClick={() => navigate(`/clients/${c.id}/calendar`)}>
                <CardContent className="t-h4 truncate">{c.name}</CardContent>
              </ClickableCard>
            ))}
          </div>
        )}
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Calendar"
      description="Every client's planned posts on their dates."
      actions={<ClientPicker value={ALL_CLIENTS} week={week} />}
    >
      {clients.isLoading || posts.isLoading || strategyOnly.isLoading ? (
        <Loading label="Loading the calendar" />
      ) : clients.isError || posts.isError ? (
        <LoadRetry context="calendar" error={clients.error || posts.error} onRetry={() => { void clients.refetch(); void posts.refetch(); }} />
      ) : (
        <div className="space-y-section">
          <WeekNav week={week} thisWeek={thisWeek} posts={weekPosts} onGo={goTo} />
          {weekPosts.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No posts planned for this week"
              description={nextPlanned.data ? "The next planned posts are in a later week." : "Posts appear here once a client's week is planned."}
              action={nextPlanned.data ? (
                <Button size="sm" variant="outline" onClick={() => goTo(mondayOf(nextPlanned.data!))}>Go to the week of {shortDate(mondayOf(nextPlanned.data!))}</Button>
              ) : undefined}
            />
          ) : (
            <AllClientsWeek posts={weekPosts} week={week} />
          )}
          {closed.length > 0 && (
            <ul className="space-y-1" aria-label="Clients set up for strategy only">
              {closed.map((c) => (
                <li key={c.id} className="t-secondary">
                  <Link to={`/clients/${c.id}/strategy`} className="t-link">{c.name}</Link>: {STRATEGY_ONLY_SHORT_STAFF}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </AppLayout>
  );
}
