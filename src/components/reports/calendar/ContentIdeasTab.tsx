import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimePostIterations } from "@/hooks/useRealtimePostIterations";
import { CalendarFilters, type CalendarFilterState } from "./CalendarFilters";
import { CalendarKanban, findLatestSelectedIteration } from "./CalendarKanban";
import { PostPanel } from "./PostPanel";
import { WeeklyHighlights } from "./WeeklyHighlights";
import { CreateAdHocPost } from "@/components/reports/CreateAdHocPost";
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

  const activeIteration = activePost
    ? findLatestSelectedIteration(postIterations as any, activePost)
    : null;

  return (
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
        filters={filters}
        onCardClick={setActivePost}
      />

      <PostPanel
        open={!!activePost}
        onOpenChange={(open) => !open && setActivePost(null)}
        post={activePost}
        iteration={activeIteration}
        clientContext={clientContext}
        clientId={clientId}
        reportId={reportId}
        clientTimezone={clientTimezone}
      />
    </div>
  );
}
