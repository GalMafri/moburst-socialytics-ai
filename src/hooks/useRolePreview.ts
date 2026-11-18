// Preview as a client, for the screens: whether this person is in a preview,
// and how a tab changes sides when one starts or ends.

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { fetchRolePreview, ROLE_PREVIEW_KEY, type RolePreviewState } from "@/lib/rolePreview";

/**
 * The signed-in person's preview, checked again when the tab is looked at
 * and once a minute while one is open, so a preview that ended elsewhere
 * (another tab, a new sign-in, 8 hours) does not stay on screen.
 */
export function useRolePreview() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ROLE_PREVIEW_KEY,
    queryFn: fetchRolePreview,
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.preview ? 60_000 : false),
    retry: 1,
  });
}

// One switch at a time for the whole tab: Start or Exit and the watcher
// (RolePreviewSync) can ask in the same moment, and the second joins the first.
let switching: Promise<void> | null = null;

/**
 * Moves this tab to the other side of a preview. Everything read under the
 * old role is dropped first, so no other client's data stays in memory or on
 * screen; then the role is read again from the server (the session itself
 * does not change, and the role is never kept in it); then the person lands
 * on the dashboard their role now has.
 *
 * Going into a preview, the role is read from the database. Coming out of
 * one, sign-in runs again from the start, so in a tab opened from the older
 * portal the Hub's current role replaces the one the preview had saved, and
 * the preview itself is asked for again instead of taken as over.
 */
export function useIdentitySwitch() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { refreshIdentity } = useAuth();
  return useCallback((next: RolePreviewState) => {
    if (switching) return switching;
    const leaving = !next.preview;
    const run = async () => {
      await queryClient.cancelQueries();
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ROLE_PREVIEW_KEY[0] });
      queryClient.setQueryData(ROLE_PREVIEW_KEY, next);
      try {
        await refreshIdentity(leaving ? { signIn: true } : undefined);
      } catch (err) {
        // The role could not be read again from here. A fresh load reads it
        // from the start, so the tab never stays on the wrong side.
        console.warn("[client preview] role not read again, loading the page afresh", err);
        window.location.assign("/");
        return;
      }
      if (leaving) void queryClient.invalidateQueries({ queryKey: ROLE_PREVIEW_KEY });
      navigate("/", { replace: true });
    };
    switching = run().finally(() => { switching = null; });
    return switching;
  }, [queryClient, navigate, refreshIdentity]);
}
