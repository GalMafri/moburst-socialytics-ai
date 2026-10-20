// Staff landing page for competitive analysis: every client with what is
// saved, what is tracked and what the last report did — three separate facts,
// each in plain words, and one click into the step that comes next.
// Mirrors AnalyticsIndex; RLS scopes company-restricted staff automatically.

import { useState } from "react";
import { ClientPicker } from "@/components/clients/ClientPicker";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchActiveClients } from "@/lib/activeClients";
import { formatDateTime } from "@/lib/display";
import { AppLayout } from "@/components/layout/AppLayout";
import { Section } from "@/components/ui/section";
import { StatGrid } from "@/components/ui/stat-card";
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
        fetchActiveClients<{ id: string; name: string; logo_url: string | null }>("id, name, logo_url").then((data) => ({ data, error: null })),
        // "*" so the recorded tracking check (competitor_sets.tracking_check) is
        // read where the column exists, without failing where it does not yet.
        supabase.from("competitor_sets").select("*").order("created_at", { ascending: false }),
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
      // A run that did not finish is made again by the product and never shown.
      for (const r of reportsRes.data || []) if (r.status !== "failed" && !latestReport.has(r.client_id)) latestReport.set(r.client_id, r);
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
    <AppLayout title="Competitive analysis" description="Choose a client to edit its competitors, run a report, or open previous results.">
        {isLoading ? (
          <Loading label="Loading clients" />
        ) : isError ? (
          // A failed read used to render as "No clients yet", which reads as a
          // fact about the account rather than a connection problem.
          <LoadError title="Could not load the competitive overview" error={error} onRetry={() => refetch()} />
        ) : !data?.length ? (
          <EmptyState icon={Crosshair} title="No clients yet" />
        ) : (
          <div className="grid gap-section lg:grid-cols-[260px_minmax(0,1fr)] items-start">
            <ClientPicker clients={visibleClients} selectedId={selectedClient?.id} onSelect={chooseClient} search={search} onSearch={setSearch} />
            <div className="min-w-0">
            {!selectedClient && <EmptyState icon={Crosshair} title="No client by that name" description="Try another client name." />}
            {(selectedClient ? [selectedClient] : []).map((c) => (
              // The selected client as one split panel: its name and the
              // things to do on the left, where it stands on the right. The
              // card had five buttons in a row under three short facts, at
              // the left of 1,100px of glass.
              <Section
                key={c.id}
                layout="split"
                eyebrow="Selected client"
                title={c.name}
                description="Competitors and reports for this client only."
                action={
                  <>
                    {c.report?.status === "complete" && (
                      <Button size="sm" onClick={() => navigate(`/clients/${c.id}/competitive/reports/${c.report.id}`)}><FileText /> Latest report</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => navigate(`/clients/${c.id}/competitive`)}><Crosshair /> Edit competitors</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/clients/${c.id}/competitive/run`)}
                      disabled={!c.runnable}
                    >
                      <Play /> {c.report?.status === "running" ? "View running report" : "Run competitive report"}
                    </Button>
                    {c.report && (
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${c.id}/competitive/reports`)}><History /> All runs</Button>
                    )}
                    {c.runnable && (
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${c.id}/competitive/feed`)}><Rss /> Feed</Button>
                    )}
                  </>
                }
              >
                <StatGrid min={200}>
                  <div className="glass-inner p-inner space-y-1 min-w-0">
                    <p className="t-subhead">Saved selection</p>
                    <p className="t-h4">{c.selection.headline}</p>
                    {c.selection.detail && <p className="t-label">{c.selection.detail}</p>}
                  </div>
                  {c.tracking.headline && (
                    <div className="glass-inner p-inner space-y-1 min-w-0">
                      <p className="t-subhead">RivalIQ tracking</p>
                      <p className="t-h4">{c.tracking.headline}</p>
                    </div>
                  )}
                  <div className="glass-inner p-inner space-y-1 min-w-0">
                    <p className="t-subhead">Last report</p>
                    <p className="t-h4">{c.outcome.headline}</p>
                    {c.report && <p className="t-label">Last run {formatDateTime(c.report.created_at)}</p>}
                  </div>
                </StatGrid>
              </Section>
            ))}
            </div>
          </div>
        )}
    </AppLayout>
  );
}
