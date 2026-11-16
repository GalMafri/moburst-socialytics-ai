import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveClients } from "@/lib/activeClients";
import { AppLayout } from "@/components/layout/AppLayout";
import { CardContent } from "@/components/ui/card";
import { ClickableCard } from "@/components/ui/clickable-card";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadRetry } from "@/components/ui/load-error";
import { ArrowRight, Compass } from "lucide-react";
import { ClientLogo } from "@/components/clients/ClientLogo";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/display";

interface StrategyRow { client_id: string; written_at: string | null; updating: string | null }

/** Every active client's content strategy, for staff (the route is staff only). */
export default function StrategyIndex() {
  const navigate = useNavigate();

  // Active clients only, the one shared definition every client list uses.
  const { data: clients, isLoading, isError, error, refetch } = useActiveClients<{ id: string; name: string; logo_url: string | null; hub_company_name: string | null }>("id, name, logo_url, hub_company_name");

  // When each strategy was written and whether a new version is under way: two small fields, never the write's own evidence.
  const { data: rows } = useQuery({
    queryKey: ["content-strategy-index"],
    queryFn: async () => {
      const { data, error } = await supabase.from("content_strategies").select<string, StrategyRow>("client_id, written_at, updating:pending->>phase");
      if (error) throw error;
      return data ?? [];
    },
    retry: true,
  });
  const byClient = new Map((rows ?? []).map((r) => [r.client_id, r]));

  return (
    <AppLayout title="Strategy"
      description="Each client's 90-day social strategy.">
        {isLoading ? (
          <Loading label="Loading clients" />
        ) : isError ? (
          <LoadRetry context="clients" error={error} onRetry={() => refetch()} />
        ) : !clients?.length ? (
          <EmptyState icon={Compass} title="No clients yet" />
        ) : (
          <div className="grid gap-inner sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 stagger-children">
            {clients.map((c) => {
              const row = byClient.get(c.id);
              const written = row?.written_at ? formatDate(row.written_at) : "";
              return (
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
                    {(written || row?.updating) && (
                      <div className="flex flex-wrap items-center gap-2 t-label">
                        {written && <span>Written {written}</span>}
                        {row?.updating && <Badge variant="outline">Updating</Badge>}
                      </div>
                    )}
                    <div className="t-link inline-flex items-center gap-1">View strategy <ArrowRight className="h-3 w-3" aria-hidden /></div>
                  </div>
                </CardContent>
              </ClickableCard>
              );
            })}
          </div>
        )}
    </AppLayout>
  );
}
