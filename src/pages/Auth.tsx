import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { BarChart3, TrendingUp, Zap } from "lucide-react";

export default function Auth() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/" />;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="flex justify-center">
          <img src="/images/logo-light.png" alt="Socialytics by Moburst" className="h-10 w-auto object-contain" />
        </div>

        <div className="space-y-3">
          <h2 className="text-2xl font-bold tracking-tight">Not authenticated</h2>
          <p className="text-muted-foreground">Please open this tool from the Moburst Hub Dashboard.</p>
        </div>

        <div className="pt-6 space-y-4 text-left">
          {[
            { icon: TrendingUp, title: "Trend Analysis", desc: "Track TikTok & Instagram trends in real-time" },
            { icon: BarChart3, title: "Performance Analytics", desc: "Monitor cross-platform social media metrics" },
            { icon: Zap, title: "AI Recommendations", desc: "Get AI-powered content strategy insights" },
          ].map((f) => (
            <div key={f.title} className="flex items-start gap-3">
              <div className="mt-1 p-2 rounded-lg bg-primary/10">
                <f.icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium">{f.title}</p>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground pt-4">Powered by Moburst</p>
      </div>
    </div>
  );
}
