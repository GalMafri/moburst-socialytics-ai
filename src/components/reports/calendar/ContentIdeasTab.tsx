import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import { CalendarFilters, type CalendarFilterState } from "./CalendarFilters";
import { effectiveFilters } from "./effectiveFilters";
import { CalendarKanban, findLatestSelectedIteration, visibleBoard } from "./CalendarKanban";
import { LoadRetry } from "@/components/ui/load-error";
import { Loading } from "@/components/ui/loading";
import { PostPanel } from "./PostPanel";
import { WeeklyHighlights } from "./WeeklyHighlights";
import { NewPostDialog } from "@/components/calendar/NewPostDialog";
import { DesignRequestsProvider } from "./DesignRequestsContext";
import { DesignRequestsDock } from "./DesignRequestsDock";
import type { ClientContext } from "@/lib/clientContext";
import type { ReportTrends } from "@/lib/reportFigures";
import { applyCopyRevisions, calendarWithRevisions, iterationMatchesPost } from "@/lib/calendarRevision";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  contentCalendar: any[];
  aiAnalysis: any;
  sproutPerformance: any;
  clientContext?: ClientContext;
  clientId?: string;
  reportId?: string;
  clientTimezone?: string;
  availablePlatforms: string[];
  availableLanguages: string[];
  /** "calendar": the Calendar tab's week board, which has its own New post and no report highlights. */
  mode?: "report" | "calendar";
  /** A post to open as soon as the board has it (arriving from the all-clients calendar). */
  openPostKey?: string;
  /** The tab that post opens on ("design" when arriving from a design progress card). */
  openPostTab?: string;
  /** A progress card's post that is not on this board (another week): the page takes the person to it. */
  onOpenElsewhere?: (calendarPostKey: string) => void;
  /** Shown in place of the board for a week with no posts; design progress stays on screen around it. */
  empty?: ReactNode;
  /** Which trends the report shows, for its highlights (reportTrends). */
  trends?: ReportTrends;
}

export function ContentIdeasTab({
  contentCalendar,
  aiAnalysis,
  sproutPerformance,
  clientContext,
  clientId,
  reportId,
  clientTimezone,
  availablePlatforms,
  availableLanguages,
  mode = "report",
  openPostKey,
  openPostTab,
  onOpenElsewhere,
  empty,
  trends,
}: Props) {
  const [chosenFilters, setFilters] = useState<CalendarFilterState>({
    day: "all",
    platform: "all",
    status: "all",
    language: "all",
  });
  const filters = useMemo(() => effectiveFilters(chosenFilters, availablePlatforms), [chosenFilters, availablePlatforms]);
  const [activePost, setActivePost] = useState<any | null>(null);
  /** The tab the panel opens on; "design" when arriving from a design progress card. */
  const [panelTab, setPanelTab] = useState<string | undefined>(undefined);
  const qc = useQueryClient();
  const { isMoburstStaff } = useAuth();

  const { data: postIterations = [], isLoading: iterationsLoading, isError: iterationsFailed, refetch: reloadIterations } = useQuery({
    queryKey: ["post-iterations", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      // Rejected and archived designs stay in the table (the learnings point
      // at them) but leave the board.
      const { data, error } = await (supabase.from("post_iterations") as any)
        .select("*")
        .eq("client_id", clientId)
        .is("rejected_at", null)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      // Swallowing this made a failed read indistinguishable from a client who
      // has generated nothing, and react-query reported success either way, so
      // no error state downstream could ever have caught it.
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });

  const {
    data: scheduledPosts = [],
    isLoading: scheduledPostsLoading,
    isError: scheduledPostsFailed,
    error: scheduledPostsError,
    refetch: reloadScheduledPosts,
  } = useQuery({
    queryKey: ["scheduled-posts", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from("scheduled_posts")
        .select("id, client_id, report_id, platform, post_content, status, scheduled_time, calendar_post_key, sprout_post_id, created_at")
        .eq("client_id", clientId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });

  // The flip is worked out once from the stored row; the read and the write
  // each repeat safely, so either one that does not get through is sent
  // again quietly. The board is read again either way, so the chip shows the
  // approval as it is stored.
  const toggleApproved = useMutation({
    mutationFn: async (iterationId: string) => {
      if (!clientId) return;
      // Read current state
      const { data: current, error: readErr } = await sendQuietly(() => supabase
        .from("post_iterations")
        .select("variant_group_id, is_approved")
        .eq("id", iterationId)
        .maybeSingle(), { again: writeResendable });
      if (readErr) throw readErr;
      if (!current) throw new Error(`post_iterations ${iterationId} is no longer on the board`);

      const variantGroupId = (current as any).variant_group_id;
      const newApproved = !((current as any).is_approved);
      // Column defaults only apply on insert, so record the approver here.
      const { data: auth } = await supabase.auth.getUser();
      const update: any = {
        is_approved: newApproved,
        approved_at: newApproved ? new Date().toISOString() : null,
        approved_by: newApproved ? auth?.user?.id ?? null : null,
      };

      // Apply to entire variant group if it exists; otherwise to the single row.
      // Both writes have to be checked: unchecked, a refused update still
      // resolved, the board refetched the unchanged row, and the chip flipped
      // back with nothing said to the person who clicked it.
      const { error: writeErr } = await sendQuietly(() => variantGroupId
        ? supabase.from("post_iterations").update(update).eq("variant_group_id", variantGroupId)
        : supabase.from("post_iterations").update(update).eq("id", iterationId), { again: writeResendable });
      if (writeErr) throw writeErr;
    },
    onError: (err: any) => console.warn("[approval] not changed yet", err),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["post-iterations", clientId] });
    },
  });

  const revisedCalendar = useMemo(() => calendarWithRevisions(contentCalendar, reportId, postIterations), [contentCalendar, reportId, postIterations]);
  // What the filters leave on the board, counted the way the board draws it, once the board can be drawn.
  const boardLoaded = !iterationsLoading && !scheduledPostsLoading && !iterationsFailed && !scheduledPostsFailed;
  const counts = useMemo(
    () => (boardLoaded ? visibleBoard(revisedCalendar, postIterations, scheduledPosts, filters) : null),
    [boardLoaded, revisedCalendar, postIterations, scheduledPosts, filters],
  );
  const currentPost = activePost ? applyCopyRevisions(activePost, postIterations) : null;
  const activeIteration = currentPost
    ? findLatestSelectedIteration(postIterations as any, currentPost)
    : null;

  // Force a fresh fetch when the panel opens for a new post, so rows just
  // inserted by a parallel variant generation are there: "View designs" would
  // otherwise open an empty tab for a few seconds.
  useEffect(() => {
    if (activePost && clientId) {
      qc.invalidateQueries({ queryKey: ["post-iterations", clientId] });
    }
    // We intentionally don't depend on the whole post object — just identity
    // markers so we refetch when the active post truly changes.
  }, [activePost?.platform, activePost?.copy, activePost?.caption_angle, clientId, qc]);

  // All iterations matching the active post by platform and copy, so every
  // variant ever generated for the post shows.
  const activePostIterations = activePost
    ? (postIterations as any[]).filter(
        (it) =>
          iterationMatchesPost(it, currentPost!) &&
          it.media_urls &&
          it.media_urls.length > 0,
      )
    : [];

  // Arriving with a post to open: open it once, when the board has it.
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openPostKey || openedRef.current === openPostKey || iterationsLoading) return;
    const post = (revisedCalendar as any[]).flatMap((d: any) => (Array.isArray(d?.posts) ? d.posts : [])).find((p: any) => p?._calendarPostKey === openPostKey);
    if (!post) return;
    openedRef.current = openPostKey;
    setActivePost(post);
    setPanelTab(openPostTab);
  }, [openPostKey, openPostTab, revisedCalendar, iterationsLoading]);

  // A design progress card names its post by key; find that post on the board.
  const openDesignsFor = useCallback((postKey: string) => {
    const post = (revisedCalendar as any[]).flatMap((d: any) => (Array.isArray(d?.posts) ? d.posts : [d])).find((p: any) => p?._calendarPostKey === postKey);
    // A post in another week: the page goes to its week and opens it there.
    if (!post) return onOpenElsewhere?.(postKey);
    setActivePost(post);
    setPanelTab("design");
  }, [revisedCalendar, onOpenElsewhere]);

  return (
    <DesignRequestsProvider clientId={clientId} onOpenPost={openDesignsFor}>
      <div className="space-y-section">
        {/* A post added here goes to the Calendar, where every post now lives. */}
        {mode === "report" && isMoburstStaff && availablePlatforms.length > 0 && clientId && (
          <div className="flex justify-end">
            <NewPostDialog
              clientId={clientId}
              platforms={availablePlatforms}
              defaultDate={new Date().toISOString().slice(0, 10)}
              reportId={reportId}
            />
          </div>
        )}

        {mode === "report" && (
          <div id="ideas-week" className="scroll-mt-[156px]">
            <WeeklyHighlights
              aiAnalysis={aiAnalysis}
              sproutMonthSummary={sproutPerformance?.month_comparison?.summary || null}
              trends={trends}
            />
          </div>
        )}

        {empty ?? <>
        <CalendarFilters
          filters={chosenFilters}
          onChange={setFilters}
          availablePlatforms={availablePlatforms}
          availableLanguages={availableLanguages}
          shown={counts?.shown}
          total={counts?.total}
        />

        <div id="ideas-calendar" className="scroll-mt-[156px]">
          {iterationsFailed || scheduledPostsFailed ? <LoadRetry context="saved post changes and scheduled posts" error={scheduledPostsError} label="Loading the calendar" onRetry={() => { if (iterationsFailed) void reloadIterations(); if (scheduledPostsFailed) void reloadScheduledPosts(); }} /> : iterationsLoading || scheduledPostsLoading ? <Loading label="Loading the calendar" /> : <CalendarKanban
            contentCalendar={revisedCalendar}
            postIterations={postIterations as any}
            scheduledPosts={scheduledPosts as any}
            filters={filters}
            onCardClick={(post) => {
              setActivePost(post);
              setPanelTab(undefined);
            }}
            onToggleApproved={(iterationId) => toggleApproved.mutate(iterationId)}
          />}
        </div>
        </>}

        <PostPanel
          open={!!activePost && !iterationsFailed}
          onOpenChange={(open) => {
            if (!open) {
              setActivePost(null);
              setPanelTab(undefined);
            }
          }}
          post={currentPost}
          onCopySaved={(updated) => {
            setActivePost(updated);
            qc.invalidateQueries({ queryKey: ["post-iterations", clientId] });
          }}
          iteration={activeIteration}
          postIterations={activePostIterations}
          clientContext={clientContext}
          clientId={clientId}
          reportId={(currentPost as { _reportId?: string } | null)?._reportId ?? reportId}
          clientTimezone={clientTimezone}
          initialTab={panelTab}
          onFeedback={async (iterationId, verdict, reason, note) => {
            // Sent again only when it never reached the server. The post panel
            // shows the outcome; a send with no answer throws so it can say so.
            const { data, error } = await sendQuietly(() => supabase.functions.invoke("record-design-feedback", {
              body: { iteration_id: iterationId, verdict, reason, note },
            }));
            qc.invalidateQueries({ queryKey: ["post-iterations", clientId] });
            if (error || data?.error) throw new Error("feedback not recorded");
          }}
        />

        {/* An open post panel covers the page and shows the cards itself. */}
        {!(activePost && !iterationsFailed) && <DesignRequestsDock />}
      </div>
    </DesignRequestsProvider>
  );
}
