// Competitor identification + review (project steps 3-6).
//
// Staff-only workspace for one client's competitor set. The client lifecycle
// picks and confirms a set on its own (the three closest competitors with a
// website) and connects RivalIQ tracking for it; a person may change it at
// any time:
//   - "Re-identify" runs the AI proposal into a new draft, then profile lookup.
//   - The draft list supports deselect/select, manual add, remove, and
//     ranking the top 3.
//   - "Confirm top 3" confirms three ranked competitors (confirm-competitor-set,
//     the same rule the lifecycle confirms by), and tracking follows on its own.
//
// Every change a person makes is sent again quietly when it does not get
// through (src/lib/quietSend.ts); the page then shows what the database has,
// never a failure. The page works on the client's NEWEST set; re-running
// identification creates a fresh draft and leaves history behind.

import { useEffect, useMemo, useRef, useState } from "react";
import { CompetitiveSteps } from "@/components/competitive/CompetitiveSteps";
import { describeSelection, describeTracking, pickRunSelection, stateLine, type SetRow } from "@/lib/competitiveFlow";
import { invokeResendable, sendQuietly, writeResendable } from "@/lib/quietSend";

import { classifyProfileUrl, isProfileUrlInput } from "@/lib/profileUrl";
import { isReviewReadyHandle } from "../../supabase/functions/_shared/competitive/extractSocialHandles";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/telemetry";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loading } from "@/components/ui/loading";
import { LoadRetry } from "@/components/ui/load-error";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/hooks/use-toast";
import { PlatformBadge, prettyPlatformName } from "@/lib/platform-config";
import { profileName } from "@/lib/display";
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

/**
 * A profile search that has said nothing for this long has stopped. The
 * server stamps checked_at when a search starts, so a row still saying
 * "running" after this is not going to change on its own: the page stops
 * polling for it and says so, rather than showing a spinner for ever.
 */
const PROFILE_CHECK_STALE_MS = 3 * 60000;
const liveProfileCheck = (c: { profile_detection?: CompetitorRow["profile_detection"] }, now = Date.now()) =>
  c.profile_detection?.status === "running" && now - Date.parse(c.profile_detection.checked_at || "") < PROFILE_CHECK_STALE_MS;

function readProfileCheck(value: unknown): CompetitorRow["profile_detection"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.status !== "string") return null;
  return { status: record.status,
    discovery_version: typeof record.discovery_version === "number" ? record.discovery_version : undefined,
    detail: typeof record.detail === "string" ? record.detail : undefined,
    checked_at: typeof record.checked_at === "string" ? record.checked_at : undefined };
}

/** A typed handle or a pasted profile address, read; null when it is not a profile (a post, a page, another site). */
function readTypedHandle(raw: string, platform: string) {
  const text = raw.trim();
  if (!text) return null;
  // A pasted profile URL is read for its handle; anything else is taken as the handle itself.
  const fromUrl = classifyProfileUrl(text);
  if (isProfileUrlInput(text) && !fromUrl) return null;
  const handle = (fromUrl?.handle || text).replace(/^@/, "").trim();
  return handle ? { platform: fromUrl?.platform || platform, handle, fromUrl } : null;
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
  /** The profile's own name (a channel or page title), when known. */
  display_name?: string | null;
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
          <p className="t-secondary mt-1">
            {rivals.length} of the three competitors a selection holds.
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
        {importingId === landscape.id ? <Loader2 className="animate-spin" /> : <Download />}
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
  const [landscapesUnavailable, setLandscapesUnavailable] = useState(false);
  /** A person's change that has not reached the database yet; the page keeps their input. */
  const [notSaved, setNotSaved] = useState<string | null>(null);
  const [showOtherLandscapes, setShowOtherLandscapes] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  // Proposing competitors spends AI and web lookups, so it is asked first.
  const [confirmIdentify, setConfirmIdentify] = useState(false);
  // Listing and importing landscapes each spend a RivalIQ request, so both are asked first.
  const [confirmList, setConfirmList] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ id: string; name: string } | null>(null);

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
  const { data: sets, isLoading: setLoading, isError: setsFailed, error: setsError, refetch: refetchSets } = useQuery({
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
  // The steps say what a report would use: the confirmed selection, which is
  // not the set on screen while a newer draft waits for review.
  const trackingState = describeTracking(runnableSet ?? currentSet);
  const viewingDraftBesideRun = !!runnableSet && currentSet?.status === "draft";


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
    refetchInterval: query => (query.state.data || []).some(c => liveProfileCheck(c)) ? 5000 : false,
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
    setLandscapesUnavailable(false);
    // A read: sent again quietly whenever it did not come back.
    const { data, error } = await sendQuietly(() => supabase.functions.invoke("import-rivaliq-landscape", {
      body: { client_id: clientId, mode: "list" },
    }), { again: (e) => invokeResendable(e, { idempotent: true }) });
    if (error || data?.error) {
      setLandscapesUnavailable(true);
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
    setNotSaved(null);
    // Each import makes a new draft, so it is sent again only when it never reached the server.
    const { data, error } = await sendQuietly(() => supabase.functions.invoke("import-rivaliq-landscape", {
      body: { client_id: clientId, mode: "import", landscape_id: landscapeId },
    }));
    setImportingId(null);
    refreshAll();
    if (error || data?.error) {
      setNotSaved("That landscape has not been imported yet.");
      return;
    }
    toast({
      title: "Imported as a new draft",
      description: `${data.competitors} competitors and ${data.handles} profiles from RivalIQ, with the top ${data.preselected} selected.`,
    });
    setImportOpen(false);
  };

  const identify = async () => {
    setIdentifying(true);
    track("competitor_identification_started", { client_id: clientId });
    setNotSaved(null);
    try {
      // Each run makes a new draft, so it is sent again only when it never reached the server.
      const { data, error } = await sendQuietly(() => supabase.functions.invoke("identify-competitors", {
        body: { client_id: clientId },
      }));
      if (error || data?.error) {
        track("competitor_identification_failed", { client_id: clientId, ok: false, error_code: "not_taken" });
        setNotSaved("No new proposal yet.");
        return;
      }
      track("competitor_identification_completed", {
        client_id: clientId, entity_id: data.set_id, ok: true,
        props: { proposed: data.competitors?.length },
      });
      refreshAll();

      // Detect handles ONE COMPETITOR PER CALL. A whole-set call scrapes up
      // to 12 third-party sites serially inside one edge request, and the
      // platform kills requests at 150s — the tail of the list never ran.
      // Driving the loop from here keeps every call small, and handles
      // appear row by row as they land.
      setDetecting(true);
      await detectForAll(data.competitors || []);
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
      const { data, error } = await sendQuietly(() => supabase.functions.invoke("detect-competitor-handles", {
        body: { competitor_id: id, refresh },
      }), { again: (e) => invokeResendable(e, { idempotent: true }) });
      if ((error as { context?: { status?: number } } | null)?.context?.status === 401) {
        profileSessionExpired.current = true;
        setNeedsPortalSession(true);
        setProfileChecks(prev => ({ ...prev, [id]: { state: "session_required" } }));
        return { id, found: 0, failed: "Reopen Socialytics from your portal to resume profile discovery." };
      }
      if (error || data?.error || data?.write_errors?.length) throw new Error("The profile lookup did not finish.");
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
      if (!manualName.trim()) return;
      setNotSaved(null);
      let setId = currentSet?.id;
      // Adding a competitor with no set yet creates a draft set to hold it.
      if (!setId) {
        const { data: newSet, error: setErr } = await sendQuietly(() => supabase
          .from("competitor_sets")
          .insert({ client_id: clientId! })
          .select("id")
          .single(), { again: writeResendable });
        if (setErr) throw setErr;
        setId = newSet.id;
      }
      const { data: comp, error } = await sendQuietly(() => supabase
        .from("competitors")
        .insert({
          set_id: setId,
          client_id: clientId!,
          name: manualName.trim(),
          website_url: manualUrl.trim() || null,
          source: "manual",
        })
        .select("id")
        .single(), { again: writeResendable });
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
    // The name and website stay in the form.
    onError: () => { refreshAll(); setNotSaved("Not added yet."); },
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
      const typed = readTypedHandle(newHandle, newHandlePlatform);
      if (!typed) return;
      const { platform, handle, fromUrl } = typed;
      setNotSaved(null);
      const { error } = await sendQuietly(() => supabase.from("competitor_handles").upsert(
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
      ), { again: writeResendable });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewHandle("");
      setAddingHandleFor(null);
      refreshAll();
      toast({ title: "Profile saved", description: "Automatic lookups leave it as it is." });
    },
    // What was typed stays in the field.
    onError: () => setNotSaved("That profile is not saved yet."),
  });

  const removeHandle = useMutation({
    // Marked rejected rather than deleted. A deleted row left no trace that a
    // person had judged the handle wrong, so the next handle refresh detected
    // it again and put it straight back; correcting a wrong handle only ever
    // lasted until the next refresh.
    mutationFn: async (handleId: string) => {
      const { error } = await sendQuietly(() => supabase
        .from("competitor_handles")
        .update({ is_active: false, source: "rejected" })
        .eq("id", handleId), { again: writeResendable });
      if (error) throw error;
    },
    // Either way the list shows what the database has.
    onSettled: () => refreshAll(),
  });

  const removeCompetitor = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sendQuietly(() => supabase.from("competitors").delete().eq("id", id), { again: writeResendable });
      if (error) throw error;
    },
    onSettled: refreshAll,
  });

  /**
   * Toggle selection. Selecting assigns the lowest free rank (1-3); at 3
   * already selected the click is refused. Deselecting frees its rank.
   */
  const toggleSelect = useMutation({
    mutationFn: async (row: CompetitorRow) => {
      if (row.is_selected) {
        const { error } = await sendQuietly(() => supabase
          .from("competitors")
          .update({ is_selected: false, selected_rank: null })
          .eq("id", row.id), { again: writeResendable });
        if (error) throw error;
      } else {
        const used = new Set(selected.map((s) => s.selected_rank));
        const free = [1, 2, 3].find((r) => !used.has(r));
        // Select is not offered with three selected.
        if (!free) return;
        const { error } = await sendQuietly(() => supabase
          .from("competitors")
          .update({ is_selected: true, selected_rank: free })
          .eq("id", row.id), { again: writeResendable });
        if (error) throw error;
      }
    },
    onSettled: refreshAll,
  });

  const confirmSet = useMutation({
    mutationFn: async () => {
      // Confirming a draft twice confirms it once (it is guarded on 'draft').
      const { data, error } = await sendQuietly(() => supabase.functions.invoke("confirm-competitor-set", {
        body: { set_id: currentSet!.id },
      }), { again: (e) => invokeResendable(e, { idempotent: true }) });
      if (error || data?.error) throw new Error("not confirmed");
    },
    onSuccess: () => {
      track("competitor_set_confirmed", { client_id: clientId, entity_id: currentSet?.id, ok: true });
      toast({ title: "Competitors confirmed", description: "Tracking for these three is connected automatically." });
    },
    // The page shows the set as the database has it: still a draft, or confirmed.
    onSettled: refreshAll,
  });

  const reopenSet = useMutation({
    mutationFn: async () => {
      const { error } = await sendQuietly(() => supabase
        .from("competitor_sets")
        .update({ status: "draft", confirmed_by: null, confirmed_at: null })
        .eq("id", currentSet!.id)
        // Never pull a set out from under a run that is going. The page's
        // idea of the status can be minutes old, and it has no realtime
        // subscription, so the guard belongs on the write.
        .neq("status", "analyzing")
        .select("id"), { again: writeResendable });
      if (error) throw error;
    },
    onSettled: refreshAll,
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
      <AppLayout title="Competitors" description="The three closest competitors, chosen automatically. Change them any time.">
        <Loading label="Loading" />
      </AppLayout>
    );
  }

  if (clientFailed || !client) {
    return (
      <AppLayout title="Competitors" description="The three closest competitors, chosen automatically. Change them any time.">
        {clientFailed
          ? <LoadRetry context="client" error={clientError} label="Loading the client" onRetry={() => refetchClient()} />
          : <EmptyState title="That client is not available" description="It may have been deleted, or your account may not have access to it." />}
      </AppLayout>
    );
  }

  // Not "no competitor set yet": that state offers to start a new draft,
  // and starting one on top of a set that merely failed to load duplicates it.
  if (setsFailed) {
    return (
      <AppLayout title={`Competitors: ${client.name}`} description="The three closest competitors, chosen automatically. Change them any time.">
        <LoadRetry context="Could not load the competitor selection" error={setsError} onRetry={() => refetchSets()} />
      </AppLayout>
    );
  }

  return (
    <AppLayout title={`Competitors: ${client.name}`} description="The three closest competitors, chosen automatically. Change them any time.">
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
            {landscapesUnavailable ? (
              <p className="t-secondary">The RivalIQ landscapes are not available right now.</p>
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
                        <LandscapeRow key={l.id} landscape={l} importingId={importingId} onImport={() => setPendingImport(l)} />
                      ))}
                    </>
                  ) : (
                    <div className="glass-inner p-4 space-y-3">
                      <p className="t-body text-white">
                        No RivalIQ landscape tracks {client?.name || "this client"} as its own company.
                      </p>
                      <p className="t-secondary">
                        Tracking for the confirmed competitors is connected automatically.
                      </p>
                      <Button
                        size="sm"
                        onClick={() => {
                          setImportOpen(false);
                          setConfirmIdentify(true);
                        }}
                        disabled={identifying}
                      >
                        <Search /> Propose competitors instead
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
                              <LandscapeRow key={l.id} landscape={l} importingId={importingId} onImport={() => setPendingImport(l)} />
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
            { title: "Competitors", ...selectionState },
            // Connected by the lifecycle on its own; says when, or nothing while it is being connected.
            { title: "Tracking", ...trackingState },
            {
              title: "Analysis",
              // A run waits for tracking on its own while the lifecycle connects it.
              headline: selectionState.ready ? "Ready to run" : "",
              ready: false,
              href: selectionState.ready ? `/clients/${clientId}/competitive/run` : undefined,
              linkLabel: "Open the run page",
            },
            {
              title: "Results",
              headline: "Reports stay in history",
              ready: false,
              href: `/clients/${clientId}/competitive/reports`,
              linkLabel: "Report history",
            },
          ]}
        />

        {/* Step 1 as one panel: the step's heading, its state and its two
            actions on the left, the three chosen competitors and what to do
            with them on the right. It was a card holding only a heading and
            a few short lines, with the buttons at the far right of 1,400px of
            glass, and the chosen three in a second card below it. */}
        <Section
          layout="split"
          eyebrow="Step 1"
          title={<><Crosshair className="h-4 w-4 text-[#b9e045]" aria-hidden /> The three competitors</>}
          description={stateLine(selectionState)}
          meta={
            <>
              {/* Tracking is its own fact: a confirmed selection is not a
                  connected one, and neither says anything about a report. */}
              {viewingDraftBesideRun ? (
                <p>
                  <span className="font-medium text-white">RivalIQ tracking:</span> Reports use the confirmed selection
                  {trackingState.headline ? ` (${trackingState.headline.toLowerCase()})` : ""}.
                  {" "}This draft is tracked once it is confirmed.
                </p>
              ) : trackingState.headline && (
                <p>
                  <span className="font-medium text-white">RivalIQ tracking:</span> {stateLine(trackingState)}
                </p>
              )}
              {notSaved && <p role="status">{notSaved}</p>}
              {client.competitor_seed_notes ? (
                <p>
                  <span className="font-medium text-white">Account team notes fed to the AI:</span> {client.competitor_seed_notes}
                </p>
              ) : null}
            </>
          }
          action={
            <>
              <Button size="sm" onClick={() => setConfirmIdentify(true)} disabled={identifying || detecting}>
                {identifying ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {currentSet ? "Re-identify (new draft)" : "Identify competitors"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmList(true)} disabled={identifying || detecting}>
                <Download /> Import from RivalIQ
              </Button>
            </>
          }
        >
          {detecting && detectProgress && (
            <p role="status" className="t-secondary flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Finding profiles automatically · {detectProgress.done}/{detectProgress.total}
            </p>
          )}
          <p className="t-subhead flex items-center gap-2">
            <Trophy className="h-3.5 w-3.5 text-[#b9e045]" aria-hidden /> Top 3 for deep analysis
          </p>
          {/* Three slots, always: an open slot says so, so the row never
              leaves a hole and the rule (three, ranked) is visible. */}
          <ol className="grid gap-inner md:grid-cols-3">
            {[0, 1, 2].map((slot) => {
              const c = selected[slot];
              if (!c) {
                return (
                  <li key={`open-${slot}`} className="rounded-[12px] border border-dashed border-white/10 p-inner flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="shrink-0">#{slot + 1}</Badge>
                    <span className="t-secondary">{isDraft ? "Open slot" : "Not selected"}</span>
                  </li>
                );
              }
              const platforms = (handlesByCompetitor.get(c.id) || []).filter((h) => h.is_active);
              return (
                <li key={c.id} className="glass-inner is-selected p-inner space-y-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge className="shrink-0">#{c.selected_rank}</Badge>
                    <span className="t-h4 truncate" title={c.name}>{displayCompanyName(c.name)}</span>
                  </div>
                  {platforms.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {platforms.map((h) => (
                        <PlatformBadge key={h.id} platform={h.platform} size="sm" />
                      ))}
                    </div>
                  ) : (
                    <p className="t-label">No profiles yet</p>
                  )}
                </li>
              );
            })}
          </ol>
          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {isDraft && (
                <Button
                  onClick={() => confirmSet.mutate()}
                  // Three ranked competitors are the whole rule (the lifecycle's own); RivalIQ tracks them by website.
                  disabled={selected.length !== 3 || confirmSet.isPending}
                >
                  <ShieldCheck />
                  Confirm top 3 {selected.length !== 3 ? `(${selected.length}/3 selected)` : ""}
                </Button>
              )}
              {!isDraft && (
                <>
                  <Button
                    onClick={() => navigate(`/clients/${clientId}/competitive/run`)}
                    disabled={currentSet?.id !== runnableSet?.id}
                  >
                    <Play /> Run deep analysis
                  </Button>
                  {/* Offered for every non-draft status, not just
                      'confirmed'. A run moves the set to 'analyzing' and
                      then 'complete' or 'failed', and while it sat in one
                      of those the whole page was read-only with no way
                      back: every edit control is gated on draft and this
                      was the only door. Two clients were already stranded
                      that way. */}
                  <Button variant="outline" onClick={() => reopenSet.mutate()} disabled={reopenSet.isPending || currentSet?.status === "analyzing"}>
                    Reopen for edits
                  </Button>
                </>
              )}
              {currentSet?.status === "analyzing" && (
                <p className="t-secondary">A report is running on this selection.</p>
              )}
            </div>
          )}
        </Section>

        {needsPortalSession && (
          <Card role="status">
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="t-secondary">Profile lookups continue once you are signed in again from the Moburst portal.</p>
              <Button asChild variant="outline" size="sm">
                <a href={isGosSession ? "https://moburst.ai" : "https://tools.moburst.com/dashboard"}>Open Moburst portal</a>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Candidate list */}
        {currentSet && (competitors?.length ?? 0) > 0 ? (
          <Section
            layout="split"
            eyebrow="Candidates"
            title={`${competitors!.length} proposed`}
            description={isDraft ? "The first three selected, in the order selected, are the ones analyzed." : "The confirmed selection, locked until it is reopened."}
            meta={unverifiedCount > 0 ? (
              <p>{unverifiedCount} suggestions could not be verified and are excluded from selection. Your confirmed competitors have not changed.</p>
            ) : undefined}
            action={unverifiedCount > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setShowUnverified(v => !v)}>{showUnverified ? "Hide unverified suggestions" : "Show unverified suggestions"}</Button>
            ) : undefined}
          >
              {competitors!.filter(c => showUnverified || !isUnverified(c)).map((c) => {
                const profileCheck = profileChecks[c.id] || (c.profile_detection ? { state: c.profile_detection.status === "running" ? (liveProfileCheck(c) ? "searching" : "stalled") : c.profile_detection.status, detail: c.profile_detection.detail } : undefined);
                const compHandles = (handlesByCompetitor.get(c.id) || []).filter((h) => h.is_active);
                return (
                  <div
                    key={c.id}
                    className={cn("glass-inner p-inner", c.is_selected && "is-selected")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="t-h4" title={c.name}>{displayCompanyName(c.name)}</span>
                          {c.source === "manual" && <Badge variant="outline">Added by hand</Badge>}
                          {isUnverified(c) ? <Badge variant="outline">Unverified suggestion</Badge> : typeof c.similarity_score === "number" && (
                            <Badge variant="secondary">{Math.round(c.similarity_score * 100)}% match</Badge>
                          )}
                        </div>
                        {c.website_url && (
                          <a
                            href={c.website_url}
                            target="_blank"
                            rel="noreferrer"
                            className="t-label hover:text-white underline-offset-2 hover:underline inline-flex items-center min-h-[24px]"
                          >
                            {c.website_url.replace(/^https?:\/\/(www\.)?/, "")}
                          </a>
                        )}
                        {c.rationale && <p className="t-secondary mt-1">{c.rationale}</p>}
                      </div>
                      {isDraft && (
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant={c.is_selected ? "default" : "outline"}
                            onClick={() => toggleSelect.mutate(c)}
                            disabled={toggleSelect.isPending || (!c.is_selected && (selected.length >= 3 || (profileCheck?.state === "unverified" && !compHandles.some(isReviewReadyHandle))))}
                          >
                            {c.is_selected ? `#${c.selected_rank}` : "Select"}
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-[#b1b7c1] hover:text-destructive"
                            aria-label={`Remove ${displayCompanyName(c.name)}`}
                            onClick={() => setRemoving({ id: c.id, name: displayCompanyName(c.name) })}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-3">
                      {compHandles.map((h) => (
                        <div key={h.id} className="glass-inner flex min-w-0 items-center gap-2 pl-3 pr-1 py-1">
                          <a href={h.profile_url || undefined} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-2 py-1" title={`${prettyPlatformName(h.platform)}: ${profileName(h, c.name)}`}>
                            <PlatformBadge platform={h.platform} size="sm" />
                            <span className="min-w-0 break-words t-label !text-white">{profileName(h, c.name)}</span>
                          </a>
                          {isDraft && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remove the ${prettyPlatformName(h.platform)} profile ${profileName(h, c.name)}`}
                              title={`Remove ${profileName(h, c.name)}`}
                              onClick={() => setRemovingHandle(h)}
                              className="shrink-0 border-0 bg-transparent text-[#b1b7c1] hover:text-destructive"
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      ))}
                      {compHandles.length === 0 && (
                        <span className="t-label inline-flex items-center gap-1.5">
                          {profileCheck?.state === "searching" || handlesLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                          {handlesLoading || handlesFailed ? "Loading saved profiles…" :
                            profileCheck?.state === "session_required" ? "Waiting for portal sign-in" :
                            profileCheck?.state === "queued" ? "Profile search queued" :
                            profileCheck?.state === "searching" ? "Searching company pages…" :
                            ["stalled", "failed", "partial"].includes(profileCheck?.state || "") ? "Profiles are looked up again later" :
                            profileCheck?.state === "unverified" ? "Company could not be verified" :
                            profileCheck?.state === "missing_website" ? "No website on file for this company" :
                            profileCheck?.state === "not_found" ? "No profiles found on checked pages" : "Profile lookup will start automatically"}
                        </span>
                      )}
                      {isDraft && (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          onClick={() => setAddingHandleFor(addingHandleFor === c.id ? null : c.id)}
                          className="justify-start px-0 h-auto min-h-[24px] t-label"
                        >
                          <Plus /> Add profile
                        </Button>
                      )}
                    </div>
                    {addingHandleFor === c.id && isDraft && (
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <select
                          aria-label="Platform"
                          value={newHandlePlatform}
                          onChange={(e) => setNewHandlePlatform(e.target.value)}
                          className="input-glass rounded-xl h-9 px-3 t-label !text-white"
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
                          className="h-9 w-full sm:w-64"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addHandle.mutate({ competitorId: c.id });
                            }
                          }}
                        />
                        <Button size="sm" onClick={() => addHandle.mutate({ competitorId: c.id })} disabled={addHandle.isPending || !readTypedHandle(newHandle, newHandlePlatform)}>
                          Save profile
                        </Button>
                        {newHandle.trim() && !readTypedHandle(newHandle, newHandlePlatform) && (
                          <p className="t-secondary w-full">That address is a post or a page, not a profile.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </Section>
        ) : competitorsFailed ? (
          <LoadRetry context="Could not load the competitors" error={competitorsError} onRetry={() => refetchCompetitors()} />
        ) : currentSet && competitorsLoading ? (
          // A set exists and its competitors are still arriving. Saying "no
          // competitor set yet" here told people to start over on a set that
          // was about to appear.
          <Loading label="Loading competitors" />
        ) : (
          !identifying && (
            <EmptyState
              icon={Crosshair}
              title="No competitors yet"
              description="They are chosen automatically from the client's website."
            />
          )
        )}

        {/* Manual add */}
        {(isDraft || !currentSet) && (
          <Section
            layout="split"
            eyebrow="Add"
            title="A competitor by hand"
            description="For a company the proposals missed. Its website is used to find its social profiles."
          >
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <div className="space-y-1.5">
                <Label htmlFor="manual-competitor-name">Name</Label>
                <Input id="manual-competitor-name" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Competitor name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-competitor-url">Website (optional)</Label>
                <Input id="manual-competitor-url" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://…" />
              </div>
              <Button
                onClick={() => addManual.mutate()}
                disabled={!manualName.trim() || addManual.isPending}
              >
                {addManual.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                Add
              </Button>
            </div>
          </Section>
        )}
      <ConfirmDialog
        open={confirmList}
        onOpenChange={setConfirmList}
        title="Read the RivalIQ landscapes?"
        description={
          <p>
            This reads the agency's RivalIQ landscapes, which uses one request from the account's hourly allowance, and
            lists the ones that track {client.name}. Nothing is imported until you choose one.
          </p>
        }
        confirmLabel="Show landscapes"
        destructive={false}
        onConfirm={() => {
          setConfirmList(false);
          void openImport();
        }}
      />
      <ConfirmDialog
        open={!!pendingImport}
        onOpenChange={(o) => !o && setPendingImport(null)}
        title={`Import ${pendingImport?.name || "this landscape"}?`}
        description={
          <>
            <p>
              This reads RivalIQ once more (one request) and creates a new draft for {client.name} with the landscape's
              competitors and their tracked profiles, with the top three pre-selected for you to adjust.
            </p>
            <p>Nothing is changed in RivalIQ. The confirmed selection, its tracking and past reports stay as they are.</p>
          </>
        }
        confirmLabel="Import as a draft"
        destructive={false}
        onConfirm={() => {
          const id = pendingImport?.id;
          setPendingImport(null);
          if (id) void importLandscape(id);
        }}
      />
      <ConfirmDialog
        open={confirmIdentify}
        onOpenChange={setConfirmIdentify}
        title={currentSet ? "Propose a new set of competitors?" : "Propose competitors?"}
        description={
          <>
            <p>
              This asks the AI to propose 8 to 12 likely competitors for {client.name} from the client profile, checks each
              website, then searches those websites for social profiles. Each run uses AI and web lookups.
            </p>
            {currentSet && <p>The proposals go into a new draft. The confirmed selection, its tracking and past reports stay as they are.</p>}
          </>
        }
        confirmLabel="Propose competitors"
        destructive={false}
        onConfirm={() => {
          setConfirmIdentify(false);
          void identify();
        }}
      />
      <ConfirmDialog
        open={!!removingHandle}
        onOpenChange={open => !open && setRemovingHandle(null)}
        title={removingHandle ? `Remove this ${prettyPlatformName(removingHandle.platform)} profile?` : "Remove this profile?"}
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
