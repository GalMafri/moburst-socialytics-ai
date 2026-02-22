import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Search, Play, Calendar, BarChart3 } from "lucide-react";
import { PlatformBadge } from "@/lib/platform-config";
import { useState, useEffect } from "react";

export function AdminDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  // Realtime: listen for any report changes to refresh dashboard
  useEffect(() => {
    const channel = supabase
      .channel("admin-reports")
      .on("postgres_changes", { event: "*", schema: "public", table: "reports" }, () => {
        queryClient.invalidateQueries({ queryKey: ["clients"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const { data: clients, isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*, reports(id, status, created_at)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = clients?.filter((c: any) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Clients</h2>
          <p className="text-muted-foreground text-sm">{clients?.length ?? 0} clients configured</p>
        </div>
        <Button onClick={() => navigate("/clients/new/setup")}>
          <Plus className="h-4 w-4 mr-2" /> Add Client
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-3">
                <div className="h-5 bg-muted rounded w-1/2" />
              </CardHeader>
              <CardContent>
                <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered && filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((client: any) => {
            const lastReport = client.reports?.[0];
            const reportCount = client.reports?.length ?? 0;
            return (
              <Card
                key={client.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/clients/${client.id}/setup`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{client.name}</CardTitle>
                    {client.logo_url && (
                      <img src={client.logo_url} alt="" className="h-8 w-8 rounded object-cover" />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    {lastReport
                      ? `Last report: ${new Date(lastReport.created_at).toLocaleDateString()}`
                      : "No reports yet"}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {client.primary_platforms?.slice(0, 3).map((p: string) => (
                      <PlatformBadge key={p} platform={p} size="sm" />
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-muted-foreground">{reportCount} reports</span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/clients/${client.id}/analytics`);
                        }}
                      >
                        <BarChart3 className="h-3 w-3 mr-1" /> Analytics
                      </Button>
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/clients/${client.id}/analyze`);
                        }}
                      >
                        <Play className="h-3 w-3 mr-1" /> Run Report
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <div className="space-y-3">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto">
              <Plus className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="font-semibold">Add your first client</h3>
            <p className="text-sm text-muted-foreground">Get started by creating a client configuration</p>
            <Button onClick={() => navigate("/clients/new/setup")}>
              <Plus className="h-4 w-4 mr-2" /> Add Client
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
