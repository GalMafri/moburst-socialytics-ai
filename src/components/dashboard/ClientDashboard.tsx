import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, TrendingUp } from "lucide-react";

export function ClientDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // RLS-scoped: returns only clients the user has access to (via is_client_member:
  // either profiles.hub_company_name = clients.hub_company_name, or a manual
  // client_users row). Do NOT filter by user._id — that's the Hub MongoDB
  // ObjectId and does not match Supabase's auth.users.id UUID.
  const { data: accessibleClients, isLoading } = useQuery({
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

  const firstClient = accessibleClients?.[0];
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

  if (!accessibleClients?.length) {
    return (
      <Card className="p-12 text-center">
        <h3 className="font-semibold mb-2">No client access yet</h3>
        <p className="text-sm text-muted-foreground">
          Your Hub company does not match any client in this tool. Ask your Moburst
          account manager to confirm your company name is set correctly in the Hub
          and that a matching client exists here.
        </p>
        {user?.company && (
          <p className="text-xs text-muted-foreground mt-4">
            Your Hub company: <code className="text-foreground">{user.company}</code>
          </p>
        )}
      </Card>
    );
  }

  const displayName = firstClient?.hub_company_name || firstClient?.name || user?.company;

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
