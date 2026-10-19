import { useReportRun } from "@/hooks/useReportRun";
import { ReportRunStatus } from "@/components/reports/ReportRunStatus";
import { RUN_ESTIMATE } from "@/lib/reportRun";
import { useParams, useNavigate } from "react-router-dom";
import { countryNames, formatDate, formatDateTime, languageNames, listedRuns, platformName } from "@/lib/display";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/telemetry";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useRef, useState } from "react";
import { Play, CheckCircle2, CalendarDays, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loading } from "@/components/ui/loading";
import { useRealtimeReports } from "@/hooks/useRealtimeReport";
import { Navigate } from "react-router-dom";
import { localDateString } from "@/lib/calendarDate";
import { competitiveReportQuality } from "../../supabase/functions/_shared/competitive/reportEvidence";

// A person's monthly report run. Asking queues it (run-report); the
// scheduled path makes the report and runs it again quietly when it does not
// finish, so this page shows it running from the request until the report
// exists, and never a failure (useReportRun).

export default function RunAnalysis() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canRunAnalysis } = useAuth();
  const run = useReportRun(id, "social");
  const active = run.view.state !== "idle" && run.view.state !== "ready";
  // Date range defaults: current month start -> today
  const now = new Date();
  const defaultStart = localDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  const defaultEnd = localDateString(now);
  const [dateRangeStart, setDateRangeStart] = useState(defaultStart);
  const [dateRangeEnd, setDateRangeEnd] = useState(defaultEnd);
  const [skipTrends, setSkipTrends] = useState(false);
  // Wall-clock for the whole run, so latency is measured as the user feels it.
  const runStartedAt = useRef(0);

  // Subscribe to realtime report updates
  useRealtimeReports(id);

  const { data: client } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: profiles } = useQuery({
    queryKey: ["sprout-profiles", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sprout_profiles")
        .select("*")
        .eq("client_id", id!)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // The latest competitive analysis that passed its checks: the one the
  // report is built with (payloads.ts reads the same one).
  const { data: latestCompetitive } = useQuery({
    queryKey: ["run-competitive-context", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitive_reports")
        .select("id, created_at, report_data")
        .eq("client_id", id!)
        .eq("status", "complete")
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data || []).find((r) => competitiveReportQuality(r.report_data).ready) ?? null;
    },
    enabled: !!id,
  });

  const { data: pastReports } = useQuery({
    queryKey: ["reports", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .eq("client_id", id!)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const hasKeywords = (client?.social_keywords?.length || 0) > 0;
  const effectiveSkipTrends = skipTrends || !hasKeywords;

  // A run that is already going shows its own period.
  const runRange = "range" in run.view ? run.view.range : null;
  useEffect(() => {
    if (!runRange) return;
    setDateRangeStart(runRange.start);
    setDateRangeEnd(runRange.end);
  }, [runRange?.start, runRange?.end]);

  // The run this page watched made its report: open it.
  const readyId = run.view.state === "ready" ? run.view.reportId : null;
  useEffect(() => {
    if (!readyId) return;
    track("analysis_completed", {
      client_id: id, entity_id: readyId, ok: true,
      duration_ms: runStartedAt.current ? performance.now() - runStartedAt.current : null,
    });
    const timer = setTimeout(() => navigate(`/clients/${id}/reports/${readyId}`), 1500);
    return () => clearTimeout(timer);
  }, [readyId, id, navigate]);

  const runAnalysis = async () => {
    if (active || run.sending) return;
    runStartedAt.current = performance.now();
    track("analysis_started", {
      client_id: id,
      range_days: dateRangeStart && dateRangeEnd ? Math.round((new Date(dateRangeEnd).getTime() - new Date(dateRangeStart).getTime()) / 86400000) : null,
      skip_trends: effectiveSkipTrends,
    });
    await run.start({ date_range_start: dateRangeStart || undefined, date_range_end: dateRangeEnd || undefined, skip_trends: skipTrends });
  };

  if (!canRunAnalysis) return <Navigate to="/" replace />;

  if (!client)
    return (
      <AppLayout title="Run analysis" width="max-w-4xl"
      description="Check the configuration, choose the period and start the monthly report.">
        <Loading label="Loading" />
      </AppLayout>
    );

  const listed = listedRuns("monthly", pastReports, { isStaff: true });

  return (
    <AppLayout title={`Analyze: ${client.name}`} width="max-w-4xl" description="Check the configuration, choose the period and start the monthly report.">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Client summary */}
        <Card>
          <CardHeader>
            <CardTitle className="t-h3">Configuration summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 t-body">
              <div>
                <span className="text-muted-foreground">Platforms:</span> {(client.primary_platforms || []).map((p: string) => platformName(p)).join(", ")}
              </div>
              <div>
                <span className="text-muted-foreground">Regions:</span> {countryNames(client.geo)}
              </div>
              <div>
                <span className="text-muted-foreground">Languages:</span> {languageNames(client.language)}
              </div>
              <div>
                <span className="text-muted-foreground">Keywords:</span> {client.social_keywords?.length || 0}
              </div>
              <div>
                <span className="text-muted-foreground">Profiles:</span> {profiles?.length || 0}
              </div>
              <div>
                <span className="text-muted-foreground">Competitive context:</span>{" "}
                {latestCompetitive ? `from ${formatDate(latestCompetitive.created_at)}` : "none yet"}
              </div>
            </div>
            {profiles && profiles.length === 0 && (
              <p className="t-secondary">No social accounts are matched to this client yet. They are matched on their own once the accounts are in Sprout.</p>
            )}
          </CardContent>
        </Card>

        {/* Date range selection */}
        <Card>
          <CardHeader>
            <CardTitle className="t-h3 flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> Report Date Range
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="range-start">Start Date</Label>
                <Input id="range-start" disabled={active} type="date" value={dateRangeStart} onChange={(e) => setDateRangeStart(e.target.value)} max={dateRangeEnd} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="range-end">End Date</Label>
                <Input id="range-end" disabled={active} type="date" value={dateRangeEnd} onChange={(e) => setDateRangeEnd(e.target.value)} min={dateRangeStart} max={defaultEnd} />
              </div>
            </div>
            <p className="t-secondary mt-2">
              Defaults to current month. The comparison period is automatically calculated as the same number of days
              immediately before the start date.
            </p>
          </CardContent>
        </Card>

        {/* Trend Analysis Options */}
        <Card>
          <CardHeader>
            <CardTitle className="t-h3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Trend Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {active ? <p className="t-secondary">This analysis uses the trend settings selected when it started.</p> : <>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="include-trends">Include trend analysis</Label>
                <p className="t-secondary">Scrape TikTok and Instagram for trending content in your niche</p>
              </div>
              <Switch id="include-trends" checked={!skipTrends} onCheckedChange={(checked) => setSkipTrends(!checked)} disabled={!hasKeywords} />
            </div>
            {!hasKeywords && <p className="t-secondary">This client has no social keywords yet, so the report covers performance without trends.</p>}
            {hasKeywords && skipTrends && <p className="t-secondary">Trends are left out of this report. It covers performance.</p>}
            </>}
          </CardContent>
        </Card>

        {/* Run button */}
        <Card>
          <CardContent className="pt-5 text-center space-y-6">
            {run.view.state === "idle" && (
              <>
                <Button size="lg" onClick={runAnalysis} className="gap-2" disabled={!profiles || profiles.length === 0 || run.isLoading || run.sending}>
                  <Play className="h-5 w-5" /> Run Full Analysis
                </Button>
                <p className="t-secondary">{run.notStarted ? "The analysis has not started yet." : RUN_ESTIMATE}</p>
              </>
            )}

            <ReportRunStatus view={run.view} kind="monthly" />

            {run.view.state === "ready" && (
              <div className="flex items-center gap-2 justify-center text-success">
                <CheckCircle2 className="h-6 w-6" />
                <span className="font-medium">Analysis complete. Opening the report.</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Past runs */}
        {listed.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="t-h3">Recent analyses</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {listed.map((r) => (
                  <div
                    key={r.id}
                    className={`glass-inner flex items-center justify-between p-3 ${r.display.state === "ready" ? "cursor-pointer" : ""}`}
                    onClick={() => r.display.state === "ready" && navigate(`/clients/${id}/reports/${r.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant={r.display.variant}>{r.display.label}</Badge>
                      <span className="t-body">{formatDateTime(r.created_at)}</span>
                    </div>
                    {r.display.state === "ready" && Number(r.duration_minutes) > 0 ? <span className="t-secondary">Duration: {r.duration_minutes} min</span> : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
