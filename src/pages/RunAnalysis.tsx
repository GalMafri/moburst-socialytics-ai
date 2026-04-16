import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
import { useRealtimeReports } from "@/hooks/useRealtimeReport";
import { Navigate } from "react-router-dom";

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

// Max time to wait for report completion (10 minutes)
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

export default function RunAnalysis() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, canRunAnalysis } = useAuth();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  // Date range defaults: current month start -> today
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const defaultEnd = now.toISOString().split("T")[0];
  const [dateRangeStart, setDateRangeStart] = useState(defaultStart);
  const [dateRangeEnd, setDateRangeEnd] = useState(defaultEnd);
  const [skipTrends, setSkipTrends] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartRef = useRef<number>(0);

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
      toast({ title: "Analysis complete!", description: "Your report is ready." });
      setTimeout(() => navigate(`/clients/${id}/reports/${reportId}`), 1500);
    } else if (activeReport?.status === "failed") {
      stopAllTimers();
      setRunning(false);
      setError("Analysis failed on the server. Check workflow logs.");
    }
  }, [pastReports, reportId, running, id, navigate, toast, stopAllTimers]);

  const pollForCompletion = useCallback(
    (rId: string) => {
      pollStartRef.current = Date.now();

      pollRef.current = setInterval(async () => {
        try {
          // Check if we've exceeded max poll duration
          if (Date.now() - pollStartRef.current > MAX_POLL_DURATION_MS) {
            stopAllTimers();
            setRunning(false);
            setError(
              "Analysis is taking longer than expected. The workflow may still be running — check n8n execution logs. You can also check the report in Recent Analyses below once it completes.",
            );
            refetchReports();
            return;
          }

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
            toast({ title: "Analysis complete!", description: "Your report is ready." });
            refetchReports();
            setTimeout(() => navigate(`/clients/${id}/reports/${rId}`), 1500);
          } else if (data?.status === "failed") {
            stopAllTimers();
            setRunning(false);
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

  const runAnalysis = async () => {
    setRunning(true);
    setError(null);
    setCurrentStep(0);

    try {
      // Get webhook URL from app settings
      const { data: setting } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "n8n_webhook_url")
        .maybeSingle();

      if (!setting?.value) {
        throw new Error("n8n webhook URL not configured. Go to Settings to set it up.");
      }

      // Create report row with date ranges
      const { data: report, error: reportErr } = await supabase
        .from("reports")
        .insert({
          client_id: id!,
          status: "running",
          report_data: {},
          created_by: null,
          date_range_start: dateRangeStart || null,
          date_range_end: dateRangeEnd || null,
        })
        .select()
        .single();
      if (reportErr) throw reportErr;

      setReportId(report.id);

      // Parse brand voice preset from brand_notes ([VOICE:preset] prefix)
      let brandNotes = client!.brand_notes || "";
      let brandVoice = "";
      const voiceMatch = brandNotes.match(/^\[VOICE:(.+?)]\n?/);
      if (voiceMatch) {
        brandVoice = voiceMatch[1];
        brandNotes = brandNotes.slice(voiceMatch[0].length);
      }

      // Parse comma-separated geo/language to arrays
      const geoArr = client!.geo
        ? client!.geo
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
        : ["US"];
      const langArr = client!.language
        ? client!.language
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
        : ["en"];

      // Build payload — include report_id so n8n can write back to Supabase
      const payload = {
        report_id: report.id,
        client_name: client!.name,
        sprout_customer_id: client!.sprout_customer_id || "1676448",
        profile_ids: profiles?.map((p) => p.sprout_profile_id) || [],
        profiles:
          profiles?.map((p) => ({
            id: p.sprout_profile_id,
            name: p.profile_name,
            native_name: p.native_name,
            network: p.network_type,
            url: p.native_link,
          })) || [],
        social_keywords: client!.social_keywords || [],
        trends_keywords: client!.trends_keywords || "",
        content_pillars: client!.content_pillars || [],
        primary_platforms: (client!.primary_platforms || []).join(","),
        geo: geoArr,
        languages: langArr,
        brand_voice: brandVoice,
        brand_notes: brandNotes,
        brand_book_text: client!.brand_book_text || "",
        brief_text: client!.brief_text || "",
        brief_file_id: client!.brief_file_id || "",
        date_range_start: dateRangeStart || "",
        date_range_end: dateRangeEnd || "",
        skip_trends: skipTrends,
        timezone: (client as any)?.timezone || "UTC",
      };

      console.log("Sending webhook payload:", JSON.stringify(payload, null, 2));
      console.log("Report ID:", report.id);
      console.log("Profile IDs:", payload.profile_ids);

      // Animate steps
      stepRef.current = setInterval(() => {
        setCurrentStep((prev) => (prev < STEPS.length - 1 ? prev + 1 : prev));
      }, 15000);

      // Fire webhook — don't wait for the full workflow to finish
      // n8n will respond immediately, then process and write results to Supabase
      const response = await fetch(setting.value, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Webhook returned ${response.status}${errorText ? ": " + errorText.slice(0, 200) : ""}`);
      }

      // Start polling Supabase for completion
      pollForCompletion(report.id);
    } catch (err: any) {
      stopAllTimers();
      setRunning(false);
      setError(err.message);
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    }
  };

  if (!canRunAnalysis) return <Navigate to="/" replace />;

  if (!client)
    return (
      <AppLayout title="Run Analysis">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </AppLayout>
    );

  return (
    <AppLayout title={`Analyze: ${client.name}`}>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Client summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuration Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
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
            </div>
            {profiles && profiles.length === 0 && (
              <p className="text-xs text-destructive font-medium">
                No Sprout profiles assigned! Add profiles in Client Setup before running analysis.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Date range selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> Report Date Range
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={dateRangeStart}
                  onChange={(e) => setDateRangeStart(e.target.value)}
                  max={dateRangeEnd}
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={dateRangeEnd}
                  onChange={(e) => setDateRangeEnd(e.target.value)}
                  min={dateRangeStart}
                  max={defaultEnd}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Defaults to current month. The comparison period is automatically calculated as the same number of days
              immediately before the start date.
            </p>
          </CardContent>
        </Card>

        {/* Trend Analysis Options */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Trend Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Include Trend Analysis</Label>
                <p className="text-xs text-muted-foreground">
                  Scrape TikTok and Instagram for trending content in your niche
                </p>
              </div>
              <Switch
                checked={!skipTrends}
                onCheckedChange={(checked) => setSkipTrends(!checked)}
                disabled={!hasKeywords}
              />
            </div>
            {!hasKeywords && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                No social keywords configured for this client. Trend analysis requires keywords to be set in Client
                Setup under "Content Strategy". The report will include performance analysis and content calendar only.
              </p>
            )}
            {hasKeywords && skipTrends && (
              <p className="text-xs text-muted-foreground">
                Trend analysis will be skipped. The report will focus on performance metrics and content calendar only.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Run button */}
        <Card>
          <CardContent className="pt-6 text-center space-y-6">
            {!running && !error && currentStep < 0 && (
              <>
                <Button size="lg" onClick={runAnalysis} className="gap-2" disabled={!profiles || profiles.length === 0}>
                  <Play className="h-5 w-5" /> Run Full Analysis
                </Button>
                <p className="text-xs text-muted-foreground">This typically takes 3-7 minutes</p>
              </>
            )}

            {running && (
              <div className="space-y-4">
                {STEPS.map((step, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    {i < currentStep ? (
                      <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                    ) : i === currentStep ? (
                      <Loader2 className="h-5 w-5 text-accent animate-spin shrink-0" />
                    ) : (
                      <Clock className="h-5 w-5 text-muted-foreground/40 shrink-0" />
                    )}
                    <span className={i <= currentStep ? "text-foreground" : "text-muted-foreground/40"}>{step}</span>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground mt-2">
                  Polling for results... {reportId ? `(Report: ${reportId.slice(0, 8)}...)` : ""}
                </p>
              </div>
            )}

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
                <p className="text-sm text-muted-foreground">{error}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setCurrentStep(-1);
                    setReportId(null);
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" /> Try Again
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Past runs */}
        {pastReports && pastReports.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Analyses</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pastReports.map((r: any) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between p-3 rounded-md bg-[rgba(255,255,255,0.04)] cursor-pointer hover:bg-[rgba(255,255,255,0.06)]"
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
                      <span className="text-sm">{new Date(r.created_at).toLocaleString()}</span>
                    </div>
                    {r.duration_minutes && <span className="text-xs text-muted-foreground">{r.duration_minutes}m</span>}
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
