import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadRetry } from "@/components/ui/load-error";
import { Eye, Crosshair, FileText } from "lucide-react";
import { OpenPresentationButton, ReportActions } from "@/components/reports/ReportActions";
import { firstRunSentence, formatDate, formatDateTime, formatRange, listedRuns } from "@/lib/display";
import { landscapeLabel } from "@/lib/competitiveStatus";
import { useActiveClients } from "@/lib/activeClients";
import { useNextRun } from "@/lib/nextRun";
import { listedMonthlyReports } from "@/lib/reportRun";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StrategyOnlyNotice } from "@/components/clients/StrategyOnly";
import { useStrategyOnlyClients } from "@/lib/strategyOnly";

type MonthlyListRow = { id: string; client_id: string; status: string | null; created_at: string; date_range_start: string | null; date_range_end: string | null; gamma_url: string | null; report_period?: unknown; clients: unknown };

export default function AllReports() {
  const navigate = useNavigate();
  // Staff only: the route guard keeps clients off this page.
  const viewer = { isStaff: true };
  const [tab, setTab] = useState<"social" | "competitive">("social");
  /** "all", or a client id. Both tabs follow it. */
  const [clientFilter, setClientFilter] = useState<string>("all");

  const [socialLimit, setSocialLimit] = useState(50);
  const [competitiveLimit, setCompetitiveLimit] = useState(50);
  useEffect(() => { setSocialLimit(50); setCompetitiveLimit(50); }, [clientFilter]);

  // The picker lists every active client the viewer can see, not only the ones
  // with a report on the current page. The filter applies to both paginated lists.
  const { data: clientOptions } = useActiveClients("id, name", {});
  const nextMonthly = useNextRun(clientFilter !== "all" ? clientFilter : null, "monthly");
  const nextCompetitive = useNextRun(clientFilter !== "all" ? clientFilter : null, "competitive");

  // A strategy-only client (no active account in Sprout) has no reports page: the reports it already has stay
  // stored and are left out of both lists, in the query, so a page of 50 is still 50. Chosen in the picker, it
  // shows the one sentence in place of the lists.
  const strategyOnly = useStrategyOnlyClients();
  const hidden = [...strategyOnly.ids].sort();
  const closedClient = clientFilter !== "all" && strategyOnly.has(clientFilter) ? clientFilter : null;

  // The reports the list shows: one ready report per client and period, so a
  // page is cut from the collapsed list, never from raw rows (a rerun of a
  // month would come back on the next page). Rows come newest first in
  // chunks, and only the columns the list reads.
  const { data: reports, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["all-reports", clientFilter, socialLimit, hidden.join(",")],
    enabled: !strategyOnly.isLoading && !closedClient,
    queryFn: async () => {
      const CHUNK = 200;
      const all: MonthlyListRow[] = [];
      for (let from = 0; ; from += CHUNK) {
        let query = supabase
          .from("reports")
          .select<string, MonthlyListRow>("id, client_id, status, created_at, date_range_start, date_range_end, gamma_url, report_period:report_data->report_period, clients(id, name)")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + CHUNK - 1);
        // Filtered in the query, not in the page, so a client's older reports are never cut off.
        if (clientFilter !== "all") query = query.eq("client_id", clientFilter);
        else if (hidden.length) query = query.not("client_id", "in", `(${hidden.join(",")})`);
        const { data, error } = await query;
        if (error) throw error;
        all.push(...(data ?? []));
        const listed = listedMonthlyReports(all, viewer);
        if (listed.length > socialLimit || (data?.length ?? 0) < CHUNK) return listed.slice(socialLimit - 50, socialLimit + 1);
      }
    },
  });

  const { data: competitive, isLoading: competitiveLoading, isError: competitiveFailed, error: competitiveError, refetch: refetchCompetitive } = useQuery({
    queryKey: ["all-competitive-reports", clientFilter, competitiveLimit, hidden.join(",")],
    enabled: !strategyOnly.isLoading && !closedClient,
    // QA 22 Nov 2026: a page is cut from the listed runs, as the monthly tab's
    // is, never from raw rows. Cut from raw rows, 50 runs that did not finish
    // (left out of the list) made page 1 say "No competitive analyses yet"
    // with a ready analysis on page 2, and held runs of one period split
    // across pages.
    queryFn: async () => {
      const CHUNK = 200;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const all: any[] = [];
      for (let from = 0; ; from += CHUNK) {
        let query = supabase
          .from("competitive_reports")
          .select("id, client_id, status, created_at, date_range_start, date_range_end, duration_minutes, gamma_url, report_data, clients(id, name)")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + CHUNK - 1);
        if (clientFilter !== "all") query = query.eq("client_id", clientFilter);
        else if (hidden.length) query = query.not("client_id", "in", `(${hidden.join(",")})`);
        const { data, error } = await query;
        if (error) throw error;
        all.push(...(data ?? []));
        const listed = listedRuns("competitive", all, viewer);
        if (listed.length > competitiveLimit || (data?.length ?? 0) < CHUNK) return listed.slice(competitiveLimit - 50, competitiveLimit + 1);
      }
    },
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
        {closedClient ? (
          <StrategyOnlyNotice clientId={closedClient} clientName={filteredClientName} />
        ) : (
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
                {isLoading || strategyOnly.isLoading ? (
                  <Loading label="Loading reports" />
                ) : isError ? (
                  <LoadRetry context="reports" error={error} onRetry={() => refetch()} />
                ) : (reports?.length ?? 0) > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead>Presentation</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reports?.slice(0, 50).map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium t-body">{r.clients?.name ?? ""}</TableCell>
                          <TableCell className="t-body">{formatDate(r.created_at)}</TableCell>
                          <TableCell>
                            <Badge variant={r.display.variant}>{r.display.label}</Badge>
                          </TableCell>
                          <TableCell className="t-secondary">
                            {formatRange({ start: r.date_range_start, end: r.date_range_end })}
                          </TableCell>
                          <TableCell>
                            {r.gamma_url ? (
                              <OpenPresentationButton url={r.gamma_url} />
                            ) : r.display.state === "running" ? (
                              <span className="t-secondary">Being made</span>
                            ) : null}
                          </TableCell>
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
                {!isLoading && !isError && (!!reports?.length || socialLimit > 50) && <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-white/[0.06]"><p className="t-label mr-auto">{reports?.length ? `Monthly reports ${socialLimit - 49} to ${socialLimit - 50 + Math.min(reports.length, 50)}` : "No more monthly reports"}{(reports?.length || 0) > 50 ? "; more available" : ""}.</p>{socialLimit > 50 && <Button size="sm" variant="outline" aria-label="Previous monthly reports" onClick={() => setSocialLimit((n) => n - 50)}>Previous</Button>}{(reports?.length || 0) > 50 && <Button size="sm" variant="outline" aria-label="Next monthly reports" onClick={() => setSocialLimit((n) => n + 50)}>Next</Button>}</div>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="competitive">
            <Card>
              <CardHeader>
                <CardTitle className="t-h3">{filteredClientName ? `${filteredClientName}: competitive analyses` : "All competitive analyses"}</CardTitle>
              </CardHeader>
              <CardContent>
                {competitiveLoading || strategyOnly.isLoading ? (
                  <Loading label="Loading competitive analyses" />
                ) : competitiveFailed ? (
                  <LoadRetry context="competitive analyses" error={competitiveError} onRetry={() => refetchCompetitive()} />
                ) : competitive?.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Run</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Period analyzed</TableHead>
                        <TableHead>Tracking</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {competitive.slice(0, 50).map((r: any) => {
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
                            <TableCell className="t-secondary">{rd.landscape?.name ? landscapeLabel(rd.landscape.name) : ""}</TableCell>
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
                {!competitiveLoading && !competitiveFailed && (!!competitive?.length || competitiveLimit > 50) && <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-white/[0.06]"><p className="t-label mr-auto">{competitive?.length ? `Competitive analyses ${competitiveLimit - 49} to ${competitiveLimit - 50 + Math.min(competitive.length, 50)}` : "No more competitive analyses"}{(competitive?.length || 0) > 50 ? "; more available" : ""}.</p>{competitiveLimit > 50 && <Button size="sm" variant="outline" aria-label="Previous competitive analyses" onClick={() => setCompetitiveLimit((n) => n - 50)}>Previous</Button>}{(competitive?.length || 0) > 50 && <Button size="sm" variant="outline" aria-label="Next competitive analyses" onClick={() => setCompetitiveLimit((n) => n + 50)}>Next</Button>}</div>}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        )}
    </AppLayout>
  );
}
