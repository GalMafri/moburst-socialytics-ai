import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { useAuth } from "@/hooks/useAuth";
import { isTransient } from "@/lib/authMessages";
import { strongestRole } from "@/lib/roles";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import { supabase } from "@/integrations/supabase/client";
import { browser, consentEntry, consentStep } from "@/utils/oauthConsent";
import { rememberIntendedDestination } from "@/utils/returnTo";

// Where Supabase Auth's OAuth server sends a person who connects Claude to
// Socialytics. Opened anywhere else, it moves to socialytics.moburst.ai,
// where the team's sessions live. There a signed-in person with a
// Socialytics role sees Claude's request (what Claude reads, and for staff
// what it saves: docs/superpowers/specs/2026-11-03-claude-sync-design.md)
// and allows or cancels it; a
// signed-out visitor goes to sign in and comes back here (ReturnTo). Only
// Claude's own callback is ever approved.

type View =
  | { kind: "loading" }
  | { kind: "signin" }
  | { kind: "ask"; host: string; email: string; busy: boolean }
  | { kind: "not-claude" }
  | { kind: "no-role" }
  | { kind: "staff-only" }
  | { kind: "expired" };

export default function OAuthConsent() {
  const entry = useMemo(() => consentEntry(browser.origin(), browser.search()), []);
  const { isLoading, isAuthenticated, isClient } = useAuth();
  const [view, setView] = useState<View>(() => (entry.kind === "invalid" ? { kind: "expired" } : { kind: "loading" }));

  useEffect(() => {
    if (entry.kind === "forward") browser.replace(entry.url);
  }, [entry]);

  useEffect(() => {
    if (entry.kind !== "here" || isLoading) return;
    const id = entry.authorizationId;
    let cancelled = false;
    const show = (v: View) => { if (!cancelled) setView(v); };
    // A brief error is sent again quietly and then again after a pause, while
    // the person sees the same "Opening Socialytics". Only an answer settles
    // anything: a request is refused on a real refusal, never on a hiccup.
    const settled = async <T extends { error: unknown }>(send: () => PromiseLike<T>, retry: (e: unknown) => boolean): Promise<T | null> => {
      for (;;) {
        const reply = await sendQuietly(send, { again: retry });
        if (!reply.error || !retry(reply.error)) return reply;
        await new Promise((r) => setTimeout(r, 5_000));
        if (cancelled) return null;
      }
    };
    (async () => {
      try {
        if (!isAuthenticated) {
          const { data } = await supabase.auth.getSession();
          const userId = data.session?.user?.id;
          if (!userId) {
            rememberIntendedDestination();
            show({ kind: "signin" });
            return;
          }
          // Signed in, but the app has not placed the person: ask the roles
          // table itself, so a failed sign-in check is not taken for "no role".
          const roles = await settled(() => supabase.from("user_roles").select("role").eq("user_id", userId), writeResendable);
          if (!roles) return;
          const role = strongestRole(((roles.data as Array<{ role: string }> | null) ?? []).map((r) => r.role));
          if (!role || role === "client") {
            await sendQuietly(() => supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true }), { again: isTransient });
            show({ kind: role ? "staff-only" : "no-role" });
            return;
          }
        } else if (isClient) {
          // Client users have no API access at all: refuse before Claude is shown anything.
          await sendQuietly(() => supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true }), { again: isTransient });
          show({ kind: "staff-only" });
          return;
        }
        const reply = await settled(() => supabase.auth.oauth.getAuthorizationDetails(id), isTransient);
        if (!reply) return;
        const { data, error } = reply;
        if (error || !data) return show({ kind: "expired" });
        const step = consentStep(data);
        if (step.kind === "go") return browser.assign(step.url);
        if (step.kind === "refuse") {
          await sendQuietly(() => supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true }), { again: isTransient });
          return show({ kind: "not-claude" });
        }
        show({ kind: "ask", host: step.host, email: step.email, busy: false });
      } catch {
        show({ kind: "expired" });
      }
    })();
    return () => { cancelled = true; };
  }, [entry, isLoading, isAuthenticated, isClient]);

  const decide = async (allow: boolean) => {
    if (entry.kind !== "here" || view.kind !== "ask") return;
    const asking = view;
    setView({ ...asking, busy: true });
    // Supabase sends the browser back to Claude, with the code or with the refusal.
    const { error } = await sendQuietly(
      () => (allow ? supabase.auth.oauth.approveAuthorization(entry.authorizationId) : supabase.auth.oauth.denyAuthorization(entry.authorizationId)),
      { again: isTransient },
    );
    // Still not through after the quiet tries: the request is as it was, so the same buttons.
    if (error) setView(isTransient(error) ? { ...asking, busy: false } : { kind: "expired" });
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
              <h1 className="t-h1 text-white">Connect Claude to Socialytics</h1>
              <p className="t-secondary">Claude will be able to read reports, analytics, trends, the calendar, client notes and the strategy of the clients you can see, and start work for them. It asks you before anything that costs money.</p>
              <p className="t-label">Signed in as {view.email}. After you choose, you'll go back to {view.host}.</p>
              <div className="flex justify-center gap-3 pt-2">
                <Button variant="outline" disabled={view.busy} onClick={() => decide(false)}>Cancel</Button>
                <Button disabled={view.busy} onClick={() => decide(true)}>Allow</Button>
              </div>
            </>
          )}
          {view.kind === "not-claude" && (
            <>
              <h1 className="t-h1 text-white">This request didn't come from Claude</h1>
              <p className="t-secondary">Socialytics connects only to Claude, so nothing was shared.</p>
            </>
          )}
          {view.kind === "no-role" && (
            <>
              <h1 className="t-h1 text-white">Socialytics isn't available to your account</h1>
              <p className="t-secondary">This account has no access to Socialytics, so Claude was not connected.</p>
            </>
          )}
          {view.kind === "staff-only" && (
            <>
              <h1 className="t-h1 text-white">The Claude connector is for Moburst staff</h1>
              <p className="t-secondary">Your account can use Socialytics in the browser, but not through Claude, so Claude was not connected.</p>
            </>
          )}
          {view.kind === "expired" && (
            <>
              <h1 className="t-h1 text-white">This connection request has expired</h1>
              <p className="t-secondary">Go back to Claude and click Connect next to Socialytics.</p>
            </>
          )}
        </div>
        <p className="t-label">Powered by Moburst</p>
      </div>
    </div>
  );
}
