import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveClients, viewerClients } from "@/lib/activeClients";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/display";
import { ClientOverview } from "@/components/dashboard/ClientOverview";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClickableCard } from "@/components/ui/clickable-card";
import { PageHeader } from "@/components/ui/page-header";
import { FileText, TrendingUp, BarChart3, Clock, Crosshair } from "lucide-react";
import { Loading } from "@/components/ui/loading";
import { LoadRetry } from "@/components/ui/load-error";
import { EmptyState } from "@/components/ui/empty-state";
import { StrategyOnlyNotice } from "@/components/clients/StrategyOnly";
import { useStrategyOnlyClients } from "@/lib/strategyOnly";

/**
 * What a client user sees before its account is linked to a client: the
 * dashboard's own words, shared with the Calendar tab. It states the status
 * and what will appear, and asks for nothing.
 */
export function ClientNotLinked({ appears = "Your reports, competitive analyses and analytics appear here once your account is connected." }: { appears?: string }) {
  return (
    <EmptyState
      icon={Clock}
      title="Your dashboard is being set up"
      description={appears}
    />
  );
}

export function ClientDashboard() {
  const navigate = useNavigate();
  const { user, isGosSession } = useAuth();

  // Active clients only, as every client list reads them; row access decides which.
  const { data: allClients, isLoading, error, refetch } = useActiveClients<{ id: string; name: string; logo_url: string | null; hub_company_name: string | null }>("id, name, logo_url, hub_company_name", { enabled: !!user });

  // The viewer's clients by the one rule the Calendar and Analytics tabs
  // share (src/lib/activeClients.ts): several are chosen between here.
  const matchingClients = viewerClients(allClients, { company: user?.company, isGosSession });
  const [pickedId, setPickedId] = useState<string | null>(null);
  const firstClient = matchingClients.find((c) => c.id === pickedId) ?? matchingClients[0];
  const clientId = firstClient?.id;
  // A strategy-only client (no active account in Sprout): the one sentence stands where its overview and report links would.
  const strategyOnly = useStrategyOnlyClients();

  // QA 22 Nov 2026: "No reports available yet" only once the read has answered; a read that fails is
  // tried again quietly and the card says it is loading meanwhile, never that there is no report.
  const { data: latestReport, isSuccess: latestReportRead } = useQuery({
    queryKey: ["client-dashboard-latest-report", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .eq("client_id", clientId!)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
    retry: true,
  });

  if (isLoading || strategyOnly.isLoading) {
    return <Loading variant="page" label="Loading your dashboard" />;
  }

  if (error) {
    return <LoadRetry context="client dashboard" error={error} label="Loading your dashboard" onRetry={() => refetch()} />;
  }

  if (matchingClients.length === 0) {
    return <ClientNotLinked />;
  }

  const displayName =
    firstClient.hub_company_name || firstClient.name || user?.company;

  return (
    <div className="space-y-section">
      <PageHeader
        title={displayName}
        description="Your social media intelligence dashboard"
        actions={matchingClients.length > 1 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Client">
            {matchingClients.map((c) => (
              <Button key={c.id} size="sm" variant={c.id === clientId ? "default" : "outline"} aria-pressed={c.id === clientId} onClick={() => setPickedId(c.id)}>
                {c.name}
              </Button>
            ))}
          </div>
        ) : undefined}
      />
      {strategyOnly.has(firstClient.id) ? (
        <StrategyOnlyNotice clientId={firstClient.id} clientName={firstClient.name} />
      ) : (
      <>
      <Card>
        <CardContent>
          <ClientOverview clientId={firstClient.id} isStaff={false} />
        </CardContent>
      </Card>

      {/* Four destinations in one row on a wide screen: two columns of
          700px tiles carried a single short line each. */}
      <div className="grid gap-inner sm:grid-cols-2 xl:grid-cols-4 stagger-children">
        <ClickableCard
          className="hover-lift"
          disabled={!latestReport}
          ariaLabel="Open the latest report"
          onClick={() => latestReport && navigate(`/clients/${clientId}/reports/${latestReport.id}`)}
        >
          <CardHeader>
            <CardTitle className="t-h3 flex items-center gap-2 [&_svg]:text-[#b9e045]">
              <TrendingUp className="h-4 w-4 text-accent" />
              Latest report
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latestReport ? (
              <p className="t-secondary">
                Generated on {formatDate(latestReport.created_at)}
              </p>
            ) : (
              <p className="t-secondary">{latestReportRead ? "No reports available yet" : "Loading the latest report"}</p>
            )}
          </CardContent>
        </ClickableCard>

        <ClickableCard
          className="hover-lift"
          ariaLabel="Open report history"
          onClick={() => navigate(`/clients/${clientId}/reports`)}
        >
          <CardHeader>
            <CardTitle className="t-h3 flex items-center gap-2 [&_svg]:text-[#b9e045]">
              <FileText className="h-4 w-4 text-accent" />
              Report history
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="t-secondary">View all past reports and analyses</p>
          </CardContent>
        </ClickableCard>

        <ClickableCard
          className="hover-lift"
          ariaLabel="Open competitive analyses"
          onClick={() => navigate(`/clients/${clientId}/competitive/reports`)}
        >
          <CardHeader>
            <CardTitle className="t-h3 flex items-center gap-2 [&_svg]:text-[#b9e045]">
              <Crosshair className="h-4 w-4 text-accent" />
              Competitive analyses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="t-secondary">How you compare with the rest of the field</p>
          </CardContent>
        </ClickableCard>

        <ClickableCard
          className="hover-lift"
          ariaLabel="Open analytics"
          onClick={() => navigate(`/clients/${clientId}/analytics`)}
        >
          <CardHeader>
            <CardTitle className="t-h3 flex items-center gap-2 [&_svg]:text-[#b9e045]">
              <BarChart3 className="h-4 w-4 text-accent" />
              Analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="t-secondary">Performance metrics and trend insights</p>
          </CardContent>
        </ClickableCard>
      </div>
      </>
      )}
    </div>
  );
}
