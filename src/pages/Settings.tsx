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
import { sendQuietly, writeResendable } from "@/lib/quietSend";

export default function Settings() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

  // Higgsfield's callback lands back here with the outcome of a sign-in
  // (its own page cannot render: Supabase serves html from *.supabase.co as
  // plain text). Either way the Higgsfield panel is read again and shows the
  // connection as it is; why a sign-in did not take is for the team's logs.
  const higgsfieldResult = searchParams.get("higgsfield");
  useEffect(() => {
    if (!higgsfieldResult) return;
    queryClient.invalidateQueries({ queryKey: ["higgsfield-status"] });
    if (higgsfieldResult === "linked") {
      toast({ title: "Higgsfield connected" });
    } else {
      console.warn("[higgsfield sign-in] not linked", searchParams.get("reason") || "no reason given");
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

  // One row per key, written as an upsert on the key, so a save that does
  // not get through is sent again quietly and can never be stored twice.
  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await sendQuietly(
        () => supabase.from("app_settings").upsert({ key: "n8n_webhook_url", value: webhookUrl }, { onConflict: "key" }),
        { again: writeResendable },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast({ title: "Settings saved" });
    },
    // The field keeps what was typed and says it is not saved yet.
    onError: (err: Error) => console.warn("[settings save] not saved yet", err),
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
        {saveMutation.isError && <p role="status" className="t-secondary">Not saved yet. The URL is kept here.</p>}
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
