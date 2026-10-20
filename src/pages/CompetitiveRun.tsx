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

import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/telemetry";
import { AppLayout } from "@/components/layout/AppLayout";
import { displayCompanyName } from "@/lib/companyName";
import { Section } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/empty-state";
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
      <AppLayout title="Competitive analysis" description="Analyze the confirmed competitors across their tracked social profiles over the period you choose.">
        <Loading label="Loading" />
      </AppLayout>
    );
  }

  if (clientFailed || !client) {
    return (
      <AppLayout title="Competitive analysis" description="Analyze the confirmed competitors across their tracked social profiles over the period you choose.">
        <LoadError
          title={clientFailed ? "Could not load this client" : "That client is not available"}
          error={clientFailed ? clientError : "It may have been deleted, or your account may not have access to it."}
          onRetry={clientFailed ? () => refetchClient() : undefined}
        />
      </AppLayout>
    );
  }

  if (setsFailed) {
    return <AppLayout title={`Competitive: ${client.name}`} description="Analyze the confirmed competitors across their tracked social profiles over the period you choose.">
      <LoadError title="Could not load the competitor selection" error={setsError} onRetry={() => refetchSets()} />
    </AppLayout>;
  }

  if (!confirmedSet) {
    return (
      <AppLayout title={`Competitive: ${client.name}`} description="Analyze the confirmed competitors across their tracked social profiles over the period you choose.">
        <EmptyState
          icon={Crosshair}
          title="No confirmed competitors yet"
          description="This client's competitors are chosen automatically from its website. Analyses run here once they are."
          action={<Button variant="outline" onClick={() => navigate(`/clients/${id}/competitive`)}>Open competitors</Button>}
        />
      </AppLayout>
    );
  }

  const listed = listedRuns("competitive", pastRuns, { isStaff: isMoburstStaff });
  const confirmed = selectedCompetitors || [];

  return (
    <AppLayout
      title={`Competitive: ${client.name}`}
      description="Analyze the confirmed competitors across their tracked social profiles over the period you choose."
      actions={
        <Button variant="outline" size="sm" onClick={() => navigate(`/clients/${id}/competitive/reports`)}>
          <History /> All runs
        </Button>
      }
    >
        {/* The run page reads as the flow it is part of: the competitors it
            uses, the period, the run, then the results, each a panel with its
            heading beside its content. It was four stacked cards in a 896px
            column, with the run button centered on its own. */}
        <Section
          layout="split"
          eyebrow="Competitors"
          title="The confirmed top 3"
          description={<>Confirmed {formatDate(confirmedSet.confirmed_at)}.{newerDraft ? " Reports use these while a newer draft is open on the competitors page." : ""}</>}
          meta={trackingState.headline ? (
            <p><span className="font-medium text-white">RivalIQ tracking:</span> {stateLine(trackingState)}</p>
          ) : undefined}
          action={
            <Button variant="outline" size="sm" onClick={() => navigate(`/clients/${id}/competitive?set=${confirmedSet.id}`)}>
              Open this selection
            </Button>
          }
        >
          <ol className="grid gap-inner md:grid-cols-3">
            {confirmed.map((c: any) => (
              <li key={c.id} className="glass-inner is-selected p-inner space-y-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge className="shrink-0">#{c.selected_rank}</Badge>
                  <span className="t-h4 truncate" title={c.name}>{displayCompanyName(c.name)}</span>
                </div>
                <p className="t-label">
                  {(c.competitor_handles || []).filter((h: any) => h.is_active).length} profiles
                </p>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          layout="split"
          eyebrow="Period"
          title="Choose the period and run"
          description={rangeOk ? <>{formatRange(range)} · {rangeDays(range)} days of posts from every company in the landscape.</> : rangeError}
        >
          <div className="flex gap-2 flex-wrap">
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
              <label className="t-label">
                <span className="block mb-1">Start</span>
                <Input type="date" value={custom.start} max={custom.end < presetRange("7d").end ? custom.end : presetRange("7d").end} disabled={active} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))} className="w-44" />
              </label>
              <label className="t-label">
                <span className="block mb-1">End</span>
                <Input type="date" value={custom.end} min={custom.start} max={presetRange("7d").end} disabled={active} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))} className="w-44" />
              </label>
            </div>
          )}
          <div className="border-t border-[rgba(255,255,255,0.06)] pt-4 space-y-4">
            {run.view.state === "idle" && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Button onClick={runAnalysis} disabled={!rangeOk || run.isLoading || run.sending}>
                  <Play /> Run competitive analysis
                </Button>
                <p className="t-secondary">
                  {run.notStarted
                    ? "The analysis has not started yet."
                    : <>Pulls RivalIQ data for {rangeOk ? formatRange(range) : "the selected period"}, breaks content down by platform and finds the gaps. The finished report exports to PDF. {RUN_ESTIMATE}</>}
                </p>
              </div>
            )}

            <ReportRunStatus view={run.view} kind="competitive" />

            {run.view.state === "ready" && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 t-h4 !text-success">
                  <CheckCircle2 className="h-5 w-5" aria-hidden /> Analysis complete
                </span>
                <Button onClick={() => navigate(`/clients/${id}/competitive/reports/${(run.view as { reportId: string }).reportId}`)}>
                  Open the report
                </Button>
                <Button variant="outline" onClick={() => run.reset()}>
                  Run another period
                </Button>
              </div>
            )}
          </div>
        </Section>

        {/* Past runs */}
        {listed.length > 0 && (
          <Section
            layout="split"
            eyebrow="Results"
            title="Recent runs"
            description="Finished reports open from here; every run stays in the history."
          >
            <ul className="space-y-2">
              {listed.map((r) => {
                const opens = r.display.state === "ready" || r.display.state === "held";
                const body = (
                  <>
                    <Badge variant={r.display.variant}>{r.display.label}</Badge>
                    <span className="t-body">{formatDateTime(r.created_at)}</span>
                    {r.date_range_start && (
                      <span className="t-label hidden sm:inline">{formatRange({ start: r.date_range_start, end: r.date_range_end })}</span>
                    )}
                    <span className="ml-auto flex items-center gap-3">
                      {r.display.state === "ready" && r.duration_minutes ? <span className="t-label">{r.duration_minutes} min</span> : null}
                      {opens && <span className="t-label !text-[#b9e045]">View report</span>}
                    </span>
                  </>
                );
                return (
                  <li key={r.id}>
                    {opens ? (
                      <Link to={`/clients/${id}/competitive/reports/${r.id}`} className="glass-inner flex flex-wrap items-center gap-3 p-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(185,224,69,0.45)]">
                        {body}
                      </Link>
                    ) : (
                      <div className="glass-inner flex flex-wrap items-center gap-3 p-inner">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
    </AppLayout>
  );
}
