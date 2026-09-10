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
import { classifyProfileUrl } from "@/lib/profileUrl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { PlatformBadge, prettyPlatformName } from "@/lib/platform-config";
import { describeInvokeError } from "@/lib/invokeError";
import { displayCompanyName } from "@/lib/companyName";
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

/**
 * One importable landscape.
 *
 * The competitors are the headline, because they are what the import brings
 * in; the landscape's own name ("TIER 2 FIRMS") is the agency's filing label
 * in RivalIQ and means nothing to someone reading this screen, so it sits
 * underneath with the focus company.
 */
function LandscapeRow({
  landscape,
  importingId,
  onImport,
}: {
  landscape: any;
  importingId: string | null;
  onImport: (id: string) => void;
}) {
  const rivals = (landscape.companies || []).filter((c: any) => !c.is_focus);
  const empty = rivals.length === 0;
  return (
    <div className="glass-inner p-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="t-body font-medium text-white">{landscape.name}</p>
        <p className="t-secondary mt-0.5">
          {empty ? "No competitors in this set" : rivals.map((c: any) => displayCompanyName(c.name)).join(", ")}
        </p>
      </div>
      <Button
        size="sm"
        onClick={() => onImport(landscape.id)}
        disabled={!!importingId || empty}
        title={empty ? "This set has no competitors to import" : undefined}
        className="shrink-0"
      >
        {importingId === landscape.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
        Import {empty ? "" : rivals.length}
      </Button>
    </div>
  );
}

export default function CompetitorReview() {
  const { id: clientId } = useParams();
  const navigate = useNavigate();
  const { canRunAnalysis } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [identifying, setIdentifying] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectingId, setDetectingId] = useState<string | null>(null);
  const [detectProgress, setDetectProgress] = useState<{ done: number; total: number } | null>(null);
  const [addingHandleFor, setAddingHandleFor] = useState<string | null>(null);
  const [newHandlePlatform, setNewHandlePlatform] = useState("instagram");
  const [newHandle, setNewHandle] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  // RivalIQ import: the agency's landscapes are the curated competitor sets.
  const [importOpen, setImportOpen] = useState(false);
  const [landscapes, setLandscapes] = useState<any[] | null>(null);
  const [landscapesError, setLandscapesError] = useState<string | null>(null);
  const [showOtherLandscapes, setShowOtherLandscapes] = useState(false);
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
    setShowOtherLandscapes(false);
  };

  // Whose set is it? A landscape belongs to this client when RivalIQ has the
  // client as its focus company; anything else is another client's work.
  const landscapeMatches = (landscapes || []).filter((l: any) => l.is_match);
  const landscapeOthers = (landscapes || []).filter((l: any) => !l.is_match);
  /**
   * Other clients' sets, gathered under the client they belong to.
   *
   * Flat, the list read as a jumble: two of the rows were Bader Law's and
   * looked like a duplicate rather than two sets that client tracks, and
   * nothing said who any of the others were for.
   */
  const landscapesByFocus = Object.entries(
    landscapeOthers.reduce((acc: Record<string, any[]>, l: any) => {
      const key = l.focus_company || "No focus company set";
      (acc[key] ||= []).push(l);
      return acc;
    }, {}),
  ).sort(([a], [b]) => a.localeCompare(b));

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
      const { empty } = await detectForAll(data.competitors || []);
      if (empty.length > 0) {
        toast({
          title: `${empty.length} of ${(data.competitors || []).length} still have no handles`,
          description: "Two passes found nothing on those sites. Add the handle by hand on the row.",
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

  /**
   * Find handles for a whole set, in one go.
   *
   * Four at a time rather than one after another (twelve sites serially took
   * minutes), and anything that comes back empty is tried once more before
   * anyone is told about it: a site that was slow, rendering its footer in
   * JavaScript, or refusing the first request usually answers the second.
   * Nobody should have to press "look again" on a brand that plainly has
   * social profiles.
   */
  const detectForAll = async (
    comps: Array<{ id: string; name?: string }>,
    opts: { refresh?: boolean } = {},
  ): Promise<{ empty: string[] }> => {
    const BATCH = 4;
    const runOne = async (id: string) => {
      try {
        const { data, error } = await supabase.functions.invoke("detect-competitor-handles", {
          body: { competitor_id: id, refresh: opts.refresh === true },
        });
        if (error || data?.error) return { id, found: 0 };
        return { id, found: (data?.results?.[0]?.detected || []).length };
      } catch {
        return { id, found: 0 };
      }
    };

    const sweep = async (ids: string[]) => {
      const results: Array<{ id: string; found: number }> = [];
      for (let i = 0; i < ids.length; i += BATCH) {
        results.push(...(await Promise.all(ids.slice(i, i + BATCH).map(runOne))));
        setDetectProgress({ done: Math.min(i + BATCH, ids.length), total: ids.length });
        refreshAll();
      }
      return results;
    };

    const ids = comps.map((c) => c.id);
    setDetectProgress({ done: 0, total: ids.length });
    const first = await sweep(ids);
    let empty = first.filter((r) => r.found === 0).map((r) => r.id);
    if (empty.length > 0) {
      // The second pass always refreshes: the first pass may have written
      // nothing, and a gap-fill upsert would skip a site that now answers.
      const second = await sweep(empty);
      empty = second.filter((r) => r.found === 0).map((r) => r.id);
    }
    setDetectProgress(null);
    return { empty };
  };

  /**
   * Look again for one competitor's handles.
   *
   * A row that says "no handles" is a dead end otherwise: the set-wide
   * re-detect re-reads every site to fix the one that failed, and a site that
   * was slow or rendering its footer in JavaScript the first time often
   * answers on a second pass.
   */
  const detectOne = async (competitorId: string) => {
    setDetectingId(competitorId);
    try {
      const { data, error } = await supabase.functions.invoke("detect-competitor-handles", {
        body: { competitor_id: competitorId, refresh: true },
      });
      if (error || data?.error) throw new Error(await describeInvokeError(error, data));
      refreshAll();
      const found = (data?.results?.[0]?.detected || []).length;
      toast({
        title: found > 0 ? `Found ${found} handle${found === 1 ? "" : "s"}` : "Still nothing on that site",
        description: found > 0 ? undefined : "Add the handle by hand below, or drop the competitor.",
      });
    } catch (err: any) {
      toast({ title: "Detection failed", description: err.message, variant: "destructive" });
    } finally {
      setDetectingId(null);
    }
  };

  const redetectHandles = async () => {
    if (!currentSet || !competitors) return;
    setDetecting(true);
    try {
      const { empty } = await detectForAll(competitors, { refresh: true });
      toast({
        title: empty.length === 0 ? "Handles refreshed" : "Handles refreshed with gaps",
        description: empty.length > 0 ? `${empty.length} site(s) gave nothing after two passes.` : undefined,
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

  /**
   * A handle typed by a person.
   *
   * The detector is good but not perfect, and a wrong or missing handle used
   * to be unfixable: the run sent whatever the scraper decided. These rows
   * are marked manual, and a re-detect leaves them alone.
   */
  const addHandle = useMutation({
    mutationFn: async ({ competitorId }: { competitorId: string }) => {
      const raw = newHandle.trim();
      if (!raw) throw new Error("Enter a handle or a profile URL");
      // A pasted profile URL is read for its handle; anything else is taken
      // as the handle itself.
      const fromUrl = classifyProfileUrl(raw);
      const platform = fromUrl?.platform || newHandlePlatform;
      const handle = (fromUrl?.handle || raw).replace(/^@/, "").trim();
      if (!handle) throw new Error("That does not look like a handle");
      const { error } = await supabase.from("competitor_handles").upsert(
        {
          competitor_id: competitorId,
          client_id: clientId!,
          platform,
          handle,
          profile_url: fromUrl?.profile_url || null,
          is_active: true,
          detection_confidence: 1,
          source: "manual",
        } as any,
        { onConflict: "competitor_id,platform" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      setNewHandle("");
      setAddingHandleFor(null);
      refreshAll();
      toast({ title: "Handle saved", description: "A re-detect will leave it alone." });
    },
    onError: (e: any) => toast({ title: "Could not save the handle", description: e.message, variant: "destructive" }),
  });

  const removeHandle = useMutation({
    mutationFn: async (handleId: string) => {
      const { error } = await supabase.from("competitor_handles").delete().eq("id", handleId);
      if (error) throw error;
    },
    onSuccess: () => refreshAll(),
    onError: (e: any) => toast({ title: "Could not remove the handle", description: e.message, variant: "destructive" }),
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
      <AppLayout title="Competitive Analysis"
      description="Review the proposed competitors, confirm the top three, then run the analysis.">
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
              <DialogTitle>Import competitors from RivalIQ</DialogTitle>
              <DialogDescription>
                A RivalIQ landscape is a set the agency already tracks. Importing one creates a new draft
                for {client?.name || "this client"} with its companies and their handles; the top 3 are pre-selected
                for you to adjust.
              </DialogDescription>
            </DialogHeader>
            {landscapesError ? (
              <p className="t-body text-destructive">{landscapesError}</p>
            ) : landscapes === null ? (
              <Loading label="Reading RivalIQ landscapes" />
            ) : landscapes.length === 0 ? (
              <p className="t-secondary">No landscapes on the RivalIQ account.</p>
            ) : (
              // Every landscape on the account used to be one flat list, so a
              // client with none of their own was offered other clients' sets
              // with no explanation. The client's own come first under their
              // own heading; the rest are a deliberate second step.
              <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
                <div className="space-y-2">
                  {landscapeMatches.length > 0 ? (
                    <>
                      <p className="t-subhead">
                        Tracked for {client?.name || "this client"} · {landscapeMatches.length} set
                        {landscapeMatches.length === 1 ? "" : "s"} in RivalIQ
                      </p>
                      {landscapeMatches.map((l: any) => (
                        <LandscapeRow key={l.id} landscape={l} importingId={importingId} onImport={importLandscape} />
                      ))}
                    </>
                  ) : (
                    <div className="glass-inner p-4 space-y-3">
                      <p className="t-body text-white">
                        RivalIQ has no set with {client?.name || "this client"} as its focus company.
                      </p>
                      <p className="t-secondary">
                        Either build one in RivalIQ and come back, or let the app propose competitors from this
                        client's website and brief — you review the list before anything is tracked.
                      </p>
                      <Button
                        size="sm"
                        onClick={() => {
                          setImportOpen(false);
                          identify();
                        }}
                        disabled={identifying}
                      >
                        <Search className="h-3.5 w-3.5 mr-1" /> Propose competitors instead
                      </Button>
                    </div>
                  )}
                </div>

                {landscapeOthers.length > 0 && (
                  <div className="space-y-2">
                    {!showOtherLandscapes ? (
                      <Button variant="ghost" size="sm" onClick={() => setShowOtherLandscapes(true)}>
                        Show {landscapeOthers.length} set{landscapeOthers.length === 1 ? "" : "s"} tracked for other clients
                      </Button>
                    ) : (
                      <div className="space-y-4">
                        <p className="t-subhead">Tracked for other clients</p>
                        {landscapesByFocus.map(([focus, sets]) => (
                          <div key={focus} className="space-y-2">
                            <p className="t-body font-medium text-white">
                              {focus}
                              <span className="t-label ml-2">
                                {(sets as any[]).length} set{(sets as any[]).length === 1 ? "" : "s"} in RivalIQ
                              </span>
                            </p>
                            {(sets as any[]).map((l: any) => (
                              <LandscapeRow key={l.id} landscape={l} importingId={importingId} onImport={importLandscape} />
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
        {/* Status / primary actions */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="t-h3 flex items-center gap-2">
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
              <p className="t-secondary">
                <span className="font-medium">Account team notes fed to the AI:</span> {client.competitor_seed_notes}
              </p>
            </CardContent>
          ) : null}
        </Card>

        {/* Selected top 3 */}
        {selected.length > 0 && (
          <Card className="border-[#b9e045]/30">
            <CardHeader className="pb-3">
              <CardTitle className="t-h3 flex items-center gap-2">
                <Trophy className="h-4 w-4 text-[#b9e045]" /> Top 3 for deep analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {selected.map((c) => (
                <div key={c.id} className="glass-inner flex items-center gap-3 p-3">
                  <Badge className="shrink-0">#{c.selected_rank}</Badge>
                  <span className="font-medium t-body" title={c.name}>{displayCompanyName(c.name)}</span>
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
              <CardTitle className="t-h3">Candidates</CardTitle>
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
                          <span className="font-medium t-body" title={c.name}>{displayCompanyName(c.name)}</span>
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
                            className="t-secondary hover:text-foreground underline-offset-2 hover:underline inline-flex items-center min-h-[24px]"
                          >
                            {c.website_url.replace(/^https?:\/\/(www\.)?/, "")}
                          </a>
                        )}
                        {c.rationale && <p className="t-secondary mt-1">{c.rationale}</p>}
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {compHandles.map((h) => (
                            <span key={h.id} className="inline-flex items-center gap-1">
                              <a href={h.profile_url || undefined} target="_blank" rel="noreferrer" className="inline-flex items-center min-h-[24px]" title={`@${h.handle}`}>
                                <PlatformBadge platform={h.platform} size="sm" />
                              </a>
                              {isDraft && (
                                <button
                                  type="button"
                                  aria-label={`Remove the ${h.platform} handle @${h.handle}`}
                                  title={`Remove @${h.handle}`}
                                  onClick={() => removeHandle.mutate(h.id)}
                                  className="text-muted-foreground hover:text-destructive leading-none px-0.5"
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          ))}
                          {compHandles.length === 0 && (
                            <span className="t-label text-amber-500/80 inline-flex items-center gap-1.5">
                              {detectingId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                              {detectingId === c.id ? "Looking…" : "No handles found"}
                            </span>
                          )}
                          {isDraft && (
                            <button
                              type="button"
                              onClick={() => setAddingHandleFor(addingHandleFor === c.id ? null : c.id)}
                              className="t-label text-muted-foreground hover:text-white inline-flex items-center gap-1 min-h-[24px]"
                            >
                              <Plus className="h-3 w-3" /> Add
                            </button>
                          )}
                          {compHandles.length === 0 && isDraft && (
                            <button
                              type="button"
                              onClick={() => detectOne(c.id)}
                              disabled={detectingId === c.id}
                              className="t-label text-muted-foreground hover:text-white inline-flex items-center gap-1 min-h-[24px] disabled:opacity-60"
                            >
                              <Search className="h-3 w-3" /> Look again
                            </button>
                          )}
                        </div>
                        {addingHandleFor === c.id && isDraft && (
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <select
                              aria-label="Platform"
                              value={newHandlePlatform}
                              onChange={(e) => setNewHandlePlatform(e.target.value)}
                              className="input-glass rounded-md h-9 px-2 t-label"
                            >
                              {["instagram", "facebook", "tiktok", "linkedin", "youtube", "x"].map((p) => (
                                <option key={p} value={p}>{prettyPlatformName(p)}</option>
                              ))}
                            </select>
                            <Input
                              aria-label="Handle"
                              value={newHandle}
                              onChange={(e) => setNewHandle(e.target.value)}
                              placeholder="handle, or paste the profile URL"
                              className="h-9 w-64"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addHandle.mutate({ competitorId: c.id });
                                }
                              }}
                            />
                            <Button size="sm" onClick={() => addHandle.mutate({ competitorId: c.id })} disabled={addHandle.isPending || !newHandle.trim()}>
                              Save handle
                            </Button>
                          </div>
                        )}
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
                            onClick={() => setRemoving({ id: c.id, name: displayCompanyName(c.name) })}
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
              <CardTitle className="t-h3">Add manually</CardTitle>
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
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? "this competitor"}?`}
        description={<p>It leaves this set, along with the social handles detected for it. Reports already run keep it.</p>}
        confirmLabel="Remove competitor"
        onConfirm={() => {
          if (removing) removeCompetitor.mutate(removing.id);
          setRemoving(null);
        }}
      />
    </AppLayout>
  );
}
