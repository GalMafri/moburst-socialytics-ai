import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { OnboardingStep } from "@/lib/display";

/**
 * The client lifecycle's tracking step, as the staff competitive screens read
 * it: whether tracking of the confirmed competitors waits, and for what
 * (competitiveFlow.ts describeTracking). Staff only: the row is not readable
 * by a client, and a screen that cannot read it says only that tracking has
 * not started. The step's own error is never read or shown.
 */
export function useTrackingStep(clientId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["tracking-step", clientId],
    enabled: !!clientId && enabled,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)("client_lifecycle_steps").select("step, status, done_at, result")
        .eq("client_id", clientId).eq("step", "tracking").maybeSingle();
      if (error) throw error;
      return (data ?? null) as OnboardingStep | null;
    },
    staleTime: 60_000,
  });
}
