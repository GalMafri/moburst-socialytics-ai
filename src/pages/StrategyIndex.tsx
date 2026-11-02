import { useNavigate } from "react-router-dom";
import { useActiveClients } from "@/lib/activeClients";
import { AppLayout } from "@/components/layout/AppLayout";
import { CardContent } from "@/components/ui/card";
import { ClickableCard } from "@/components/ui/clickable-card";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadRetry } from "@/components/ui/load-error";
import { ArrowRight, Compass } from "lucide-react";
import { ClientLogo } from "@/components/clients/ClientLogo";

/** Every active client's content strategy, for staff (the route is staff only). */
export default function StrategyIndex() {
  const navigate = useNavigate();

  // Active clients only, the one shared definition every client list uses.
  const { data: clients, isLoading, isError, error, refetch } = useActiveClients<{ id: string; name: string; logo_url: string | null; hub_company_name: string | null }>("id, name, logo_url, hub_company_name");

  return (
    <AppLayout title="Strategy"
      description="Each client's content strategy, written from its brief, its trend profile and its posts.">
        {isLoading ? (
          <Loading label="Loading clients" />
        ) : isError ? (
          <LoadRetry context="clients" error={error} onRetry={() => refetch()} />
        ) : !clients?.length ? (
          <EmptyState icon={Compass} title="No clients yet" />
        ) : (
          <div className="grid gap-inner sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 stagger-children">
            {clients.map((c) => (
              <ClickableCard
                key={c.id}
                className="hover-lift"
                onClick={() => navigate(`/clients/${c.id}/strategy`)}
                ariaLabel={`View the strategy for ${c.name}`}
              >
                <CardContent className="flex items-center gap-3">
                  <ClientLogo client={c} />
                  <div className="min-w-0">
                    <div className="t-h4 truncate">{c.name}</div>
                    <div className="t-link inline-flex items-center gap-1">View strategy <ArrowRight className="h-3 w-3" aria-hidden /></div>
                  </div>
                </CardContent>
              </ClickableCard>
            ))}
          </div>
        )}
    </AppLayout>
  );
}
