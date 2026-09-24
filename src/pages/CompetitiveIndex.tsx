// Staff landing page for competitive analysis: every client with what is
// saved, what is tracked and what the last report did — three separate facts,
// each in plain words, and one click into the step that comes next.
// Mirrors AnalyticsIndex; RLS scopes company-restricted staff automatically.

import { useState } from "react";
import { ClientPicker } from "@/components/clients/ClientPicker";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");


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

  const visibleClients = (data || []).filter(c => c.name.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedClient = visibleClients.find(c => c.id === params.get("client")) || visibleClients[0];
  const chooseClient = (id: string) => setParams(prev => { prev.set("client", id); return prev; }, { replace: true });

  return (
    <AppLayout title="Competitive Analysis" description="Choose a client to edit its competitors, run a report, or open previous results.">
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
          <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
            <ClientPicker clients={visibleClients} selectedId={selectedClient?.id} onSelect={chooseClient} search={search} onSearch={setSearch} />
            <div className="min-w-0">
            {!selectedClient && <p className="t-secondary py-6">Try another client name.</p>}
            {(selectedClient ? [selectedClient] : []).map((c) => (
              <Card key={c.id} className="border-white/15">
                <CardContent className="pt-5 space-y-3">
                  <div className="border-b border-white/10 pb-4"><p className="t-label uppercase tracking-wider">Selected client</p><h2 className="t-h2 mt-1">{c.name}</h2><p className="t-secondary mt-1">Competitors and reports for this client only.</p></div>
                  <dl className="grid gap-4 py-2 md:grid-cols-3">
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
                    <Button size="sm" variant="outline" onClick={() => navigate(`/clients/${c.id}/competitive`)}><Crosshair className="h-3.5 w-3.5 mr-1" /> Edit competitors</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/clients/${c.id}/competitive/run`)}
                      disabled={!c.runnable || (!c.tracking.ready && c.report?.status !== 'running')}
                      title={!c.runnable ? "Confirm three competitors before running a report" : !c.tracking.ready ? "Connect tracking from Edit competitors first" : undefined}
                    >
                      <Play className="h-3.5 w-3.5 mr-1" /> {c.report?.status === "running" ? "View running report" : "Run competitive report"}
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
          </div>
        )}
      </div>
    </AppLayout>
  );
}
