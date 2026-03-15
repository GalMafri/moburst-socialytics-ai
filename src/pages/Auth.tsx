import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, TrendingUp, Zap } from "lucide-react";

export default function Auth() {
  const { session, isLoading } = useAuth();

  if (isLoading) return null;
  if (session) return <Navigate to="/" />;

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left branding panel */}
      <div className="hidden lg:flex flex-col justify-between bg-sidebar p-8 text-sidebar-foreground">
        <div className="flex-1 flex flex-col justify-center">
          <div className="space-y-6 max-w-md">
            <div className="flex items-center gap-3">
              <img
                src="/images/logo-dark.png"
                alt="Socialytics by Moburst"
                className="h-10 w-auto object-contain"
              />
            </div>

            <p className="text-lg text-sidebar-foreground/80">
              Social media intelligence powered by AI. Analyze trends, track performance, and generate actionable content recommendations.
            </p>

            <div className="space-y-4 pt-4">
              {[
                { icon: TrendingUp, title: "Trend Analysis", desc: "Track TikTok & Instagram trends in real-time" },
                { icon: BarChart3, title: "Performance Analytics", desc: "Monitor cross-platform social media metrics" },
                { icon: Zap, title: "AI Recommendations", desc: "Get AI-powered content strategy insights" },
              ].map((f) => (
                <div key={f.title} className="flex items-start gap-3">
                  <div className="mt-1 p-2 rounded-lg bg-sidebar-primary/10">
                    <f.icon className="h-4 w-4 text-sidebar-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sidebar-foreground">{f.title}</p>
                    <p className="text-sm text-sidebar-foreground/60">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="text-xs text-sidebar-foreground/50">Powered by Moburst</p>
      </div>

      {/* Right auth panel */}
      <div className="flex flex-col justify-center p-6 lg:p-12 bg-background">
        <div className="w-full max-w-sm mx-auto space-y-6">
          {/* Mobile logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <img
              src="/images/logo-light.png"
              alt="Socialytics by Moburst"
              className="h-8 w-auto object-contain"
            />
          </div>

          <AuthForms />
        </div>
      </div>
    </div>
  );
}

function AuthForms() {
  const { signIn, signUp } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>, mode: "login" | "signup") => {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const password = form.get("password") as string;
    const displayName = form.get("displayName") as string;

    try {
      if (mode === "login") {
        await signIn(email, password);
      } else {
        await signUp(email, password, displayName);
        toast({ title: "Check your email", description: "We've sent you a verification link." });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Tabs defaultValue="login" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="login">Sign In</TabsTrigger>
        <TabsTrigger value="signup">Sign Up</TabsTrigger>
      </TabsList>

      <TabsContent value="login">
        <Card>
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Sign in to your account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => handleSubmit(e, "login")} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" required />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="signup">
        <Card>
          <CardHeader>
            <CardTitle>Create account</CardTitle>
            <CardDescription>Get started with Socialytics AI</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => handleSubmit(e, "signup")} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input id="displayName" name="displayName" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" required minLength={6} />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creating account..." : "Create Account"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
