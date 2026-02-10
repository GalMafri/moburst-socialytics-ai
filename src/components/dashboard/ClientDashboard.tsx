import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, TrendingUp } from "lucide-react";

export function ClientDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: clientAccess } = useQuery({
    queryKey: ["my-clients", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_users")
        .select("client_id, clients(id, name, logo_url)")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const clientId = clientAccess?.[0]?.client_id;

  const { data: latestReport } = useQuery({
    queryKey: ["latest-report", clientId],
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

  if (!clientAccess?.length) {
    return (
      <Card className="p-12 text-center">
        <h3 className="font-semibold mb-2">No client access</h3>
        <p className="text-sm text-muted-foreground">Contact your account manager to get access.</p>
      </Card>
    );
  }

  const client = clientAccess[0]?.clients as any;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{client?.name}</h2>
        <p className="text-muted-foreground text-sm">Your social media intelligence dashboard</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => latestReport && navigate(`/clients/${clientId}/reports/${latestReport.id}`)}>
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

        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/clients/${clientId}/reports`)}>
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
