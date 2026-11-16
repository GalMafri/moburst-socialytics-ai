import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveClients, viewerClients } from "@/lib/activeClients";
import { ClientNotLinked } from "@/components/dashboard/ClientDashboard";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { ClickableCard } from "@/components/ui/clickable-card";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadRetry } from "@/components/ui/load-error";
import { BarChart3, ArrowRight } from "lucide-react";
import { ClientLogo } from "@/components/clients/ClientLogo";

export default function AnalyticsIndex() {
  const navigate = useNavigate();
  const { isClient, user, isGosSession } = useAuth();

  // Active clients only, the one shared definition every client list uses.
  const { data: clients, isLoading, isError, error, refetch } = useActiveClients<{ id: string; name: string; logo_url: string | null; hub_company_name: string | null }>("id, name, logo_url, hub_company_name");

  // A client user has the clients the shared rule gives it (src/lib/activeClients.ts):
  // exactly one opens straight away, several are chosen between below.
  const mine = isClient && clients ? viewerClients(clients, { company: user?.company, isGosSession }) : null;
  const only = mine?.length === 1 ? mine[0] : null;
  useEffect(() => {
    if (only) navigate(`/clients/${only.id}/analytics`, { replace: true });
  }, [only, navigate]);
  const shown = mine ?? clients;

  return (
    <AppLayout title="Analytics"
      description="Each client's live performance, trends and competitive view.">
        {isLoading ? (
          <Loading label="Loading clients" />
        ) : isError ? (
          <LoadRetry context="clients" error={error} onRetry={() => refetch()} />
        ) : only ? (
          <Loading label="Opening your analytics" />
        ) : isClient && !shown?.length ? (
          <ClientNotLinked appears="Your analytics appear here once your account is connected." />
        ) : !shown?.length ? (
          <EmptyState icon={BarChart3} title="No clients yet" />
        ) : (
          <div className="grid gap-inner sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 stagger-children">
            {shown.map((c) => (
              <ClickableCard
                key={c.id}
                className="hover-lift"
                onClick={() => navigate(`/clients/${c.id}/analytics`)}
                ariaLabel={`View analytics for ${c.name}`}
              >
                <CardContent className="flex items-center gap-3">
                  <ClientLogo client={c} />
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
