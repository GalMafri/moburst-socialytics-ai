import { useNavigate } from "react-router-dom";
import { formatDate } from "@/lib/display";
import { ClientOverview } from "@/components/dashboard/ClientOverview";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClickableCard } from "@/components/ui/clickable-card";
import { PageHeader } from "@/components/ui/page-header";
import { FileText, TrendingUp, BarChart3, AlertCircle, Crosshair } from "lucide-react";

// Defense-in-depth: even when RLS returns extra/stale clients (e.g. client_users
// cache not yet cleaned, or migration to computed is_client_member not applied
// yet), we filter client-side to the user's CURRENT Hub company. This keeps the
// dashboard showing only the right client's data no matter what the DB state is.

function normalize(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export function ClientDashboard() {
  const navigate = useNavigate();
  const { user, isGosSession } = useAuth();

  // Pull everything RLS allows, then filter here.
  const { data: allClients, isLoading, error } = useQuery({
    queryKey: ["client-dashboard-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, logo_url, hub_company_name")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Filter to clients whose hub_company_name matches the user's Hub company.
  // gOS sessions are already company-scoped by RLS (allowed_company_slugs), so
  // trust the rows RLS returned; legacy sessions keep the name filter.
  const userCompany = normalize(user?.company);
  const matchingClients = isGosSession
    ? (allClients ?? [])
    : (allClients ?? []).filter((c) => {
        if (!userCompany) return false;
        return normalize(c.hub_company_name) === userCompany;
      });

  const firstClient = matchingClients[0];
  const clientId = firstClient?.id;

  const { data: latestReport } = useQuery({
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
  });

  if (isLoading) {
    return (
      <Card className="p-12 text-center">
        <p className="t-secondary">Loading your dashboard…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-12 text-center">
        <AlertCircle className="h-10 w-10 mx-auto text-destructive mb-3" />
        <h3 className="font-semibold mb-2">Your dashboard did not load</h3>
        <p className="t-secondary mb-4">Refresh the page to try again.</p>
      </Card>
    );
  }

  if (matchingClients.length === 0) {
    return (
      <Card className="p-12 text-center">
        <h3 className="font-semibold mb-2">Your dashboard is being set up</h3>
        <p className="t-secondary">Your Moburst account team is connecting your account. Contact them if this does not change soon.</p>
      </Card>
    );
  }

  const displayName =
    firstClient.hub_company_name || firstClient.name || user?.company;

  return (
    <div className="space-y-6">
      <PageHeader title={displayName} description="Your social media intelligence dashboard" />
      <ClientOverview clientId={firstClient.id} isStaff={false} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ClickableCard
          className="hover-lift transition-shadow"
          disabled={!latestReport}
          ariaLabel="Open the latest report"
          onClick={() => latestReport && navigate(`/clients/${clientId}/reports/${latestReport.id}`)}
        >
          <CardHeader>
            <CardTitle className="t-h3 flex items-center gap-2">
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
              <p className="t-secondary">No reports available yet</p>
            )}
          </CardContent>
        </ClickableCard>

        <ClickableCard
          className="hover-lift transition-shadow"
          ariaLabel="Open report history"
          onClick={() => navigate(`/clients/${clientId}/reports`)}
        >
          <CardHeader>
            <CardTitle className="t-h3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-accent" />
              Report history
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="t-secondary">View all past reports and analyses</p>
          </CardContent>
        </ClickableCard>

        <ClickableCard
          className="hover-lift transition-shadow"
          ariaLabel="Open competitive analyses"
          onClick={() => navigate(`/clients/${clientId}/competitive/reports`)}
        >
          <CardHeader>
            <CardTitle className="t-h3 flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-accent" />
              Competitive analyses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="t-secondary">How you compare with the rest of the field</p>
          </CardContent>
        </ClickableCard>

        <ClickableCard
          className="hover-lift transition-shadow"
          ariaLabel="Open analytics"
          onClick={() => navigate(`/clients/${clientId}/analytics`)}
        >
          <CardHeader>
            <CardTitle className="t-h3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-accent" />
              Analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="t-secondary">Performance metrics and trend insights</p>
          </CardContent>
        </ClickableCard>
      </div>
    </div>
  );
}
