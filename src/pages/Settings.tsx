import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Section } from "@/components/ui/section";
import { useToast } from "@/hooks/use-toast";
import { Navigate, useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { HubCompanySync } from "@/components/HubCompanySync";
import { HiggsfieldConnection } from "@/components/settings/HiggsfieldConnection";
import { GoogleSlidesConnection } from "@/components/settings/GoogleSlidesConnection";
import { ApiAccessCard } from "@/components/settings/ApiAccessCard";
import { fetchActiveClients } from "@/lib/activeClients";

export default function Settings() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
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

  // Google's sign-in for strategy decks lands back here the same way.
  const googleResult = searchParams.get("google");
  useEffect(() => {
    if (!googleResult) return;
    queryClient.invalidateQueries({ queryKey: ["google-status"] });
    if (googleResult === "connected") toast({ title: "Google Slides connected" });
    else console.warn("[google sign-in] not connected", searchParams.get("reason") || "no reason given");
    const next = new URLSearchParams(searchParams);
    next.delete("google");
    next.delete("reason");
    setSearchParams(next, { replace: true });
  }, [googleResult, queryClient, searchParams, setSearchParams, toast]);

  // The company slugs a key can be limited to (the same slugs the hub hands over).
  const { data: clientSlugs = [] } = useQuery({
    queryKey: ["client-slugs"],
    queryFn: async () => {
      const data = await fetchActiveClients<{ company_slug: string | null }>("company_slug");
      return Array.from(new Set(data.map((c) => c.company_slug).filter((x): x is string => !!x))).sort();
    },
    enabled: isAdmin,
  });

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <AppLayout title="Settings" description="Workspace connections, portal access and API keys.">
      {/* Every group is one split panel: what it is on the left, its fields
          and list on the right. Settings used to be a separate 896px column
          of cards with three different header patterns. */}
      <HubCompanySync />

      <HiggsfieldConnection />

      <GoogleSlidesConnection />

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
