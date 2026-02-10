import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Play, Loader2, CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react";

const STEPS = [
  "Fetching Sprout Social performance data...",
  "Scraping TikTok trends...",
  "Scraping Instagram trends...",
  "AI analyzing and synthesizing...",
  "Generating presentation...",
];

export default function RunAnalysis() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);

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
      const { data, error } = await supabase.from("sprout_profiles").select("*").eq("client_id", id!).eq("is_active", true);
      if (error) throw error;
      return data;
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
        .limit(5);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

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

      // Create report row
      const { data: report, error: reportErr } = await supabase
        .from("reports")
        .insert({
          client_id: id!,
          status: "running",
          report_data: {},
          created_by: user!.id,
        })
        .select()
        .single();
      if (reportErr) throw reportErr;

      // Build payload
      const payload = {
        client_name: client!.name,
        sprout_customer_id: client!.sprout_customer_id,
        profile_ids: profiles?.map((p) => p.sprout_profile_id) || [],
        profiles: profiles?.map((p) => ({
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
        geo: client!.geo || "US",
        language: client!.language || "en",
        brand_notes: client!.brand_notes || "",
        brief_text: client!.brief_text || "",
        brief_file_id: client!.brief_file_id || "",
      };

      // Animate steps
      const stepInterval = setInterval(() => {
        setCurrentStep((prev) => (prev < STEPS.length - 1 ? prev + 1 : prev));
      }, 15000);

      // Call n8n webhook
      const response = await fetch(setting.value, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300000),
      });

      clearInterval(stepInterval);

      if (!response.ok) throw new Error(`Webhook returned ${response.status}`);

      const result = await response.json();

      // Update report
      await supabase
        .from("reports")
        .update({
          report_data: result as any,
          status: "completed",
          gamma_url: result.gamma_url || null,
          duration_minutes: result.duration_minutes || null,
          date_range_start: result.report_period?.current_month?.start || null,
          date_range_end: result.report_period?.current_month?.end || null,
        })
        .eq("id", report.id);

      setCurrentStep(STEPS.length);
      toast({ title: "Analysis complete!", description: "Your report is ready." });

      setTimeout(() => navigate(`/clients/${id}/reports/${report.id}`), 1500);
    } catch (err: any) {
      setError(err.message);
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  if (!client) return <AppLayout title="Run Analysis"><div className="animate-pulse text-muted-foreground">Loading...</div></AppLayout>;

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
              <div><span className="text-muted-foreground">Platforms:</span> {client.primary_platforms?.join(", ")}</div>
              <div><span className="text-muted-foreground">Geo:</span> {client.geo}</div>
              <div><span className="text-muted-foreground">Keywords:</span> {client.social_keywords?.length || 0}</div>
              <div><span className="text-muted-foreground">Profiles:</span> {profiles?.length || 0}</div>
            </div>
          </CardContent>
        </Card>

        {/* Run button */}
        <Card>
          <CardContent className="pt-6 text-center space-y-6">
            {!running && !error && currentStep < 0 && (
              <>
                <Button size="lg" onClick={runAnalysis} className="gap-2">
                  <Play className="h-5 w-5" /> Run Full Analysis
                </Button>
                <p className="text-xs text-muted-foreground">This typically takes 2-5 minutes</p>
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
                    <span className={i <= currentStep ? "text-foreground" : "text-muted-foreground/40"}>
                      {step}
                    </span>
                  </div>
                ))}
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
                  <span className="font-medium">Analysis failed</span>
                </div>
                <p className="text-sm text-muted-foreground">{error}</p>
                <Button variant="outline" onClick={() => { setError(null); setCurrentStep(-1); }}>
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
                    className="flex items-center justify-between p-3 rounded-md bg-muted cursor-pointer hover:bg-muted/80"
                    onClick={() => r.status === "completed" && navigate(`/clients/${id}/reports/${r.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant={r.status === "completed" ? "default" : r.status === "running" ? "secondary" : "destructive"}>
                        {r.status}
                      </Badge>
                      <span className="text-sm">{new Date(r.created_at).toLocaleString()}</span>
                    </div>
                    {r.duration_minutes && (
                      <span className="text-xs text-muted-foreground">{r.duration_minutes}m</span>
                    )}
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
