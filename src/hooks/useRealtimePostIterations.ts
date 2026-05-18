import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to realtime changes on `post_iterations` rows for a given client.
 * Invalidates the ["post-iterations", clientId] react-query key on any change
 * so consumers can refetch.
 *
 * Additive: does not conflict with useRealtimeReports (different table).
 */
export function useRealtimePostIterations(clientId?: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel(`post-iterations-${clientId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "post_iterations",
          filter: `client_id=eq.${clientId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["post-iterations", clientId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId, qc]);
}
