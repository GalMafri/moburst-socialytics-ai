import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PORTAL_URL } from "@/utils/gosAuth";
import { BarChart3, TrendingUp, Zap, AlertCircle } from "lucide-react";

export default function Auth() {
  const { isAuthenticated, isLoading, authError } = useAuth();

  // Why sign-in did not happen, in plain terms. Without this the page is a
  // dead end that looks identical whether there is no session at all, a
  // session with no role for this tool, or a genuine bridge failure — and
  // those need three different fixes.
  const [reason, setReason] = useState<"checking" | "no-session" | "no-role" | "ready">("checking");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const su = data.session?.user;
        if (!su) { if (!cancelled) setReason("no-session"); return; }
        const { data: roles } = await supabase
          .from("user_roles").select("role").eq("user_id", su.id);
        if (!cancelled) setReason(roles && roles.length ? "ready" : "no-role");
      } catch {
        if (!cancelled) setReason("no-session");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/" />;

  const hasError = !!authError;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0b0c10] intercept-bg p-6">
      <div className="max-w-md w-full space-y-8 text-center relative z-10">
        <div className="flex justify-center">
          <img src="/images/logo-dark.png" alt="Socialytics by Moburst" className="h-10 w-auto object-contain brightness-0 invert" />
        </div>

        <div className="space-y-3">
          {hasError ? (
            <>
              <div className="flex justify-center">
                <div className="p-3 rounded-full bg-[rgba(239,68,68,0.1)]">
                  <AlertCircle className="h-6 w-6 text-[#ef4444]" />
                </div>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-white">Sign-in failed</h2>
              <p className="text-[#9ca3af]">{authError}</p>
              <p className="text-xs text-[#6b7280] pt-2">
                Open this tool from the Moburst Hub Dashboard. If you're already there,
                ask a Hub admin to confirm your tool assignment.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold tracking-tight text-white">Sign in to continue</h2>
              <p className="text-[#9ca3af]">
                This tool signs you in through the Moburst portal. Open it there and you
                will come straight back to the page you were trying to reach.
              </p>
              <div className="pt-2">
                <a
                  href={PORTAL_URL}
                  className="inline-flex items-center justify-center rounded-lg bg-[#b9e045] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
                >
                  Open the Moburst portal
                </a>
              </div>
            {reason === "no-role" && (
              <p className="text-xs text-amber-500 pt-2">
                You are signed in, but this tool has no role assigned to your account.
                A portal admin needs to grant you access to it.
              </p>
            )}
            {reason === "ready" && (
              <p className="text-xs text-amber-500 pt-2">
                A session was found but could not be restored. Reload the page, and if
                it persists, open the tool from the portal once.
              </p>
            )}
            </>
          )}
        </div>

        {!hasError && (
          <div className="pt-6 space-y-4 text-left">
            {[
              { icon: TrendingUp, title: "Trend Analysis", desc: "Track TikTok & Instagram trends in real-time" },
              { icon: BarChart3, title: "Performance Analytics", desc: "Monitor cross-platform social media metrics" },
              { icon: Zap, title: "AI Recommendations", desc: "Get AI-powered content strategy insights" },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-3 glass-inner p-3">
                <div className="mt-1 p-2 rounded-lg bg-[rgba(185,224,69,0.1)]">
                  <f.icon className="h-4 w-4 text-[#b9e045]" />
                </div>
                <div>
                  <p className="font-medium text-white">{f.title}</p>
                  <p className="text-sm text-[#9ca3af]">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-[#6b7280] pt-4">Powered by Moburst</p>
      </div>
    </div>
  );
}
