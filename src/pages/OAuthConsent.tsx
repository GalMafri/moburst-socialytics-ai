import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { browser, consentEntry, consentStep } from "@/utils/oauthConsent";
import { rememberIntendedDestination } from "@/utils/returnTo";

// Where Supabase Auth's OAuth server sends a person who connects Claude to
// Socialytics. Opened anywhere else, it moves to socialytics.moburst.ai,
// where the team's sessions live. There a signed-in person with a
// Socialytics role sees Claude's request and allows or cancels it; a
// signed-out visitor goes to sign in and comes back here (ReturnTo). Only
// Claude's own callback is ever approved.

type View =
  | { kind: "loading" }
  | { kind: "signin" }
  | { kind: "ask"; host: string; email: string; busy: boolean }
  | { kind: "not-claude" }
  | { kind: "no-role" }
  | { kind: "expired" };

export default function OAuthConsent() {
  const entry = useMemo(() => consentEntry(browser.origin(), browser.search()), []);
  const { isLoading, isAuthenticated } = useAuth();
  const [view, setView] = useState<View>(() => (entry.kind === "invalid" ? { kind: "expired" } : { kind: "loading" }));

  useEffect(() => {
    if (entry.kind === "forward") browser.replace(entry.url);
  }, [entry]);

  useEffect(() => {
    if (entry.kind !== "here" || isLoading) return;
    const id = entry.authorizationId;
    let cancelled = false;
    const show = (v: View) => { if (!cancelled) setView(v); };
    (async () => {
      try {
        if (!isAuthenticated) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            rememberIntendedDestination();
            show({ kind: "signin" });
            return;
          }
          // Signed in, but with no Socialytics role.
          await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
          show({ kind: "no-role" });
          return;
        }
        const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
        if (error || !data) return show({ kind: "expired" });
        const step = consentStep(data);
        if (step.kind === "go") return browser.assign(step.url);
        if (step.kind === "refuse") {
          await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
          return show({ kind: "not-claude" });
        }
        show({ kind: "ask", host: step.host, email: step.email, busy: false });
      } catch {
        show({ kind: "expired" });
      }
    })();
    return () => { cancelled = true; };
  }, [entry, isLoading, isAuthenticated]);

  const decide = async (allow: boolean) => {
    if (entry.kind !== "here" || view.kind !== "ask") return;
    setView({ ...view, busy: true });
    // Supabase sends the browser back to Claude, with the code or with the refusal.
    const { error } = allow ? await supabase.auth.oauth.approveAuthorization(entry.authorizationId) : await supabase.auth.oauth.denyAuthorization(entry.authorizationId);
    if (error) setView({ kind: "expired" });
  };

  if (entry.kind === "forward" || view.kind === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b0c10] intercept-bg">
        <div className="relative z-10"><Loading variant="page" label="Opening Socialytics" /></div>
      </div>
    );
  }
  if (view.kind === "signin") return <Navigate to="/auth" replace />;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0b0c10] intercept-bg p-page">
      <div className="max-w-md w-full space-y-section text-center relative z-10">
        <div className="flex justify-center">
          <img src="/images/logo-dark.png" alt="Socialytics by Moburst" className="h-10 w-auto object-contain" />
        </div>
        <div className="glass p-card space-y-3">
          {view.kind === "ask" && (
            <>
              <h2 className="t-h1 text-white">Connect Claude to Socialytics</h2>
              <p className="t-secondary">Claude will be able to read reports, analytics and trends for the clients you see in Socialytics. It can't change anything.</p>
              <p className="t-label">Signed in as {view.email}. After you choose, you'll go back to {view.host}.</p>
              <div className="flex justify-center gap-3 pt-2">
                <Button variant="outline" disabled={view.busy} onClick={() => decide(false)}>Cancel</Button>
                <Button disabled={view.busy} onClick={() => decide(true)}>Allow</Button>
              </div>
            </>
          )}
          {view.kind === "not-claude" && (
            <>
              <h2 className="t-h1 text-white">This request didn't come from Claude</h2>
              <p className="t-secondary">Socialytics connects only to Claude, so nothing was shared.</p>
            </>
          )}
          {view.kind === "no-role" && (
            <>
              <h2 className="t-h1 text-white">Socialytics isn't available to your account</h2>
              <p className="t-secondary">Claude can connect once a portal admin gives your account access to Socialytics.</p>
            </>
          )}
          {view.kind === "expired" && (
            <>
              <h2 className="t-h1 text-white">This connection request has expired</h2>
              <p className="t-secondary">Go back to Claude and click Connect next to Socialytics.</p>
            </>
          )}
        </div>
        <p className="t-label">Powered by Moburst</p>
      </div>
    </div>
  );
}
