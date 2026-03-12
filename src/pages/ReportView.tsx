import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Loader2, ExternalLink, Calendar, Clock } from "lucide-react";
import { useRealtimeReports } from "@/hooks/useRealtimeReport";
import { ReportActions } from "@/components/reports/ReportActions";

export default function ReportView() {
  const { id, reportId } = useParams();
  const navigate = useNavigate();
  useRealtimeReports(id);

  const { data: report, isLoading } = useQuery({
    queryKey: ["report", reportId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("*, clients(name)")
        .eq("id", reportId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!reportId,
  });

  const clientName = (report as any)?.clients?.name ?? "Client";
  const rd = (report?.report_data ?? {}) as Record<string, any>;
  const isRunning = report?.status === "running";

  return (
    <AppLayout title={`Report: ${clientName}`}>
      <div className="max-w-4xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/clients/${id}/reports`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Reports
        </Button>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading report…
          </div>
        ) : !report ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Report not found.
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Header */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="text-lg">
                    {clientName} — Report
                  </CardTitle>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    {report.created_at && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(report.created_at).toLocaleDateString()}
                      </span>
                    )}
                    {report.duration_minutes && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {report.duration_minutes}m
                      </span>
                    )}
                    {report.date_range_start && report.date_range_end && (
                      <span>{report.date_range_start} — {report.date_range_end}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={report.status === "completed" ? "default" : report.status === "running" ? "secondary" : "destructive"}
                    className="gap-1"
                  >
                    {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
                    {report.status}
                  </Badge>
                  {report.gamma_url && (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.open(report.gamma_url!, "_blank")}>
                      <ExternalLink className="h-3.5 w-3.5" /> Presentation
                    </Button>
                  )}
                  <ReportActions report={report} />
                </div>
              </CardHeader>
            </Card>

            {/* Report Data */}
            {isRunning ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3" />
                  <p>Report is being generated…</p>
                  <p className="text-xs mt-1">This page will update automatically.</p>
                </CardContent>
              </Card>
            ) : rd && Object.keys(rd).length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Report Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Executive Summary */}
                  {rd.executive_summary && (
                    <div>
                      <h3 className="font-semibold text-sm mb-1">Executive Summary</h3>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{rd.executive_summary}</p>
                    </div>
                  )}

                  {rd.executive_summary && <Separator />}

                  {/* Sections - render any top-level keys as sections */}
                  {Object.entries(rd)
                    .filter(([key]) => key !== "executive_summary")
                    .map(([key, value]) => (
                      <div key={key}>
                        <h3 className="font-semibold text-sm mb-1 capitalize">
                          {key.replace(/_/g, " ")}
                        </h3>
                        {typeof value === "string" ? (
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{value}</p>
                        ) : (
                          <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-60">
                            {JSON.stringify(value, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground text-sm">
                  No report data available.
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
