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
import { BarChart3 } from "lucide-react";

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
      description="Choose a client to open its analytics: live Sprout numbers, trends and the competitive view.">
      <div className="space-y-6">
        <div>
        </div>

        {isLoading ? (
          <Loading label="Loading clients" />
        ) : isError ? (
          <LoadError title="Could not load the clients" error={error} onRetry={() => refetch()} />
        ) : !clients?.length ? (
          <EmptyState icon={BarChart3} title="No clients yet" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map((c) => (
              <ClickableCard
                key={c.id}
                className="hover-lift transition-shadow"
                onClick={() => navigate(`/clients/${c.id}/analytics`)}
                ariaLabel={`View analytics for ${c.name}`}
              >
                <CardContent className="pt-5 flex items-center gap-3">
                  {c.logo_url ? (
                    <img src={c.logo_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                      {c.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="t-secondary">View analytics →</div>
                  </div>
                </CardContent>
              </ClickableCard>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
