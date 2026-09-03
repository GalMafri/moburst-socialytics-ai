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
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/telemetry";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/ui/loading";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { useInsightFeedback } from "@/hooks/useInsightFeedback";
import { PRESET_LABELS, presetRange, isValidRange, rangeDays, formatRange, type RangePreset, type DateRange } from "@/lib/dateRange";
import { CheckCircle2, Clock, Crosshair, History, Loader2, Play, RefreshCw, XCircle } from "lucide-react";

const STEPS = [
  "Pulling competitor metrics from Rival IQ...",
  "Analyzing content and engagement patterns...",
  "Building mood boards...",
  "Identifying gaps and opportunities...",
  "Writing the report...",
];

const MAX_POLL_DURATION_MS = 15 * 60 * 1000; // RivalIQ runs are slower than Sprout runs

export default function CompetitiveRun() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canRunAnalysis } = useAuth();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  // Period to analyze: presets end yesterday (the last full day of data);
  // custom ranges are capped at a year so a run stays inside RivalIQ's budget.
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [custom, setCustom] = useState<DateRange>(() => presetRange("30d"));
  const range: DateRange = preset === "custom" ? custom : presetRange(preset);
  const rangeOk = isValidRange(range) && rangeDays(range) <= 366;
  const { suppressedTexts } = useInsightFeedback(id);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runStartedAt = useRef(0);
  const pollStartRef = useRef(0);

  const { data: client } = useQuery({
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
      pollStartRef.current = Date.now();
      pollRef.current = setInterval(async () => {
        try {
          if (Date.now() - pollStartRef.current > MAX_POLL_DURATION_MS) {
            stopAllTimers();
            setRunning(false);
            track("competitive_analysis_timed_out", {
              client_id: id, entity_id: rId, ok: false, error_code: "client_timeout",
              duration_ms: runStartedAt.current ? performance.now() - runStartedAt.current : null,
            });
            setError(
              "The analysis is taking longer than expected. The workflow may still be running — check back in Recent Runs below.",
            );
            refetchRuns();
            return;
          }

          const { data } = await supabase
            .from("competitive_reports")
            .select("status, gamma_url")
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
            setError("Analysis failed on the server. Check the n8n execution logs.");
            refetchRuns();
          }
        } catch {
          // transient; next tick retries
        }
      }, 8000);
    },
    [id, stopAllTimers, refetchRuns, toast],
  );

  const runAnalysis = async () => {
    if (!rangeOk) {
      toast({ title: "Pick a valid period", description: "The end date must be on or after the start date, and the range at most one year.", variant: "destructive" });
      return;
    }
    setRunning(true);
    setError(null);
    setCurrentStep(0);
    runStartedAt.current = performance.now();
    track("competitive_analysis_started", { client_id: id, entity_id: confirmedSet?.id });

    try {
      const { data: setting } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "competitive_n8n_webhook_url")
        .maybeSingle();

      if (!setting?.value) {
        throw new Error(
          "The competitive analysis workflow is not configured yet (app_settings.competitive_n8n_webhook_url). " +
            "It goes live with the Rival IQ integration.",
        );
      }

      const { data: report, error: reportErr } = await supabase
        .from("competitive_reports")
        .insert({ client_id: id!, set_id: confirmedSet!.id, status: "running", date_range_start: range.start, date_range_end: range.end })
        .select()
        .single();
      if (reportErr) throw reportErr;
      setReportId(report.id);

      const payload = {
        report_id: report.id,
        client_id: id,
        client_name: client!.name,
        company_slug: client!.company_slug,
        website_url: client!.website_url,
        set_id: confirmedSet!.id,
        // Sets imported from RivalIQ carry the landscape id; the workflow then
        // resolves it explicitly instead of matching by focus-company name.
        rivaliq_landscape_id: (confirmedSet as any).rivaliq_landscape_id || undefined,
        date_range_start: range.start,
        date_range_end: range.end,
        range_preset: preset,
        // Gap suggestions the team voted down; the analysis never re-proposes them.
        suppressed_insights: suppressedTexts,
        competitors: (selectedCompetitors || []).map((c: any) => ({
          id: c.id,
          rank: c.selected_rank,
          name: c.name,
          website_url: c.website_url,
          rivaliq_company_id: c.rivaliq_company_id,
          handles: (c.competitor_handles || [])
            .filter((h: any) => h.is_active)
            .map((h: any) => ({ platform: h.platform, handle: h.handle, url: h.profile_url })),
        })),
      };

      stepRef.current = setInterval(() => {
        setCurrentStep((prev) => (prev < STEPS.length - 1 ? prev + 1 : prev));
      }, 30000);

      const response = await fetch(setting.value, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const t = await response.text().catch(() => "");
        throw new Error(`Webhook returned ${response.status}${t ? ": " + t.slice(0, 200) : ""}`);
      }

      pollForCompletion(report.id);
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
    }
  };

  if (!canRunAnalysis) return <Navigate to="/" replace />;

  if (!client || setLoading) {
    return (
      <AppLayout title="Competitive Analysis" width="max-w-4xl">
        <Loading label="Loading" />
      </AppLayout>
    );
  }

  if (!confirmedSet) {
    return (
      <AppLayout title={`Competitive: ${client.name}`}>
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
    <AppLayout title={`Competitive: ${client.name}`}>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Confirmed set summary */}
        <Card>
          <CardHeader>
            <CardTitle className="t-h3">Confirmed Top 3</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(selectedCompetitors || []).map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 t-body">
                <Badge>#{c.selected_rank}</Badge>
                <span className="font-medium">{c.name}</span>
                <span className="t-secondary ml-auto">
                  {(c.competitor_handles || []).filter((h: any) => h.is_active).length} handles
                </span>
              </div>
            ))}
            <p className="t-secondary pt-1">
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
                <Button size="lg" onClick={runAnalysis} className="gap-2" disabled={!rangeOk}>
                  <Play className="h-5 w-5" /> Run Competitive Analysis
                </Button>
                <p className="t-secondary">
                  Pulls Rival IQ data for {rangeOk ? formatRange(range) : "the selected period"}, breaks content down by platform and finds the gaps. The finished report exports to PDF.
                </p>
              </>
            )}

            {running && (
              <div className="space-y-4">
                {STEPS.map((step, i) => (
                  <div key={i} className="flex items-center gap-3 t-body">
                    {i < currentStep ? (
                      <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                    ) : i === currentStep ? (
                      <Loader2 className="h-5 w-5 text-accent animate-spin shrink-0" />
                    ) : (
                      <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
                    )}
                    <span className={i <= currentStep ? "text-foreground" : "text-muted-foreground"}>{step}</span>
                  </div>
                ))}
                <p className="t-secondary mt-2">
                  Polling for results... {reportId ? `(Run: ${reportId.slice(0, 8)}...)` : ""}
                </p>
              </div>
            )}

            {currentStep >= STEPS.length && !error && (
              <div className="flex items-center gap-2 justify-center text-success">
                <CheckCircle2 className="h-6 w-6" />
                <span className="font-medium">Analysis complete!</span>
              </div>
            )}

            {error && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 justify-center text-destructive">
                  <XCircle className="h-6 w-6" />
                  <span className="font-medium">Analysis issue</span>
                </div>
                <p className="t-secondary">{error}</p>
                <Button
                  variant="outline"
                  onClick={() => { setError(null); setCurrentStep(-1); setReportId(null); }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" /> Try Again
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Past runs */}
        {pastRuns && pastRuns.length > 0 && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="t-h3">Recent Runs</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate(`/clients/${id}/competitive/reports`)}>
                <History className="h-4 w-4 mr-1" /> All runs
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pastRuns.map((r: any) => (
                  <div
                    key={r.id}
                    className={`flex items-center justify-between p-3 rounded-md bg-[rgba(255,255,255,0.04)] ${r.status !== "running" ? "cursor-pointer hover:bg-[rgba(255,255,255,0.06)]" : ""}`}
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
