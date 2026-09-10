import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MediaBackend = "gemini" | "higgsfield";

/**
 * Which generator a client's images and clips come from.
 *
 * The server decides this for real, from the same column; the frontend reads
 * it only to tell the truth about how long a run will take and what it is
 * doing. Getting it wrong here costs nothing but a wrong estimate, so a
 * failed read falls back to the default rather than blocking anything.
 *
 * Cached for the session: it changes when somebody edits Client Setup, not
 * during a generation.
 */
export function useMediaBackend(clientId?: string | null): MediaBackend {
  const { data } = useQuery({
    queryKey: ["media-backend", clientId],
    queryFn: async (): Promise<MediaBackend> => {
      const { data, error } = await supabase
        .from("clients")
        .select("media_backend")
        .eq("id", clientId!)
        .maybeSingle();
      if (error) throw error;
      return data?.media_backend === "higgsfield" ? "higgsfield" : "gemini";
    },
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
  });
  return data ?? "gemini";
}
