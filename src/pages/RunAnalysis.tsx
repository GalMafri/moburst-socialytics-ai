import { useReportRun } from "@/hooks/useReportRun";
import { ReportRunStatus } from "@/components/reports/ReportRunStatus";
import { RUN_ESTIMATE } from "@/lib/reportRun";
import { Link, useParams, useNavigate } from "react-router-dom";
import { countryNames, formatDate, formatDateTime, languageNames, listedRuns, platformName } from "@/lib/display";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/telemetry";
import { AppLayout } from "@/components/layout/AppLayout";
import { Section } from "@/components/ui/section";
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
      <AppLayout title="Run analysis" description="The configuration the monthly report uses and the period it covers.">
        <Loading label="Loading the client" />
      </AppLayout>
    );

  const listed = listedRuns("monthly", pastReports, { isStaff: true });
  const summary: [string, React.ReactNode][] = [
    ["Platforms", (client.primary_platforms || []).map((p: string) => platformName(p)).join(", ") || "None yet"],
    ["Regions", countryNames(client.geo) || "None yet"],
    ["Languages", languageNames(client.language) || "None yet"],
    ["Keywords", client.social_keywords?.length || 0],
    ["Profiles", profiles?.length || 0],
    ["Competitive context", latestCompetitive ? `From ${formatDate(latestCompetitive.created_at)}` : "None yet"],
  ];

  return (
    <AppLayout title={`Analyze: ${client.name}`} description="The configuration the monthly report uses and the period it covers.">
        {/* The same flow panels as the competitive run: what the report
            uses, the period and options, the run, then past runs. It was five
            stacked cards in an 896px column with a centered run button. */}
        <Section layout="split" eyebrow="Client" title="Configuration">
          <dl className="grid gap-inner grid-cols-2 lg:grid-cols-3">
            {summary.map(([label, value]) => (
              <div key={label} className="glass-inner p-inner space-y-0.5 min-w-0">
                <dt className="t-label">{label}</dt>
                <dd className="t-body text-white break-words">{value}</dd>
              </div>
            ))}
          </dl>
          {profiles && profiles.length === 0 && (
            <p className="t-secondary">No social accounts are matched to this client yet. They are matched on their own once the accounts are in Sprout.</p>
          )}
        </Section>

        <Section
          layout="split"
          eyebrow="Period"
          title={<><CalendarDays className="h-4 w-4 text-[#b9e045]" aria-hidden /> Report date range</>}
          description="Defaults to the current month. The comparison period is the same number of days immediately before the start date."
        >
          <div className="grid gap-inner sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="range-start">Start date</Label>
              <Input id="range-start" disabled={active} type="date" value={dateRangeStart} onChange={(e) => setDateRangeStart(e.target.value)} max={dateRangeEnd} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="range-end">End date</Label>
              <Input id="range-end" disabled={active} type="date" value={dateRangeEnd} onChange={(e) => setDateRangeEnd(e.target.value)} min={dateRangeStart} max={defaultEnd} />
            </div>
          </div>
        </Section>

        <Section
          layout="split"
          eyebrow="Options"
          title={<><TrendingUp className="h-4 w-4 text-[#b9e045]" aria-hidden /> Trend analysis</>}
          description="Trending TikTok and Instagram content in the client's niche, read from its keywords."
        >
          {active ? <p className="t-secondary">This analysis uses the trend settings selected when it started.</p> : <>
          <div className="glass-inner p-inner flex items-center gap-4">
            <Switch id="include-trends" checked={!skipTrends} onCheckedChange={(checked) => setSkipTrends(!checked)} disabled={!hasKeywords} />
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="include-trends">Include trend analysis</Label>
              <p className="t-label">Adds a trends section to the report.</p>
            </div>
          </div>
          {!hasKeywords && <p className="t-secondary">This client has no social keywords yet, so the report covers performance without trends.</p>}
          {hasKeywords && skipTrends && <p className="t-secondary">Trends are left out of this report. It covers performance.</p>}
          </>}
          <div className="border-t border-[rgba(255,255,255,0.06)] pt-4 space-y-4">
            {run.view.state === "idle" && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Button onClick={runAnalysis} disabled={!profiles || profiles.length === 0 || run.isLoading || run.sending}>
                  <Play /> Run full analysis
                </Button>
                <p className="t-secondary">{run.notStarted ? "The analysis has not started yet." : RUN_ESTIMATE}</p>
              </div>
            )}

            <ReportRunStatus view={run.view} kind="monthly" />

            {run.view.state === "ready" && (
              <p className="inline-flex items-center gap-2 t-h4 !text-success">
                <CheckCircle2 className="h-5 w-5" aria-hidden /> Analysis complete. Opening the report.
              </p>
            )}
          </div>
        </Section>

        {/* Past runs */}
        {listed.length > 0 && (
          <Section layout="split" eyebrow="Results" title="Recent analyses" description="Finished reports open from here.">
            <ul className="space-y-2">
              {listed.map((r) => {
                const body = (
                  <>
                    <Badge variant={r.display.variant}>{r.display.label}</Badge>
                    <span className="t-body">{formatDateTime(r.created_at)}</span>
                    <span className="ml-auto flex items-center gap-3">
                      {r.display.state === "ready" && Number(r.duration_minutes) > 0 ? <span className="t-label">{r.duration_minutes} min</span> : null}
                      {r.display.state === "ready" && <span className="t-label !text-[#b9e045]">View report</span>}
                    </span>
                  </>
                );
                return (
                  <li key={r.id}>
                    {r.display.state === "ready" ? (
                      <Link to={`/clients/${id}/reports/${r.id}`} className="glass-inner flex flex-wrap items-center gap-3 p-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(185,224,69,0.45)]">{body}</Link>
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
