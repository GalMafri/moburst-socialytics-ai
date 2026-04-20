import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, TrendingUp, AlertCircle } from "lucide-react";

// Defense-in-depth: even when RLS returns extra/stale clients (e.g. client_users
// cache not yet cleaned, or migration to computed is_client_member not applied
// yet), we filter client-side to the user's CURRENT Hub company. This keeps the
// dashboard showing only the right client's data no matter what the DB state is.

function normalize(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export function ClientDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

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
  const userCompany = normalize(user?.company);
  const matchingClients = (allClients ?? []).filter((c) => {
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
        <p className="text-sm text-muted-foreground">Loading your dashboard…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-12 text-center">
        <AlertCircle className="h-10 w-10 mx-auto text-destructive mb-3" />
        <h3 className="font-semibold mb-2">Couldn't load client data</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </Card>
    );
  }

  if (matchingClients.length === 0) {
    // Distinguish between "RLS returned nothing" and "RLS returned clients but none match your company"
    const rlsReturnedZero = (allClients?.length ?? 0) === 0;
    return (
      <Card className="p-12 text-center">
        <h3 className="font-semibold mb-2">No client access yet</h3>
        <p className="text-sm text-muted-foreground">
          {rlsReturnedZero
            ? "No clients are linked to your account yet. Ask your Moburst account manager to confirm your company is set up correctly in the Hub and linked to a client in this tool."
            : "Your Hub company doesn't match any client in this tool. Ask your account manager to fix the mapping in Settings → Hub Company Mapping."}
        </p>
        <div className="mt-4 p-3 rounded-lg bg-[rgba(255,255,255,0.03)] text-xs text-muted-foreground text-left max-w-sm mx-auto">
          <div>
            Your Hub company:{" "}
            <code className="text-foreground">{user?.company || "(not set)"}</code>
          </div>
          <div>Clients visible to you: {allClients?.length ?? 0}</div>
          {!!allClients?.length && allClients.length <= 10 && (
            <div className="mt-2">
              Their Hub company names:{" "}
              {allClients.map((c) => (
                <span
                  key={c.id}
                  className="inline-block mx-0.5 px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.04)]"
                >
                  {c.hub_company_name || "(blank)"}
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>
    );
  }

  const displayName =
    firstClient.hub_company_name || firstClient.name || user?.company;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{displayName}</h2>
        <p className="text-muted-foreground text-sm">Your social media intelligence dashboard</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          className="cursor-pointer hover-lift transition-shadow"
          onClick={() => latestReport && navigate(`/clients/${clientId}/reports/${latestReport.id}`)}
        >
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-accent" />
              Latest Report
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latestReport ? (
              <p className="text-sm text-muted-foreground">
                Generated on {new Date(latestReport.created_at).toLocaleDateString()}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No reports available yet</p>
            )}
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover-lift transition-shadow"
          onClick={() => navigate(`/clients/${clientId}/reports`)}
        >
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-accent" />
              Report History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">View all past reports and analyses</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
