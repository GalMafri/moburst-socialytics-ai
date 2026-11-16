import { useParams, useNavigate } from "react-router-dom";
import { firstRunSentence, formatDate, formatRange } from "@/lib/display";
import { listedMonthlyReports } from "@/lib/reportRun";
import { useNextRun } from "@/lib/nextRun";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Eye, Loader2, FileText } from "lucide-react";
import { useRealtimeReports } from "@/hooks/useRealtimeReport";
import { OpenPresentationButton, ReportActions } from "@/components/reports/ReportActions";
import { useAuth } from "@/hooks/useAuth";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadRetry } from "@/components/ui/load-error";

type HistoryReport = { id: string; client_id: string | null; status: string | null; created_at: string | null; date_range_start: string | null; date_range_end: string | null; duration_minutes: number | null; gamma_url: string | null; report_period: unknown };

export default function ReportHistory() {
  const { id } = useParams();
  useRealtimeReports(id);
  const navigate = useNavigate();
  const { isClient, isMoburstStaff } = useAuth();
  const nextRun = useNextRun(id, "monthly");

  const { data: client } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("name").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: reports, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["reports-history", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select<string, HistoryReport>("id, client_id, status, created_at, date_range_start, date_range_end, duration_minutes, gamma_url, report_period:report_data->report_period")
        .eq("client_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const listed = listedMonthlyReports(reports, { isStaff: isMoburstStaff });

  return (
    <AppLayout title={`Reports: ${client?.name ?? "Client"}`}
      description="All monthly reports for this client, newest first.">
        <Card>
          <CardContent>
            {isLoading ? (
              <Loading label="Loading reports" />
            ) : isError ? (
              // Never the empty state here. "No reports yet" tells a client
              // their work does not exist, on the strength of a request that
              // never answered.
              <LoadRetry context="reports" error={error} onRetry={() => refetch()} />
            ) : listed.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Duration</TableHead>
                    {!isClient && <TableHead>Presentation</TableHead>}
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listed.map((r: any) => {
                    const isRunning = r.display.state === "running";
                    return (
                      <TableRow key={r.id} className={isRunning ? "animate-pulse" : ""}>
                        <TableCell className="t-body">{formatDate(r.created_at)}</TableCell>
                        <TableCell>
                          <Badge variant={r.display.variant} className="gap-1">
                            {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
                            {r.display.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="t-secondary">
                          {formatRange({ start: r.date_range_start, end: r.date_range_end })}
                        </TableCell>
                        <TableCell className="t-secondary">
                          {r.duration_minutes ? `${r.duration_minutes} min` : ""}
                        </TableCell>
                        {!isClient && (
                          <TableCell>
                            {r.gamma_url ? (
                              <OpenPresentationButton url={r.gamma_url} />
                            ) : null}
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                          {r.display.state === "ready" && (
                            <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${id}/reports/${r.id}`)}>
                              <Eye /> View
                            </Button>
                          )}
                          <ReportActions report={r} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyState framed={false} icon={FileText} title="No reports yet" description={firstRunSentence("monthly", nextRun.data) || undefined} />
            )}
          </CardContent>
        </Card>
    </AppLayout>
  );
}
