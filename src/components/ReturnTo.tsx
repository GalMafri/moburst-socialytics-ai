import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { consumeReturnTo } from "@/utils/returnTo";

/**
 * Finishes the journey a shared deep link started.
 *
 * Both portals hand the user back at the tool root: the gOS handoff ends in a
 * redirect to "/", and the legacy hub opens the tool at "/" with a ?hubToken.
 * Once sign-in has settled, this sends them on to the page they originally
 * asked for.
 *
 * It only ever fires from the landing pages ("/" or "/auth"). Redirecting from
 * anywhere else would hijack normal navigation, and a stale stored path could
 * yank someone off a page they deliberately opened.
 */
export function ReturnTo() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    if (location.pathname !== "/" && location.pathname !== "/auth") return;

    const target = consumeReturnTo();
    if (target && target !== location.pathname) navigate(target, { replace: true });
  }, [isAuthenticated, isLoading, location.pathname, navigate]);

  return null;
}
