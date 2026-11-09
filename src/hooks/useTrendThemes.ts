import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import { LOAD_RETRY_WAITS_MS } from "@/components/ui/load-error";

/** A post a theme is built on. `engagement` (the weighted score) is only there for Moburst staff. */
export interface TrendPost {
  platform: string;
  url: string;
  author: string;
  text: string;
  posted_at: string | null;
  format: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagement: number | null;
}

export interface TrendTheme {
  id: string;
  /** The Monday of the week the theme was collected for (yyyy-mm-dd). */
  week_start: string;
  title: string;
  happening: string;
  why_it_matters: string;
  angle: string;
  platforms: string[];
  posts: TrendPost[];
}

/** The answer for a window: its themes, and whether the client has had any weekly collection at all. */
export interface TrendThemesAnswer {
  /** True when at least one week was collected on any date, so "no themes" means none in this window. */
  collected: boolean;
  themes: TrendTheme[];
}

/** The client alone is the prefix of every window's key, so one call refreshes them all. */
const themesKey = (clientId: string, ...range: string[]) => ["trend-themes", clientId, ...range];

/**
 * The client's weekly themes for the weeks with any day between `from` and
 * `to` (yyyy-mm-dd, both included), newest week first, each with its kept
 * posts, and whether any week was ever collected for the client.
 * One database function answers it (trend_themes_in_range): a client user
 * cannot read the week rows a range needs, and the function also keeps the
 * team's own columns out of the answer. Dismissed themes and posts the
 * tripwire flagged are not in it.
 *
 * `untilRead`: for a screen that shows nothing in place of the themes (a
 * report's trends and the figures they change). A read that does not answer
 * is tried again quietly, on LoadRetry's waits, until one does: the query
 * stays loading, never failed, and the cause goes to the console for the
 * team. Without it, a failed read is the caller's to try again (LoadRetry).
 */
export function useTrendThemes(clientId: string, from: string, to: string, opts: { untilRead?: boolean } = {}) {
  return useQuery({
    queryKey: themesKey(clientId, from, to),
    enabled: !!clientId && !!from && !!to,
    ...(opts.untilRead
      ? {
        retry: true,
        retryDelay: (tries: number, error: unknown) => {
          console.warn("[trend themes] not read yet; trying again quietly:", error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error));
          return LOAD_RETRY_WAITS_MS[Math.min(tries, LOAD_RETRY_WAITS_MS.length - 1)];
        },
      }
      : {}),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("trend_themes_in_range", { p_client: clientId, p_from: from, p_to: to });
      if (error) throw error;
      // The function returns one jsonb object, { collected, themes }; its themes have the shape TrendTheme describes.
      const answer = data && typeof data === "object" && !Array.isArray(data) ? data : null;
      return { collected: answer?.collected === true, themes: Array.isArray(answer?.themes) ? (answer.themes as unknown as TrendTheme[]) : [] } satisfies TrendThemesAnswer;
    },
  });
}

/**
 * Staff dismiss a theme: it comes off the list, and its pattern is left out
 * of next week's collection. Dismissing twice changes nothing, so a request
 * that does not get through is sent again quietly. The themes are read again
 * either way, so a theme that was not dismissed stays on the list.
 */
export function useDismissTrendTheme(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (themeId: string) => {
      const { error } = await sendQuietly(() => supabase.rpc("trend_theme_dismiss", { p_theme: themeId }), { again: writeResendable });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: themesKey(clientId) }),
  });
}
