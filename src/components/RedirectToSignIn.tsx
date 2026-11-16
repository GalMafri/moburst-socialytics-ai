import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loading } from "@/components/ui/loading";
import { rememberReturnTo } from "@/utils/returnTo";

/**
 * The one screen for "sign-in is being checked", used by AppLayout, both route
 * guards and the portal handoff page, so the wait looks the same everywhere.
 */
export function SigningIn() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loading variant="page" label="Signing you in" />
    </div>
  );
}

/**
 * Where a signed-out visit to a guarded page goes. The page being opened is
 * stored first, in an effect (a render must not write), so the portal round
 * trip can finish the journey instead of dropping the person on the
 * dashboard. A portal can name the page itself with ?next=. rememberReturnTo
 * drops sign-in parameters such as ?hubToken, which the router can still
 * report after hubAuth.ts has stripped them from the address bar.
 */
export function RedirectToSignIn() {
  const { pathname, search } = useLocation();
  const [stored, setStored] = useState(false);
  useEffect(() => {
    rememberReturnTo(new URLSearchParams(search).get("next") || pathname + search);
    setStored(true);
  }, [pathname, search]);
  return stored ? <Navigate to="/auth" replace /> : <SigningIn />;
}
