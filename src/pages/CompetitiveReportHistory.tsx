// Every competitive analysis run for one client, newest first. Unguarded in
// the router like the social report history: RLS shows clients only their
// completed reports and staff everything.

import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRange } from "@/lib/dateRange";
import { ArrowLeft, Crosshair, Eye, Loader2, Play, Rss } from "lucide-react";

export default function CompetitiveReportHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isMoburstStaff } = useAuth();

  const { data: client } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: reports, isLoading } = useQuery({
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
    refetchInterval: (q) => ((q.state.data as any[] | undefined)?.some((r) => r.status === "running") ? 10000 : false),
  });

  return (
    <AppLayout title={`Competitive reports: ${client?.name ?? "Client"}`}>
      <div className="w-full space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => navigate(isMoburstStaff ? "/competitive" : "/")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {isMoburstStaff && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate(`/clients/${id}/competitive/feed`)}><Rss className="h-4 w-4 mr-1" /> Competitor feed</Button>
              <Button variant="outline" size="sm" onClick={() => navigate(`/clients/${id}/competitive`)}><Crosshair className="h-4 w-4 mr-1" /> Competitor set</Button>
              <Button size="sm" onClick={() => navigate(`/clients/${id}/competitive/run`)}><Play className="h-4 w-4 mr-1" /> New analysis</Button>
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Competitive analysis history</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Loading label="Loading competitive reports" />
            ) : reports && reports.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Period analyzed</TableHead>
                    <TableHead>Landscape</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((r: any) => {
                    const rd = (r.report_data || {}) as any;
                    const running = r.status === "running";
                    const period = rd.period?.start ? formatRange(rd.period) : r.date_range_start ? formatRange({ start: r.date_range_start, end: r.date_range_end }) : "—";
                    return (
                      <TableRow key={r.id} className={running ? "animate-pulse" : ""}>
                        <TableCell className="text-[15px]">{new Date(r.created_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === "complete" ? "default" : running ? "secondary" : "destructive"} className="gap-1">
                            {running && <Loader2 className="h-3 w-3 animate-spin" />}
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[15px] text-[#9ca3af]">{period}</TableCell>
                        <TableCell className="text-[15px] text-[#9ca3af]">{rd.landscape?.name || "—"}</TableCell>
                        <TableCell className="text-[15px] text-[#9ca3af]">{r.duration_minutes ? `${r.duration_minutes}m` : "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {!running && (
                              <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${id}/competitive/reports/${r.id}`)}>
                                <Eye className="h-4 w-4 mr-1" /> View
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={Crosshair}
                title="No competitive analyses yet"
                description={isMoburstStaff ? "Confirm a competitor set, then run the first analysis." : "Your account team has not run a competitive analysis yet."}
                action={isMoburstStaff ? <Button onClick={() => navigate(`/clients/${id}/competitive`)}>Set up competitors</Button> : undefined}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
