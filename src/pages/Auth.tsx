import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { signInUrl } from "@/utils/gosAuth";
import { authMessage, isAuthErrorCode, isTransient, type AuthErrorCode } from "@/lib/authMessages";
import { BarChart3, TrendingUp, Zap, AlertCircle } from "lucide-react";

export default function Auth() {
  const { isAuthenticated, isLoading, authError } = useAuth();

  // Why sign-in did not happen, as a reason code. It comes from the sign-in
  // itself, or from the address when a moburst.ai handoff failed and sent the
  // person here. With no code, a stored sign-in that has no access, or one
  // that could not be restored, is told apart from no sign-in at all.
  const [params] = useSearchParams();
  const fromAddress = params.get("reason");
  const [found, setFound] = useState<AuthErrorCode | "none" | "checking">("checking");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        // The auth server did not answer: the person may well be signed in.
        if (error && isTransient(error)) { if (!cancelled) setFound("unreachable"); return; }
        const su = data.session?.user;
        if (!su) { if (!cancelled) setFound("none"); return; }
        const { data: roles, error: rolesError } = await supabase
          .from("user_roles").select("role").eq("user_id", su.id);
        if (cancelled) return;
        // QA 22 Nov 2026: a roles read that did not answer says nothing about
        // access. "No access" is said only when the read answered with no role.
        if (rolesError) setFound(isTransient(rolesError) ? "unreachable" : "restore_failed");
        else setFound(roles && roles.length ? "restore_failed" : "no_access");
      } catch {
        if (!cancelled) setFound("none");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b0c10] intercept-bg">
        <div className="relative z-10"><Loading variant="page" label="Signing you in" /></div>
      </div>
    );
  }
  if (isAuthenticated) return <Navigate to="/" />;

  const code: AuthErrorCode | null =
    authError ?? (isAuthErrorCode(fromAddress) ? fromAddress : found !== "none" && found !== "checking" ? found : null);
  const hasError = code !== null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0b0c10] intercept-bg p-page">
      <div className="max-w-md w-full space-y-section text-center relative z-10">
        <div className="flex justify-center">
          <img src="/images/logo-dark.png" alt="Socialytics by Moburst" className="h-10 w-auto object-contain" />
        </div>

        <div className="glass p-card space-y-3">
          {hasError ? (
            <>
              <div className="flex justify-center">
                <div className="p-3 rounded-full bg-[rgba(239,68,68,0.1)]">
                  <AlertCircle className="h-6 w-6 text-destructive" />
                </div>
              </div>
              <h2 className="t-h1 text-white">Sign-in did not finish</h2>
              <p className="t-secondary">{authMessage(code)}</p>
            </>
          ) : (
            <>
              <h2 className="t-h1 text-white">Sign in to continue</h2>
              <p className="t-secondary">
                Socialytics signs you in through the Moburst portal. Open it there and you
                will come straight back to the page you were trying to reach.
              </p>
            </>
          )}
          <div className="pt-2">
            <Button asChild>
              <a href={signInUrl()}>Open the Moburst portal</a>
            </Button>
          </div>
        </div>

        {!hasError && (
          <div className="space-y-3 text-left">
            {[
              // Say what the product does, in words a client would use.
              { icon: TrendingUp, title: "Trends", desc: "Each week's industry themes on the platforms the client posts on." },
              { icon: BarChart3, title: "Performance analytics", desc: "Every connected platform's numbers in one place" },
              { icon: Zap, title: "Content calendar", desc: "A week of posts at a time, written from the client's own brand and results" },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-3 glass-inner p-inner">
                <div className="mt-0.5 p-2 rounded-[8px] bg-[rgba(185,224,69,0.1)]">
                  <f.icon className="h-4 w-4 text-[#b9e045]" aria-hidden />
                </div>
                <div>
                  <p className="t-h4">{f.title}</p>
                  <p className="t-secondary">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="t-label">Powered by Moburst</p>
      </div>
    </div>
  );
}
