import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { BarChart3, TrendingUp, Zap, AlertCircle } from "lucide-react";

export default function Auth() {
  const { isAuthenticated, isLoading, authError } = useAuth();

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
              <h2 className="text-2xl font-bold tracking-tight text-white">Not authenticated</h2>
              <p className="text-[#9ca3af]">Please open this tool from the Moburst Hub Dashboard.</p>
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
