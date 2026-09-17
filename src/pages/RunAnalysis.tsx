import { useActiveReportRun } from "@/hooks/useActiveReportRun";
import { ReportRunStatus } from "@/components/reports/ReportRunStatus";
import { RetryReportButton } from "@/components/reports/RetryReportButton";
import { RUN_ESTIMATE, canRetry } from "@/lib/reportRun";
import { useParams, useNavigate } from "react-router-dom";
import { describeInvokeError } from "@/lib/invokeError";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/telemetry";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useState, useRef, useCallback, useEffect } from "react";
import { Play, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, CalendarDays, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loading } from "@/components/ui/loading";
import { useRealtimeReports } from "@/hooks/useRealtimeReport";
import { Navigate } from "react-router-dom";
import { localDateString } from "@/lib/calendarDate";

const STEPS_FULL = [
  "Fetching Sprout Social performance data...",
  "Scraping TikTok trends...",
  "Scraping Instagram trends...",
  "AI analyzing and synthesizing...",
  "Generating presentation...",
];

const STEPS_NO_TRENDS = [
  "Fetching Sprout Social performance data...",
  "AI analyzing and synthesizing...",
  "Generating presentation...",
];


export default function RunAnalysis() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, canRunAnalysis } = useAuth();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const activeRun = useActiveReportRun(id, "monthly");
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const submitting = useRef(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  // Date range defaults: current month start -> today
  const now = new Date();
  const defaultStart = localDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  const defaultEnd = localDateString(now);
  const [dateRangeStart, setDateRangeStart] = useState(defaultStart);
  const [dateRangeEnd, setDateRangeEnd] = useState(defaultEnd);
  const [skipTrends, setSkipTrends] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wall-clock for the whole run, so latency is measured as the user feels it.
  const runStartedAt = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Latest complete competitive analysis, sent along so the report synthesis
  // can react to competitor gaps rather than analyze the client in isolation.
  const { data: latestCompetitive } = useQuery({
    queryKey: ["competitive-latest", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitive_reports")
        .select("id, created_at, report_data")
        .eq("client_id", id!)
        .eq("status", "complete")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Team verdicts on competitive gaps: endorsed gaps become must-address items
  // for the synthesis, down-voted gaps are kept out of the brief entirely.

  const { data: pastReports, refetch: refetchReports } = useQuery({
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

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (stepRef.current) clearInterval(stepRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const stopAllTimers = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (stepRef.current) {
      clearInterval(stepRef.current);
      stepRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Determine which steps to show based on skipTrends
  const hasKeywords = (client?.social_keywords?.length || 0) > 0;
  const effectiveSkipTrends = skipTrends || !hasKeywords;
  const STEPS = effectiveSkipTrends ? STEPS_NO_TRENDS : STEPS_FULL;

  // Watch for the active report to complete via realtime-triggered refetch
  useEffect(() => {
    if (!reportId || !running || !pastReports) return;
    const activeReport = pastReports.find((r: any) => r.id === reportId);
    if (activeReport?.status === "completed") {
      stopAllTimers();
      setCurrentStep(STEPS.length);
      setRunning(false);
      track("analysis_completed", {
        client_id: id,
        entity_id: reportId,
        duration_ms: runStartedAt.current ? performance.now() - runStartedAt.current : null,
        ok: true,
      });
      toast({ title: "Analysis complete!", description: "Your report is ready." });
      setTimeout(() => navigate(`/clients/${id}/reports/${reportId}`), 1500);
    } else if (activeReport?.status === "failed") {
      stopAllTimers();
      setRunning(false);
      track("analysis_failed", {
        client_id: id,
        entity_id: reportId,
        stage: "server",
        duration_ms: runStartedAt.current ? performance.now() - runStartedAt.current : null,
        ok: false,
        error_code: "server_failed",
      });
      setError("Analysis failed on the server. Check workflow logs.");
    }
  }, [pastReports, reportId, running, id, navigate, toast, stopAllTimers]);

  const pollForCompletion = useCallback(
    (rId: string) => {
      if (pollRef.current) clearInterval(pollRef.current);

      pollRef.current = setInterval(async () => {
        try {
          const { data, error: fetchErr } = await supabase
            .from("reports")
            .select("status, report_data, gamma_url")
            .eq("id", rId)
            .maybeSingle();

          if (fetchErr) {
            console.error("Poll error:", fetchErr);
            return; // Will retry on next interval
          }

          if (data?.status === "completed") {
            stopAllTimers();
            setCurrentStep(STEPS.length);
            setRunning(false);
            track("analysis_completed", {
              client_id: id,
              entity_id: rId,
              via: "poll",
              duration_ms: runStartedAt.current ? performance.now() - runStartedAt.current : null,
              ok: true,
            });
            toast({ title: "Analysis complete!", description: "Your report is ready." });
            refetchReports();
            setTimeout(() => navigate(`/clients/${id}/reports/${rId}`), 1500);
          } else if (data?.status === "failed") {
            stopAllTimers();
            setRunning(false);
            track("analysis_failed", {
              client_id: id,
              entity_id: rId,
              stage: "server",
              via: "poll",
              duration_ms: runStartedAt.current ? performance.now() - runStartedAt.current : null,
              ok: false,
              error_code: "server_failed",
            });
            setError("Analysis failed on the server. Check n8n execution logs.");
            refetchReports();
          }
        } catch {
          // Polling error, will retry on next interval
        }
      }, 8000); // Poll every 8 seconds
    },
    [id, navigate, toast, stopAllTimers, refetchReports],
  );

  useEffect(() => {
    const active = activeRun.data;
    if (!active || running || reportId) return;
    setReportId(active.id);
    setStartedAt(active.created_at);
    if (active.date_range_start) setDateRangeStart(active.date_range_start);
    if (active.date_range_end) setDateRangeEnd(active.date_range_end);
    setError(null);
    setCurrentStep(0);
    setRunning(true);
    pollForCompletion(active.id);
  }, [activeRun.data, running, reportId, pollForCompletion]);

  const runAnalysis = async () => {
    if (submitting.current || running || activeRun.data || !activeRun.isSuccess || activeRun.isFetching) return;
    submitting.current = true;
    setStartedAt(new Date().toISOString());
    setRunning(true);
    setError(null);
    setCurrentStep(0);
    runStartedAt.current = performance.now();
    track("analysis_started", {
      client_id: id,
      range_days:
        dateRangeStart && dateRangeEnd
          ? Math.round(
              (new Date(dateRangeEnd).getTime() - new Date(dateRangeStart).getTime()) / 86400000,
            )
          : null,
      skip_trends: effectiveSkipTrends,
    });

    try {
      // One place builds what n8n receives: the same function serves this
      // page, the scheduler and a retry, so a rerun can never send something
      // different from the original attempt.
      const { data: started, error: runErr } = await supabase.functions.invoke("run-report", {
        body: {
          client_id: id,
          kind: "social",
          date_range_start: dateRangeStart || undefined,
          date_range_end: dateRangeEnd || undefined,
          skip_trends: skipTrends,
        },
      });
      if (runErr || started?.error) throw new Error(await describeInvokeError(runErr, started));
      const reportRowId: string = started.report_id;
      setReportId(reportRowId);
      setStartedAt(started.created_at || new Date().toISOString());

      pollForCompletion(reportRowId);
    } catch (err: any) {
      stopAllTimers();
      setRunning(false);
      setError(err.message);
      track("analysis_failed", {
        client_id: id,
        stage: "submit",
        duration_ms: runStartedAt.current ? performance.now() - runStartedAt.current : null,
        ok: false,
        error_code: String(err?.message || "unknown").slice(0, 120),
      });
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      submitting.current = false;
      activeRun.refetch();
    }
  };

  if (!canRunAnalysis) return <Navigate to="/" replace />;

  if (!client)
    return (
      <AppLayout title="Run analysis" width="max-w-4xl"
      description="Check the configuration, choose the period and start the monthly report.">
        <Loading label="Loading" />
      </AppLayout>
    );

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
                <span className="text-muted-foreground">Platforms:</span> {client.primary_platforms?.join(", ")}
              </div>
              <div>
                <span className="text-muted-foreground">Regions:</span> {client.geo || "US"}
              </div>
              <div>
                <span className="text-muted-foreground">Languages:</span> {client.language || "en"}
              </div>
              <div>
                <span className="text-muted-foreground">Keywords:</span> {client.social_keywords?.length || 0}
              </div>
              <div>
                <span className="text-muted-foreground">Profiles:</span> {profiles?.length || 0}
              </div>
              <div>
                <span className="text-muted-foreground">Competitive context:</span>{" "}
                {latestCompetitive ? `from ${new Date(latestCompetitive.created_at).toLocaleDateString()}` : "none yet"}
              </div>
            </div>
            {profiles && profiles.length === 0 && (
              <p className="t-label text-destructive font-medium">
                No Sprout profiles assigned! Add profiles in Client Setup before running analysis.
              </p>
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
                <Input
                  id="range-start"
                  disabled={running || !!activeRun.data}
                  type="date"
                  value={dateRangeStart}
                  onChange={(e) => setDateRangeStart(e.target.value)}
                  max={dateRangeEnd}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="range-end">End Date</Label>
                <Input
                  id="range-end"
                  disabled={running || !!activeRun.data}
                  type="date"
                  value={dateRangeEnd}
                  onChange={(e) => setDateRangeEnd(e.target.value)}
                  min={dateRangeStart}
                  max={defaultEnd}
                />
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
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="include-trends">Include trend analysis</Label>
                <p className="t-secondary">
                  Scrape TikTok and Instagram for trending content in your niche
                </p>
              </div>
              <Switch
                id="include-trends"
                checked={!skipTrends}
                onCheckedChange={(checked) => setSkipTrends(!checked)}
                disabled={running || !!activeRun.data || !hasKeywords}
              />
            </div>
            {!hasKeywords && (
              <p className="t-label text-amber-600 dark:text-amber-400">
                No social keywords configured for this client. Trend analysis requires keywords to be set in Client
                Setup under "Content Strategy". The report will include performance analysis and content calendar only.
              </p>
            )}
            {hasKeywords && skipTrends && (
              <p className="t-secondary">
                Trend analysis will be skipped. The report will focus on performance metrics and content calendar only.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Run button */}
        <Card>
          <CardContent className="pt-5 text-center space-y-6">
            {!running && !error && currentStep < 0 && (
              <>
                <Button size="lg" onClick={runAnalysis} className="gap-2" disabled={!profiles || profiles.length === 0 || !activeRun.isSuccess || activeRun.isFetching || !!activeRun.data}>
                  <Play className="h-5 w-5" /> Run Full Analysis
                </Button>
                <p className="t-secondary">{RUN_ESTIMATE}</p>
              </>
            )}

            {activeRun.isError && <p className="t-secondary">Could not check for an existing run. Reconnect or refresh before starting an analysis.</p>}
            {running && <ReportRunStatus reportId={reportId} startedAt={startedAt} kind="monthly" onStarted={() => { setStartedAt(new Date().toISOString()); activeRun.refetch(); refetchReports(); }} />}

            {currentStep >= STEPS.length && !error && (
              <div className="flex items-center gap-2 justify-center text-success">
                <CheckCircle2 className="h-6 w-6" />
                <span className="font-medium">Analysis complete! Redirecting...</span>
              </div>
            )}

            {error && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 justify-center text-destructive">
                  <XCircle className="h-6 w-6" />
                  <span className="font-medium">Analysis issue</span>
                </div>
                <p className="t-secondary">{error}</p>
                {reportId ? (
                  canRetry({ status: "failed", created_at: startedAt }) ?
                    <RetryReportButton reportId={reportId} kind="monthly" variant="outline" onStarted={() => { setError(null); setRunning(true); setCurrentStep(0); setStartedAt(new Date().toISOString()); pollForCompletion(reportId); }} /> :
                    <p className="t-secondary">Retry becomes available 90 minutes after this run started. You can return later from report history.</p>
                ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setCurrentStep(-1);
                    setReportId(null);
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" /> Review settings
                </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Past runs */}
        {pastReports && pastReports.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="t-h3">Recent analyses</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pastReports.map((r: any) => (
                  <div
                    key={r.id}
                    className="glass-inner flex items-center justify-between p-3 cursor-pointer"
                    onClick={() => r.status === "completed" && navigate(`/clients/${id}/reports/${r.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={
                          r.status === "completed" ? "default" : r.status === "running" ? "secondary" : "destructive"
                        }
                      >
                        {r.status}
                      </Badge>
                      <span className="t-body">{new Date(r.created_at).toLocaleString()}</span>
                    </div>
                    {Number(r.duration_minutes) > 0 ? <span className="t-secondary">Duration: {r.duration_minutes}m</span> : null}
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
