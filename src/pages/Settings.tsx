import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Navigate } from "react-router-dom";
import { Save, Loader2 } from "lucide-react";

export default function Settings() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [webhookUrl, setWebhookUrl] = useState("");

  const { data: settings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("*");
      if (error) throw error;
      return data;
    },
    enabled: isAdmin,
  });

  useEffect(() => {
    if (settings) {
      const webhook = settings.find((s: any) => s.key === "n8n_webhook_url");
      if (webhook) setWebhookUrl(webhook.value);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const existing = settings?.find((s: any) => s.key === "n8n_webhook_url");
      if (existing) {
        const { error } = await supabase.from("app_settings").update({ value: webhookUrl }).eq("key", "n8n_webhook_url");
        if (error) throw error;
      } else {
        const { error } = await supabase.from("app_settings").insert({ key: "n8n_webhook_url", value: webhookUrl });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <AppLayout title="Settings">
      <div className="max-w-2xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Integration Settings</CardTitle>
            <CardDescription>Configure external service connections</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>n8n Webhook URL</Label>
              <Input
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-n8n-instance.com/webhook/socialytics-report"
              />
              <p className="text-xs text-muted-foreground">The full URL of your n8n webhook that handles report generation</p>
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Settings
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sprout Social</CardTitle>
            <CardDescription>OAuth2 credentials are managed as backend secrets</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The Sprout Social access token is stored securely as a backend secret (SPROUT_SOCIAL_ACCESS_TOKEN).
              Contact your administrator to update these credentials.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
