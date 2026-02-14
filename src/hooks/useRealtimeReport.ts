import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Subscribes to realtime changes on the reports table.
 * Automatically invalidates relevant react-query caches when a report changes.
 */
export function useRealtimeReports(clientId?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!clientId) return;

    const channel = supabase
      .channel(`reports-${clientId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reports",
          filter: `client_id=eq.${clientId}`,
        },
        (payload) => {
          console.log("Realtime report update:", payload);
          // Invalidate all report-related queries for this client
          queryClient.invalidateQueries({ queryKey: ["reports", clientId] });
          queryClient.invalidateQueries({ queryKey: ["reports-history", clientId] });
          queryClient.invalidateQueries({ queryKey: ["latest-report", clientId] });
          queryClient.invalidateQueries({ queryKey: ["clients"] });

          // If it's a specific report update, also invalidate that report's query
          const newRecord = payload.new as any;
          if (newRecord?.id) {
            queryClient.invalidateQueries({ queryKey: ["report", newRecord.id] });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId, queryClient]);
}
