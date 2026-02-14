import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Eye, ExternalLink } from "lucide-react";
import { ReportActions } from "@/components/reports/ReportActions";

export default function AllReports() {
  const navigate = useNavigate();
  const { isAdmin, user } = useAuth();

  const { data: reports, isLoading } = useQuery({
    queryKey: ["all-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("*, clients(id, name)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppLayout title="Reports">
      <div className="max-w-5xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All Reports</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
            ) : reports && reports.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Gamma</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium text-sm">{r.clients?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "completed" ? "default" : r.status === "running" ? "secondary" : "destructive"}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.date_range_start && r.date_range_end ? `${r.date_range_start} — ${r.date_range_end}` : "—"}
                      </TableCell>
                      <TableCell>
                        {r.gamma_url ? (
                          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.open(r.gamma_url, "_blank")}>
                            <ExternalLink className="h-3.5 w-3.5" /> Gamma
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Coming soon</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right flex items-center justify-end gap-1">
                        {r.status === "completed" && (
                          <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${r.clients?.id}/reports/${r.id}`)}>
                            <Eye className="h-4 w-4 mr-1" /> View
                          </Button>
                        )}
                        <ReportActions report={r} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-center text-muted-foreground py-8">No reports yet</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
