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

import { useEffect, useMemo, useRef, useState } from "react";
import { RivalIqSetup } from "@/components/competitive/RivalIqSetup";
import { CompetitiveSteps } from "@/components/competitive/CompetitiveSteps";
import { describeSelection, describeTracking, pickRunSelection, type SetRow } from "@/lib/competitiveFlow";

import { classifyProfileUrl, isProfileUrlInput } from "@/lib/profileUrl";
import { isReviewReadyHandle } from "../../supabase/functions/_shared/competitive/extractSocialHandles";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { LoadError } from "@/components/ui/load-error";
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
  profile_detection?: { status: string; detail?: string; checked_at?: string; discovery_version?: number } | null;
};

function readProfileCheck(value: unknown): CompetitorRow["profile_detection"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.status !== "string") return null;
  return { status: record.status,
    discovery_version: typeof record.discovery_version === "number" ? record.discovery_version : undefined,
    detail: typeof record.detail === "string" ? record.detail : undefined,
    checked_at: typeof record.checked_at === "string" ? record.checked_at : undefined };
}

type HandleRow = {
  id: string;
  competitor_id: string;
  platform: string;
  handle: string;
  profile_url: string | null;
  is_active: boolean;
  source?: string;
  detection_confidence?: number | null;
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
  const rivals = (landscape.companies || []).filter((c: any) => c.id !== landscape.client_company_id);
  const empty = rivals.length === 0;
  return (
    <div className="glass-inner p-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="t-body font-medium text-white">{landscape.name}</p>
        <p className="t-secondary mt-0.5">
          {empty ? "No competitors in this set" : rivals.map((c: any) => displayCompanyName(c.name)).join(", ")}
        </p>
        {!empty && rivals.length < 3 && (
          <p className="t-secondary text-amber-400 mt-1">
            This imports an incomplete draft. Add {3 - rivals.length} more competitor{rivals.length === 1 ? "s" : ""} before you can confirm it and run a report.
          </p>
        )}
      </div>
      <Button
        size="sm"
        onClick={() => onImport(landscape.id)}
        disabled={!!importingId || empty || !landscape.is_match}
        title={!landscape.is_match ? "This landscape does not uniquely track this client" : empty ? "This set has no competitors to import" : undefined}
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
  const { canRunAnalysis, isGosSession } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [identifying, setIdentifying] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [showUnverified, setShowUnverified] = useState(false);
  const attemptedProfiles = useRef(new Set<string>());
  const profileSessionExpired = useRef(false);
  const [needsPortalSession, setNeedsPortalSession] = useState(false);
  const [profileChecks, setProfileChecks] = useState<Record<string, { state: string; detail?: string }>>({});
  const [removingHandle, setRemovingHandle] = useState<HandleRow | null>(null);
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

  const { data: client, isLoading: clientLoading, isError: clientFailed, error: clientError, refetch: refetchClient } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", clientId!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

  // Every set for this client, newest first. The whole (short) list is needed
  // because a newer draft and the older confirmed set that a report would
  // actually use are different rows, and both have to be shown.
  const { data: sets, isLoading: setLoading } = useQuery({
    queryKey: ["competitor-set", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitor_sets")
        .select("*")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });
  const [selectionParams] = useSearchParams();
  const requestedSet = selectionParams.get('set');
  const currentSet = (requestedSet ? sets?.find(s => s.id === requestedSet) : sets?.[0]) ?? null;
  const { runnable: runnableSet } = pickRunSelection((sets || []) as SetRow[]);
  const selectionState = describeSelection((sets || []) as SetRow[]);
  const trackingState = describeTracking(currentSet);


  const { data: competitors, isLoading: competitorsLoading, isError: competitorsFailed, error: competitorsError, refetch: refetchCompetitors } = useQuery({
    queryKey: ["competitors", currentSet?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitors")
        .select("*")
        .eq("set_id", currentSet!.id)
        .order("similarity_score", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data || []).map(row => ({ ...row, profile_detection: readProfileCheck(row.profile_detection) }));
    },
    enabled: !!currentSet?.id,
    refetchInterval: query => (query.state.data || []).some(c => c.profile_detection?.status === "running") ? 5000 : false,
  });

  const { data: handles, isLoading: handlesLoading, isError: handlesFailed } = useQuery({
    queryKey: ["competitor-handles", currentSet?.id, (competitors || []).map(c => c.id).sort().join(",")],
    queryFn: async () => {
      const ids = (competitors || []).map((c) => c.id);
      if (ids.length === 0) return [] as HandleRow[];
      const { data, error } = await supabase
        .from("competitor_handles")
        .select("*")
        .in("competitor_id", ids)
        // A handle someone removed is kept as the record of that decision,
        // so the detector stops re-adding it. It is not shown.
        .neq("is_active", false);
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

  /** Selected competitors the server will refuse, because they carry no handle. */
  const withoutHandles = useMemo(
    () =>
      selected
        .filter((c) => (handlesByCompetitor.get(c.id) || []).filter((h) => h.is_active !== false).length === 0)
        .map((c) => displayCompanyName(c.name)),
    [selected, handlesByCompetitor],
  );
  const withoutReviewedHandles = useMemo(
    () =>
      selected
        .filter((c) => {
          const active = (handlesByCompetitor.get(c.id) || []).filter((h) => h.is_active !== false);
          return active.length > 0 && !active.some(isReviewReadyHandle);
        })
        .map((c) => displayCompanyName(c.name)),
    [selected, handlesByCompetitor],
  );
  const runNeedsProfileReview = withoutHandles.length > 0 || withoutReviewedHandles.length > 0;

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
        description: data.competitors < 3
          ? `${data.competitors} competitors imported. Add ${3 - data.competitors} more before confirming; a report cannot run with this incomplete selection.`
          : `${data.competitors} competitors, ${data.handles} handles from RivalIQ. Top ${data.preselected} pre-selected; adjust and confirm.`,
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
      toast({ title: "Competitors identified", description: data.rejected?.length
        ? `${data.rejected.length} suggestions were excluded because their websites could not be validated or were duplicates. Finding profiles for the remaining companies…`
        : "Finding social profiles automatically…" });

      // Detect handles ONE COMPETITOR PER CALL. A whole-set call scrapes up
      // to 12 third-party sites serially inside one edge request, and the
      // platform kills requests at 150s — the tail of the list never ran.
      // Driving the loop from here keeps every call small, and handles
      // appear row by row as they land.
      setDetecting(true);
      const { empty, failures } = await detectForAll(data.competitors || []);
      if (empty.length > 0) {
        toast({
          title: `${empty.length} of ${(data.competitors || []).length} still have no handles`,
          description: failures.length
            ? `Detection failed: ${failures[0]}`
            : "No profiles found on the checked company pages. Add a verified profile if one is available.",
          variant: failures.length ? "destructive" : undefined,
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

  const detectProfile = async (id: string, refresh = false) => {
    attemptedProfiles.current.add(id);
    if (profileSessionExpired.current) {
      setProfileChecks(prev => ({ ...prev, [id]: { state: "session_required" } }));
      return { id, found: 0, failed: "Reopen Socialytics from your portal to resume profile discovery." };
    }
    setProfileChecks(prev => ({ ...prev, [id]: { state: "searching" } }));
    try {
      const { data, error } = await supabase.functions.invoke("detect-competitor-handles", {
        body: { competitor_id: id, refresh },
      });
      if ((error as { context?: { status?: number } } | null)?.context?.status === 401) {
        profileSessionExpired.current = true;
        setNeedsPortalSession(true);
        setProfileChecks(prev => ({ ...prev, [id]: { state: "session_required" } }));
        return { id, found: 0, failed: "Reopen Socialytics from your portal to resume profile discovery." };
      }
      if (error || data?.error) throw new Error(await describeInvokeError(error, data));
      if (data?.write_errors?.length) throw new Error("Profiles were found but could not be saved. Please try again.");
      const result = data?.results?.[0];
      const found = result?.detected?.length || 0;
      const state = result?.status || (found ? "found" : "not_found");
      const detail = result?.warnings?.join(" ");
      setProfileChecks(prev => ({ ...prev, [id]: { state, detail } }));
      return { id, found, failed: ["failed", "partial", "missing_website"].includes(state) ? detail || "The profile lookup did not complete." : undefined };
    } catch (e: any) {
      const detail = e?.message || "The request did not complete.";
      setProfileChecks(prev => ({ ...prev, [id]: { state: "failed", detail } }));
      return { id, found: 0, failed: detail };
    } finally { refreshAll(); }
  };

  // A bounded worker pool updates each row immediately. A completed empty
  // search is not blindly repeated; the user can retry all missing profiles.
  const detectForAll = async (comps: Array<{ id: string; name?: string }>, opts: { refresh?: boolean } = {}) => {
    setProfileChecks(prev => ({ ...prev, ...Object.fromEntries(comps.map(c => [c.id, { state: "queued" }])) }));
    setDetectProgress({ done: 0, total: comps.length });
    let next = 0, done = 0;
    const results: Array<{ id: string; found: number; failed?: string }> = [];
    await Promise.all(Array.from({ length: Math.min(4, comps.length) }, async () => {
      while (next < comps.length) {
        const comp = comps[next++];
        results.push(await detectProfile(comp.id, opts.refresh));
        setDetectProgress({ done: ++done, total: comps.length });
      }
    }));
    setDetectProgress(null);
    return { empty: results.filter(r => !r.found).map(r => r.id), failures: results.flatMap(r => r.failed ? [r.failed] : []) };
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
        refreshAll();
        await detectProfile(comp.id);
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
      if (isProfileUrlInput(raw) && !fromUrl) throw new Error("Enter a social profile URL, not a post, discovery page or unrelated website.");
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
    // Marked rejected rather than deleted. A deleted row left no trace that a
    // person had judged the handle wrong, so the next handle refresh detected
    // it again and put it straight back; correcting a wrong handle only ever
    // lasted until the next refresh.
    mutationFn: async (handleId: string) => {
      const { error } = await supabase
        .from("competitor_handles")
        .update({ is_active: false, source: "rejected" })
        .eq("id", handleId);
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
        if (!free) throw new Error("Three competitors are already selected. Deselect one first.");
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
      toast({ title: "Competitor set confirmed", description: "Top 3 saved. Connect RivalIQ tracking before running analysis." });
    },
    onError: (err: any) => toast({ title: "Confirm failed", description: err.message, variant: "destructive" }),
  });

  const reopenSet = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("competitor_sets")
        .update({ status: "draft", confirmed_by: null, confirmed_at: null })
        .eq("id", currentSet!.id)
        // Never pull a set out from under a run that is going. The page's
        // idea of the status can be minutes old, and it has no realtime
        // subscription, so the guard belongs on the write.
        .neq("status", "analyzing")
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("That set is mid-analysis. Wait for the run to finish or fail, then reopen it.");
      }
    },
    onSuccess: refreshAll,
    onError: (err: any) =>
      toast({ title: "Could not reopen the set", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!canRunAnalysis || !currentSet || !competitors || !handles || handlesLoading || handlesFailed || identifying || detecting) return;
    const due = competitors.filter(c => {
      if (attemptedProfiles.current.has(c.id)) return false;
      const savedHandles = handlesByCompetitor.get(c.id) || [];
      if (savedHandles.length && savedHandles.every(h => h.source === "manual" || h.source === "rivaliq")) return false;
      const check = c.profile_detection;
      if ((check?.discovery_version || 0) < 2 && c.website_url) return true;
      if ((handlesByCompetitor.get(c.id) || []).length) return false;
      if (!check) return true;
      const age = Date.now() - Date.parse(check.checked_at || "");
      if (check.status === "unverified") return Number.isFinite(age) && age > 24 * 60 * 60 * 1000;
      return check.status === "running" ? !Number.isFinite(age) || age > 120000
        : ["failed", "partial"].includes(check.status) && (!Number.isFinite(age) || age > 15 * 60 * 1000);
    });
    if (!due.length) return;
    setDetecting(true);
    void detectForAll(due).finally(() => setDetecting(false));
  }, [canRunAnalysis, currentSet?.id, competitors, handles, handlesLoading, handlesFailed, identifying, detecting]);

  const isUnverified = (c: CompetitorRow) => !c.is_selected &&
    (profileChecks[c.id]?.state || c.profile_detection?.status) === "unverified" &&
    !(handlesByCompetitor.get(c.id) || []).some(isReviewReadyHandle);
  const unverifiedCount = (competitors || []).filter(isUnverified).length;

  if (!canRunAnalysis) return <Navigate to="/" replace />;

  // Three outcomes, not one. Gating purely on `!client` meant a client that
  // failed to load, and a client id that does not resolve, both sat on a
  // spinner that never resolved.
  if (clientLoading || setLoading) {
    return (
      <AppLayout title="Competitive Analysis"
      description="Review the proposed competitors, confirm the top three, then run the analysis.">
        <Loading label="Loading" />
      </AppLayout>
    );
  }

  if (clientFailed || !client) {
    return (
      <AppLayout title="Competitive Analysis"
      description="Review the proposed competitors, confirm the top three, then run the analysis.">
        <LoadError
          title={clientFailed ? "Could not load this client" : "That client is not available"}
          error={clientFailed ? clientError : "It may have been deleted, or your account may not have access to it."}
          onRetry={clientFailed ? () => refetchClient() : undefined}
        />
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
                        No RivalIQ landscape uniquely identifies {client?.name || "this client"} as a tracked company.
                      </p>
                      <p className="t-secondary">
                        Propose and confirm three competitors, then use Set up RivalIQ tracking on this page.
                        Confirming a selection alone does not add companies to RivalIQ.
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
        {/* Where this client is in the four steps, before any control. */}
        <CompetitiveSteps
          current={selectionState.ready ? 1 : 0}
          steps={[
            { title: "Review competitors", ...selectionState },
            { title: "Connect tracking", ...trackingState },
            {
              title: "Choose period and run",
              headline: selectionState.ready && trackingState.ready ? "Ready to run" : "Not ready yet",
              detail: selectionState.ready && trackingState.ready ? undefined : "Finish the two steps on the left first.",
              ready: false,
              href: selectionState.ready ? `/clients/${clientId}/competitive/run` : undefined,
              linkLabel: "Open the run page",
            },
            {
              title: "Open the result",
              headline: "Reports stay in history",
              ready: false,
              href: `/clients/${clientId}/competitive/reports`,
              linkLabel: "Report history",
            },
          ]}
        />

        {/* Status / primary actions */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="t-h3 flex items-center gap-2">
                  <Crosshair className="h-4 w-4" /> Step 1 · The three competitors
                </CardTitle>
                <CardDescription className="mt-1">
                  {selectionState.headline}
                  {selectionState.detail ? ` ${selectionState.detail}` : ""}
                </CardDescription>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={openImport} disabled={identifying || detecting}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Import from RivalIQ
                </Button>
                {currentSet && ["confirmed", "complete", "failed"].includes(currentSet.status) && (
                  <RivalIqSetup
                    key={currentSet.id}
                    setId={currentSet.id}
                    connected={!!currentSet.rivaliq_landscape_id}
                    onComplete={refreshAll}
                  />
                )}
                {detecting && detectProgress && (
                  <p role="status" className="t-secondary flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Finding profiles automatically · {detectProgress.done}/{detectProgress.total}
                  </p>
                )}
                <Button size="sm" onClick={identify} disabled={identifying || detecting}>
                  {identifying ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                  {currentSet ? "Re-identify (new draft)" : "Identify competitors"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {/* Tracking is its own fact: a confirmed selection is not a
                connected one, and neither says anything about a report. */}
            <p className="t-secondary">
              <span className="font-medium">RivalIQ tracking:</span> {trackingState.headline}
              {trackingState.detail ? ` ${trackingState.detail}` : ""}
            </p>
            {client.competitor_seed_notes ? (
              <p className="t-secondary">
                <span className="font-medium">Account team notes fed to the AI:</span> {client.competitor_seed_notes}
              </p>
            ) : null}
          </CardContent>
        </Card>


        {needsPortalSession && (
          <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
            <p className="font-medium">Your portal session has expired</p>
            <p className="t-secondary">Reopen Socialytics from the portal to resume automatic profile discovery. This is a sign-in issue, not a missing company profile.</p>
            <a className="inline-flex underline text-sm" href={isGosSession ? "https://moburst.ai" : "https://tools.moburst.com/dashboard"}>Open Moburst portal</a>
          </div>
        )}

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
                    // confirm-competitor-set refuses a selection where any
                    // competitor has no active handle. The button used to be
                    // enabled anyway, so the only way to learn was to press it
                    // and read a 422.
                    disabled={selected.length !== 3 || withoutHandles.length > 0 || withoutReviewedHandles.length > 0 || confirmSet.isPending}
                    className="gap-2"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Confirm top 3 {selected.length !== 3 ? `(${selected.length}/3 selected)` : ""}
                  </Button>
                )}
                {!isDraft && (
                  <>
                    <Button
                      className="gap-2"
                      onClick={() => navigate(`/clients/${clientId}/competitive/run`)}
                      disabled={runNeedsProfileReview || !trackingState.ready || currentSet?.id !== runnableSet?.id}
                    >
                      <Play className="h-4 w-4" /> Run deep analysis
                    </Button>
                    {/* Offered for every non-draft status, not just
                        'confirmed'. A run moves the set to 'analyzing' and
                        then 'complete' or 'failed', and while it sat in one
                        of those the whole page was read-only with no way
                        back: every edit control is gated on draft and this
                        was the only door. Two clients were already stranded
                        that way. */}
                    <Button variant="outline" onClick={() => reopenSet.mutate()} disabled={reopenSet.isPending}>
                      Reopen for edits
                    </Button>
                  </>
                )}
              </div>
              {isDraft && selected.length < 3 && (
                <p className="t-secondary text-amber-400/90">
                  Select {3 - selected.length} more competitor{selected.length === 1 ? "s" : ""} to enable confirmation.
                  {competitors.length < 3 ? " Add the missing company below, verify its social profiles, then select it. Tracking must include that company before the report can run." : " Choose from the candidates below."}
                </p>
              )}
              {isDraft && selected.length === 3 && withoutHandles.length > 0 && (
                <p className="t-secondary">
                  {withoutHandles.join(" and ")} {withoutHandles.length === 1 ? "has" : "have"} no social handle yet.
                  Add one on the row below, or swap in another competitor, before confirming.
                </p>
              )}
              {isDraft && selected.length === 3 && withoutReviewedHandles.length > 0 && (
                <p className="t-secondary text-amber-400/90">
                  {withoutReviewedHandles.join(" and ")} only {withoutReviewedHandles.length === 1 ? "has" : "have"} low-confidence automatic profiles.
                  Open and verify one, then remove the guess and add the verified profile manually before confirming.
                </p>
              )}
              {!isDraft && runNeedsProfileReview && (
                <p className="t-secondary text-amber-400/90">
                  Deep analysis is paused because {[
                    ...withoutHandles.map((name) => `${name} has no active profile`),
                    ...withoutReviewedHandles.map((name) => `${name} only has low-confidence automatic profiles`),
                  ].join("; ")}.
                  Reopen the set, verify or replace those profiles, and confirm it again before running a report.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Candidate list */}
        {currentSet && (competitors?.length ?? 0) > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="t-h3">Candidates</CardTitle>
              <CardDescription>
                {competitors!.length} proposed · click Select on the three you want analysed
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {unverifiedCount > 0 && <div className="rounded-lg border border-white/10 p-3 space-y-2">
                <p className="t-secondary">{unverifiedCount} suggestions could not be verified and are excluded from selection. Your confirmed competitors have not changed.</p>
                <Button variant="outline" size="sm" onClick={() => setShowUnverified(v => !v)}>{showUnverified ? "Hide unverified suggestions" : "Show unverified suggestions"}</Button>
              </div>}
              {competitors!.filter(c => showUnverified || !isUnverified(c)).map((c) => {
                const profileCheck = profileChecks[c.id] || (c.profile_detection ? { state: c.profile_detection.status === "running" ? "searching" : c.profile_detection.status, detail: c.profile_detection.detail } : undefined);
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
                          {isUnverified(c) ? <Badge variant="outline">Unverified suggestion</Badge> : typeof c.similarity_score === "number" && (
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-3">
                          {compHandles.map((h) => (
                            <div key={h.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2">
                              <a href={h.profile_url || undefined} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-start gap-2" title={`${prettyPlatformName(h.platform)} @${h.handle}`}>
                                <PlatformBadge platform={h.platform} size="sm" />
                                <span className="min-w-0 break-all text-sm leading-5">@{h.handle}</span>
                              </a>
                              {h.source === "auto" && Number(h.detection_confidence ?? 0) < 0.8 && (
                                <span className="text-xs text-amber-400 shrink-0" title="Automatically detected with limited evidence. Open the profile and verify it belongs to this company.">Verify</span>
                              )}
                              {isDraft && (
                                <button
                                  type="button"
                                  aria-label={`Remove the ${h.platform} handle @${h.handle}`}
                                  title={`Remove @${h.handle}`}
                                  onClick={() => setRemovingHandle(h)}
                                  className="shrink-0 rounded p-2 text-muted-foreground hover:text-destructive hover:bg-white/5"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                          {compHandles.length === 0 && (
                            <span className="t-label text-amber-500/80 inline-flex items-center gap-1.5">
                              {profileCheck?.state === "searching" || handlesLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                              {handlesLoading ? "Loading saved profiles…" : handlesFailed ? "Could not load saved profiles" :
                                profileCheck?.state === "session_required" ? "Waiting for portal sign-in" :
                                profileCheck?.state === "queued" ? "Profile search queued" :
                                profileCheck?.state === "searching" ? "Searching company pages…" :
                                profileCheck?.state === "failed" ? "Profile lookup failed" :
                                profileCheck?.state === "unverified" ? "Company could not be verified" :
                                profileCheck?.state === "partial" ? "Profile lookup incomplete" :
                                profileCheck?.state === "missing_website" ? "Company website needed" :
                                profileCheck?.state === "not_found" ? "No profiles found on checked pages" : "Profile lookup will start automatically"}
                            </span>
                          )}
                          {isDraft && (
                            <button
                              type="button"
                              onClick={() => setAddingHandleFor(addingHandleFor === c.id ? null : c.id)}
                              className="t-label text-muted-foreground hover:text-white inline-flex items-center gap-1 min-h-[24px]"
                            >
                              <Plus className="h-3 w-3" /> Add profile
                            </button>
                          )}
                          {compHandles.length === 0 && profileCheck?.detail && (
                            <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-3">{profileCheck.detail}</p>
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
                            disabled={toggleSelect.isPending || (!c.is_selected && profileCheck?.state === "unverified" && !compHandles.some(isReviewReadyHandle))}
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
        ) : competitorsFailed ? (
          <LoadError title="Could not load the competitors" error={competitorsError} onRetry={() => refetchCompetitors()} />
        ) : currentSet && competitorsLoading ? (
          // A set exists and its competitors are still arriving. Saying "no
          // competitor set yet" here told people to start over on a set that
          // was about to appear.
          <Loading label="Loading competitors" />
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
        open={!!removingHandle}
        onOpenChange={open => !open && setRemovingHandle(null)}
        title={`Remove @${removingHandle?.handle || "profile"}?`}
        description={<p>This profile will stop being used for this competitor. Automatic detection will not add it back.</p>}
        confirmLabel="Remove profile"
        onConfirm={() => { if (removingHandle) removeHandle.mutate(removingHandle.id); setRemovingHandle(null); }}
      />
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
