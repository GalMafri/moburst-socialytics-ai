import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveClients } from "@/lib/activeClients";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { ClickableCard } from "@/components/ui/clickable-card";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";
import { BarChart3, ArrowRight } from "lucide-react";

export default function AnalyticsIndex() {
  const navigate = useNavigate();
  const { isClient, user, isGosSession } = useAuth();

  // Active clients only, the one shared definition every client list uses.
  const { data: clients, isLoading, isError, error, refetch } = useActiveClients<{ id: string; name: string; logo_url: string | null; hub_company_name: string | null }>("id, name, logo_url, hub_company_name");

  // Client-role users should skip the chooser and go straight to their own
  // client's analytics page.
  useEffect(() => {
    if (!isClient || !clients?.length) return;
    const userCompany = (user?.company ?? "").trim().toLowerCase();
    // gOS client sessions are RLS-scoped, so any returned client is theirs — take
    // the first. Legacy sessions match on hub_company_name.
    const mine = isGosSession
      ? clients[0]
      : (clients.find((c) => (c.hub_company_name ?? "").trim().toLowerCase() === userCompany) ??
        (clients.length === 1 ? clients[0] : null));
    if (mine) navigate(`/clients/${mine.id}/analytics`, { replace: true });
  }, [isClient, clients, user?.company, isGosSession, navigate]);

  return (
    <AppLayout title="Analytics"
      description="Each client's live performance, trends and competitive view.">
        {isLoading ? (
          <Loading label="Loading clients" />
        ) : isError ? (
          <LoadError title="Could not load the clients" error={error} onRetry={() => refetch()} />
        ) : !clients?.length ? (
          <EmptyState icon={BarChart3} title="No clients yet" />
        ) : (
          <div className="grid gap-inner sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 stagger-children">
            {clients.map((c) => (
              <ClickableCard
                key={c.id}
                className="hover-lift"
                onClick={() => navigate(`/clients/${c.id}/analytics`)}
                ariaLabel={`View analytics for ${c.name}`}
              >
                <CardContent className="flex items-center gap-3">
                  {c.logo_url ? (
                    <img src={c.logo_url} alt="" className="h-10 w-10 rounded-[8px] object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-[8px] bg-white/10 flex items-center justify-center t-badge text-white">
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="t-h4 truncate">{c.name}</div>
                    <div className="t-link inline-flex items-center gap-1">View analytics <ArrowRight className="h-3 w-3" aria-hidden /></div>
                  </div>
                </CardContent>
              </ClickableCard>
            ))}
          </div>
        )}
    </AppLayout>
  );
}
