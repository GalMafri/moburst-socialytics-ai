import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Eye, Loader2, ExternalLink } from "lucide-react";
import { useRealtimeReports } from "@/hooks/useRealtimeReport";
import { ReportActions } from "@/components/reports/ReportActions";
import { useAuth } from "@/hooks/useAuth";

export default function ReportHistory() {
  const { id } = useParams();
  useRealtimeReports(id);
  const navigate = useNavigate();
  const { canRunAnalysis } = useAuth();

  const { data: client } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("name").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: reports, isLoading } = useQuery({
    queryKey: ["reports-history", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .eq("client_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  return (
    <AppLayout title={`Reports: ${client?.name ?? "Client"}`}>
      <div className="max-w-4xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Report History</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
            ) : reports && reports.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Presentation</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((r: any) => {
                    const rd = r.report_data as any;
                    const isRunning = r.status === "running";
                    return (
                      <TableRow key={r.id} className={isRunning ? "animate-pulse" : ""}>
                        <TableCell className="text-sm">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <Badge
                            variant={r.status === "completed" ? "default" : r.status === "running" ? "secondary" : "destructive"}
                            className="gap-1"
                          >
                            {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.date_range_start && r.date_range_end
                            ? `${r.date_range_start} — ${r.date_range_end}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.duration_minutes ? `${r.duration_minutes}m` : "—"}
                        </TableCell>
                        <TableCell>
                          {r.gamma_url ? (
                            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.open(r.gamma_url, "_blank")}>
                              <ExternalLink className="h-3.5 w-3.5" /> View
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Coming soon</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right flex items-center justify-end gap-1">
                          {r.status === "completed" && (
                            <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${id}/reports/${r.id}`)}>
                              <Eye className="h-4 w-4 mr-1" /> View
                            </Button>
                          )}
                          <ReportActions report={r} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No reports yet</p>
                {canRunAnalysis && (
                  <Button variant="outline" className="mt-3" onClick={() => navigate(`/clients/${id}/analyze`)}>
                    Run your first analysis
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
