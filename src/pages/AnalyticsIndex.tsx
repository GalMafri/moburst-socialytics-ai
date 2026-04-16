import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

export default function AnalyticsIndex() {
  const navigate = useNavigate();

  const { data: clients, isLoading } = useQuery({
    queryKey: ["clients-for-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, logo_url")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppLayout title="Analytics">
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Select a Client</h2>
          <p className="text-sm text-muted-foreground">Choose a client to view their analytics dashboard.</p>
        </div>

        {isLoading ? (
          <div className="animate-pulse text-muted-foreground">Loading clients...</div>
        ) : !clients?.length ? (
          <Card className="p-12 text-center">
            <div className="space-y-3">
              <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto" />
              <h3 className="font-semibold">No clients yet</h3>
              <p className="text-sm text-muted-foreground">Create a client first to see analytics.</p>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map((c) => (
              <Card
                key={c.id}
                className="cursor-pointer hover-lift transition-shadow"
                onClick={() => navigate(`/clients/${c.id}/analytics`)}
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
                    <div className="text-xs text-muted-foreground">View analytics →</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
