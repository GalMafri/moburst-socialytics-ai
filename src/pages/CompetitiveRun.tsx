import { useActiveReportRun } from "@/hooks/useActiveReportRun";
import { ReportRunStatus } from "@/components/reports/ReportRunStatus";
import { RetryReportButton } from "@/components/reports/RetryReportButton";
import { RUN_ESTIMATE, canRetry } from "@/lib/reportRun";
// Step 2: the competitive-analysis "go" button, with the same visible-status
// contract as the social report (RunAnalysis.tsx): insert a row in status
// 'running', fire the n8n webhook, watch the row via realtime + poll, land on
// history when it completes.
//
// The webhook URL lives in app_settings under 'competitive_n8n_webhook_url'
// (NOT the social report's n8n_webhook_url — different workflow). Until the
// Milestone-3 workflow is wired up, the run button surfaces a clear
// "not configured" message instead of failing silently.

import { useCallback, useEffect, useRef, useState } from "react";
import { describeInvokeError } from "@/lib/invokeError";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/telemetry";
import { AppLayout } from "@/components/layout/AppLayout";
import { displayCompanyName } from "@/lib/companyName";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/ui/loading";
import { LoadError } from "@/components/ui/load-error";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { PRESET_LABELS, presetRange, isValidRange, rangeDays, formatRange, type RangePreset, type DateRange } from "@/lib/dateRange";
import { CheckCircle2, Clock, Crosshair, History, Loader2, Play, RefreshCw, XCircle } from "lucide-react";

const STEPS = [
  "Pulling competitor metrics from Rival IQ...",
  "Analyzing content and engagement patterns...",
  "Building mood boards...",
  "Identifying gaps and opportunities...",
  "Writing the report...",
];


export default function CompetitiveRun() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canRunAnalysis } = useAuth();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const activeRun = useActiveReportRun(id, "competitive");
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const submitting = useRef(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  // Period to analyze: presets end yesterday (the last full day of data);
  // custom ranges are capped at a year so a run stays inside RivalIQ's budget.
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [custom, setCustom] = useState<DateRange>(() => presetRange("30d"));
  const range: DateRange = preset === "custom" ? custom : presetRange(preset);
  const rangeOk = isValidRange(range) && rangeDays(range) <= 366;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runStartedAt = useRef(0);

  const { data: client, isLoading: clientLoading, isError: clientFailed, error: clientError, refetch: refetchClient } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Deep analysis runs against the newest confirmed set. A set keeps its
  // confirmation through later runs (its status moves to analyzing, complete
  // or failed), so every post-confirmation status counts; only drafts do not.
  const { data: confirmedSet, isLoading: setLoading } = useQuery({
    queryKey: ["confirmed-competitor-set", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitor_sets")
        .select("*")
        .eq("client_id", id!)
        .in("status", ["confirmed", "analyzing", "complete", "failed"])
        .order("confirmed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: selectedCompetitors } = useQuery({
    queryKey: ["confirmed-competitors", confirmedSet?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitors")
        .select("*, competitor_handles(*)")
        .eq("set_id", confirmedSet!.id)
        .eq("is_selected", true)
        .order("selected_rank", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!confirmedSet?.id,
  });

  const { data: pastRuns, refetch: refetchRuns } = useQuery({
    queryKey: ["competitive-reports", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitive_reports")
        .select("*")
        .eq("client_id", id!)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (stepRef.current) clearInterval(stepRef.current);
    };
  }, []);

  const stopAllTimers = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (stepRef.current) { clearInterval(stepRef.current); stepRef.current = null; }
  }, []);

  const pollForCompletion = useCallback(
    (rId: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await supabase
            .from("competitive_reports")
            .select("status, gamma_url, report_data")
            .eq("id", rId)
            .maybeSingle();

          if (data?.status === "complete") {
            stopAllTimers();
            setCurrentStep(STEPS.length);
            setRunning(false);
            track("competitive_analysis_completed", {
              client_id: id, entity_id: rId, ok: true,
              duration_ms: runStartedAt.current ? performance.now() - runStartedAt.current : null,
            });
            toast({ title: "Competitive analysis complete!" });
            refetchRuns();
          } else if (data?.status === "failed") {
            stopAllTimers();
            setRunning(false);
            track("competitive_analysis_failed", {
              client_id: id, entity_id: rId, stage: "server", ok: false, error_code: "server_failed",
              duration_ms: runStartedAt.current ? performance.now() - runStartedAt.current : null,
            });
            // The workflow records why it stopped; showing it beats sending
            // someone to the execution log for a reason we already hold.
            const why = String((data as any)?.report_data?.error || "").trim();
            setError(why ? `Analysis failed: ${why}` : "Analysis failed on the server, with no reason recorded.");
            refetchRuns();
          }
        } catch {
          // transient; next tick retries
        }
      }, 8000);
    },
    [id, stopAllTimers, refetchRuns, toast],
  );

  useEffect(() => {
    const active = activeRun.data;
    if (!active || running || reportId) return;
    setReportId(active.id);
    setStartedAt(active.created_at);
    if (active.date_range_start && active.date_range_end) { setPreset("custom"); setCustom({start: active.date_range_start, end: active.date_range_end}); }
    setError(null);
    setCurrentStep(0);
    setRunning(true);
    pollForCompletion(active.id);
  }, [activeRun.data, running, reportId, pollForCompletion]);

  const runAnalysis = async () => {
    if (submitting.current || running || activeRun.data || !activeRun.isSuccess || activeRun.isFetching) return;
    if (!rangeOk) {
      toast({ title: "Pick a valid period", description: "The end date must be on or after the start date, and the range at most one year.", variant: "destructive" });
      return;
    }
    submitting.current = true;
    setStartedAt(new Date().toISOString());
    setRunning(true);
    setError(null);
    setCurrentStep(0);
    runStartedAt.current = performance.now();
    track("competitive_analysis_started", { client_id: id, entity_id: confirmedSet?.id });

    try {
      // One place builds what n8n receives: the same function serves this
      // page, the scheduler and a retry, so a rerun can never send something
      // different from the original attempt.
      const { data: started, error: runErr } = await supabase.functions.invoke("run-report", {
        body: {
          client_id: id,
          kind: "competitive",
          date_range_start: range.start,
          date_range_end: range.end,
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
      track("competitive_analysis_failed", {
        client_id: id, stage: "submit", ok: false,
        error_code: String(err?.message || "unknown").slice(0, 120),
        duration_ms: runStartedAt.current ? performance.now() - runStartedAt.current : null,
      });
      toast({ title: "Could not start analysis", description: err.message, variant: "destructive" });
    } finally {
      submitting.current = false;
      activeRun.refetch();
    }
  };

  if (!canRunAnalysis) return <Navigate to="/" replace />;

  if (clientLoading || setLoading) {
    return (
      <AppLayout title="Competitive Analysis" width="max-w-4xl" description="Run the RivalIQ deep analysis for the confirmed competitor set over the period you choose.">
        <Loading label="Loading" />
      </AppLayout>
    );
  }

  if (clientFailed || !client) {
    return (
      <AppLayout title="Competitive Analysis" width="max-w-4xl" description="Run the RivalIQ deep analysis for the confirmed competitor set over the period you choose.">
        <LoadError
          title={clientFailed ? "Could not load this client" : "That client is not available"}
          error={clientFailed ? clientError : "It may have been deleted, or your account may not have access to it."}
          onRetry={clientFailed ? () => refetchClient() : undefined}
        />
      </AppLayout>
    );
  }

  if (!confirmedSet) {
    return (
      <AppLayout title={`Competitive: ${client.name}`} width="max-w-4xl" description="Run the RivalIQ deep analysis for the confirmed competitor set over the period you choose.">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="pt-5 text-center space-y-4">
              <Crosshair className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="t-secondary">
                No confirmed competitor set for this client yet. Review and confirm a top 3 first.
              </p>
              <Button onClick={() => navigate(`/clients/${id}/competitive`)}>Go to competitor review</Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={`Competitive: ${client.name}`} width="max-w-4xl" description="Run the RivalIQ deep analysis for the confirmed competitor set over the period you choose.">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* What this run will actually use. When someone re-identified
            competitors, the newest selection on the review page is a draft and
            is NOT what runs — saying so beats silently analysing older names. */}
        {newerDraft && (
          <Card>
            <CardContent className="pt-5 space-y-2">
              <p className="t-body font-medium">This report would use the older confirmed competitors</p>
              <p className="t-secondary">
                A newer set of three is waiting for review and will not be used until it is confirmed.
              </p>
              <Button size="sm" variant="outline" onClick={() => navigate(`/clients/${id}/competitive`)}>
                Review the newer selection
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Confirmed set summary */}
        <Card>
          <CardHeader>
            <CardTitle className="t-h3">Confirmed top 3</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(selectedCompetitors || []).map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 t-body">
                <Badge>#{c.selected_rank}</Badge>
                <span className="font-medium" title={c.name}>{displayCompanyName(c.name)}</span>
                <span className="t-secondary ml-auto">
                  {(c.competitor_handles || []).filter((h: any) => h.is_active).length} handles
                </span>
              </div>
            ))}
            <p className="t-secondary pt-1">
              <span className="font-medium">RivalIQ tracking:</span> {trackingState.headline}
              {trackingState.detail ? ` ${trackingState.detail}` : ""}
            </p>
            <p className="t-secondary">
              Confirmed {confirmedSet.confirmed_at ? new Date(confirmedSet.confirmed_at).toLocaleDateString() : ""}
              {" · "}
              <button className="underline underline-offset-2" onClick={() => navigate(`/clients/${id}/competitive`)}>
                edit set
              </button>
            </p>
          </CardContent>
        </Card>


        {/* Period */}
        <Card>
          <CardHeader>
            <CardTitle className="t-h3">Period to analyze</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-1.5 flex-wrap">
              {(["7d", "30d", "90d", "previous_month", "custom"] as RangePreset[]).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={preset === p ? "default" : "outline"}
                  aria-pressed={preset === p}
                  disabled={running}
                  onClick={() => { if (p === "custom") setCustom(range); setPreset(p); }}
                >
                  {PRESET_LABELS[p]}
                </Button>
              ))}
            </div>
            {preset === "custom" && (
              <div className="flex items-end gap-3 flex-wrap">
                <label className="t-secondary">
                  <span className="block mb-1">Start</span>
                  <Input type="date" value={custom.start} max={custom.end} disabled={running} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))} className="w-44" />
                </label>
                <label className="t-secondary">
                  <span className="block mb-1">End</span>
                  <Input type="date" value={custom.end} min={custom.start} disabled={running} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))} className="w-44" />
                </label>
              </div>
            )}
            <p className="t-secondary">
              {rangeOk ? (
                <>{formatRange(range)} · {rangeDays(range)} days of posts from every company in the landscape.</>
              ) : (
                <span className="text-destructive">The end date must be on or after the start date, and the range at most one year.</span>
              )}
            </p>
          </CardContent>
        </Card>

        {/* Run */}
        <Card>
          <CardContent className="pt-5 text-center space-y-6">
            {!running && !error && currentStep < 0 && (
              <>
                <Button size="lg" onClick={runAnalysis} className="gap-2" disabled={!rangeOk || !activeRun.isSuccess || activeRun.isFetching || !!activeRun.data}>
                  <Play className="h-5 w-5" /> Run competitive analysis
                </Button>
                <p className="t-secondary">
                  Pulls Rival IQ data for {rangeOk ? formatRange(range) : "the selected period"}, breaks content down by platform and finds the gaps. The finished report exports to PDF. {RUN_ESTIMATE}
                </p>
              </>
            )}

            {activeRun.isError && <p className="t-secondary">Could not check for an existing run. Reconnect or refresh before starting an analysis.</p>}
            {running && <ReportRunStatus reportId={reportId} startedAt={startedAt} kind="competitive" onStarted={() => { setStartedAt(new Date().toISOString()); activeRun.refetch(); refetchRuns(); }} />}

            {currentStep >= STEPS.length && !error && (
              // The page used to end here. The run button renders only while
              // currentStep < 0, so after a run finished this card held a tick
              // and nothing else: no way to open what had just been produced,
              // and no way to run another period without reloading the page.
              <div className="space-y-4">
                <div className="flex items-center gap-2 justify-center text-success">
                  <CheckCircle2 className="h-6 w-6" />
                  <span className="font-medium">Analysis complete</span>
                </div>
                <div className="flex gap-2 justify-center">
                  {reportId && (
                    <Button onClick={() => navigate(`/clients/${id}/competitive/reports/${reportId}`)} className="gap-2">
                      Open the report
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => { setCurrentStep(-1); setReportId(null); setError(null); }}>
                    Run another period
                  </Button>
                </div>
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
                    <RetryReportButton reportId={reportId} kind="competitive" variant="outline" onStarted={() => { setError(null); setRunning(true); setCurrentStep(0); setStartedAt(new Date().toISOString()); pollForCompletion(reportId); }} /> :
                    <p className="t-secondary">Retry becomes available 90 minutes after this run started. You can return later from report history.</p>
                ) : (
                <Button
                  variant="outline"
                  onClick={() => { setError(null); setCurrentStep(-1); setReportId(null); }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" /> Review settings
                </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Past runs */}
        {pastRuns && pastRuns.length > 0 && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="t-h3">Recent runs</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate(`/clients/${id}/competitive/reports`)}>
                <History className="h-4 w-4 mr-1" /> All runs
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pastRuns.map((r: any) => (
                  <div
                    key={r.id}
                    className={`glass-inner flex items-center justify-between p-3 ${r.status !== "running" ? "cursor-pointer" : ""}`}
                    onClick={() => r.status !== "running" && navigate(`/clients/${id}/competitive/reports/${r.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={r.status === "complete" ? "default" : r.status === "running" ? "secondary" : "destructive"}
                      >
                        {r.status}
                      </Badge>
                      <span className="t-body">{new Date(r.created_at).toLocaleString()}</span>
                      {r.date_range_start && (
                        <span className="t-secondary hidden sm:inline">{formatRange({ start: r.date_range_start, end: r.date_range_end })}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {r.duration_minutes ? (
                        <span className="t-secondary">{r.duration_minutes}m</span>
                      ) : null}
                      {r.status !== "running" && (
                        <span className="t-body underline underline-offset-2">View report</span>
                      )}
                    </div>
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
