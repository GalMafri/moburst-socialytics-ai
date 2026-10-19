import { competitiveRangeError } from "../../supabase/functions/_shared/reports/competitiveRange";
import { useReportRun } from "@/hooks/useReportRun";
import { ReportRunStatus } from "@/components/reports/ReportRunStatus";
import { RUN_ESTIMATE } from "@/lib/reportRun";
import { formatDate, formatDateTime, listedRuns } from "@/lib/display";
// Step 3: a person's competitive analysis for a period. Asking queues it
// (run-report); the scheduled path makes the report, waits for tracking while
// the lifecycle connects it, and runs it again quietly when it does not
// finish or its figures do not pass the checks. So this page shows it running
// from the request until the report exists (useReportRun), and never a
// failure.

import { useEffect, useRef, useState } from "react";
import { describeTracking, pickRunSelection, stateLine, type SetRow } from "@/lib/competitiveFlow";

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
import { Input } from "@/components/ui/input";
import { PRESET_LABELS, presetRange, rangeDays, formatRange, type RangePreset, type DateRange } from "@/lib/dateRange";
import { CheckCircle2, Crosshair, History, Play } from "lucide-react";

export default function CompetitiveRun() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canRunAnalysis, isMoburstStaff } = useAuth();
  const run = useReportRun(id, "competitive");
  const active = run.view.state !== "idle" && run.view.state !== "ready";
  // Period to analyze: presets end yesterday (the last full day of data);
  // custom ranges are capped at a year so a run stays inside RivalIQ's budget.
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [custom, setCustom] = useState<DateRange>(() => presetRange("30d"));
  const range: DateRange = preset === "custom" ? custom : presetRange(preset);
  const rangeError = competitiveRangeError(range);
  const rangeOk = !rangeError;
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
  const { data: sets, isLoading: setLoading, isError: setsFailed, error: setsError, refetch: refetchSets } = useQuery({
    queryKey: ["confirmed-competitor-set", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitor_sets")
        .select("*")
        .eq("client_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });
  const { runnable: confirmedSet, newerDraft } = pickRunSelection((sets || []) as SetRow[]);
  const trackingState = describeTracking(confirmedSet);

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

  const { data: pastRuns } = useQuery({
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
    refetchInterval: active ? 15_000 : false,
  });

  // A run that is already going shows its own period.
  const runRange = "range" in run.view ? run.view.range : null;
  useEffect(() => {
    if (!runRange) return;
    setPreset("custom");
    setCustom(runRange);
  }, [runRange?.start, runRange?.end]);

  const readyId = run.view.state === "ready" ? run.view.reportId : null;
  useEffect(() => {
    if (!readyId) return;
    track("competitive_analysis_completed", { client_id: id, entity_id: readyId, ok: true, duration_ms: runStartedAt.current ? performance.now() - runStartedAt.current : null });
  }, [readyId, id]);

  const runAnalysis = async () => {
    if (active || run.sending || !rangeOk || !confirmedSet) return;
    runStartedAt.current = performance.now();
    track("competitive_analysis_started", { client_id: id, entity_id: confirmedSet?.id });
    await run.start({ date_range_start: range.start, date_range_end: range.end });
  };

  if (!canRunAnalysis) return <Navigate to="/" replace />;

  if (clientLoading || setLoading) {
    return (
      <AppLayout title="Competitive Analysis" width="max-w-4xl" description="Analyze the confirmed competitors across their tracked social profiles over the period you choose.">
        <Loading label="Loading" />
      </AppLayout>
    );
  }

  if (clientFailed || !client) {
    return (
      <AppLayout title="Competitive Analysis" width="max-w-4xl" description="Analyze the confirmed competitors across their tracked social profiles over the period you choose.">
        <LoadError
          title={clientFailed ? "Could not load this client" : "That client is not available"}
          error={clientFailed ? clientError : "It may have been deleted, or your account may not have access to it."}
          onRetry={clientFailed ? () => refetchClient() : undefined}
        />
      </AppLayout>
    );
  }

  if (setsFailed) {
    return <AppLayout title={`Competitive: ${client.name}`} width="max-w-4xl">
      <LoadError title="Could not load the competitor selection" error={setsError} onRetry={() => refetchSets()} />
    </AppLayout>;
  }

  if (!confirmedSet) {
    return (
      <AppLayout title={`Competitive: ${client.name}`} width="max-w-4xl" description="Analyze the confirmed competitors across their tracked social profiles over the period you choose.">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="pt-5 text-center space-y-4">
              <Crosshair className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="t-secondary">This client's competitors are chosen automatically from its website. Analyses run here once they are.</p>
              <Button variant="outline" onClick={() => navigate(`/clients/${id}/competitive`)}>Open competitors</Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const listed = listedRuns("competitive", pastRuns, { isStaff: isMoburstStaff });

  return (
    <AppLayout title={`Competitive: ${client.name}`} width="max-w-4xl" description="Analyze the confirmed competitors across their tracked social profiles over the period you choose.">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* What this run uses: the confirmed selection, also while a newer draft is open. */}
        {newerDraft && (
          <Card>
            <CardContent className="pt-5 space-y-2">
              <p className="t-body font-medium">Reports use the confirmed competitors below</p>
              <p className="t-secondary">A newer draft is open beside them on the competitors page.</p>
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
                  {(c.competitor_handles || []).filter((h: any) => h.is_active).length} profiles
                </span>
              </div>
            ))}
            {trackingState.headline && (
              <p className="t-secondary pt-1">
                <span className="font-medium">RivalIQ tracking:</span> {stateLine(trackingState)}
              </p>
            )}
            <p className="t-secondary">
              Confirmed {formatDate(confirmedSet.confirmed_at)}
              {" · "}
              <button className="underline underline-offset-2" onClick={() => navigate(`/clients/${id}/competitive?set=${confirmedSet.id}`)}>
                Open this selection
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
                  disabled={active}
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
                  <Input type="date" value={custom.start} max={custom.end < presetRange("7d").end ? custom.end : presetRange("7d").end} disabled={active} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))} className="w-44" />
                </label>
                <label className="t-secondary">
                  <span className="block mb-1">End</span>
                  <Input type="date" value={custom.end} min={custom.start} max={presetRange("7d").end} disabled={active} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))} className="w-44" />
                </label>
              </div>
            )}
            <p className="t-secondary">
              {rangeOk ? <>{formatRange(range)} · {rangeDays(range)} days of posts from every company in the landscape.</> : rangeError}
            </p>
          </CardContent>
        </Card>

        {/* Run */}
        <Card>
          <CardContent className="pt-5 text-center space-y-6">
            {run.view.state === "idle" && (
              <>
                <Button size="lg" onClick={runAnalysis} className="gap-2" disabled={!rangeOk || run.isLoading || run.sending}>
                  <Play className="h-5 w-5" /> Run competitive analysis
                </Button>
                <p className="t-secondary">
                  {run.notStarted
                    ? "The analysis has not started yet."
                    : <>Pulls Rival IQ data for {rangeOk ? formatRange(range) : "the selected period"}, breaks content down by platform and finds the gaps. The finished report exports to PDF. {RUN_ESTIMATE}</>}
                </p>
              </>
            )}

            <ReportRunStatus view={run.view} kind="competitive" />

            {run.view.state === "ready" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 justify-center text-success">
                  <CheckCircle2 className="h-6 w-6" />
                  <span className="font-medium">Analysis complete</span>
                </div>
                <div className="flex gap-2 justify-center">
                  <Button onClick={() => navigate(`/clients/${id}/competitive/reports/${(run.view as { reportId: string }).reportId}`)} className="gap-2">
                    Open the report
                  </Button>
                  <Button variant="outline" onClick={() => run.reset()}>
                    Run another period
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Past runs */}
        {listed.length > 0 && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="t-h3">Recent runs</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate(`/clients/${id}/competitive/reports`)}>
                <History className="h-4 w-4 mr-1" /> All runs
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {listed.map((r) => {
                  const opens = r.display.state === "ready" || r.display.state === "held";
                  return (
                  <div
                    key={r.id}
                    className={`glass-inner flex items-center justify-between p-3 ${opens ? "cursor-pointer" : ""}`}
                    onClick={() => opens && navigate(`/clients/${id}/competitive/reports/${r.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant={r.display.variant}>{r.display.label}</Badge>
                      <span className="t-body">{formatDateTime(r.created_at)}</span>
                      {r.date_range_start && (
                        <span className="t-secondary hidden sm:inline">{formatRange({ start: r.date_range_start, end: r.date_range_end })}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {r.display.state === "ready" && r.duration_minutes ? (
                        <span className="t-secondary">{r.duration_minutes} min</span>
                      ) : null}
                      {opens && (
                        <span className="t-body underline underline-offset-2">View report</span>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
