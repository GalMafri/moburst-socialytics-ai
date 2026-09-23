// Staff landing page for competitive analysis: every client with what is
// saved, what is tracked and what the last report did — three separate facts,
// each in plain words, and one click into the step that comes next.
// Mirrors AnalyticsIndex; RLS scopes company-restricted staff automatically.

import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { LoadError } from "@/components/ui/load-error";
import { EmptyState } from "@/components/ui/empty-state";
import { describeReport, describeSelection, describeTracking, pickRunSelection, type SetRow } from "@/lib/competitiveFlow";
import { Crosshair, FileText, History, Play, Rss } from "lucide-react";

export default function CompetitiveIndex() {
  const navigate = useNavigate();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["competitive-index"],
    queryFn: async () => {
      const [clientsRes, setsRes, reportsRes] = await Promise.all([
        supabase.from("clients").select("id, name, logo_url").is("archived_at", null).order("name"),
        supabase.from("competitor_sets").select("id, client_id, status, created_at, confirmed_at, rivaliq_landscape_id").order("created_at", { ascending: false }),
        supabase.from("competitive_reports").select("id, client_id, status, created_at").order("created_at", { ascending: false }),
      ]);
      if (clientsRes.error) throw clientsRes.error;
      if (setsRes.error) throw setsRes.error;
      if (reportsRes.error) throw reportsRes.error;
      const setsByClient = new Map<string, SetRow[]>();
      for (const s of setsRes.data || []) {
        if (!setsByClient.has(s.client_id)) setsByClient.set(s.client_id, []);
        setsByClient.get(s.client_id)!.push(s as SetRow);
      }
      const latestReport = new Map<string, any>();
      for (const r of reportsRes.data || []) if (!latestReport.has(r.client_id)) latestReport.set(r.client_id, r);
      return (clientsRes.data || []).map((c) => {
        const sets = setsByClient.get(c.id) || [];
        const { runnable, newerDraft } = pickRunSelection(sets);
        const report = latestReport.get(c.id) || null;
        return {
          ...c,
          runnable,
          newerDraft,
          report,
          selection: describeSelection(sets),
          tracking: describeTracking(runnable),
          outcome: describeReport(report),
        };
      });
    },
  });

  return (
    <AppLayout title="Competitive Analysis" description="Review each client's three competitors, connect RivalIQ tracking, run the analysis, then open the result.">
      <div className="w-full space-y-4">
        {isLoading ? (
          <Loading label="Loading clients" />
        ) : isError ? (
          // A failed read used to render as "No clients yet", which reads as a
          // fact about the account rather than a connection problem.
          <LoadError title="Could not load the competitive overview" error={error} onRetry={() => refetch()} />
        ) : !data?.length ? (
          <EmptyState icon={Crosshair} title="No clients yet" description="Add a client to start competitive analysis." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.map((c) => (
              <Card key={c.id}>
                <CardContent className="pt-5 space-y-3">
                  <div className="font-medium">{c.name}</div>
                  <dl className="space-y-1.5">
                    <div>
                      <dt className="t-label">Saved selection</dt>
                      <dd className="t-body">{c.selection.headline}</dd>
                      {c.selection.detail && <dd className="t-secondary">{c.selection.detail}</dd>}
                    </div>
                    <div>
                      <dt className="t-label">RivalIQ tracking</dt>
                      <dd className="t-body">{c.tracking.headline}</dd>
                    </div>
                    <div>
                      <dt className="t-label">Last report</dt>
                      <dd className="t-body">{c.outcome.headline}</dd>
                    </div>
                  </dl>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => navigate(`/clients/${c.id}/competitive`)}><Crosshair className="h-3.5 w-3.5 mr-1" /> Review competitors</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/clients/${c.id}/competitive/run`)}
                      disabled={!c.runnable || (!c.tracking.ready && c.report?.status !== 'running')}
                      title={!c.runnable ? "Confirm three competitors before running a report" : !c.tracking.ready ? "Connect tracking from Review competitors first" : undefined}
                    >
                      <Play className="h-3.5 w-3.5 mr-1" /> Choose period and run
                    </Button>
                    {c.report?.status === "complete" && (
                      <Button size="sm" onClick={() => navigate(`/clients/${c.id}/competitive/reports/${c.report.id}`)}><FileText className="h-3.5 w-3.5 mr-1" /> Latest report</Button>
                    )}
                    {c.report && (
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${c.id}/competitive/reports`)}><History className="h-3.5 w-3.5 mr-1" /> All runs</Button>
                    )}
                    {c.runnable && (
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${c.id}/competitive/feed`)}><Rss className="h-3.5 w-3.5 mr-1" /> Feed</Button>
                    )}
                  </div>
                  {c.report && <p className="t-secondary">Last run {new Date(c.report.created_at).toLocaleString()}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
