import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Section } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Navigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Save, Loader2 } from "lucide-react";
import { HubCompanySync } from "@/components/HubCompanySync";
import { HiggsfieldConnection } from "@/components/settings/HiggsfieldConnection";
import { ApiAccessCard } from "@/components/settings/ApiAccessCard";
import { fetchActiveClients } from "@/lib/activeClients";

/**
 * Why a sign-in did not take. Higgsfield's callback cannot render a page of
 * its own — Supabase serves html from *.supabase.co as plain text — so it
 * redirects here with a short code and this is where it becomes a sentence.
 */
const HIGGSFIELD_REASONS: Record<string, string> = {
  refused: "Higgsfield refused the sign-in. Nothing was saved.",
  bad_state: "That sign-in link was not the one this app started. Start again from here.",
  expired: "That sign-in link had expired. They last 15 minutes; start again from here.",
  no_refresh_token:
    "Higgsfield returned a session but no way to stay signed in, so nothing was saved. Start again and leave every permission ticked.",
  exchange_failed: "Higgsfield would not complete the sign-in. Nothing was saved. Start again from here.",
  not_saved: "The sign-in worked but the connection could not be stored. Start again from here.",
};

export default function Settings() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

  // Higgsfield's callback lands back here with the outcome of a sign-in.
  const higgsfieldResult = searchParams.get("higgsfield");
  useEffect(() => {
    if (!higgsfieldResult) return;
    if (higgsfieldResult === "linked") {
      queryClient.invalidateQueries({ queryKey: ["higgsfield-status"] });
      toast({ title: "Higgsfield connected" });
    } else {
      const reason = searchParams.get("reason") || "";
      toast({
        title: "Higgsfield is not connected",
        description: HIGGSFIELD_REASONS[reason] || "The sign-in did not finish. Nothing was saved.",
        variant: "destructive",
      });
    }
    // Clear it so a refresh does not repeat the message.
    const next = new URLSearchParams(searchParams);
    next.delete("higgsfield");
    next.delete("reason");
    setSearchParams(next, { replace: true });
  }, [higgsfieldResult, queryClient, searchParams, setSearchParams, toast]);

  const { data: settings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("*");
      if (error) throw error;
      return data;
    },
    enabled: isAdmin,
  });

  // The company slugs a key can be limited to (the same slugs the hub hands over).
  const { data: clientSlugs = [] } = useQuery({
    queryKey: ["client-slugs"],
    queryFn: async () => {
      const data = await fetchActiveClients<{ company_slug: string | null }>("company_slug");
      return Array.from(new Set(data.map((c) => c.company_slug).filter((x): x is string => !!x))).sort();
    },
    enabled: isAdmin,
  });

  useEffect(() => {
    if (settings) {
      const webhook = settings.find((s: { key: string; value: string }) => s.key === "n8n_webhook_url");
      if (webhook) setWebhookUrl(webhook.value);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const existing = settings?.find((s: { key: string; value: string }) => s.key === "n8n_webhook_url");
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
    onError: (err: Error) => {
      console.error("[settings save]", err);
      toast({ title: "The settings were not saved", description: "Nothing changed. Try again in a minute.", variant: "destructive" });
    },
  });

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <AppLayout title="Settings" description="Workspace connections, portal access and API keys.">
      {/* Every group is one split panel: what it is on the left, its fields
          and list on the right. Settings used to be a separate 896px column
          of cards with three different header patterns. */}
      <Section
        layout="split"
        eyebrow="Reports"
        title="Report webhook"
        description="Where a monthly analysis is sent when a report runs."
      >
        <div className="space-y-2">
          <Label htmlFor="webhook-url">n8n webhook URL</Label>
          <Input
            id="webhook-url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://your-n8n-instance.com/webhook/socialytics-report"
          />
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          Save settings
        </Button>
      </Section>

      <HubCompanySync />

      <HiggsfieldConnection />

      <ApiAccessCard clientSlugs={clientSlugs} />

      <Section layout="split" eyebrow="Data" title="Sprout Social" description="Connected once for the whole workspace.">
        <div className="glass-inner p-inner flex items-start gap-3">
          <CheckCircle2 className="h-4 w-4 mt-1 shrink-0 text-[#b9e045]" aria-hidden />
          <p className="t-secondary">Every client's figures come from Sprout Social. Its sign-in is stored securely on the server and renews on its own.</p>
        </div>
      </Section>
    </AppLayout>
  );
}
