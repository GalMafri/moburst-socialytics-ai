import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Section } from "@/components/ui/section";
import { useToast } from "@/hooks/use-toast";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { HubCompanySync } from "@/components/HubCompanySync";
import { HiggsfieldConnection } from "@/components/settings/HiggsfieldConnection";
import { GoogleSlidesConnection, type SignInResult } from "@/components/settings/GoogleSlidesConnection";

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

  // Google's sign-in for strategy decks lands back here the same way. A
  // connection is a toast; one that did not connect is said in words on the
  // Google card, from the short reason the sign-in came back with.
  const googleResult = searchParams.get("google");
  const [googleFailure, setGoogleFailure] = useState<SignInResult | null>(null);
  useEffect(() => {
    if (!googleResult) return;
    queryClient.invalidateQueries({ queryKey: ["google-status"] });
    if (googleResult === "connected") {
      setGoogleFailure(null);
      toast({ title: "Google Slides connected" });
    } else {
      setGoogleFailure({ reason: searchParams.get("reason") || "unknown" });
    }
    const next = new URLSearchParams(searchParams);
    next.delete("google");
    next.delete("reason");
    setSearchParams(next, { replace: true });
  }, [googleResult, queryClient, searchParams, setSearchParams, toast]);

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <AppLayout title="Settings" description="Workspace connections and portal access.">
      {/* Every group is one split panel: what it is on the left, its fields
          and list on the right. Settings used to be a separate 896px column
          of cards with three different header patterns. */}
      <HubCompanySync />

      <HiggsfieldConnection />

      <GoogleSlidesConnection signInResult={googleFailure} />

      <p className="t-secondary" data-testid="api-moved">API keys and docs moved to <Link to="/api-access?tab=tokens" className="text-primary underline-offset-4 hover:underline">API</Link>.</p>

      <Section layout="split" eyebrow="Data" title="Sprout Social" description="Connected once for the whole workspace.">
        <div className="glass-inner p-inner flex items-start gap-3">
          <CheckCircle2 className="h-4 w-4 mt-1 shrink-0 text-[#b9e045]" aria-hidden />
          <p className="t-secondary">Every client's figures come from Sprout Social. Connected.</p>
        </div>
      </Section>
    </AppLayout>
  );
}
