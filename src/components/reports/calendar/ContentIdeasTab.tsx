import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimePostIterations } from "@/hooks/useRealtimePostIterations";
import { CalendarFilters, type CalendarFilterState } from "./CalendarFilters";
import { CalendarKanban, findLatestSelectedIteration } from "./CalendarKanban";
import { PostPanel } from "./PostPanel";
import { WeeklyHighlights } from "./WeeklyHighlights";
import { CreateAdHocPost } from "@/components/reports/CreateAdHocPost";
import { GenerationProvider } from "./GenerationContext";
import { GenerationProgress } from "./GenerationProgress";
import type { ClientContext } from "@/lib/clientContext";

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
}: Props) {
  const [filters, setFilters] = useState<CalendarFilterState>({
    day: "all",
    platform: "all",
    status: "all",
    language: "all",
  });
  const [activePost, setActivePost] = useState<any | null>(null);
  /** When the user opens the panel via the floating GenerationProgress card,
   *  we know the exact variant_group_id they want to see. Filtering by it is
   *  bulletproof — no copy-slice heuristic, no realtime lag dependency. */
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const qc = useQueryClient();

  useRealtimePostIterations(clientId);

  const { data: postIterations = [] } = useQuery({
    queryKey: ["post-iterations", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      const { data } = await supabase
        .from("post_iterations")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!clientId,
  });

  const { data: scheduledPosts = [] } = useQuery({
    queryKey: ["scheduled-posts", clientId],
    queryFn: async () => {
      if (!clientId) return [];
      const { data } = await supabase
        .from("scheduled_posts")
        .select("id, client_id, report_id, platform, post_content, status")
        .eq("client_id", clientId);
      return data || [];
    },
    enabled: !!clientId,
  });

  const toggleApproved = useMutation({
    mutationFn: async (iterationId: string) => {
      if (!clientId) return;
      // Read current state
      const { data: current } = await supabase
        .from("post_iterations")
        .select("variant_group_id, is_approved")
        .eq("id", iterationId)
        .maybeSingle();
      if (!current) return;

      const variantGroupId = (current as any).variant_group_id;
      const newApproved = !((current as any).is_approved);
      const update: any = {
        is_approved: newApproved,
        approved_at: newApproved ? new Date().toISOString() : null,
      };

      // Apply to entire variant group if it exists; otherwise to the single row.
      if (variantGroupId) {
        await supabase
          .from("post_iterations")
          .update(update)
          .eq("variant_group_id", variantGroupId);
      } else {
        await supabase
          .from("post_iterations")
          .update(update)
          .eq("id", iterationId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["post-iterations", clientId] });
    },
  });

  const activeIteration = activePost
    ? findLatestSelectedIteration(postIterations as any, activePost)
    : null;

  // Force a fresh fetch when the panel opens for a new post. Defeats the
  // case where realtime hasn't yet delivered the rows we just inserted from
  // a parallel variant generation — without this, "View designs" can open
  // an empty tab for a few seconds.
  useEffect(() => {
    if (activePost && clientId) {
      qc.invalidateQueries({ queryKey: ["post-iterations", clientId] });
    }
    // We intentionally don't depend on the whole post object — just identity
    // markers so we refetch when the active post truly changes.
  }, [activePost?.platform, activePost?.copy, activePost?.caption_angle, clientId, qc]);

  // All iterations matching the active post. When a variant_group_id is
  // provided (set by openPanel from the floating GenerationProgress card),
  // filter to that exact group — no string-match heuristic, no surprises.
  // Otherwise fall back to platform+copy matching as before so direct card
  // clicks still surface every variant ever generated for the post.
  const activePostIterations = activePost
    ? activeGroupId
      ? (postIterations as any[]).filter(
          (it) =>
            (it as any).variant_group_id === activeGroupId &&
            it.media_urls &&
            it.media_urls.length > 0,
        )
      : (postIterations as any[]).filter((it) => {
          const matchingPlatform = (activePost.platform || "").toLowerCase();
          const matchingCopy = (activePost.copy || activePost.caption_angle || "")
            .trim()
            .slice(0, 200);
          return (
            (it.platform || "").toLowerCase() === matchingPlatform &&
            (it.post_copy || "").trim().slice(0, 200) === matchingCopy &&
            it.media_urls &&
            it.media_urls.length > 0
          );
        })
    : [];

  return (
    <GenerationProvider
      onOpenPanel={(post, opts) => {
        setActivePost(post);
        setActiveGroupId(opts?.variantGroupId || null);
      }}
    >
      <div className="space-y-4">
        {availablePlatforms.length > 0 && clientId && (
          <div className="flex justify-end">
            <CreateAdHocPost
              clientId={clientId}
              platforms={availablePlatforms}
              clientContext={clientContext}
            />
          </div>
        )}

        <WeeklyHighlights
          aiAnalysis={aiAnalysis}
          sproutMonthSummary={sproutPerformance?.month_comparison?.summary || null}
        />

        <CalendarFilters
          filters={filters}
          onChange={setFilters}
          availablePlatforms={availablePlatforms}
          availableLanguages={availableLanguages}
        />

        <CalendarKanban
          contentCalendar={contentCalendar}
          postIterations={postIterations as any}
          scheduledPosts={scheduledPosts as any}
          filters={filters}
          onCardClick={(post) => {
            // Direct card clicks should show the most recent variant group
            // (the heuristic path) — clear any group filter set by the
            // floating "View" button.
            setActivePost(post);
            setActiveGroupId(null);
          }}
          onToggleApproved={(iterationId) => toggleApproved.mutate(iterationId)}
        />

        <PostPanel
          open={!!activePost}
          onOpenChange={(open) => {
            if (!open) {
              setActivePost(null);
              setActiveGroupId(null);
            }
          }}
          post={activePost}
          iteration={activeIteration}
          postIterations={activePostIterations}
          clientContext={clientContext}
          clientId={clientId}
          reportId={reportId}
          clientTimezone={clientTimezone}
          onToggleSelected={(iterationId, nextSelected) => {
            supabase
              .from("post_iterations")
              .update({ is_selected: nextSelected } as any)
              .eq("id", iterationId)
              .then(() => {
                qc.invalidateQueries({ queryKey: ["post-iterations", clientId] });
              });
          }}
        />

        {/* Floating progress + completion indicator (bottom-right) */}
        <GenerationProgress />
      </div>
    </GenerationProvider>
  );
}
