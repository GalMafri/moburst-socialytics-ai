// Staff landing page for competitive analysis: every client with the state of
// its latest competitor set and latest report, one click into each flow.
// Mirrors AnalyticsIndex; RLS scopes company-restricted staff automatically.

import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { Crosshair, FileText, History, Play, Rss } from "lucide-react";

export default function CompetitiveIndex() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["competitive-index"],
    queryFn: async () => {
      const [clientsRes, setsRes, reportsRes] = await Promise.all([
        supabase.from("clients").select("id, name, logo_url").is("archived_at", null).order("name"),
        supabase.from("competitor_sets").select("id, client_id, status, created_at").order("created_at", { ascending: false }),
        supabase.from("competitive_reports").select("id, client_id, status, created_at").order("created_at", { ascending: false }),
      ]);
      if (clientsRes.error) throw clientsRes.error;
      if (setsRes.error) throw setsRes.error;
      if (reportsRes.error) throw reportsRes.error;
      const latestSet = new Map<string, any>();
      for (const s of setsRes.data || []) if (!latestSet.has(s.client_id)) latestSet.set(s.client_id, s);
      const latestReport = new Map<string, any>();
      for (const r of reportsRes.data || []) if (!latestReport.has(r.client_id)) latestReport.set(r.client_id, r);
      return (clientsRes.data || []).map((c) => ({ ...c, set: latestSet.get(c.id) || null, report: latestReport.get(c.id) || null }));
    },
  });

  return (
    <AppLayout title="Competitive Analysis">
      <div className="max-w-5xl mx-auto space-y-4">
        <p className="text-sm text-muted-foreground">
          Identify and confirm each client's top competitors, run the RivalIQ deep analysis, and open the results.
        </p>
        {isLoading ? (
          <Loading label="Loading clients" />
        ) : !data?.length ? (
          <EmptyState icon={Crosshair} title="No clients yet" description="Add a client to start competitive analysis." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.map((c) => (
              <Card key={c.id}>
                <CardContent className="pt-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{c.name}</div>
                    <div className="flex gap-1.5">
                      {c.set ? <Badge variant={c.set.status === "complete" || c.set.status === "confirmed" ? "default" : "secondary"}>set: {c.set.status}</Badge> : <Badge variant="outline">no set</Badge>}
                      {c.report && <Badge variant={c.report.status === "complete" ? "default" : c.report.status === "failed" ? "destructive" : "secondary"}>report: {c.report.status}</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => navigate(`/clients/${c.id}/competitive`)}><Crosshair className="h-3.5 w-3.5 mr-1" /> Competitors</Button>
                    <Button size="sm" variant="outline" onClick={() => navigate(`/clients/${c.id}/competitive/run`)} disabled={!c.set || !["confirmed", "analyzing", "complete", "failed"].includes(c.set.status)}><Play className="h-3.5 w-3.5 mr-1" /> Run</Button>
                    {c.report?.status === "complete" && (
                      <Button size="sm" onClick={() => navigate(`/clients/${c.id}/competitive/reports/${c.report.id}`)}><FileText className="h-3.5 w-3.5 mr-1" /> Latest report</Button>
                    )}
                    {c.report && (
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${c.id}/competitive/reports`)}><History className="h-3.5 w-3.5 mr-1" /> All runs</Button>
                    )}
                    {c.set && (
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${c.id}/competitive/feed`)}><Rss className="h-3.5 w-3.5 mr-1" /> Feed</Button>
                    )}
                  </div>
                  {c.report && <p className="text-xs text-muted-foreground">Last run {new Date(c.report.created_at).toLocaleString()}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
