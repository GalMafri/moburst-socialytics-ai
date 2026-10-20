import { useEffect, useState } from "react";
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
import { LoadError } from "@/components/ui/load-error";
import { Eye, ExternalLink, Crosshair, FileText } from "lucide-react";
import { ReportActions } from "@/components/reports/ReportActions";
import { firstRunSentence, formatDate, formatDateTime, formatRange, listedRuns } from "@/lib/display";
import { landscapeLabel } from "@/lib/competitiveStatus";
import { useActiveClients } from "@/lib/activeClients";
import { useNextRun } from "@/lib/nextRun";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function AllReports() {
  const navigate = useNavigate();
  const { isClient, isMoburstStaff, user } = useAuth();
  const viewer = { isStaff: isMoburstStaff };
  const [tab, setTab] = useState<"social" | "competitive">("social");
  /** "all", or a client id. Both tabs follow it. */
  const [clientFilter, setClientFilter] = useState<string>("all");

  const [socialLimit, setSocialLimit] = useState(50);
  const [competitiveLimit, setCompetitiveLimit] = useState(50);
  useEffect(() => { setSocialLimit(50); setCompetitiveLimit(50); }, [clientFilter]);

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

  // The picker lists every active client the viewer can see, not only the ones
  // with a report on the current page. The filter applies to both paginated lists.
  const { data: clientOptions } = useActiveClients("id, name", { ids: isClient ? clientAccess ?? [] : undefined, enabled: ready });
  const nextMonthly = useNextRun(clientFilter !== "all" ? clientFilter : null, "monthly");
  const nextCompetitive = useNextRun(clientFilter !== "all" ? clientFilter : null, "competitive");

  const { data: reports, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["all-reports", isClient ? clientAccess : "all", clientFilter, socialLimit],
    queryFn: async () => {
      let query = supabase
        .from("reports")
        .select("*, clients(id, name)")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(socialLimit - 50, socialLimit);
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

  const { data: competitive, isLoading: competitiveLoading, isError: competitiveFailed, error: competitiveError, refetch: refetchCompetitive } = useQuery({
    queryKey: ["all-competitive-reports", isClient ? clientAccess : "all", clientFilter, competitiveLimit],
    queryFn: async () => {
      let query = supabase
        .from("competitive_reports")
        .select("id, client_id, status, created_at, date_range_start, date_range_end, duration_minutes, gamma_url, report_data, clients(id, name)")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(competitiveLimit - 50, competitiveLimit);
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
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="space-y-section">
          <TabsList>
            <TabsTrigger value="social" className="gap-1.5"><FileText className="h-4 w-4" /> Monthly reports</TabsTrigger>
            <TabsTrigger value="competitive" className="gap-1.5"><Crosshair className="h-4 w-4" /> Competitive analyses</TabsTrigger>
          </TabsList>

          <TabsContent value="social">
            <Card>
              <CardHeader>
                <CardTitle className="t-h3">{filteredClientName ? `${filteredClientName}: monthly reports` : "All monthly reports"}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Loading label="Loading reports" />
                ) : isError ? (
                  <LoadError title="Could not load the reports" error={error} onRetry={() => refetch()} />
                ) : listedRuns("monthly", reports?.slice(0, 50), viewer).length > 0 ? (
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
                      {listedRuns("monthly", reports?.slice(0, 50), viewer).map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium t-body">{r.clients?.name ?? ""}</TableCell>
                          <TableCell className="t-body">{formatDate(r.created_at)}</TableCell>
                          <TableCell>
                            <Badge variant={r.display.variant}>{r.display.label}</Badge>
                          </TableCell>
                          <TableCell className="t-secondary">
                            {formatRange({ start: r.date_range_start, end: r.date_range_end })}
                          </TableCell>
                          {!isClient && (
                            <TableCell>
                              {r.gamma_url ? (
                                <Button size="sm" variant="outline" onClick={() => window.open(r.gamma_url, "_blank")}>
                                  <ExternalLink /> Presentation
                                </Button>
                              ) : r.display.state === "running" ? (
                                <span className="t-secondary">Being made</span>
                              ) : null}
                            </TableCell>
                          )}
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {r.display.state === "ready" && (
                                <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${r.clients?.id}/reports/${r.id}`)}>
                                  <Eye /> Open report
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
                    framed={false}
                    icon={FileText}
                    title={filteredClientName ? `No reports for ${filteredClientName} yet` : "No reports yet"}
                    description={firstRunSentence("monthly", nextMonthly.data) || undefined}
                  />
                )}
                {!isLoading && !isError && (!!reports?.length || socialLimit > 50) && <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-white/[0.06]"><p className="t-label mr-auto">{reports?.length ? `Monthly reports ${socialLimit - 49}–${socialLimit - 50 + Math.min(reports.length, 50)}` : "No more monthly reports"}{(reports?.length || 0) > 50 ? "; more available" : ""}.</p>{socialLimit > 50 && <Button size="sm" variant="outline" aria-label="Previous monthly reports" onClick={() => setSocialLimit((n) => n - 50)}>Previous</Button>}{(reports?.length || 0) > 50 && <Button size="sm" variant="outline" aria-label="Next monthly reports" onClick={() => setSocialLimit((n) => n + 50)}>Next</Button>}</div>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="competitive">
            <Card>
              <CardHeader>
                <CardTitle className="t-h3">{filteredClientName ? `${filteredClientName}: competitive analyses` : "All competitive analyses"}</CardTitle>
              </CardHeader>
              <CardContent>
                {competitiveLoading ? (
                  <Loading label="Loading competitive analyses" />
                ) : competitiveFailed ? (
                  <LoadError title="Could not load competitive analyses" error={competitiveError} onRetry={() => refetchCompetitive()} />
                ) : listedRuns("competitive", competitive?.slice(0, 50), viewer).length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Run</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Period analyzed</TableHead>
                        {isMoburstStaff && <TableHead>Tracking</TableHead>}
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {listedRuns("competitive", competitive?.slice(0, 50), viewer).map((r: any) => {
                        const rd = (r.report_data || {}) as any;
                        const period = formatRange(rd.period) || formatRange({ start: r.date_range_start, end: r.date_range_end });
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium t-body">{r.clients?.name ?? ""}</TableCell>
                            <TableCell className="t-body">{formatDateTime(r.created_at)}</TableCell>
                            <TableCell>
                              <Badge variant={r.display.variant}>{r.display.label}</Badge>
                            </TableCell>
                            <TableCell className="t-secondary">{period}</TableCell>
                            {isMoburstStaff && <TableCell className="t-secondary">{rd.landscape?.name ? landscapeLabel(rd.landscape.name) : ""}</TableCell>}
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${r.client_id}/competitive/reports`)}>All runs</Button>
                                {r.display.state === "ready" && (
                                  <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${r.client_id}/competitive/reports/${r.id}`)}>
                                    <Eye /> Open report
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
                  <EmptyState
                    framed={false}
                    icon={Crosshair}
                    title={filteredClientName ? `No competitive analyses for ${filteredClientName} yet` : "No competitive analyses yet"}
                    description={firstRunSentence("competitive", nextCompetitive.data) || undefined}
                  />
                )}
                {!competitiveLoading && !competitiveFailed && (!!competitive?.length || competitiveLimit > 50) && <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-white/[0.06]"><p className="t-label mr-auto">{competitive?.length ? `Competitive analyses ${competitiveLimit - 49}–${competitiveLimit - 50 + Math.min(competitive.length, 50)}` : "No more competitive analyses"}{(competitive?.length || 0) > 50 ? "; more available" : ""}.</p>{competitiveLimit > 50 && <Button size="sm" variant="outline" aria-label="Previous competitive analyses" onClick={() => setCompetitiveLimit((n) => n - 50)}>Previous</Button>}{(competitive?.length || 0) > 50 && <Button size="sm" variant="outline" aria-label="Next competitive analyses" onClick={() => setCompetitiveLimit((n) => n + 50)}>Next</Button>}</div>}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
    </AppLayout>
  );
}
