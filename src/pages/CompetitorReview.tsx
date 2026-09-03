// Competitor identification + review (project steps 3-6).
//
// Staff-only workspace for one client's competitor set:
//   - "Identify competitors" runs the AI proposal, then handle detection.
//   - The draft list supports deselect/select, manual add, remove, and
//     ranking the top 3.
//   - "Confirm top 3" runs the server-side gate (confirm-competitor-set),
//     after which the set is what the deep analysis consumes.
//
// The page always works on the client's NEWEST set. Re-running identification
// creates a fresh draft set and leaves history behind (sets are cheap rows).

import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/telemetry";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loading } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/hooks/use-toast";
import { PlatformBadge } from "@/lib/platform-config";
import { describeInvokeError } from "@/lib/invokeError";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Crosshair, Loader2, Plus, RefreshCw, Search, ShieldCheck, Trash2, Trophy, Play, Download,
} from "lucide-react";

type CompetitorRow = {
  id: string;
  set_id: string;
  client_id: string;
  name: string;
  website_url: string | null;
  rationale: string | null;
  similarity_score: number | null;
  source: string;
  is_selected: boolean;
  selected_rank: number | null;
};

type HandleRow = {
  id: string;
  competitor_id: string;
  platform: string;
  handle: string;
  profile_url: string | null;
  is_active: boolean;
};

export default function CompetitorReview() {
  const { id: clientId } = useParams();
  const navigate = useNavigate();
  const { canRunAnalysis } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [identifying, setIdentifying] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  // RivalIQ import: the agency's landscapes are the curated competitor sets.
  const [importOpen, setImportOpen] = useState(false);
  const [landscapes, setLandscapes] = useState<any[] | null>(null);
  const [landscapesError, setLandscapesError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

  const { data: client } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", clientId!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

  // Newest set for this client, whatever its status.
  const { data: currentSet, isLoading: setLoading } = useQuery({
    queryKey: ["competitor-set", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitor_sets")
        .select("*")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

  const { data: competitors } = useQuery({
    queryKey: ["competitors", currentSet?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitors")
        .select("*")
        .eq("set_id", currentSet!.id)
        .order("similarity_score", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data as CompetitorRow[];
    },
    enabled: !!currentSet?.id,
  });

  const { data: handles } = useQuery({
    queryKey: ["competitor-handles", currentSet?.id],
    queryFn: async () => {
      const ids = (competitors || []).map((c) => c.id);
      if (ids.length === 0) return [] as HandleRow[];
      const { data, error } = await supabase
        .from("competitor_handles")
        .select("*")
        .in("competitor_id", ids);
      if (error) throw error;
      return data as HandleRow[];
    },
    enabled: !!competitors && competitors.length > 0,
  });

  const handlesByCompetitor = useMemo(() => {
    const m = new Map<string, HandleRow[]>();
    for (const h of handles || []) {
      if (!m.has(h.competitor_id)) m.set(h.competitor_id, []);
      m.get(h.competitor_id)!.push(h);
    }
    return m;
  }, [handles]);

  const selected = useMemo(
    () => (competitors || []).filter((c) => c.is_selected).sort((a, b) => (a.selected_rank || 9) - (b.selected_rank || 9)),
    [competitors],
  );

  const isDraft = currentSet?.status === "draft";
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["competitor-set", clientId] });
    queryClient.invalidateQueries({ queryKey: ["competitors"] });
    queryClient.invalidateQueries({ queryKey: ["competitor-handles"] });
  };

  // ── Actions ────────────────────────────────────────────────────────────────

  const openImport = async () => {
    setImportOpen(true);
    setLandscapes(null);
    setLandscapesError(null);
    const { data, error } = await supabase.functions.invoke("import-rivaliq-landscape", {
      body: { client_id: clientId, mode: "list" },
    });
    if (error || data?.error) {
      setLandscapesError(await describeInvokeError(error, data));
      return;
    }
    setLandscapes(data?.landscapes || []);
  };

  const importLandscape = async (landscapeId: string) => {
    setImportingId(landscapeId);
    track("competitive_landscape_import_started", { client_id: clientId, landscape_id: landscapeId });
    try {
      const { data, error } = await supabase.functions.invoke("import-rivaliq-landscape", {
        body: { client_id: clientId, mode: "import", landscape_id: landscapeId },
      });
      if (error || data?.error) throw new Error(await describeInvokeError(error, data));
      toast({
        title: "Landscape imported as a new draft",
        description: `${data.competitors} competitors, ${data.handles} handles from RivalIQ. Top ${data.preselected} pre-selected; adjust and confirm.`,
      });
      setImportOpen(false);
      refreshAll();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImportingId(null);
    }
  };

  const identify = async () => {
    setIdentifying(true);
    track("competitor_identification_started", { client_id: clientId });
    try {
      const { data, error } = await supabase.functions.invoke("identify-competitors", {
        body: { client_id: clientId },
      });
      if (error || data?.error) throw new Error(await describeInvokeError(error, data));
      track("competitor_identification_completed", {
        client_id: clientId, entity_id: data.set_id, ok: true,
        props: { proposed: data.competitors?.length },
      });
      refreshAll();
      toast({ title: "Competitors identified", description: "Now detecting social handles…" });

      // Detect handles ONE COMPETITOR PER CALL. A whole-set call scrapes up
      // to 12 third-party sites serially inside one edge request, and the
      // platform kills requests at 150s — the tail of the list never ran.
      // Driving the loop from here keeps every call small, and handles
      // appear row by row as they land.
      setDetecting(true);
      let detectFailures = 0;
      for (const comp of data.competitors || []) {
        const det = await supabase.functions.invoke("detect-competitor-handles", {
          body: { competitor_id: comp.id },
        });
        if (det.error || det.data?.error) detectFailures++;
        refreshAll();
      }
      if (detectFailures > 0) {
        toast({
          title: "Some handle detections failed",
          description: `${detectFailures} competitor site(s) could not be read — add or re-detect those handles manually.`,
        });
      }
    } catch (err: any) {
      track("competitor_identification_failed", {
        client_id: clientId, ok: false, error_code: String(err?.message || "unknown").slice(0, 120),
      });
      toast({ title: "Identification failed", description: err.message, variant: "destructive" });
    } finally {
      setIdentifying(false);
      setDetecting(false);
    }
  };

  const redetectHandles = async () => {
    if (!currentSet || !competitors) return;
    setDetecting(true);
    try {
      // Same one-per-call pacing as the identify flow (150s gateway cap).
      let failures = 0;
      for (const comp of competitors) {
        const { data, error } = await supabase.functions.invoke("detect-competitor-handles", {
          body: { competitor_id: comp.id, refresh: true },
        });
        if (error || data?.error) failures++;
        refreshAll();
      }
      toast({
        title: failures === 0 ? "Handles refreshed" : "Handles refreshed with gaps",
        description: failures > 0 ? `${failures} site(s) could not be read.` : undefined,
      });
    } catch (err: any) {
      toast({ title: "Detection failed", description: err.message, variant: "destructive" });
    } finally {
      setDetecting(false);
    }
  };

  const addManual = useMutation({
    mutationFn: async () => {
      if (!manualName.trim()) throw new Error("Name is required");
      let setId = currentSet?.id;
      // Adding a competitor with no set yet creates a draft set to hold it.
      if (!setId) {
        const { data: newSet, error: setErr } = await supabase
          .from("competitor_sets")
          .insert({ client_id: clientId! })
          .select("id")
          .single();
        if (setErr) throw setErr;
        setId = newSet.id;
      }
      const { data: comp, error } = await supabase
        .from("competitors")
        .insert({
          set_id: setId,
          client_id: clientId!,
          name: manualName.trim(),
          website_url: manualUrl.trim() || null,
          source: "manual",
        })
        .select("id")
        .single();
      if (error) throw error;
      // Detect handles for the new row (best-effort).
      if (manualUrl.trim()) {
        await supabase.functions.invoke("detect-competitor-handles", {
          body: { competitor_id: comp.id },
        });
      }
    },
    onSuccess: () => {
      setManualName("");
      setManualUrl("");
      refreshAll();
    },
    onError: (err: any) => toast({ title: "Could not add competitor", description: err.message, variant: "destructive" }),
  });

  const removeCompetitor = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("competitors").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refreshAll,
    onError: (err: any) => toast({ title: "Remove failed", description: err.message, variant: "destructive" }),
  });

  /**
   * Toggle selection. Selecting assigns the lowest free rank (1-3); at 3
   * already selected the click is refused. Deselecting frees its rank.
   */
  const toggleSelect = useMutation({
    mutationFn: async (row: CompetitorRow) => {
      if (row.is_selected) {
        const { error } = await supabase
          .from("competitors")
          .update({ is_selected: false, selected_rank: null })
          .eq("id", row.id);
        if (error) throw error;
      } else {
        const used = new Set(selected.map((s) => s.selected_rank));
        const free = [1, 2, 3].find((r) => !used.has(r));
        if (!free) throw new Error("Three competitors are already selected — deselect one first.");
        const { error } = await supabase
          .from("competitors")
          .update({ is_selected: true, selected_rank: free })
          .eq("id", row.id);
        if (error) throw error;
      }
    },
    onSuccess: refreshAll,
    onError: (err: any) => toast({ title: "Selection", description: err.message, variant: "destructive" }),
  });

  const confirmSet = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("confirm-competitor-set", {
        body: { set_id: currentSet!.id },
      });
      if (error || data?.error) throw new Error(await describeInvokeError(error, data));
    },
    onSuccess: () => {
      track("competitor_set_confirmed", { client_id: clientId, entity_id: currentSet?.id, ok: true });
      refreshAll();
      toast({ title: "Competitor set confirmed", description: "Top 3 locked in for deep analysis." });
    },
    onError: (err: any) => toast({ title: "Confirm failed", description: err.message, variant: "destructive" }),
  });

  const reopenSet = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("competitor_sets")
        .update({ status: "draft", confirmed_by: null, confirmed_at: null })
        .eq("id", currentSet!.id);
      if (error) throw error;
    },
    onSuccess: refreshAll,
  });

  if (!canRunAnalysis) return <Navigate to="/" replace />;

  if (!client || setLoading) {
    return (
      <AppLayout title="Competitive Analysis">
        <Loading label="Loading" />
      </AppLayout>
    );
  }

  return (
    <AppLayout title={`Competitors: ${client.name}`}>
      <div className="w-full space-y-6">
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Import a RivalIQ landscape</DialogTitle>
              <DialogDescription>
                Landscapes whose focus company is this client are listed first. Importing creates a new draft set
                with the landscape's companies and their tracked handles; the top 3 are pre-selected for you to adjust.
              </DialogDescription>
            </DialogHeader>
            {landscapesError ? (
              <p className="text-sm text-destructive">{landscapesError}</p>
            ) : landscapes === null ? (
              <Loading label="Reading RivalIQ landscapes" />
            ) : landscapes.length === 0 ? (
              <p className="text-[15px] text-[#9ca3af]">No landscapes on the RivalIQ account.</p>
            ) : (
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {landscapes.map((l: any) => (
                  <div key={l.id} className="p-3 rounded-md bg-[rgba(255,255,255,0.04)] flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[15px] font-medium flex items-center gap-2">
                        {l.name}
                        {l.is_match && <Badge>matches {client?.name}</Badge>}
                      </div>
                      <div className="text-[14px] text-[#9ca3af]">
                        Focus: {l.focus_company || "?"} · {l.companies.filter((c: any) => !c.is_focus).length} competitors
                      </div>
                      <div className="text-[14px] text-[#9ca3af] truncate">
                        {l.companies.filter((c: any) => !c.is_focus).map((c: any) => c.name).join(", ")}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => importLandscape(l.id)} disabled={!!importingId}>
                      {importingId === l.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                      Import
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
        {/* Status / primary actions */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Crosshair className="h-4 w-4" /> Competitor Set
                  {currentSet && (
                    <Badge variant={currentSet.status === "confirmed" ? "default" : "secondary"}>
                      {currentSet.status}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="mt-1">
                  AI proposes, you decide. Swap out misfits, add your own, then lock the top 3.
                </CardDescription>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={openImport} disabled={identifying}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Import from RivalIQ
                </Button>
                {currentSet && (
                  <Button variant="outline" size="sm" onClick={redetectHandles} disabled={detecting || !isDraft}>
                    {detecting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Search className="h-3.5 w-3.5 mr-1" />}
                    Re-detect handles
                  </Button>
                )}
                <Button size="sm" onClick={identify} disabled={identifying}>
                  {identifying ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                  {currentSet ? "Re-identify (new draft)" : "Identify competitors"}
                </Button>
              </div>
            </div>
          </CardHeader>
          {client.competitor_seed_notes ? (
            <CardContent className="pt-0">
              <p className="text-[14px] text-[#9ca3af]">
                <span className="font-medium">Account team notes fed to the AI:</span> {client.competitor_seed_notes}
              </p>
            </CardContent>
          ) : null}
        </Card>

        {/* Selected top 3 */}
        {selected.length > 0 && (
          <Card className="border-[#b9e045]/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Trophy className="h-4 w-4 text-[#b9e045]" /> Top 3 for deep analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {selected.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-2 rounded-md bg-[rgba(255,255,255,0.04)]">
                  <Badge className="shrink-0">#{c.selected_rank}</Badge>
                  <span className="font-medium text-[15px]">{c.name}</span>
                  <span className="flex gap-1 ml-auto">
                    {(handlesByCompetitor.get(c.id) || []).filter((h) => h.is_active).map((h) => (
                      <PlatformBadge key={h.id} platform={h.platform} size="sm" />
                    ))}
                  </span>
                </div>
              ))}
              <div className="flex gap-2 pt-2">
                {isDraft && (
                  <Button
                    onClick={() => confirmSet.mutate()}
                    disabled={selected.length !== 3 || confirmSet.isPending}
                    className="gap-2"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Confirm top 3 {selected.length !== 3 ? `(${selected.length}/3 selected)` : ""}
                  </Button>
                )}
                {currentSet?.status === "confirmed" && (
                  <>
                    <Button className="gap-2" onClick={() => navigate(`/clients/${clientId}/competitive/run`)}>
                      <Play className="h-4 w-4" /> Run deep analysis
                    </Button>
                    <Button variant="outline" onClick={() => reopenSet.mutate()}>
                      Reopen for edits
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Candidate list */}
        {currentSet && (competitors?.length ?? 0) > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Candidates</CardTitle>
              <CardDescription>
                {competitors!.length} proposed · click a row's star slot to select it into the top 3
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {competitors!.map((c) => {
                const compHandles = (handlesByCompetitor.get(c.id) || []).filter((h) => h.is_active);
                return (
                  <div
                    key={c.id}
                    className={`p-3 rounded-md border ${
                      c.is_selected ? "border-[#b9e045]/40 bg-[#b9e045]/5" : "border-white/[0.06] bg-[rgba(255,255,255,0.03)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-[15px]">{c.name}</span>
                          {c.source === "manual" && <Badge variant="outline">manual</Badge>}
                          {typeof c.similarity_score === "number" && (
                            <Badge variant="secondary">{Math.round(c.similarity_score * 100)}% match</Badge>
                          )}
                        </div>
                        {c.website_url && (
                          <a
                            href={c.website_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[14px] text-[#9ca3af] hover:text-foreground underline-offset-2 hover:underline"
                          >
                            {c.website_url.replace(/^https?:\/\/(www\.)?/, "")}
                          </a>
                        )}
                        {c.rationale && <p className="text-[14px] text-[#9ca3af] mt-1">{c.rationale}</p>}
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {compHandles.length > 0 ? (
                            compHandles.map((h) => (
                              <a key={h.id} href={h.profile_url || undefined} target="_blank" rel="noreferrer">
                                <PlatformBadge platform={h.platform} size="sm" />
                              </a>
                            ))
                          ) : (
                            <span className="text-[13px] text-amber-500/80">no handles detected yet</span>
                          )}
                        </div>
                      </div>
                      {isDraft && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant={c.is_selected ? "default" : "outline"}
                            onClick={() => toggleSelect.mutate(c)}
                            disabled={toggleSelect.isPending}
                          >
                            {c.is_selected ? `#${c.selected_rank}` : "Select"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removeCompetitor.mutate(c.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : (
          !identifying && (
            <EmptyState
              icon={Crosshair}
              title="No competitor set yet"
              description="Run AI identification to draft 8-12 likely competitors from the client profile, or add competitors manually below."
            />
          )
        )}

        {/* Manual add */}
        {(isDraft || !currentSet) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Add manually</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Competitor name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Website (optional, used for handle detection)</Label>
                  <Input value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://…" />
                </div>
                <Button
                  onClick={() => addManual.mutate()}
                  disabled={!manualName.trim() || addManual.isPending}
                  className="gap-1"
                >
                  {addManual.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
