// Every competitive analysis run for one client, newest first. Unguarded in
// the router like the social report history: RLS shows clients only their
// completed reports and staff everything.

import { useNavigate, useParams } from "react-router-dom";
import { landscapeLabel } from "@/lib/competitiveStatus";
import { firstRunSentence, formatDateTime, formatRange, listedRuns } from "@/lib/display";
import { useNextRun } from "@/lib/nextRun";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadRetry } from "@/components/ui/load-error";
import { watchExpired } from "@/lib/runWatch";
import { ReportActions } from "@/components/reports/ReportActions";
import { ArrowLeft, Crosshair, Eye, Loader2, Play, Rss } from "lucide-react";

export default function CompetitiveReportHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isMoburstStaff } = useAuth();
  const nextRun = useNextRun(id, "competitive");

  const { data: client } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: reports, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["competitive-reports-history", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitive_reports")
        .select("id, status, created_at, date_range_start, date_range_end, duration_minutes, gamma_url, report_data")
        .eq("client_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
    // Only while a run is going and inside the watch limit; the abandoned-run sweep closes the rest.
    refetchInterval: (q) => ((q.state.data as any[] | undefined)?.some((r) => r.status === "running" && !watchExpired(r.created_at)) ? 10000 : false),
  });

  return (
    <AppLayout
      title={`Competitive reports: ${client?.name ?? "Client"}`}
      description="Every competitive analysis run for this client, newest first."
      back={
        <Button variant="ghost" size="sm" className="-ml-2 border-0 bg-transparent" onClick={() => navigate(isMoburstStaff ? "/competitive" : "/")}>
          <ArrowLeft /> Back
        </Button>
      }
      actions={isMoburstStaff ? (
        <>
          <Button variant="outline" size="sm" onClick={() => navigate(`/clients/${id}/competitive/feed`)}><Rss /> Competitor feed</Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/clients/${id}/competitive`)}><Crosshair /> Competitor set</Button>
          <Button size="sm" onClick={() => navigate(`/clients/${id}/competitive/run`)}><Play /> New analysis</Button>
        </>
      ) : undefined}
    >
        <Card>
          <CardContent>
            {isLoading ? (
              <Loading label="Loading competitive reports" />
            ) : isError ? (
              // Not an empty state. "No competitive analyses yet" asserts
              // something about the data on the strength of a request that
              // never answered, and the runs are almost certainly still there.
              <LoadRetry context="competitive run history" error={error} onRetry={() => refetch()} />
            ) : listedRuns("competitive", reports, { isStaff: isMoburstStaff }).length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Period analyzed</TableHead>
                    {isMoburstStaff && <TableHead>Tracking</TableHead>}
                    <TableHead>Duration</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listedRuns("competitive", reports, { isStaff: isMoburstStaff }).map((r: any) => {
                    const rd = (r.report_data || {}) as any;
                    const running = r.display.state === "running";
                    const period = formatRange(rd.period) || formatRange({ start: r.date_range_start, end: r.date_range_end });
                    return (
                      <TableRow key={r.id} className={running ? "animate-pulse" : ""}>
                        <TableCell className="t-body">{formatDateTime(r.created_at)}</TableCell>
                        <TableCell>
                          <Badge variant={r.display.variant} className="gap-1">
                            {running && <Loader2 className="h-3 w-3 animate-spin" />}
                            {r.display.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="t-secondary">{period}</TableCell>
                        {isMoburstStaff && <TableCell className="t-secondary">{rd.landscape?.name ? landscapeLabel(rd.landscape.name) : ""}</TableCell>}
                        <TableCell className="t-secondary">{r.display.state === "ready" && r.duration_minutes ? `${r.duration_minutes} min` : ""}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {(r.display.state === "ready" || r.display.state === "held") && (
                              <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${id}/competitive/reports/${r.id}`)}>
                                <Eye /> View
                              </Button>
                            )}
                            <ReportActions report={r} kind="competitive" />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyState framed={false} icon={Crosshair} title="No competitive analyses yet" description={firstRunSentence("competitive", nextRun.data) || undefined} />
            )}
          </CardContent>
        </Card>
    </AppLayout>
  );
}
