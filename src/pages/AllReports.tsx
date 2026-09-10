import { useState } from "react";
import { RetryReportButton } from "@/components/reports/RetryReportButton";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { Eye, ExternalLink, Crosshair, FileText } from "lucide-react";
import { ReportActions } from "@/components/reports/ReportActions";
import { formatRange } from "@/lib/dateRange";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function AllReports() {
  const navigate = useNavigate();
  const { isClient, user } = useAuth();
  const [tab, setTab] = useState<"social" | "competitive">("social");
  /** "all", or a client id. Both tabs follow it. */
  const [clientFilter, setClientFilter] = useState<string>("all");

  // For client role, first get their assigned client IDs
  const { data: clientAccess } = useQuery({
    queryKey: ["my-clients", user?._id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_users")
        .select("client_id")
        .eq("user_id", user!._id);
      if (error) throw error;
      return data?.map((c) => c.client_id) ?? [];
    },
    enabled: isClient && !!user,
  });

  const ready = !isClient || (isClient && clientAccess !== undefined);

  // The picker lists every client the viewer can see, not only the ones with a
  // report in the last 50 rows, so choosing one is how you reach the older ones.
  const { data: clientOptions } = useQuery({
    queryKey: ["report-filter-clients", isClient ? clientAccess : "all"],
    queryFn: async () => {
      let query = supabase.from("clients").select("id, name").order("name");
      if (isClient && clientAccess && clientAccess.length > 0) query = query.in("id", clientAccess);
      else if (isClient) return [];
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: ready,
  });

  const { data: reports, isLoading } = useQuery({
    queryKey: ["all-reports", isClient ? clientAccess : "all", clientFilter],
    queryFn: async () => {
      let query = supabase
        .from("reports")
        .select("*, clients(id, name)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (isClient && clientAccess && clientAccess.length > 0) {
        query = query.in("client_id", clientAccess);
      } else if (isClient) {
        return [];
      }
      // Filtered in the query, not in the page: with a 50-row cap, filtering
      // what came back would hide a client's older reports entirely.
      if (clientFilter !== "all") query = query.eq("client_id", clientFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: ready,
  });

  const { data: competitive, isLoading: competitiveLoading } = useQuery({
    queryKey: ["all-competitive-reports", isClient ? clientAccess : "all", clientFilter],
    queryFn: async () => {
      let query = supabase
        .from("competitive_reports")
        .select("id, client_id, status, created_at, date_range_start, date_range_end, duration_minutes, gamma_url, report_data, clients(id, name)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (isClient && clientAccess && clientAccess.length > 0) {
        query = query.in("client_id", clientAccess);
      } else if (isClient) {
        return [];
      }
      if (clientFilter !== "all") query = query.eq("client_id", clientFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: ready,
  });

  const filteredClientName = clientOptions?.find((c) => c.id === clientFilter)?.name;

  return (
    <AppLayout
      title="Reports"
      description={
        filteredClientName
          ? `Every monthly report and competitive analysis for ${filteredClientName}, newest first.`
          : "Every monthly report and competitive analysis across clients, newest first."
      }
      actions={
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-[220px]" aria-label="Filter by client">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {(clientOptions ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <div className="w-full">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="mb-4">
            <TabsTrigger value="social" className="gap-1.5"><FileText className="h-4 w-4" /> Monthly reports</TabsTrigger>
            <TabsTrigger value="competitive" className="gap-1.5"><Crosshair className="h-4 w-4" /> Competitive analyses</TabsTrigger>
          </TabsList>

          <TabsContent value="social">
            <Card>
              <CardHeader>
                <CardTitle className="t-h3">{filteredClientName ? `${filteredClientName} — monthly reports` : "All monthly reports"}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Loading label="Loading reports" />
                ) : reports && reports.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Period</TableHead>
                        {!isClient && <TableHead>Presentation</TableHead>}
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reports.map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium t-body">{r.clients?.name ?? "—"}</TableCell>
                          <TableCell className="t-body">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <Badge variant={r.status === "completed" ? "default" : r.status === "running" ? "secondary" : "destructive"}>
                              {r.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="t-secondary">
                            {r.date_range_start && r.date_range_end ? formatRange({ start: r.date_range_start, end: r.date_range_end }) : "—"}
                          </TableCell>
                          {!isClient && (
                            <TableCell>
                              {r.gamma_url ? (
                                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.open(r.gamma_url, "_blank")}>
                                  <ExternalLink className="h-3.5 w-3.5" /> View
                                </Button>
                              ) : (
                                <span className="t-secondary">Coming soon</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {r.status === "completed" && (
                                <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${r.clients?.id}/reports/${r.id}`)}>
                                  <Eye className="h-4 w-4 mr-1" /> View
                                </Button>
                              )}
                              <ReportActions report={r} />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    title={filteredClientName ? `No reports for ${filteredClientName}` : "No reports yet"}
                    description={
                      filteredClientName
                        ? "This client has no monthly reports yet. Pick another client, or run an analysis."
                        : "Reports across all clients will appear here once analyses have been run."
                    }
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="competitive">
            <Card>
              <CardHeader>
                <CardTitle className="t-h3">{filteredClientName ? `${filteredClientName} — competitive analyses` : "All competitive analyses"}</CardTitle>
              </CardHeader>
              <CardContent>
                {competitiveLoading ? (
                  <Loading label="Loading competitive analyses" />
                ) : competitive && competitive.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Run</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Period analyzed</TableHead>
                        <TableHead>Landscape</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {competitive.map((r: any) => {
                        const rd = (r.report_data || {}) as any;
                        const period = rd.period?.start ? formatRange(rd.period) : r.date_range_start ? formatRange({ start: r.date_range_start, end: r.date_range_end }) : "—";
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium t-body">{r.clients?.name ?? "—"}</TableCell>
                            <TableCell className="t-body">{new Date(r.created_at).toLocaleString()}</TableCell>
                            <TableCell>
                              <Badge variant={r.status === "complete" ? "default" : r.status === "running" ? "secondary" : "destructive"}>{r.status}</Badge>
                            </TableCell>
                            <TableCell className="t-secondary">{period}</TableCell>
                            <TableCell className="t-secondary">{rd.landscape?.name || "—"}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${r.client_id}/competitive/reports`)}>All runs</Button>
                                {r.status !== "running" && (
                                  <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${r.client_id}/competitive/reports/${r.id}`)}>
                                    <Eye className="h-4 w-4 mr-1" /> View
                                  </Button>
                                )}
                                {r.status === "failed" && <RetryReportButton reportId={r.id} kind="competitive" />}
                                <ReportActions report={r} kind="competitive" />
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
                    title={filteredClientName ? `No competitive analyses for ${filteredClientName}` : "No competitive analyses yet"}
                    description="Confirm a competitor set for a client and run the RivalIQ analysis; results will be listed here."
                    action={!isClient ? <Button onClick={() => navigate("/competitive")}>Go to competitive analysis</Button> : undefined}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
